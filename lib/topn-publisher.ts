import { TopBook, getTopBooks, getTopNLists, getMusicTrack } from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderTitleSlide, renderBookSlide } from "@/lib/render-topn-slide";
import { uploadPng, uploadVideo, pbFetch } from "@/lib/post-bridge";
import { renderVideo } from "@/lib/render-video";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface PublishTopNOptions {
  listId: string;
  accountIds: number[];
  scheduledAt?: string; // ISO string
  platform?: "tiktok-carousel" | "tiktok-video" | "fb-video" | "ig-carousel" | "ig-video";
  backgroundPrompts?: string[]; // account-level override for list bg prompts
}

export interface PublishTopNResult {
  postId: string;
  slides: number;
  books: string[];
}

/**
 * Internal: generates slides + optional video for a list.
 * Shared by publishTopN and previewTopN.
 * @param maxBooks - cap number of books (for preview to avoid memory issues)
 */
async function generateTopNSlides(listId: string, maxBooks?: number, bgPromptsOverride?: string[]) {
  const [lists, allBooks] = await Promise.all([getTopNLists(), getTopBooks()]);
  const list = lists.find((l) => l.id === listId);
  if (!list) throw new Error("List not found");

  const manualBooks = list.bookIds
    .map((id) => allBooks.find((b) => b.id === id))
    .filter((b): b is TopBook => !!b);
  const genreBooks = (list.genres && list.genres.length > 0)
    ? allBooks.filter((b) => {
        if (list.bookIds.includes(b.id)) return false;
        const bookGenres = b.genre ? b.genre.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
        return bookGenres.some((g) => list.genres!.some((lg) => lg.toLowerCase() === g));
      })
    : [];
  const poolBooks = [...manualBooks, ...genreBooks];

  const pinned = poolBooks.filter((b) => b.pinned);
  const unpinned = shuffle(poolBooks.filter((b) => !b.pinned));

  const limit = maxBooks ?? list.count;
  const selected: TopBook[] = [...pinned];
  for (const b of unpinned) {
    if (selected.length >= limit) break;
    selected.push(b);
  }
  if (selected.length === 0) throw new Error("No books selected");

  const finalOrder = shuffle(selected);

  let bgImage: string | null = null;
  const bgPrompts = bgPromptsOverride && bgPromptsOverride.length > 0
    ? bgPromptsOverride
    : list.backgroundPrompts;
  if (bgPrompts && bgPrompts.length > 0) {
    const prompt = bgPrompts[Math.floor(Math.random() * bgPrompts.length)];
    console.log(`[topn] generating bg image, prompt="${prompt.slice(0, 80)}..."`);
    bgImage = await generateImage(prompt);
    console.log(`[topn] bg image generated, length=${bgImage?.length ?? 0}`);
  }

  const titleTexts = list.titleTexts && list.titleTexts.length > 0 ? list.titleTexts : [""];
  const titleText = titleTexts[Math.floor(Math.random() * titleTexts.length)];

  const titleBuf = await renderTitleSlide(titleText, bgImage);

  const slideBufs: Buffer[] = [titleBuf];
  for (const book of finalOrder) {
    const b64 = book.coverData.includes(",") ? book.coverData.split(",")[1] : book.coverData;
    const coverBuf = Buffer.from(b64, "base64");
    const buf = await renderBookSlide(coverBuf, book.title, book.author, bgImage);
    slideBufs.push(buf);
  }

  // Fetch a random music track if the list has any assigned
  let audioBuffer: Buffer | undefined;
  if (list.musicTrackIds && list.musicTrackIds.length > 0) {
    const trackId = list.musicTrackIds[Math.floor(Math.random() * list.musicTrackIds.length)];
    const track = await getMusicTrack(trackId);
    if (track) {
      const b64 = track.audioData.includes(",") ? track.audioData.split(",")[1] : track.audioData;
      audioBuffer = Buffer.from(b64, "base64");
    }
  }

  return { list, slideBufs, finalOrder, audioBuffer };
}

/**
 * Generate a Top N slideshow and schedule/publish it via PostBridge.
 */
