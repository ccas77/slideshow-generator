import {
  getIgAutomation,
  getIgSlideshows,
  setIgAutomation,
  appendPostLog,
} from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { pbFetch, uploadPng } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled, unmarkScheduled } from "./scheduled-today";
import { notify } from "@/lib/notify";
import { notifyPostFailure } from "@/lib/post-failure";
import { withJobTimeout, JOB_TIMEOUT_MS } from "./with-timeout";
import { unlimitedDeadline, type RunDeadline } from "./deadline";
import type { IgAutoResult } from "./types";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runInstagramPhase(
  scheduledToday: Set<string>,
  deadline: RunDeadline = unlimitedDeadline()
): Promise<IgAutoResult[]> {
  const igAutoResults: IgAutoResult[] = [];
  let outOfBudget = false;
  try {
    const igAuto = await getIgAutomation();
    if (igAuto.accounts && Object.keys(igAuto.accounts).length > 0) {
      const igSlideshows = await getIgSlideshows();
      if (igSlideshows.length > 0) {
        const updatedAccounts = { ...igAuto.accounts };

        for (const [accIdStr, accConfig] of Object.entries(igAuto.accounts)) {
          if (outOfBudget) break;
          if (!accConfig.enabled || accConfig.intervals.length === 0) continue;

          // Build pool: filter by books, then by specific slideshows
          let filtered = igSlideshows;
          if (accConfig.bookIds.length > 0) {
            filtered = filtered.filter((s) => s.sourceBookId && accConfig.bookIds.includes(s.sourceBookId));
          }
          if (accConfig.slideshowIds.length > 0) {
            filtered = filtered.filter((s) => accConfig.slideshowIds.includes(s.id));
          }
          if (filtered.length === 0) continue;

          // Interleave by book: cycle through books round-robin, each book
          // wraps its own list independently so uneven sizes don't clump.
          const byBook = new Map<string, typeof filtered>();
          for (const s of filtered) {
            const key = s.sourceBookId || "_none";
            if (!byBook.has(key)) byBook.set(key, []);
            byBook.get(key)!.push(s);
          }
          const bookGroups = [...byBook.values()];
          if (bookGroups.length === 0) continue;
          // LCM-based pool: total items = sum of all group lengths, but we
          // build a pool that's long enough to cover the full rotation.
          // Each position picks the next item from the next book group (wrapping).
          const totalItems = filtered.length;
          const pool: typeof filtered = [];
          const groupPointers = bookGroups.map(() => 0);
          for (let i = 0; i < totalItems; i++) {
            const groupIdx = i % bookGroups.length;
            const group = bookGroups[groupIdx];
            pool.push(group[groupPointers[groupIdx] % group.length]);
            groupPointers[groupIdx]++;
          }
          if (pool.length === 0) continue;

          let pointer = accConfig.pointer;

          // Mark IG schedule keys upfront
          const windowsToProcess = accConfig.intervals.filter(
            (w) => shouldProcessWindow(w.start) && !scheduledToday.has(`ig:${accIdStr}:${w.start}`)
          );
          const igSchedKeys = windowsToProcess.map((w) => `ig:${accIdStr}:${w.start}`);
          if (igSchedKeys.length > 0) await markScheduled(igSchedKeys);
          const failedIgKeys: string[] = [];

          // EARLY pointer save, before any heavy work — same fix as the TikTok
          // (2026-05-07) and TopN (2026-06-02 / 2026-06-15) phases. This phase
          // still saved the pointer after its publish loop, so a Vercel kill
          // mid-loop left the pointer pinned and the account replayed the same
          // slideshow the next day. The +1 bump shifts the daily start so a
          // windows-per-day count that divides the pool size cannot cycle back
          // to the same position every day (2026-05-07 incident class).
          if (windowsToProcess.length > 0) {
            updatedAccounts[accIdStr] = {
              ...accConfig,
              pointer: accConfig.pointer + windowsToProcess.length + 1,
            };
            try {
              await setIgAutomation({ ...igAuto, accounts: updatedAccounts });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              await notify({
                subject: "Slideshow Generator: IG early pointer save failed",
                body: `setIgAutomation threw during the early save for account ${accIdStr}. The pointer may not advance today, so tomorrow could repeat today's slideshow.\n\n${msg}`,
                dedupeKey: `ig-early-save-fail:${accIdStr}`,
                cooldownSec: 3600,
              });
            }
          }

          for (const win of accConfig.intervals) {
            if (!shouldProcessWindow(win.start)) continue;
            if (scheduledToday.has(`ig:${accIdStr}:${win.start}`)) continue;
            // Release anything we cannot start in the remaining budget rather
            // than being killed with the key still marked.
            if (!deadline.hasTimeFor(JOB_TIMEOUT_MS)) {
              outOfBudget = true;
              failedIgKeys.push(`ig:${accIdStr}:${win.start}`);
              igAutoResults.push({ status: `deferred (${accIdStr}) ${win.start}: out of cron budget` });
              continue;
            }
            const ss = pool[pointer % pool.length];
            const prompt = pickRandom(ss.imagePrompts);
            const caption = pickRandom(ss.captions);
            if (!prompt) continue;

            const texts = ss.slideTexts.split("\n").map((t) => t.trim()).filter(Boolean);
            if (texts.length < 2) continue;

            let scheduledAt: Date | undefined;
            let postIssued = false;
            try {
              const skipReason = await withJobTimeout((async (): Promise<string | null> => {
                const image = await generateImage(prompt.value);
                if (!image) {
                  return `skip: image gen failed for ${ss.name} (${accIdStr})`;
                }
                const slideBufs: Buffer[] = [];

                for (const text of texts) {
                  slideBufs.push(await renderSlide(image, text));
                }
                const mediaIds: string[] = [];
                for (let j = 0; j < slideBufs.length; j++) {
                  mediaIds.push(await uploadPng(slideBufs[j], `ig-auto-${accIdStr}-${j + 1}.png`));
                }

                // Determine platform config based on account type
                const accId = Number(accIdStr);
                const isIg = igAuto.igAccountIds?.includes(accId) || !igAuto.tiktokAccountIds?.includes(accId);
                const platformCfg = isIg
                  ? { instagram: {} }
                  : { tiktok: { draft: false, is_aigc: false } };

                scheduledAt = randomTimeInWindow(win.start, win.end);
                postIssued = true;
                const postResp = await pbFetch("/v1/posts", {
                  method: "POST",
                  body: JSON.stringify({
                    caption: caption?.value || "",
                    media: mediaIds,
                    social_accounts: [accId],
                    scheduled_at: scheduledAt.toISOString(),
                    platform_configurations: platformCfg,
                  }),
                });
                const postId = postResp.id || postResp.data?.id || "unknown";
                const postUrl = postResp.url || postResp.data?.url || "";
                igAutoResults.push({
                  status: `${ss.name} → ${accIdStr} at ${scheduledAt.toISOString()} [post:${postId}]`,
                });

                const igNow = new Date();
                await appendPostLog({
                  date: igNow.toISOString().slice(0, 10),
                  time: igNow.toISOString().slice(11, 16),
                  accountId: accId,
                  accountName: accIdStr,
                  bookName: "",
                  slideshowId: ss.id,
                  slideshowName: ss.name,
                  imagePromptId: prompt?.id || "",
                  imagePromptText: (prompt?.value || "").slice(0, 100),
                  captionId: caption?.id || "",
                  captionText: (caption?.value || "").slice(0, 100),
                  postBridgeId: String(postId),
                  postBridgeUrl: String(postUrl),
                  source: "cron-ig",
                  timestamp: igNow.toISOString(),
                }).catch(() => {});
                return null;
              })(), JOB_TIMEOUT_MS, `ig ${accIdStr} ss=${ss.id}`);
              if (skipReason) {
                igAutoResults.push({ status: skipReason });
                if (skipReason.startsWith("skip:")) {
                  failedIgKeys.push(`ig:${accIdStr}:${win.start}`);
                }
                pointer++;
                continue;
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              const result = await notifyPostFailure({
                subject: `[CONFIRMED] IG post failed for account ${accIdStr}`,
                body: `Confirmed failure after retries.\n\nAccount: ${accIdStr}\nStep: IG post pipeline\nSlideshow: ${ss.name}\nWindow: ${win.start}-${win.end}\n\n${msg}`,
                error: err,
                accountId: Number(accIdStr),
                scheduledAt,
                captionSlice: caption?.value || "",
                dedupeKey: `ig-fail:${accIdStr}:${new Date().toISOString().slice(0, 13)}`,
                cooldownSec: 3600,
              });
              if (result.verified) {
                igAutoResults.push({ status: `${ss.name} → ${accIdStr} verified-after-error` });
              } else {
                igAutoResults.push({ status: `error (${accIdStr}): ${msg}` });
                // Release the key so the next run can retry this window. Without
                // this a single failure burned the window for the whole day —
                // the TikTok, TopN and excerpt phases all released theirs.
                if (!postIssued) {
                  // Aborted before the create request went out, so a retry is
                  // safe. If it went out, keep the key marked rather than risk
                  // a duplicate post.
                  failedIgKeys.push(`ig:${accIdStr}:${win.start}`);
                }
              }
            }

            pointer++;
          }

          if (failedIgKeys.length > 0) {
            await unmarkScheduled(failedIgKeys);
          }
        }
        // Pointer is persisted per account before its heavy work (see above),
        // so there is deliberately no post-loop save here.
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    igAutoResults.push({ status: `IG automation error: ${msg}` });
    await notify({
      subject: "Slideshow Generator: IG phase crashed",
      body: `Instagram automation threw before completing.\n\n${msg}`,
      dedupeKey: "ig-phase-crash",
      cooldownSec: 3600,
    });
  }

  return igAutoResults;
}
