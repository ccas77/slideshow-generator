import {
  getExcerptAutomation,
  setExcerptAutomation,
  getExcerpts,
  getBooks,
} from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { pbFetch, uploadPng } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled } from "./scheduled-today";
import type { ExcerptAutoResult } from "./types";

function pickRandom<T>(arr: T[]): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runExcerptPhase(
  scheduledToday: Set<string>
): Promise<ExcerptAutoResult[]> {
  const results: ExcerptAutoResult[] = [];
  try {
    const auto = await getExcerptAutomation();
    if (!auto.accounts || Object.keys(auto.accounts).length === 0) return results;

    const excerpts = await getExcerpts();
    const books = await getBooks();
    if (excerpts.length === 0) return results;

    let updated = false;
    const updatedAccounts = { ...auto.accounts };

    for (const [accIdStr, accConfig] of Object.entries(auto.accounts)) {
      if (!accConfig.enabled || accConfig.intervals.length === 0) continue;

      // Build excerpt pool
      let pool = excerpts.filter(
        (e) => e.imagePrompts.length > 0 && e.excerptImages.length > 0
      );
      if (accConfig.excerptIds.length > 0) {
        pool = pool.filter((e) => accConfig.excerptIds.includes(e.id));
      }
      if (pool.length === 0) continue;

      let pointer = accConfig.pointer;

      // Mark schedule keys upfront
      const schedKeys = accConfig.intervals
        .filter(
          (w) =>
            shouldProcessWindow(w.start) &&
            !scheduledToday.has(`excerpt:${accIdStr}:${w.start}`)
        )
        .map((w) => `excerpt:${accIdStr}:${w.start}`);
      if (schedKeys.length > 0) await markScheduled(schedKeys);

      for (const win of accConfig.intervals) {
        if (!shouldProcessWindow(win.start)) continue;
        if (scheduledToday.has(`excerpt:${accIdStr}:${win.start}`)) continue;

        const excerpt = pool[pointer % pool.length];
        const prompt = pickRandom(excerpt.imagePrompts);
        const hookText = pickRandom(excerpt.overlayTexts);

        try {
          // Build slides
          const mediaIds: string[] = [];

          // Slide 1: Hook — AI image with overlay text
          if (prompt) {
            const hookImageData = await generateImage(prompt);
            if (hookText) {
              const hookBuf = await renderSlide(hookImageData, hookText);
              mediaIds.push(
                await uploadPng(hookBuf, `excerpt-auto-${accIdStr}-hook.png`)
              );
            } else if (hookImageData) {
              const b64 = hookImageData.includes(",")
                ? hookImageData.split(",")[1]
                : hookImageData;
              const buf = Buffer.from(b64, "base64");
              mediaIds.push(
                await uploadPng(buf, `excerpt-auto-${accIdStr}-hook.png`)
              );
            }
          }

          // Slides 2+: Excerpt images
          for (let i = 0; i < excerpt.excerptImages.length; i++) {
            const img = excerpt.excerptImages[i];
            const b64 = img.imageData.includes(",")
              ? img.imageData.split(",")[1]
              : img.imageData;
            const buf = Buffer.from(b64, "base64");
            mediaIds.push(
              await uploadPng(buf, `excerpt-auto-${accIdStr}-${i + 1}.png`)
            );
          }

          // Final slide: Book cover
          if (excerpt.bookId) {
            const book = books.find((b) => b.id === excerpt.bookId);
            if (book?.coverImage) {
              const b64 = book.coverImage.includes(",")
                ? book.coverImage.split(",")[1]
                : book.coverImage;
              const buf = Buffer.from(b64, "base64");
              mediaIds.push(
                await uploadPng(buf, `excerpt-auto-${accIdStr}-cover.png`)
              );
            }
          }

          if (mediaIds.length < 2) {
            results.push({
              status: `skip: ${excerpt.name} — not enough slides (${mediaIds.length})`,
            });
            pointer++;
            continue;
          }

          const platformCfg =
            accConfig.platform === "instagram"
              ? { instagram: {} }
              : { tiktok: { draft: false, is_aigc: true } };

          const scheduledAt = randomTimeInWindow(win.start, win.end);
          const postResp = await pbFetch("/v1/posts", {
            method: "POST",
            body: JSON.stringify({
              caption: " ",
              media: mediaIds,
              social_accounts: [Number(accIdStr)],
              scheduled_at: scheduledAt.toISOString(),
              platform_configurations: platformCfg,
            }),
          });
          const postId = postResp.id || postResp.data?.id || "unknown";
          results.push({
            status: `${excerpt.name} → ${accIdStr} at ${scheduledAt.toISOString()} [post:${postId}]`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({ status: `error (${accIdStr}): ${msg}` });
        }

        pointer++;
      }

      updatedAccounts[accIdStr] = { ...accConfig, pointer };
      updated = true;
    }

    if (updated) {
      await setExcerptAutomation({ accounts: updatedAccounts });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ status: `Excerpt automation error: ${msg}` });
  }

  return results;
}
