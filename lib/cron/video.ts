import {
  getVideoAutomation,
  setVideoAutomation,
  getIgSlideshows,
  getVideoMusicTrack,
  getBooksWithCovers,
  appendPostLog,
} from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderTextOverlay } from "@/lib/render-slide";
import { renderVideo } from "@/lib/render-video";
import { pbFetch, uploadVideo } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled, unmarkScheduled } from "./scheduled-today";
import { notify } from "@/lib/notify";
import { notifyPostFailure } from "@/lib/post-failure";
import { withJobTimeout, VIDEO_JOB_TIMEOUT_MS } from "./with-timeout";
import { unlimitedDeadline, type RunDeadline } from "./deadline";
import type { VideoAutoResult } from "./types";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runVideoPhase(
  scheduledToday: Set<string>,
  deadline: RunDeadline = unlimitedDeadline()
): Promise<VideoAutoResult[]> {
  const results: VideoAutoResult[] = [];
  let outOfBudget = false;
  try {
    const videoAuto = await getVideoAutomation();
    if (Object.keys(videoAuto.accounts).length === 0) return results;

    const igSlideshows = await getIgSlideshows();
    if (igSlideshows.length === 0) return results;

    const books = await getBooksWithCovers();
    const bookMusicMap = new Map<string, string[]>();
    const bookCoverMap = new Map<string, string>();
    for (const book of books) {
      if (book.musicTrackIds && book.musicTrackIds.length > 0) {
        bookMusicMap.set(book.id, book.musicTrackIds);
      }
      if (book.coverImage) {
        bookCoverMap.set(book.id, book.coverImage);
      }
    }

    const updatedAccounts = { ...videoAuto.accounts };

    for (const [accIdStr, accConfig] of Object.entries(videoAuto.accounts)) {
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

      // Mark schedule keys upfront
      const windowsToProcess = accConfig.intervals.filter(
        (w) => shouldProcessWindow(w.start) && !scheduledToday.has(`video:${accIdStr}:${w.start}`)
      );
      const schedKeys = windowsToProcess.map((w) => `video:${accIdStr}:${w.start}`);
      if (schedKeys.length > 0) await markScheduled(schedKeys);
      const failedVideoKeys: string[] = [];

      // EARLY pointer save, before any heavy work — same fix as the TikTok
      // (2026-05-07) and TopN (2026-06-02 / 2026-06-15) phases, which this one
      // never received. ffmpeg encoding makes a kill mid-loop more likely here
      // than anywhere else, and a kill left the pointer pinned so the account
      // replayed the same video the next day. The +1 bump shifts the daily
      // start position (2026-05-07 incident class).
      if (windowsToProcess.length > 0) {
        updatedAccounts[accIdStr] = {
          ...accConfig,
          pointer: accConfig.pointer + windowsToProcess.length + 1,
        };
        try {
          await setVideoAutomation({ accounts: updatedAccounts });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await notify({
            subject: "Slideshow Generator: video early pointer save failed",
            body: `setVideoAutomation threw during the early save for account ${accIdStr}. The pointer may not advance today, so tomorrow could repeat today's video.\n\n${msg}`,
            dedupeKey: `video-early-save-fail:${accIdStr}`,
            cooldownSec: 3600,
          });
        }
      }

      for (const win of accConfig.intervals) {
        if (!shouldProcessWindow(win.start)) continue;
        if (scheduledToday.has(`video:${accIdStr}:${win.start}`)) continue;
        // Release anything we cannot start in the remaining budget rather than
        // being killed with the key still marked.
        if (!deadline.hasTimeFor(VIDEO_JOB_TIMEOUT_MS)) {
          outOfBudget = true;
          failedVideoKeys.push(`video:${accIdStr}:${win.start}`);
          results.push({ status: `deferred (${accIdStr}) ${win.start}: out of cron budget` });
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

          // Decode background image for camera motion
          const bgB64 = image.includes(",") ? image.split(",")[1] : image;
          const backgroundImage = Buffer.from(bgB64, "base64");

          // Build slide durations: 2.5s per text slide, 5s for cover
          const coverImage = ss.sourceBookId ? bookCoverMap.get(ss.sourceBookId) : undefined;
          const slideTexts = coverImage && texts.length > 2 ? texts.slice(0, -1) : texts;

          const slideBufs: Buffer[] = [];
          const durations: number[] = [];
          for (const text of slideTexts) {
            slideBufs.push(await renderTextOverlay(text));
            durations.push(2.5);
          }

          // Add book cover as final slide
          if (coverImage) {
            const b64 = coverImage.includes(",") ? coverImage.split(",")[1] : coverImage;
            slideBufs.push(Buffer.from(b64, "base64"));
            durations.push(5);
          }

          // Pick a random music track (book-level first, then account-level)
          let audioBuffer: Buffer | undefined;
          const bookTrackIds = ss.sourceBookId ? (bookMusicMap.get(ss.sourceBookId) || []) : [];
          const trackIds = bookTrackIds.length > 0 ? bookTrackIds : (accConfig.musicTrackIds || []);
          if (trackIds.length > 0) {
            const trackId = trackIds[Math.floor(Math.random() * trackIds.length)];
            const track = await getVideoMusicTrack(trackId);
            if (track?.audioData) {
              const base64 = track.audioData.replace(/^data:[^;]+;base64,/, "");
              audioBuffer = Buffer.from(base64, "base64");
            }
          }

          const videoBuf = await renderVideo(slideBufs, {
            durations,
            audioBuffer,
            backgroundImage,
          });

          const mediaId = await uploadVideo(videoBuf, `video-auto-${accIdStr}.mp4`);

          scheduledAt = randomTimeInWindow(win.start, win.end);
          postIssued = true;
          const postResp = await pbFetch("/v1/posts", {
            method: "POST",
            body: JSON.stringify({
              caption: caption?.value || "",
              media: [mediaId],
              social_accounts: [Number(accIdStr)],
              scheduled_at: scheduledAt.toISOString(),
              platform_configurations: (() => {
                const plat = accConfig.platform || "tiktok";
                if (plat === "facebook") return { facebook: {} };
                if (plat === "instagram") return { instagram: {} };
                return { tiktok: { draft: false, is_aigc: false } };
              })(),
            }),
          });

          const postId = postResp.id || postResp.data?.id || "unknown";
          const postUrl = postResp.url || postResp.data?.url || "";
          results.push({
            status: `${ss.name} -> ${accIdStr} video at ${scheduledAt.toISOString()} [post:${postId}]`,
          });

          const vNow = new Date();
          await appendPostLog({
            date: vNow.toISOString().slice(0, 10),
            time: vNow.toISOString().slice(11, 16),
            accountId: Number(accIdStr),
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
            source: "cron-video",
            timestamp: vNow.toISOString(),
          }).catch(() => {});
          return null;
          })(), VIDEO_JOB_TIMEOUT_MS, `video ${accIdStr} ss=${ss.id}`);
          if (skipReason) {
            results.push({ status: skipReason });
            if (skipReason.startsWith("skip:")) {
              failedVideoKeys.push(`video:${accIdStr}:${win.start}`);
            }
            pointer++;
            continue;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const result = await notifyPostFailure({
            subject: `[CONFIRMED] Video post failed for account ${accIdStr}`,
            body: `Confirmed failure after retries.\n\nAccount: ${accIdStr}\nStep: video post pipeline\nSlideshow: ${ss.name}\nWindow: ${win.start}-${win.end}\n\n${msg}`,
            error: err,
            accountId: Number(accIdStr),
            scheduledAt,
            captionSlice: caption?.value || "",
            dedupeKey: `video-fail:${accIdStr}:${new Date().toISOString().slice(0, 13)}`,
            cooldownSec: 3600,
          });
          if (result.verified) {
            results.push({ status: `${ss.name} -> ${accIdStr} video verified-after-error` });
          } else {
            results.push({ status: `error (${accIdStr}): ${msg}` });
            // Release the key so the next run retries this window. Without this
            // a single failure burned the window for the whole day.
            if (!postIssued) {
              // Aborted before the create request went out, so a retry is
              // safe. If it went out, keep the key marked rather than risk a
              // duplicate post.
              failedVideoKeys.push(`video:${accIdStr}:${win.start}`);
            }
          }
        }

        pointer++;
      }

      if (failedVideoKeys.length > 0) {
        await unmarkScheduled(failedVideoKeys);
      }
    }
    // Pointer is persisted per account before its heavy work (see above), so
    // there is deliberately no post-loop save here.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ status: `Video automation error: ${msg}` });
    await notify({
      subject: "Slideshow Generator: video phase crashed",
      body: `Video automation threw before completing.\n\n${msg}`,
      dedupeKey: "video-phase-crash",
      cooldownSec: 3600,
    });
  }

  return results;
}
