import { NextRequest, NextResponse } from "next/server";
import { getExcerpts, getBooks, redis } from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";

export const maxDuration = 300;

function checkAuth(req: NextRequest) {
  const pw = req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function pickRandom<T>(arr: T[]): T | undefined {
  if (!arr.length) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { excerptId } = (await req.json()) as { excerptId: string };
  if (!excerptId) {
    return NextResponse.json({ error: "excerptId required" }, { status: 400 });
  }

  const excerpts = await getExcerpts();
  const excerpt = excerpts.find((e) => e.id === excerptId);
  if (!excerpt) {
    return NextResponse.json({ error: "Excerpt not found" }, { status: 404 });
  }

  try {
    const slides: { label: string; imageData: string }[] = [];

    // Slide 1: Hook — pick random prompt + hook text, generate image
    const prompt = pickRandom(excerpt.imagePrompts);
    const hookText = pickRandom(excerpt.overlayTexts);

    let hookImageData: string | null = null;
    if (prompt) {
      hookImageData = await generateImage(prompt);
    }

    if (hookText) {
      const hookBuf = await renderSlide(hookImageData, hookText);
      slides.push({
        label: "Hook",
        imageData: `data:image/png;base64,${hookBuf.toString("base64")}`,
      });
    } else if (hookImageData) {
      slides.push({ label: "Hook", imageData: hookImageData });
    }

    // Slides 2+: Excerpt images (already stored)
    for (const img of excerpt.excerptImages) {
      slides.push({ label: img.label || "Excerpt", imageData: img.imageData });
    }

    // Final slide: Book cover
    if (excerpt.bookId) {
      const books = await getBooks();
      const book = books.find((b) => b.id === excerpt.bookId);
      if (book?.coverImage) {
        slides.push({ label: "Cover", imageData: book.coverImage });
      }
    }

    // Store slides in Redis (1 hour TTL) so publish route can read them
    // without the client needing to send the full base64 data back.
    const generationId = `excerpt-gen:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await redis.set(generationId, slides, { ex: 3600 });

    // Return slides for preview + the generationId for posting
    return NextResponse.json({ ok: true, generationId, slides });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
