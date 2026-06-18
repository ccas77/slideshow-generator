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
import type { TopNResult } from "./types";

interface TopNJob {
  accIdStr: string;
  accConfig: Awaited<ReturnType<typeof getTopNAutomation>>["accounts"][string];
  selectedList: Awaited<ReturnType<typeof getTopNLists>>[0];
  win: { start: string; end: string };
  schedKey: string;
}

export async function runTopNPhase(
  scheduledToday: Set<string>
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

      // EARLY pointer save: stage the advance in updatedTopNAccounts now.
      // Even if publishTopN times out below, the pointer write happens before
      // heavy work via setTopNAutomation. Mirror of Creator's 2026-06-02 fix.
      // +1 bump prevents pointer cycling back to the same start position when
      // windowsPerDay is a multiple of pool size (2026-05-07 incident class).
      if (windowsToProcess.length > 0) {
        updatedTopNAccounts[accIdStr] = {
          ...accConfig,
          pointer: currentPointer + 1,
          lastPostDate: today,
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

    // Phase 2: heavy work. Pointer is already saved, so even if this times
    // out the next day's cron rotates correctly.
    const failedTopnKeys: string[] = [];
    for (const job of topNJobs) {
      const { accIdStr, accConfig, selectedList, win, schedKey } = job;
      try {
        const scheduledAt = randomTimeInWindow(win.start, win.end);
        const r = await publishTopN({
          listId: selectedList.id,
          accountIds: [Number(accIdStr)],
          scheduledAt: scheduledAt.toISOString(),
          platform: accConfig.platform,
          backgroundPrompts: accConfig.backgroundPrompts,
        });
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        topNResults.push({ listName: selectedList.name, status: `error (${accIdStr}): ${msg}` });
        failedTopnKeys.push(schedKey);
        await notify({
          subject: `[CONFIRMED] TopN post failed for account ${accIdStr}`,
          body: `Confirmed failure after retries.\n\nAccount: ${accIdStr}\nStep: TopN post pipeline\nList: ${selectedList.name}\nWindow: ${win.start}-${win.end}\n\n${msg}`,
          dedupeKey: `topn-fail:${accIdStr}:${new Date().toISOString().slice(0, 13)}`,
          cooldownSec: 3600,
        });
      }
    }
    if (failedTopnKeys.length > 0) {
      await unmarkScheduled(failedTopnKeys);
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
