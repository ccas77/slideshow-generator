import {
  getExcerptAutomation,
  setExcerptAutomation,
  getExcerpts,
  getBooksWithCovers,
  appendPostLog,
} from "@/lib/kv";
import { generateImageWithInfo } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { pbFetch, uploadPng } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled, unmarkScheduled } from "./scheduled-today";
import { notify } from "@/lib/notify";
import { notifyPostFailure } from "@/lib/post-failure";
import { withJobTimeout, JOB_TIMEOUT_MS } from "./with-timeout";
import { unlimitedDeadline, type RunDeadline } from "./deadline";
import { buildGoneAccountGuard } from "./live-accounts";
import type { ExcerptAutoResult } from "./types";

function pickRandom<T>(arr: T[]): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runExcerptPhase(
  scheduledToday: Set<string>,
  deadline: RunDeadline = unlimitedDeadline()
): Promise<ExcerptAutoResult[]> {
  const results: ExcerptAutoResult[] = [];
  let outOfBudget = false;
  try {
    const auto = await getExcerptAutomation();
    if (!auto.accounts || Object.keys(auto.accounts).length === 0) return results;

    const excerpts = await getExcerpts();
    const books = await getBooksWithCovers();
    if (excerpts.length === 0) return results;

    const updatedAccounts = { ...auto.accounts };
    const isGone = await buildGoneAccountGuard();

    for (const [accIdStr, accConfig] of Object.entries(auto.accounts)) {
      if (outOfBudget) break;
      if (!accConfig.enabled || accConfig.intervals.length === 0) continue;
      if (await isGone(accIdStr, "excerpt")) {
        results.push({
          status: `${accIdStr}: skipped — PostBridge no longer has this account`,
        });
        continue;
      }

      // Build excerpt pool
      let pool = excerpts.filter(
        (e) => e.imagePrompts.length > 0
      );
      if (accConfig.excerptIds.length > 0) {
        pool = pool.filter((e) => accConfig.excerptIds.includes(e.id));
      }
      if (pool.length === 0) continue;

      let pointer = accConfig.pointer;

      // Mark schedule keys upfront
      const windowsToProcess = accConfig.intervals.filter(
        (w) =>
          shouldProcessWindow(w.start) &&
          !scheduledToday.has(`excerpt:${accIdStr}:${w.start}`)
      );
      const schedKeys = windowsToProcess.map((w) => `excerpt:${accIdStr}:${w.start}`);
      if (schedKeys.length > 0) await markScheduled(schedKeys);
      const failedExcerptKeys: string[] = [];

      // EARLY pointer save, before any heavy work — same fix as the TikTok
      // (2026-05-07) and TopN (2026-06-02 / 2026-06-15) phases, which this one
      // never received: a kill mid-loop left the pointer pinned and the account
      // replayed the same excerpt the next day. The +1 bump shifts the daily
      // start position (2026-05-07 incident class).
      if (windowsToProcess.length > 0) {
        updatedAccounts[accIdStr] = {
          ...accConfig,
          pointer: accConfig.pointer + windowsToProcess.length + 1,
        };
        try {
          await setExcerptAutomation({ accounts: updatedAccounts });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await notify({
            subject: "Slideshow Generator: excerpt early pointer save failed",
            body: `setExcerptAutomation threw during the early save for account ${accIdStr}. The pointer may not advance today, so tomorrow could repeat today's excerpt.\n\n${msg}`,
            dedupeKey: `excerpt-early-save-fail:${accIdStr}`,
            cooldownSec: 3600,
          });
        }
      }

      for (const win of accConfig.intervals) {
        if (!shouldProcessWindow(win.start)) continue;
        if (scheduledToday.has(`excerpt:${accIdStr}:${win.start}`)) continue;
        // Release anything we cannot start in the remaining budget rather than
        // being killed with the key still marked.
        if (!deadline.hasTimeFor(JOB_TIMEOUT_MS)) {
          outOfBudget = true;
          failedExcerptKeys.push(`excerpt:${accIdStr}:${win.start}`);
          results.push({ status: `deferred (${accIdStr}) ${win.start}: out of cron budget` });
          continue;
        }

        const excerpt = pool[pointer % pool.length];
        const prompt = pickRandom(excerpt.imagePrompts);
        const hookText = pickRandom(excerpt.overlayTexts);

        let scheduledAt: Date | undefined;
        let postIssued = false;
        try {
          const skipReason = await withJobTimeout((async (): Promise<string | null> => {
          // Build slides
          const mediaIds: string[] = [];

          // Slide 1: Hook — AI image with overlay text
          let hookImageData: string | null = null;
          if (prompt) {
            const hookResult = await generateImageWithInfo(prompt);
            hookImageData = hookResult.data;
            if (!hookImageData) {
              results.push({ status: `warn (${accIdStr}): hook image failed — ${hookResult.error || "unknown"}` });
            }
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

          // Optional extra hook slide (fresh AI image from its own prompts)
          const extraPrompts = excerpt.extraImagePrompts?.filter(Boolean) || [];
          const extraTexts = excerpt.extraOverlayTexts?.filter(Boolean) || [];
          if (extraPrompts.length > 0) {
            const extraPrompt = pickRandom(extraPrompts);
            const extraText = extraTexts.length > 0 ? pickRandom(extraTexts) : undefined;
            if (extraPrompt) {
              const extraResult = await generateImageWithInfo(extraPrompt);
              const extraImageData = extraResult.data;
              if (!extraImageData) {
                results.push({ status: `warn (${accIdStr}): extra hook image failed — ${extraResult.error || "unknown"}` });
              }
              if (extraText) {
                const extraBuf = await renderSlide(extraImageData, extraText);
                mediaIds.push(
                  await uploadPng(extraBuf, `excerpt-auto-${accIdStr}-hook2.png`)
                );
              } else if (extraImageData) {
                const b64 = extraImageData.includes(",")
                  ? extraImageData.split(",")[1]
                  : extraImageData;
                const buf = Buffer.from(b64, "base64");
                mediaIds.push(
                  await uploadPng(buf, `excerpt-auto-${accIdStr}-hook2.png`)
                );
              }
            }
          }

          // Excerpt images (optional)
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
            return `skip: ${excerpt.name} — not enough slides (${mediaIds.length})`;
          }

          const platformCfg =
            accConfig.platform === "instagram"
              ? { instagram: {} }
              : { tiktok: { draft: false, is_aigc: false } };

          scheduledAt = randomTimeInWindow(win.start, win.end);
          postIssued = true;
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
          const postUrl = postResp.url || postResp.data?.url || "";
          results.push({
            status: `${excerpt.name} → ${accIdStr} at ${scheduledAt.toISOString()} [post:${postId}]`,
          });

          const exNow = new Date();
          await appendPostLog({
            date: exNow.toISOString().slice(0, 10),
            time: exNow.toISOString().slice(11, 16),
            accountId: Number(accIdStr),
            accountName: accIdStr,
            bookName: "",
            slideshowId: excerpt.id,
            slideshowName: excerpt.name,
            imagePromptId: "",
            imagePromptText: (prompt || "").slice(0, 100),
            captionId: "",
            captionText: (hookText || "").slice(0, 100),
            postBridgeId: String(postId),
            postBridgeUrl: String(postUrl),
            source: "cron-excerpt",
            timestamp: exNow.toISOString(),
          }).catch(() => {});
          return null;
          })(), JOB_TIMEOUT_MS, `excerpt ${accIdStr} name=${excerpt.name}`);
          if (skipReason) {
            results.push({ status: skipReason });
            if (skipReason.startsWith("skip:")) {
              failedExcerptKeys.push(`excerpt:${accIdStr}:${win.start}`);
            }
            pointer++;
            continue;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const result = await notifyPostFailure({
            subject: `[CONFIRMED] Excerpt post failed for account ${accIdStr}`,
            body: `Confirmed failure after retries.\n\nAccount: ${accIdStr}\nStep: excerpt post pipeline\nExcerpt: ${excerpt.name}\nWindow: ${win.start}-${win.end}\n\n${msg}`,
            error: err,
            accountId: Number(accIdStr),
            scheduledAt,
            dedupeKey: `excerpt-fail:${accIdStr}:${new Date().toISOString().slice(0, 13)}`,
            cooldownSec: 3600,
          });
          if (result.verified) {
            results.push({ status: `${excerpt.name} → ${accIdStr} verified-after-error` });
          } else {
            results.push({ status: `error (${accIdStr}): ${msg}` });
            if (!postIssued) {
              // Aborted before the create request went out, so a retry is
              // safe. If it went out, keep the key marked rather than risk a
              // duplicate post.
              failedExcerptKeys.push(`excerpt:${accIdStr}:${win.start}`);
            }
          }
        }

        pointer++;
      }

      if (failedExcerptKeys.length > 0) {
        await unmarkScheduled(failedExcerptKeys);
      }

    }
    // Pointer is persisted per account before its heavy work (see above), so
    // there is deliberately no post-loop save here.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ status: `Excerpt automation error: ${msg}` });
    await notify({
      subject: "Slideshow Generator: excerpt phase crashed",
      body: `Excerpt automation threw before completing.\n\n${msg}`,
      dedupeKey: "excerpt-phase-crash",
      cooldownSec: 3600,
    });
  }

  return results;
}