export async function publishTopN(
  opts: PublishTopNOptions
): Promise<PublishTopNResult> {
  const startMs = Date.now();
  let phase = "init";
  let slideCount = 0;
  try {
  const { listId, accountIds, scheduledAt } = opts;

  phase = "generateSlides";
  console.log(`[topn] phase=${phase} listId=${listId}`);
  const { list, slideBufs, finalOrder, audioBuffer } = await generateTopNSlides(listId, undefined, opts.backgroundPrompts);
  slideCount = slideBufs.length;
  console.log(`[topn] slides generated: ${slideCount} books=${finalOrder.length} elapsedMs=${Date.now() - startMs}`);

  const isVideo = opts.platform === "tiktok-video" || opts.platform === "fb-video" || opts.platform === "ig-video";

  phase = "upload";
  const mediaIds: string[] = [];
  if (isVideo) {
    console.log(`[topn] phase=renderVideo`);
    const videoBuf = await renderVideo(slideBufs, { durationPerSlide: 4, transitionDuration: 2, audioBuffer });
    console.log(`[topn] phase=uploadVideo size=${videoBuf.length} elapsedMs=${Date.now() - startMs}`);
    const mediaId = await uploadVideo(videoBuf, "topn-video.mp4");
    mediaIds.push(mediaId);
  } else {
    for (let j = 0; j < slideBufs.length; j++) {
      console.log(`[topn] phase=uploadPng ${j+1}/${slideBufs.length} elapsedMs=${Date.now() - startMs}`);
      const mediaId = await uploadPng(slideBufs[j], `topn-slide-${j}.png`);
      mediaIds.push(mediaId);
    }
  }
  console.log(`[topn] uploads done mediaIds=${mediaIds.length} elapsedMs=${Date.now() - startMs}`);

  const DEFAULT_CAPTION = "#booktok #fyp #bookrecs #kindleunlimited";
  const captions = list.captions && list.captions.length > 0 ? list.captions : [DEFAULT_CAPTION];
  const caption = captions[Math.floor(Math.random() * captions.length)] || DEFAULT_CAPTION;

  const platformConfigurations: Record<string, unknown> = {};
  if (opts.platform === "tiktok-video" || opts.platform === "tiktok-carousel") {
    platformConfigurations.tiktok = { draft: false, is_aigc: true };
  } else if (opts.platform === "ig-carousel" || opts.platform === "ig-video") {
    platformConfigurations.instagram = {};
  } else if (opts.platform === "fb-video") {
    platformConfigurations.facebook = {};
  } else {
    platformConfigurations.tiktok = { draft: false, is_aigc: true };
    platformConfigurations.instagram = {};
  }

  const postBody: Record<string, unknown> = {
    caption,
    media: mediaIds,
    social_accounts: accountIds,
    platform_configurations: platformConfigurations,
  };
  if (scheduledAt) postBody.scheduled_at = scheduledAt;

  phase = "createPost";
  console.log(`[topn] phase=createPost elapsedMs=${Date.now() - startMs}`);
  const postResp = await pbFetch("/v1/posts", {
    method: "POST",
    body: JSON.stringify(postBody),
  });

  console.log(`[topn] post created id=${postResp.id || postResp.data?.id} elapsedMs=${Date.now() - startMs}`);
  return {
    postId: postResp.id || postResp.data?.id || "unknown",
    slides: slideBufs.length,
    books: finalOrder.map((b) => b.title),
  };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[topn] FAILED phase=${phase} elapsedMs=${Date.now() - startMs} error=${msg}`);
    throw err;
  } finally {
    console.log(`[topn] publishTopN done slides=${slideCount} elapsedMs=${Date.now() - startMs}`);
  }
}

/**
 * Generate a preview video for a list (no upload, no posting).
 * Returns the MP4 buffer.
 */
export async function previewTopN(listId: string, bgPromptsOverride?: string[]): Promise<Buffer> {
  const startMs = Date.now();
  let slideCount = 0;
  try {
    const { slideBufs, audioBuffer } = await generateTopNSlides(listId, undefined, bgPromptsOverride);
    slideCount = slideBufs.length;
    return renderVideo(slideBufs, { durationPerSlide: 4, transitionDuration: 2, audioBuffer });
  } finally {
    console.log(`[topn-publisher] previewTopN done slides=${slideCount} elapsedMs=${Date.now() - startMs}`);
  }
}
