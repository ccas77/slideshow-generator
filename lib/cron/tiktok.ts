import {
  getAccountData,
  setAccountData,
  getBooks,
} from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { listTikTokAccounts, pbFetch, uploadPng } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled } from "./scheduled-today";
import type { Job, CronAccountResult } from "./types";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runTikTokPhase(
  scheduledToday: Set<string>
): Promise<{ results: CronAccountResult[]; accounts: { id: number; username: string }[] }> {
  const results: CronAccountResult[] = [];
  const accounts = await listTikTokAccounts();
  const books = await getBooks();

  // Phase 1: Build all jobs (fast, no I/O-heavy work)
  const jobs: Job[] = [];
  const accountData = new Map<number, Awaited<ReturnType<typeof getAccountData>>>();
  const pointerUpdates = new Map<number, number>(); // accId → new pointer
  const promptPointerUpdates = new Map<number, number>(); // accId → new promptPointer

  for (const acc of accounts) {
    try {
      const data = await getAccountData(acc.id);
      accountData.set(acc.id, data);
      if (!data.config.enabled) continue;

      const windows = data.config.intervals;

      for (const win of windows) {
        if (!shouldProcessWindow(win.start)) continue;
        const schedKey = `${acc.id}:${win.start}`;
        if (scheduledToday.has(schedKey)) continue;
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
          if (!picked || !picked.slideshow.slideTexts.trim()) continue;
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
          if (!pickedPrompt) continue;
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
          if (!prompt || !textSet) continue;
          imagePrompt = prompt.value;
          slideTexts = textSet.value
            .split("\n")
            .map((t) => t.trim())
            .filter(Boolean);
          captionText = captionItem?.value || "";
          source = "legacy-saved";
        }

        if (slideTexts.length < 2) continue;

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

  // Phase 2: Generate all images in parallel (Gemini API, no sharp involved)
  const images = await Promise.all(
    jobs.map(async (job) => {
      try {
        return await generateImage(job.imagePrompt);
      } catch {
        return null;
      }
    })
  );

  // Phase 3: Render slides strictly one at a time (sharp Pango fails under concurrency)
  // Then upload and post each job
  const postResults: Array<{ job: Job; status: string }> = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const image = images[i];
    if (!image) {
      postResults.push({ job, status: "skipped: image generation failed" });
      continue;
    }
    try {
      const slideBufs: Buffer[] = [];

      for (const text of job.slideTexts) {
        const buf = await renderSlide(image, text);
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
      postResults.push({ job, status: `error: ${msg}` });
    }
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
        const newPointer = pointerUpdates.get(accId);
        const newPromptPointer = promptPointerUpdates.get(accId);
        await setAccountData(accId, {
          ...data,
          config: {
            ...data.config,
            ...(newPointer !== undefined ? { pointer: newPointer } : {}),
            ...(newPromptPointer !== undefined ? { promptPointer: newPromptPointer } : {}),
          },
          lastRun: new Date().toISOString(),
          lastStatus: status,
        });
      }
    } catch {}
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

  return { results, accounts };
}
