import {
  getTopNLists,
  getTopNAutomation,
  setTopNAutomation,
  appendPostLog,
} from "@/lib/kv";
import { publishTopN } from "@/lib/topn-publisher";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled, unmarkScheduled } from "./scheduled-today";
import { notify } from "@/lib/notify";
import { notifyPostFailure } from "@/lib/post-failure";
import { withJobTimeout, JOB_TIMEOUT_MS } from "./with-timeout";
import { unlimitedDeadline, type RunDeadline } from "./deadline";
import type { TopNResult } from "./types";

// Cap how many TopN publishes run at once. Each publishTopN takes 30-90s
// (Gemini bg image + slide render + N PB uploads + POST + verify). Serial
// processing at 13 accounts blew past Vercel's request timeout and killed
// the function mid-loop with no thrown error to catch. See 2026-07-05
// incident-log entry. Batch of 3 keeps wall-clock under ~5 min for 13
// accounts even in the worst case.
const TOPN_BATCH_SIZE = 3;

// Platforms whose publish path runs ffmpeg (see isVideo in lib/topn-publisher.ts).
// These are memory-heavy and must not run concurrently with each other.
function isVideoPlatform(platform?: string): boolean {
  return platform === "tiktok-video" || platform === "fb-video" || platform === "ig-video";
}

interface TopNJob {
  accIdStr: string;
  accConfig: Awaited<ReturnType<typeof getTopNAutomation>>["accounts"][string];
  selectedList: Awaited<ReturnType<typeof getTopNLists>>[0];
  win: { start: string; end: string };
  schedKey: string;
}

