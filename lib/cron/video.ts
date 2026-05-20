import {
  getVideoAutomation,
  setVideoAutomation,
  getIgSlideshows,
  getVideoMusicTrack,
  getBooksWithCovers,
} from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderTextOverlay } from "@/lib/render-slide";
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

    let updated = false;
    const updatedAccounts = { ...videoAuto.accounts };

    for (const [accIdStr, accConfig] of Object.entries(videoAuto.accounts)) {
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

          const scheduledAt = randomTimeInWindow(win.start, win.end);
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
