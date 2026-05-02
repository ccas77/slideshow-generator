import {
  getVideoAutomation,
  setVideoAutomation,
  getIgSlideshows,
  getVideoMusicTrack,
} from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { renderVideo } from "@/lib/render-video";
import { pbFetch, uploadVideo } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled } from "./scheduled-today";
import type { VideoAutoResult } from "./types";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runVideoPhase(
  scheduledToday: Set<string>
): Promise<VideoAutoResult[]> {
  const results: VideoAutoResult[] = [];
  try {
    const videoAuto = await getVideoAutomation();
    if (Object.keys(videoAuto.accounts).length === 0) return results;

    const igSlideshows = await getIgSlideshows();
    if (igSlideshows.length === 0) return results;

    let updated = false;
    const updatedAccounts = { ...videoAuto.accounts };

    for (const [accIdStr, accConfig] of Object.entries(videoAuto.accounts)) {
      if (!accConfig.enabled || accConfig.intervals.length === 0) continue;

      // Build pool: filter by books, then by specific slideshows
      let pool = igSlideshows;
      if (accConfig.bookIds.length > 0) {
        pool = pool.filter((s) => s.sourceBookId && accConfig.bookIds.includes(s.sourceBookId));
      }
      if (accConfig.slideshowIds.length > 0) {
        pool = pool.filter((s) => accConfig.slideshowIds.includes(s.id));
      }
      if (pool.length === 0) continue;

      let pointer = accConfig.pointer;

      // Mark schedule keys upfront
      const schedKeys = accConfig.intervals
        .filter((w) => shouldProcessWindow(w.start) && !scheduledToday.has(`video:${accIdStr}:${w.start}`))
        .map((w) => `video:${accIdStr}:${w.start}`);
      if (schedKeys.length > 0) await markScheduled(schedKeys);

      for (const win of accConfig.intervals) {
        if (!shouldProcessWindow(win.start)) continue;
        if (scheduledToday.has(`video:${accIdStr}:${win.start}`)) continue;

        const ss = pool[pointer % pool.length];
        const prompt = pickRandom(ss.imagePrompts);
        const caption = pickRandom(ss.captions);
        if (!prompt) continue;

        const texts = ss.slideTexts.split("\n").map((t) => t.trim()).filter(Boolean);
        if (texts.length < 2) continue;

        try {
          const image = await generateImage(prompt.value);
          if (!image) {
            results.push({ status: `skip: image gen failed for ${ss.name} (${accIdStr})` });
            continue;
          }

          const slideBufs: Buffer[] = [];
          for (const text of texts) {
            slideBufs.push(await renderSlide(image, text));
          }

          // Pick a random music track
          let audioBuffer: Buffer | undefined;
          const trackIds = accConfig.musicTrackIds || [];
          if (trackIds.length > 0) {
            const trackId = trackIds[Math.floor(Math.random() * trackIds.length)];
            const track = await getVideoMusicTrack(trackId);
            if (track?.audioData) {
              const base64 = track.audioData.replace(/^data:[^;]+;base64,/, "");
              audioBuffer = Buffer.from(base64, "base64");
            }
          }

          const videoBuf = await renderVideo(slideBufs, {
            durationPerSlide: accConfig.durationPerSlide || 2,
            audioBuffer,
          });

          const mediaId = await uploadVideo(videoBuf, `video-auto-${accIdStr}.mp4`);

          const scheduledAt = randomTimeInWindow(win.start, win.end);
          const postResp = await pbFetch("/v1/posts", {
            method: "POST",
            body: JSON.stringify({
              caption: caption?.value || "",
              media: [mediaId],
              social_accounts: [Number(accIdStr)],
              scheduled_at: scheduledAt.toISOString(),
              platform_configurations: {
                tiktok: { draft: false, is_aigc: true },
              },
            }),
          });

          const postId = postResp.id || postResp.data?.id || "unknown";
          results.push({
            status: `${ss.name} -> ${accIdStr} video at ${scheduledAt.toISOString()} [post:${postId}]`,
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
      await setVideoAutomation({ accounts: updatedAccounts });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ status: `Video automation error: ${msg}` });
  }

  return results;
}