export async function runTopNPhase(
  scheduledToday: Set<string>,
  deadline: RunDeadline = unlimitedDeadline()
): Promise<TopNResult[]> {
  const topNResults: TopNResult[] = [];
  try {
    const topNLists = await getTopNLists();
    const topNAuto = await getTopNAutomation();
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const updatedTopNAccounts = { ...topNAuto.accounts };

    // Phase 1: build all jobs across accounts, advancing the pointer for each.
    const topNJobs: TopNJob[] = [];
    const excessSchedKeys: string[] = [];

    for (const [accIdStr, accConfig] of Object.entries(topNAuto.accounts)) {
      if (!accConfig.enabled || accConfig.intervals.length === 0) continue;

      // Frequency check: skip if not enough days since last post
      if (accConfig.lastPostDate) {
        const lastDate = new Date(accConfig.lastPostDate + "T00:00:00Z");
        const todayDate = new Date(today + "T00:00:00Z");
        const daysSince = Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000);
        if (daysSince < accConfig.frequencyDays) continue;
      }

      // Build eligible list pool
      let pool = topNLists.filter((l) => l.bookIds.length > 0 || (l.genres && l.genres.length > 0));
      if (accConfig.listIds.length > 0) {
        pool = pool.filter((l) => accConfig.listIds.includes(l.id));
      }
      if (pool.length === 0) continue;

      // Check if any window is active this hour and not already scheduled
      const activeWindows = accConfig.intervals.filter((w) => {
        const sk = `topn:${accIdStr}:${w.start}`;
        return shouldProcessWindow(w.start) && !scheduledToday.has(sk);
      });
      if (activeWindows.length === 0) continue;

      // Cap windows to pool size so we never post the same list twice.
      // Mark ALL window keys (including excess) so skipped windows don't fire on later cron runs.
      const windowsToProcess = activeWindows.slice(0, pool.length);
      const excessKeys = activeWindows
        .slice(pool.length)
        .map((w) => `topn:${accIdStr}:${w.start}`);
      excessSchedKeys.push(...excessKeys);

      let currentPointer = accConfig.pointer;
      for (const win of windowsToProcess) {
        const listIndex = currentPointer % pool.length;
        const selectedList = pool[listIndex];
        currentPointer++;
        topNJobs.push({
          accIdStr,
          accConfig,
          selectedList,
          win,
          schedKey: `topn:${accIdStr}:${win.start}`,
        });
      }

      // EARLY pointer save: stage the pointer advance in updatedTopNAccounts
      // now. Even if publishTopN times out below, the pointer write happens
      // before heavy work via setTopNAutomation (2026-06-02 stuck-rotation
      // fix). +1 bump prevents pointer cycling back to the same start
      // position when windowsPerDay is a multiple of pool size (2026-05-07
      // incident class).
      //
      // NOTE (2026-07-05 incident fix): we no longer batch-save lastPostDate
      // here. The old code set lastPostDate=today for every account before
      // publishTopN ran, so a Vercel timeout killed the loop mid-flight and
      // then subsequent crons skipped every unprocessed account via the
      // frequency check. lastPostDate is now saved per-account AFTER
      // publishTopN succeeds, in phase 3 below.
      if (windowsToProcess.length > 0) {
        updatedTopNAccounts[accIdStr] = {
          ...accConfig,
          pointer: currentPointer + 1,
        };
      }
    }

    // Mark all schedule keys NOW, before any heavy work.
    const allSchedKeys = [...topNJobs.map((j) => j.schedKey), ...excessSchedKeys];
    if (allSchedKeys.length > 0) {
      await markScheduled(allSchedKeys);
    }

    // EARLY save: persist pointer advances and lastPostDate BEFORE publishTopN.
    if (topNJobs.length > 0) {
      try {
        await setTopNAutomation({ accounts: updatedTopNAccounts });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await notify({
          subject: "Slideshow Generator: TopN early pointer save failed",
          body: `setTopNAutomation threw during the early save. Pointer may not advance for today; tomorrow's cron may repeat today's lists.\n\n${msg}`,
          dedupeKey: "topn-early-save-fail",
          cooldownSec: 3600,
        });
      }
    }

    // Phase 2: heavy work. Batched via Promise.allSettled so 13 accounts at
    // ~30-90s each don't blow past Vercel's request timeout. Pointer is
    // already saved above, so even if this times out the next day's cron
    // rotates to different lists correctly.
    const failedTopnKeys: string[] = [];
    const successfulAccountIds = new Set<string>();

    async function runJob(job: TopNJob): Promise<void> {
      const { accIdStr, accConfig, selectedList, win, schedKey } = job;
      let scheduledAt: Date | undefined;
      try {
        scheduledAt = randomTimeInWindow(win.start, win.end);
        const r = await withJobTimeout(
          publishTopN({
            listId: selectedList.id,
            accountIds: [Number(accIdStr)],
            scheduledAt: scheduledAt.toISOString(),
            platform: accConfig.platform,
            backgroundPrompts: accConfig.backgroundPrompts,
          }),
          JOB_TIMEOUT_MS,
          `topn ${accIdStr} list=${selectedList.id}`,
        );
        topNResults.push({
          listName: selectedList.name,
          status: `${accIdStr}: scheduled ${r.slides} slides for ${scheduledAt.toISOString()} [post:${r.postId}]`,
        });

        const tnNow = new Date();
        await appendPostLog({
          date: tnNow.toISOString().slice(0, 10),
          time: tnNow.toISOString().slice(11, 16),
          accountId: Number(accIdStr),
          accountName: accIdStr,
          bookName: "",
          slideshowId: selectedList.id,
          slideshowName: selectedList.name,
          imagePromptId: "",
          imagePromptText: "",
          captionId: "",
          captionText: "",
          postBridgeId: String(r.postId),
          postBridgeUrl: r.postUrl || "",
          source: "cron-topn",
          timestamp: tnNow.toISOString(),
        }).catch(() => {});

        // Mark this account as truly-posted-today so the per-account
        // lastPostDate save at phase 3 covers it (and only it).
        successfulAccountIds.add(accIdStr);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const result = await notifyPostFailure({
          subject: `[CONFIRMED] TopN post failed for account ${accIdStr}`,
          body: `Confirmed failure after retries.\n\nAccount: ${accIdStr}\nStep: TopN post pipeline\nList: ${selectedList.name}\nWindow: ${win.start}-${win.end}\n\n${msg}`,
          error: err,
          accountId: Number(accIdStr),
          scheduledAt,
          dedupeKey: `topn-fail:${accIdStr}:${new Date().toISOString().slice(0, 13)}`,
          cooldownSec: 3600,
        });
        if (result.verified) {
          topNResults.push({ listName: selectedList.name, status: `${accIdStr}: verified-after-error` });
          // Verified-after-error means PostBridge has the post, so this
          // account did effectively publish today. Mark it as such so we
          // don't retry tomorrow morning.
          successfulAccountIds.add(accIdStr);
        } else {
          topNResults.push({ listName: selectedList.name, status: `error (${accIdStr}): ${msg}` });
          failedTopnKeys.push(schedKey);
        }
      }
    }

    // Video jobs run ffmpeg and hold a multi-MB background image plus every
    // rendered slide in memory at once. Three of those concurrently killed the
    // 2026-07-27 00:30 run with "instance was killed because it ran out of
    // available memory" — three jobs reached phase=renderVideo together after
    // taking 120-172s each in generateSlides. Carousels stay batched; video
    // jobs are strictly serial so peak memory is one encode, not three.
    const batches: TopNJob[][] = [];
    const carouselJobs = topNJobs.filter((j) => !isVideoPlatform(j.accConfig.platform));
    const videoJobs = topNJobs.filter((j) => isVideoPlatform(j.accConfig.platform));
    for (let i = 0; i < carouselJobs.length; i += TOPN_BATCH_SIZE) {
      batches.push(carouselJobs.slice(i, i + TOPN_BATCH_SIZE));
    }
    for (const job of videoJobs) batches.push([job]);

    for (let b = 0; b < batches.length; b++) {
      // Stop starting batches while there is still time to release the rest.
      // A Vercel kill here is the 2026-07-05 failure mode: keys stay marked,
      // nothing throws, and the accounts go silent for the day.
      if (!deadline.hasTimeFor(JOB_TIMEOUT_MS)) {
        const deferred = batches.slice(b).flat();
        await unmarkScheduled(deferred.map((j) => j.schedKey));
        await notify({
          subject: "Slideshow Generator: TopN phase ran out of cron budget",
          body: `${deferred.length} TopN job(s) were not started because the run was near its budget. Their schedule keys were released so the next run retries them.\n\nDeferred accounts: ${deferred.map((j) => j.accIdStr).join(", ")}`,
          dedupeKey: `budget-exhausted:topn:${new Date().toISOString().slice(0, 13)}`,
          cooldownSec: 3600,
        });
        break;
      }
      await Promise.allSettled(batches[b].map(runJob));
    }

    if (failedTopnKeys.length > 0) {
      await unmarkScheduled(failedTopnKeys);
    }

    // Phase 3: save lastPostDate=today for accounts that actually published.
    // Read the current config fresh to avoid stomping any concurrent changes
    // (early pointer save already committed above).
    if (successfulAccountIds.size > 0) {
      try {
        const currentAuto = await getTopNAutomation();
        const finalUpdated = { ...currentAuto.accounts };
        for (const accIdStr of successfulAccountIds) {
          if (finalUpdated[accIdStr]) {
            finalUpdated[accIdStr] = {
              ...finalUpdated[accIdStr],
              lastPostDate: today,
            };
          }
        }
        await setTopNAutomation({ accounts: finalUpdated });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await notify({
          subject: "Slideshow Generator: TopN lastPostDate save failed",
          body: `Post-publish lastPostDate save threw. Accounts that published today may retry tomorrow if the pointer save already committed; harmless but noisy.\n\n${msg}`,
          dedupeKey: "topn-lastpost-save-fail",
          cooldownSec: 3600,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    topNResults.push({ listName: "(topn-auto)", status: `error: ${msg}` });
    await notify({
      subject: "Slideshow Generator: TopN phase crashed",
      body: `TopN automation threw before completing.\n\n${msg}`,
      dedupeKey: "topn-phase-crash",
      cooldownSec: 3600,
    });
  }

  return topNResults;
}
