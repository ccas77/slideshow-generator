import {
  getAccountData,
  setAccountData,
  getBooksWithCovers,
} from "@/lib/kv";
import { generateImageWithInfo } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { listTikTokAccounts, pbFetch, uploadPng } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled, unmarkScheduled, getScheduledToday } from "./scheduled-today";
import type { Job, CronAccountResult } from "./types";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runTikTokPhase(
  scheduledToday: Set<string>
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
        let slideTexts: string[] = [];
        let captionText = "";
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
          slideTexts = textSet.value
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean);
          captionText = captionItem?.value || "";
          source = "legacy-saved";
        }

        if (slideTexts.length < 2) {
          debugLog.push(`  ${win.start}: skip — fewer than 2 slide texts (${slideTexts.length})`);
          continue;
        }

        jobs.push({ acc, win, imagePrompt, slideTexts, captionText, source, coverImage, schedKey });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        accountId: acc.id,
        username: acc.username,
        status: `error: ${msg}`,
      });
    }
  }

  // Mark all job keys as scheduled NOW — before heavy work starts.
  const allSchedKeys = jobs.map((j) => j.schedKey);
  if (allSchedKeys.length > 0) {
    await markScheduled(allSchedKeys);
  }

  // Phase 2+3: Generate image, render slides, and post — one job at a time
  const postResults: Array<{ job: Job; status: string }> = [];

  for (const job of jobs) {
    try {
      const imgResult = await generateImageWithInfo(job.imagePrompt);
      if (!imgResult.data) {
        debugLog.push(`${job.acc.username} (${job.acc.id}) ${job.win.start}: image gen failed — ${imgResult.error || "unknown"}`);
        postResults.push({ job, status: `skipped: image generation failed — ${imgResult.error || "unknown"}` });
        continue;
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

      // Upload book cover as final slide if available
      if (job.coverImage) {
        const base64 = job.coverImage.replace(/^data:[^;]+;base64,/, "");
        const coverBuf = Buffer.from(base64, "base64");
        const coverMediaId = await uploadPng(coverBuf, `slide-${slideBufs.length + 1}-cover.png`);
        mediaIds.push(coverMediaId);
      }

      const scheduledAt = randomTimeInWindow(job.win.start, job.win.end);

      const postResp = await pbFetch("/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          caption: job.captionText,
          media: mediaIds,
          social_accounts: [job.acc.id],
          scheduled_at: scheduledAt.toISOString(),
          platform_configurations: {
            tiktok: { draft: false, is_aigc: true },
          },
        }),
      });

      const postId = postResp.id || postResp.data?.id || "unknown";
      postResults.push({
        job,
        status: `scheduled ${job.slideTexts.length} slides for ${scheduledAt.toISOString()} (${job.source}) [post:${postId}]`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.push(`${job.acc.username} (${job.acc.id}) ${job.win.start}: job error — ${msg}`);
      postResults.push({ job, status: `error: ${msg}` });
    }
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
  for (const r of postResults) {
    const id = r.job.acc.id;
    if (!accountStatuses.has(id)) accountStatuses.set(id, []);
    accountStatuses.get(id)!.push(r.status);
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
      const data = accountData.get(accId);
      if (data) {
        // Bump pointers by 1 extra so daily rotation doesn't repeat
        // when windows_per_day is a multiple of candidates.length
        const rawPointer = pointerUpdates.get(accId);
        const newPointer = rawPointer !== undefined ? rawPointer + 1 : undefined;
        const rawPromptPointer = promptPointerUpdates.get(accId);
        const newPromptPointer = rawPromptPointer !== undefined ? rawPromptPointer + 1 : undefined;
        await setAccountData(accId, {
          ...data,
          config: {
            ...data.config,
            ...(newPointer !== undefined ? { pointer: newPointer } : {}),
            ...(newPromptPointer !== undefined ? { promptPointer: newPromptPointer } : {}),
          },
          lastRun: new Date().toISOString(),
          lastStatus: status,
        }, "cron");
      }
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
    // Skip if any window is still upcoming (normal retry will handle it)
    const anyWindowLeft = data.config.intervals.some((w) => shouldProcessWindow(w.start));
    if (anyWindowLeft) continue;
    // Skip if any schedule key is set (means a previous invocation succeeded)
    const hasSuccessKey = data.config.intervals.some((w) =>
      currentScheduled.has(`${acc.id}:${w.start}`)
    );
    if (hasSuccessKey) continue;

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
        const b64 = book.coverImage.replace(/^data:[^;]+;base64,/, "");
        mediaIds.push(await uploadPng(Buffer.from(b64, "base64"), `slide-cover.png`));
      }

      // Schedule 5 minutes from now
      const scheduledAt = new Date(Date.now() + 5 * 60 * 1000);
      const postResp = await pbFetch("/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          caption: captionText,
          media: mediaIds,
          social_accounts: [acc.id],
          scheduled_at: scheduledAt.toISOString(),
          platform_configurations: { tiktok: { draft: false, is_aigc: true } },
        }),
      });
      const postId = postResp.id || postResp.data?.id || "unknown";
      const status = `fallback: scheduled ${finalTexts.length} slides for ${scheduledAt.toISOString()} (book:${book.name}/${pickedSlideshow.name}) [post:${postId}]`;
      results.push({ accountId: acc.id, username: acc.username, status });

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
      results.push({ accountId: acc.id, username: acc.username, status: `fallback error: ${msg}` });
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
