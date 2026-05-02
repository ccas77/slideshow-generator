import { NextRequest, NextResponse } from "next/server";
import { getExcerpts, getBooks } from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { uploadPng, pbFetch } from "@/lib/post-bridge";

export const maxDuration = 300;

function checkAuth(req: NextRequest) {
  const body_pw = req.headers.get("x-password");
  if (process.env.APP_PASSWORD && body_pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { excerptId, accountIds, scheduledAt, platform } = (await req.json()) as {
    excerptId: string;
    accountIds: number[];
    scheduledAt?: string;
    platform?: "tiktok" | "instagram";
  };

  if (!excerptId || !accountIds?.length) {
    return NextResponse.json({ error: "excerptId and accountIds required" }, { status: 400 });
  }

  const excerpts = await getExcerpts();
  const excerpt = excerpts.find((e) => e.id === excerptId);
  if (!excerpt) {
    return NextResponse.json({ error: "Excerpt not found" }, { status: 404 });
  }

  try {
    const mediaIds: string[] = [];

    // Slide 1: Hook slide — AI-generated image with overlay text
    let hookImageData: string | null = null;
    if (excerpt.imagePrompt) {
      hookImageData = await generateImage(excerpt.imagePrompt);
    }
    if (excerpt.overlayText) {
      const hookBuf = await renderSlide(hookImageData, excerpt.overlayText);
      mediaIds.push(await uploadPng(hookBuf, "hook-slide.png"));
    } else if (hookImageData) {
      const b64 = hookImageData.includes(",") ? hookImageData.split(",")[1] : hookImageData;
      const buf = Buffer.from(b64, "base64");
      mediaIds.push(await uploadPng(buf, "hook-slide.png"));
    }

    // Slides 2+: Excerpt images
    for (let i = 0; i < excerpt.excerptImages.length; i++) {
      const img = excerpt.excerptImages[i];
      const b64 = img.imageData.includes(",") ? img.imageData.split(",")[1] : img.imageData;
      const buf = Buffer.from(b64, "base64");
      mediaIds.push(await uploadPng(buf, `excerpt-${i + 1}.png`));
    }

    // Final slide: Book cover
    if (excerpt.bookId) {
      const books = await getBooks();
      const book = books.find((b) => b.id === excerpt.bookId);
      if (book?.coverImage) {
        const b64 = book.coverImage.includes(",") ? book.coverImage.split(",")[1] : book.coverImage;
        const buf = Buffer.from(b64, "base64");
        mediaIds.push(await uploadPng(buf, "cover-slide.png"));
      }
    }

    if (mediaIds.length < 2) {
      return NextResponse.json({ error: "Need at least 2 slides to post a carousel" }, { status: 400 });
    }

    const platformConfig: Record<string, unknown> = {};
    if (platform === "instagram") {
      platformConfig.instagram = {};
    } else {
      platformConfig.tiktok = { draft: false, is_aigc: true };
    }

    const postBody: Record<string, unknown> = {
      caption: "",
      media: mediaIds,
      social_accounts: accountIds,
      platform_configurations: platformConfig,
    };
    if (scheduledAt) postBody.scheduled_at = scheduledAt;

    const postResp = await pbFetch("/v1/posts", {
      method: "POST",
      body: JSON.stringify(postBody),
    });

    const postId = postResp.id || postResp.data?.id || "unknown";
    return NextResponse.json({ ok: true, postId, slides: mediaIds.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
