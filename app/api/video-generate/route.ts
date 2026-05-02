import { NextRequest, NextResponse } from "next/server";
import { getIgSlideshows, getBooks, getVideoMusicTrack, redis } from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { renderVideo } from "@/lib/render-video";

export const maxDuration = 300;

function checkAuth(req: NextRequest) {
  const pw = req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { slideshowId, musicTrackId, durationPerSlide } = (await req.json()) as {
    slideshowId: string;
    musicTrackId?: string;
    durationPerSlide?: number;
  };

  if (!slideshowId) {
    return NextResponse.json({ error: "slideshowId required" }, { status: 400 });
  }

  const slideshows = await getIgSlideshows();
  const ss = slideshows.find((s) => s.id === slideshowId);
  if (!ss) {
    return NextResponse.json({ error: "Slideshow not found" }, { status: 404 });
  }

  try {
    // Pick random prompt
    const prompt = ss.imagePrompts.length > 0
      ? ss.imagePrompts[Math.floor(Math.random() * ss.imagePrompts.length)]
      : null;
    if (!prompt) {
      return NextResponse.json({ error: "Slideshow has no image prompts" }, { status: 400 });
    }

    const image = await generateImage(prompt.value);
    if (!image) {
      return NextResponse.json({ error: "Image generation failed" }, { status: 500 });
    }

    const texts = ss.slideTexts.split("\n").map((t) => t.trim()).filter(Boolean);

    // Check for book cover — drop last text slide if cover replaces it
    const books = await getBooks();
    const book = ss.sourceBookId ? books.find((b) => b.id === ss.sourceBookId) : undefined;
    const slideTexts = book?.coverImage && texts.length > 2 ? texts.slice(0, -1) : texts;

    const slideBufs: Buffer[] = [];
    for (const text of slideTexts) {
      slideBufs.push(await renderSlide(image, text));
    }

    // Add book cover as final slide
    if (book?.coverImage) {
      const b64 = book.coverImage.includes(",") ? book.coverImage.split(",")[1] : book.coverImage;
      slideBufs.push(Buffer.from(b64, "base64"));
    }

    if (slideBufs.length < 2) {
      return NextResponse.json({ error: "Need at least 2 slides" }, { status: 400 });
    }

    // Get music if selected
    let audioBuffer: Buffer | undefined;
    if (musicTrackId) {
      const track = await getVideoMusicTrack(musicTrackId);
      if (track?.audioData) {
        const b64 = track.audioData.replace(/^data:[^;]+;base64,/, "");
        audioBuffer = Buffer.from(b64, "base64");
      }
    }

    const videoBuf = await renderVideo(slideBufs, {
      durationPerSlide: durationPerSlide || 2,
      audioBuffer,
    });

    // Store in Redis (1 hour TTL)
    const generationId = `video-gen:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await redis.set(generationId, videoBuf.toString("base64"), { ex: 3600 });

    // Pick random caption
    const caption = ss.captions.length > 0
      ? ss.captions[Math.floor(Math.random() * ss.captions.length)]
      : null;

    return NextResponse.json({
      ok: true,
      generationId,
      slideCount: slideBufs.length,
      caption: caption?.value || "",
      slideshowName: ss.name,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
