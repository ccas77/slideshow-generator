import {
  getAccountData,
  setAccountData,
  getBooksWithCovers,
  appendPostLog,
} from "@/lib/kv";
import { generateImageWithInfo } from "@/lib/gemini";
import { renderSlide, renderCoverSlide } from "@/lib/render-slide";
import { listTikTokAccounts, pbFetch, uploadPng } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled, unmarkScheduled, getScheduledToday } from "./scheduled-today";
import { notify } from "@/lib/notify";
import { notifyPostFailure } from "@/lib/post-failure";
import { withJobTimeout, JOB_TIMEOUT_MS } from "./with-timeout";
import { unlimitedDeadline, type RunDeadline } from "./deadline";
import type { Job, CronAccountResult } from "./types";

// Status prefix for a job we abandoned after the create request was already
// sent. Treated as "do not retry" (no duplicate) but also "do not claim as a
// confirmed post" in the account's recent-post history.
const POSSIBLY_POSTED = "possibly-posted";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runTikTokPhase(
  scheduledToday: Set<string>,
  deadline: RunDeadline = unlimitedDeadline()
): Promise<{ results: CronAccountResult[]; accounts: { id: number; username: string }[]; debugLog: string[] }> {
  const results: CronAccountResult[] = [];
  const debugLog: string[] = [];
  const accounts = await listTikTokAccounts();
  const books = await getBooksWithCovers();
  debugLog.push(`${accounts.length} accounts, ${books.length} books, scheduledToday: ${JSON.stringify([...scheduledToday])}`);

  // Phase 1: Build all jobs (fast, no I/O-heavy work)
  const jobs: Job[] = [];
  const accountData = new Map<number, Awaited<ReturnType<typeof getAccountData>>>();
  const pointerUpdates = new Map<number, number>(); // accId → new pointer
  const promptPointerUpdates = new Map<number, number>(); // accId → new promptPointer

  for (const acc of accounts) {
    try {
      const data = await getAccountData(acc.id);
      accountData.set(acc.id, data);
      if (!data.config.enabled) {
        debugLog.push(`${acc.username} (${acc.id}): disabled`);
        continue;
      }

      const windows = data.config.intervals;
      debugLog.push(`${acc.username} (${acc.id}): enabled, windows=${JSON.stringify(windows)}`);

      for (const win of windows) {
        const willProcess = shouldProcessWindow(win.start);
        const schedKey = `${acc.id}:${win.start}`;
        const alreadyScheduled = scheduledToday.has(schedKey);
        debugLog.push(`  ${win.start}-${win.end}: shouldProcess=${willProcess}, alreadyScheduled=${alreadyScheduled}`);
        if (!willProcess) continue;
        if (alreadyScheduled) continue;
        let imagePrompt = "";
        let imagePromptId = "";
        let slideTexts: string[] = [];
        let slideshowId = "";
        let slideshowName = "";
        let bookName = "";
        let captionText = "";
        let captionId = "";
        let source = "";
        let coverImage: string | undefined;

        const candidates: Array<{
          book: (typeof books)[0];
          slideshow: (typeof books)[0]["slideshows"][0];
        }> = [];

        for (const sel of data.config.selections) {
          const book = books.find((b) => b.id === sel.bookId);
          const slideshow = book?.slideshows.find(
            (s) => s.id === sel.slideshowId
          );
          if (book && slideshow) candidates.push({ book, slideshow });
        }

        if (candidates.length > 0) {
          // Round-robin: use pointer to cycle through candidates
          const currentPointer = pointerUpdates.get(acc.id) ?? (data.config.pointer || 0);
          const pickedIdx = currentPointer % candidates.length;
          const picked = candidates[pickedIdx];
          pointerUpdates.set(acc.id, currentPointer + 1);
          if (!picked || !picked.slideshow.slideTexts.trim()) {
            debugLog.push(`  ${win.start}: skip — no picked slideshow or empty slideTexts (idx=${pickedIdx}, candidates=${candidates.length})`);
            continue;
          }
          const { book, slideshow: pickedSlideshow } = picked;
          // If the slideshow explicitly links prompts/captions, rotate only
          // through those. Otherwise (e.g. imported slideshows with empty
          // id arrays) fall back to the book's full pool so it still posts.
          const linkedPrompts = (book.imagePrompts || []).filter((p) =>
            pickedSlideshow.imagePromptIds.includes(p.id)
          );
          const linkedCaptions = (book.captions || []).filter((c) =>
            pickedSlideshow.captionIds.includes(c.id)
          );
          const allowedPrompts =
            linkedPrompts.length > 0 ? linkedPrompts : book.imagePrompts || [];
          const allowedCaptions =
            linkedCaptions.length > 0 ? linkedCaptions : book.captions || [];
          const currentPromptPointer = promptPointerUpdates.get(acc.id) ?? (data.config.promptPointer || 0);
          const pickedPrompt = allowedPrompts.length > 0 ? allowedPrompts[currentPromptPointer % allowedPrompts.length] : null;
          promptPointerUpdates.set(acc.id, currentPromptPointer + 1);
          const pickedCaption = pickRandom(allowedCaptions);
          if (!pickedPrompt) {
            debugLog.push(`  ${win.start}: skip — no prompt (linkedPrompts=${linkedPrompts.length}, bookPrompts=${(book.imagePrompts||[]).length}, promptPtr=${currentPromptPointer})`);
            continue;
          }
          imagePrompt = pickedPrompt.value;
          imagePromptId = pickedPrompt.id || "";
          slideTexts = pickedSlideshow.slideTexts
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean);
          // If book has a cover image, drop the last text slide (book tag)
          // since the cover replaces it
          if (book.coverImage && slideTexts.length > 2) {
            slideTexts = slideTexts.slice(0, -1);
          }
          captionText = pickedCaption?.value || "";
          captionId = pickedCaption?.id || "";
          slideshowId = pickedSlideshow.id;
          slideshowName = pickedSlideshow.name;
          bookName = book.name;
          coverImage = book.coverImage;
          source = `book:${book.name}/${pickedSlideshow.name}`;
        } else {
          const prompt = pickRandom(data.prompts);
          const textSet = pickRandom(data.texts);
          const captionItem = pickRandom(data.captions);
          if (!prompt || !textSet) {
            debugLog.push(`  ${win.start}: skip — no legacy prompt/textSet (prompts=${data.prompts.length}, texts=${data.texts.length})`);
            continue;
          }
          imagePrompt = prompt.value;
          imagePromptId = prompt.name || "";
          slideTexts = textSet.value
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean);
          captionText = captionItem?.value || "";
          captionId = captionItem?.name || "";
          source = "legacy-saved";
        }

        if (slideTexts.length < 2) {
          debugLog.push(`  ${win.start}: skip — fewer than 2 slide texts (${slideTexts.length})`);
          continue;
        }

        jobs.push({ acc, win, imagePrompt, imagePromptId, slideTexts, slideshowId, slideshowName, bookName, captionText, captionId, source, coverImage, schedKey });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        accountId: acc.id,
        username: acc.username,
        status: `error: ${msg}`,
      });
      await notify({
        subject: `[CONFIRMED] Job build failed for @${acc.username}`,
        body: `Confirmed failure - this is config or data shape, not a transient blip.\n\nAccount: @${acc.username} (${acc.id})\nStep: build jobs (before posting)\n\n${msg}`,
        dedupeKey: `tiktok-build-fail:${acc.id}:${new Date().toISOString().slice(0, 13)}`,
        cooldownSec: 3600,
      });
    }
  }

  // Mark all job keys as scheduled NOW - before heavy work starts.
  const allSchedKeys = jobs.map((j) => j.schedKey);
  if (allSchedKeys.length > 0) {
    await markScheduled(allSchedKeys);
  }

  // Save pointers NOW — before heavy work. If the cron times out during
  // image generation or posting, the pointer is already advanced so the
  // next run won't pick the same slideshows.
  for (const [accId, rawPointer] of pointerUpdates) {
    const data = accountData.get(accId);
    if (!data) continue;
    const rawPromptPointer = promptPointerUpdates.get(accId);
    const newPointer = rawPointer + 1; // +1 bump to shift daily start
    const newPromptPointer = rawPromptPointer !== undefined ? rawPromptPointer + 1 : data.config.promptPointer;
    try {
      await setAccountData(accId, {
        ...data,
        config: {
          ...data.config,
          pointer: newPointer,
          promptPointer: newPromptPointer,
        },
      }, "cron-pointer-early");
      debugLog.push(`Early pointer save ${accId}: pointer=${newPointer}, promptPointer=${newPromptPointer}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.push(`Early pointer save FAILED ${accId}: ${msg}`);
    }
  }

  // Phase 2+3: Generate image, render slides, and post — in parallel batches
  const BATCH_SIZE = 8;
  const postResults: Array<{ job: Job; status: string }> = [];

  async function processJob(job: Job): Promise<{ job: Job; status: string }> {
    let scheduledAt: Date | undefined;
    // Set the instant before POST /v1/posts goes out. If the job is aborted
    // after that point (job timeout, network drop on the response) PostBridge
    // may already have accepted the post, so the window must NOT be released
    // for retry — that is how the 2026-05-08 duplicate-post class happens.
    let postIssued = false;
    try {
      return await withJobTimeout((async () => {
        const imgResult = await generateImageWithInfo(job.imagePrompt);
        if (!imgResult.data) {
          debugLog.push(`${job.acc.username} (${job.acc.id}) ${job.win.start}: image gen failed — ${imgResult.error || "unknown"}`);
          return { job, status: `skipped: image generation failed — ${imgResult.error || "unknown"}` };
        }

        const slideBufs: Buffer[] = [];
        for (const text of job.slideTexts) {
          const buf = await renderSlide(imgResult.data, text);
          slideBufs.push(buf);
        }

        const mediaIds: string[] = [];
        for (let j = 0; j < slideBufs.length; j++) {
          const mediaId = await uploadPng(slideBufs[j], `slide-${j + 1}.png`);
          mediaIds.push(mediaId);
        }

        if (job.coverImage) {
          const coverSlideBuf = await renderCoverSlide(imgResult.data, job.coverImage);
          const coverMediaId = await uploadPng(coverSlideBuf, `slide-${slideBufs.length + 1}-cover.png`);
          mediaIds.push(coverMediaId);
        }

        scheduledAt = randomTimeInWindow(job.win.start, job.win.end);

        postIssued = true;
        const postResp = await pbFetch("/v1/posts", {
          method: "POST",
          body: JSON.stringify({
            caption: job.captionText,
            media: mediaIds,
            social_accounts: [job.acc.id],
            scheduled_at: scheduledAt.toISOString(),
            platform_configurations: {
              tiktok: { draft: false, is_aigc: false },
            },
          }),
        });

        const postId = postResp.id || postResp.data?.id || "unknown";
        const postUrl = postResp.url || postResp.data?.url || "";

        const now = new Date();
        await appendPostLog({
          date: now.toISOString().slice(0, 10),
          time: now.toISOString().slice(11, 16),
          accountId: job.acc.id,
          accountName: job.acc.username,
          bookName: job.bookName,
          slideshowId: job.slideshowId,
          slideshowName: job.slideshowName,
          imagePromptId: job.imagePromptId,
          imagePromptText: job.imagePrompt.slice(0, 100),
          captionId: job.captionId,
          captionText: job.captionText.slice(0, 100),
          postBridgeId: String(postId),
          postBridgeUrl: String(postUrl),
          source: "cron",
          timestamp: now.toISOString(),
        }).catch(() => {});

        return {
          job,
          status: `scheduled ${job.slideTexts.length} slides for ${scheduledAt.toISOString()} (${job.source}) [post:${postId}]`,
        };
      })(), JOB_TIMEOUT_MS, `tiktok ${job.acc.username} (${job.acc.id})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.push(`${job.acc.username} (${job.acc.id}) ${job.win.start}: job error - ${msg}`);

      const result = await notifyPostFailure({
        subject: `[CONFIRMED] TikTok post failed for @${job.acc.username}`,
        body: `Confirmed failure - either an upload retry was exhausted, a fail-fast 4xx, or a POST /v1/posts response error with no matching post found at PostBridge after verification.\n\nAccount: @${job.acc.username} (${job.acc.id})\nStep: TikTok post pipeline\nWindow: ${job.win.start}-${job.win.end}\nBook: ${job.bookName}\nSlideshow: ${job.slideshowName}\nSource: ${job.source}\n\n${msg}`,
        error: err,
        accountId: job.acc.id,
        scheduledAt,
        captionSlice: job.captionText,
        dedupeKey: `tiktok-fail:${job.acc.id}:${new Date().toISOString().slice(0, 13)}`,
        cooldownSec: 3600,
      });
      if (result.verified) {
        debugLog.push(`${job.acc.username} (${job.acc.id}) verified at PostBridge despite ${msg}`);
        return { job, status: `verified-after-error (${msg.slice(0, 80)})` };
      }
      if (postIssued) {
        // Verification could not confirm the post, but the create request was
        // already in flight when we gave up. Retrying risks a duplicate, which
        // is worse than missing one window, so keep the schedule key marked.
        debugLog.push(`${job.acc.username} (${job.acc.id}) aborted after POST was issued — not retrying`);
        return { job, status: `${POSSIBLY_POSTED}: ${msg.slice(0, 80)}` };
      }
      return { job, status: `error: ${msg}` };
    }
  }

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    // Stop starting batches while there is still time to unmark the rest and
    // return cleanly. Being killed here would leave every remaining schedule
    // key marked, silently burning those windows for the day.
    if (!deadline.hasTimeFor(JOB_TIMEOUT_MS)) {
      const deferred = jobs.slice(i);
      debugLog.push(`Out of cron budget — deferring ${deferred.length} TikTok jobs to the next run`);
      await unmarkScheduled(deferred.map((j) => j.schedKey));
      await notify({
        subject: `Slideshow Generator: TikTok phase ran out of cron budget`,
        body: `${deferred.length} TikTok job(s) were not started because the cron run was close to its ${Math.round(JOB_TIMEOUT_MS / 1000)}s-per-job limit within the shared run budget. Their schedule keys were released, so the next run will retry them.\n\nDeferred: ${deferred.map((j) => `${j.acc.username} ${j.win.start}`).join(", ")}`,
        dedupeKey: `budget-exhausted:tiktok:${new Date().toISOString().slice(0, 13)}`,
        cooldownSec: 3600,
      });
      break;
    }
    debugLog.push(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} jobs`);
    const batchResults = await Promise.allSettled(batch.map(processJob));
    batchResults.forEach((r, idx) => {
      // Index-matched: attributing a rejection to batch[0] unmarked the wrong
      // window (duplicate risk) and left the real failure marked (silent loss).
      postResults.push(
        r.status === "fulfilled" ? r.value : { job: batch[idx], status: `error: ${r.reason}` }
      );
    });
  }

  // Un-mark schedule keys for failed jobs so they can retry next invocation
  const failedSchedKeys = postResults
    .filter((r) => r.status.startsWith("skipped:") || r.status.startsWith("error:"))
    .map((r) => r.job.schedKey);
  if (failedSchedKeys.length > 0) {
    debugLog.push(`Un-marking ${failedSchedKeys.length} failed schedule keys: ${JSON.stringify(failedSchedKeys)}`);
    await unmarkScheduled(failedSchedKeys);
  }

  // Phase 4: Aggregate results per account and save status
  const accountStatuses = new Map<number, string[]>();
  const accountNewPosts = new Map<number, Array<{ slideshowName: string; bookName: string; promptSnippet: string; scheduledAt: string; postId: string; timestamp: string }>>();
  for (const r of postResults) {
    const id = r.job.acc.id;
    if (!accountStatuses.has(id)) accountStatuses.set(id, []);
    accountStatuses.get(id)!.push(r.status);
    if (
      !r.status.startsWith("skipped:") &&
      !r.status.startsWith("error:") &&
      !r.status.startsWith(POSSIBLY_POSTED)
    ) {
      if (!accountNewPosts.has(id)) accountNewPosts.set(id, []);
      accountNewPosts.get(id)!.push({
        slideshowName: r.job.slideshowName || "unknown",
        bookName: r.job.bookName || "unknown",
        promptSnippet: r.job.imagePrompt.slice(0, 60),
        scheduledAt: new Date().toISOString(),
        postId: "unknown",
        timestamp: new Date().toISOString(),
      });
    }
  }

  for (const [accId, statuses] of accountStatuses) {
    const acc = jobs.find((j) => j.acc.id === accId)?.acc;
    const status = statuses.join(" | ");
    results.push({
      accountId: accId,
      username: acc?.username || "unknown",
      status,
    });
    try {
      // Read fresh data (pointer was already saved early, don't overwrite it)
      const freshData = await getAccountData(accId);
      const existingHistory = freshData.recentPosts || [];
      const newHistory = [...(accountNewPosts.get(accId) || []), ...existingHistory].slice(0, 20);
      await setAccountData(accId, {
        ...freshData,
        lastRun: new Date().toISOString(),
        lastStatus: status,
        recentPosts: newHistory,
      }, "cron-status");
    } catch (saveErr) {
      const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      debugLog.push(`Save error for ${accId}: ${msg}`);
    }
  }

  // Fallback: if ALL windows passed and no successful post, try once more now
  const currentScheduled = await getScheduledToday();
  const successfulAccounts = new Set(
    postResults
      .filter((r) => !r.status.startsWith("skipped:") && !r.status.startsWith("error:"))
      .map((r) => r.job.acc.id)
  );

  for (const acc of accounts) {
    const data = accountData.get(acc.id);
    if (!data || !data.config.enabled) continue;
    if (data.config.intervals.length === 0) continue;
    // Skip if this account already posted successfully this invocation
    if (successfulAccounts.has(acc.id)) continue;
    // Skip if the fallback already ran for this account today. Without this the
    // fallback fired again on EVERY later cron run — it marks `<id>:fallback`
    // but nothing ever read that key, so an account with no successful window
    // got a fresh duplicate post every 30 minutes until midnight UTC.
    if (currentScheduled.has(`${acc.id}:fallback`)) continue;
    // Skip if any window is still upcoming (normal retry will handle it)
    const anyWindowLeft = data.config.intervals.some((w) => shouldProcessWindow(w.start));
    if (anyWindowLeft) continue;
    // Skip if any schedule key is set (means a previous invocation succeeded)
    const hasSuccessKey = data.config.intervals.some((w) =>
      currentScheduled.has(`${acc.id}:${w.start}`)
    );
    if (hasSuccessKey) continue;
    // No budget left to run a fallback publish; the next run will pick it up
    // (the `<id>:fallback` key is only set on success, so nothing is lost).
    if (!deadline.hasTimeFor(JOB_TIMEOUT_MS)) {
      debugLog.push(`${acc.username} (${acc.id}): fallback skipped — out of cron budget`);
      continue;
    }

    // All windows passed, no successful post today — fallback attempt
    debugLog.push(`${acc.username} (${acc.id}): fallback — all windows passed with no successful post`);
    const candidates: Array<{ book: (typeof books)[0]; slideshow: (typeof books)[0]["slideshows"][0] }> = [];
    for (const sel of data.config.selections) {
      const book = books.find((b) => b.id === sel.bookId);
      const slideshow = book?.slideshows.find((s) => s.id === sel.slideshowId);
      if (book && slideshow) candidates.push({ book, slideshow });
    }
    if (candidates.length === 0) continue;

    const ptr = pointerUpdates.get(acc.id) ?? (data.config.pointer || 0);
    const picked = candidates[ptr % candidates.length];
    if (!picked || !picked.slideshow.slideTexts.trim()) continue;

    const { book, slideshow: pickedSlideshow } = picked;
    const linkedPrompts = (book.imagePrompts || []).filter((p) => pickedSlideshow.imagePromptIds.includes(p.id));
    const allowedPrompts = linkedPrompts.length > 0 ? linkedPrompts : book.imagePrompts || [];
    const pPtr = promptPointerUpdates.get(acc.id) ?? (data.config.promptPointer || 0);
    const pickedPrompt = allowedPrompts.length > 0 ? allowedPrompts[pPtr % allowedPrompts.length] : null;
    if (!pickedPrompt) continue;

    const slideTexts = pickedSlideshow.slideTexts.split("\n").map((t) => t.trim()).filter(Boolean);
    if (slideTexts.length < 2) continue;
    const finalTexts = book.coverImage && slideTexts.length > 2 ? slideTexts.slice(0, -1) : slideTexts;

    const linkedCaptions = (book.captions || []).filter((c) => pickedSlideshow.captionIds.includes(c.id));
    const allowedCaptions = linkedCaptions.length > 0 ? linkedCaptions : book.captions || [];
    const captionText = pickRandom(allowedCaptions)?.value || "";

    let scheduledAt: Date | undefined;
    try {
      const imgResult = await generateImageWithInfo(pickedPrompt.value);
      if (!imgResult.data) {
        debugLog.push(`${acc.username} (${acc.id}) fallback: image gen failed — ${imgResult.error || "unknown"}`);
        results.push({ accountId: acc.id, username: acc.username, status: `fallback failed: ${imgResult.error || "image gen failed"}` });
        continue;
      }

      const slideBufs: Buffer[] = [];
      for (const text of finalTexts) {
        slideBufs.push(await renderSlide(imgResult.data, text));
      }
      const mediaIds: string[] = [];
      for (let j = 0; j < slideBufs.length; j++) {
        mediaIds.push(await uploadPng(slideBufs[j], `slide-${j + 1}.png`));
      }
      if (book.coverImage) {
        const coverSlideBuf = await renderCoverSlide(imgResult.data, book.coverImage);
        mediaIds.push(await uploadPng(coverSlideBuf, `slide-cover.png`));
      }

      // Schedule 5 minutes from now
      scheduledAt = new Date(Date.now() + 5 * 60 * 1000);
      const postResp = await pbFetch("/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          caption: captionText,
          media: mediaIds,
          social_accounts: [acc.id],
          scheduled_at: scheduledAt.toISOString(),
          platform_configurations: { tiktok: { draft: false, is_aigc: false } },
        }),
      });
      const postId = postResp.id || postResp.data?.id || "unknown";
      const postUrl = postResp.url || postResp.data?.url || "";
      const status = `fallback: scheduled ${finalTexts.length} slides for ${scheduledAt.toISOString()} (book:${book.name}/${pickedSlideshow.name}) [post:${postId}]`;
      results.push({ accountId: acc.id, username: acc.username, status });

      const fbNow = new Date();
      await appendPostLog({
        date: fbNow.toISOString().slice(0, 10),
        time: fbNow.toISOString().slice(11, 16),
        accountId: acc.id,
        accountName: acc.username,
        bookName: book.name,
        slideshowId: pickedSlideshow.id,
        slideshowName: pickedSlideshow.name,
        imagePromptId: pickedPrompt.id || "",
        imagePromptText: pickedPrompt.value.slice(0, 100),
        captionId: "",
        captionText: captionText.slice(0, 100),
        postBridgeId: String(postId),
        postBridgeUrl: String(postUrl),
        source: "cron-fallback",
        timestamp: fbNow.toISOString(),
      }).catch(() => {});

      // Mark so we don't fallback again and save pointer
      await markScheduled([`${acc.id}:fallback`]);
      const newPointer = (ptr + 1);
      const newPromptPointer = (pPtr + 1);
      await setAccountData(acc.id, {
        ...data,
        config: { ...data.config, pointer: newPointer, promptPointer: newPromptPointer },
        lastRun: new Date().toISOString(),
        lastStatus: status,
      }, "cron-fallback");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.push(`${acc.username} (${acc.id}) fallback error: ${msg}`);

      const result = await notifyPostFailure({
        subject: `[CONFIRMED] TikTok fallback failed for @${acc.username}`,
        body: `Confirmed failure after retries.\n\nAccount: @${acc.username} (${acc.id})\nStep: TikTok fallback (triggered because no successful post happened in the day's windows, and the fallback also failed).\n\n${msg}`,
        error: err,
        accountId: acc.id,
        scheduledAt,
        captionSlice: captionText,
        dedupeKey: `tiktok-fallback-fail:${acc.id}:${new Date().toISOString().slice(0, 10)}`,
        cooldownSec: 86400,
      });
      if (result.verified) {
        debugLog.push(`${acc.username} (${acc.id}) fallback verified at PostBridge despite ${msg}`);
        results.push({ accountId: acc.id, username: acc.username, status: `fallback verified-after-error` });
      } else {
        results.push({ accountId: acc.id, username: acc.username, status: `fallback error: ${msg}` });
      }
    }
  }

  // Include skipped accounts (enabled=false or no jobs)
  for (const acc of accounts) {
    if (!results.find((r) => r.accountId === acc.id)) {
      results.push({
        accountId: acc.id,
        username: acc.username,
        status: "skipped",
      });
    }
  }

  return { results, accounts, debugLog };
}
