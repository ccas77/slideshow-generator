import { NextRequest, NextResponse } from "next/server";
import { previewTopN } from "@/lib/topn-publisher";

export const maxDuration = 300;

function checkAuth(req: NextRequest) {
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const listId = url.searchParams.get("listId");
  const debug = url.searchParams.get("debug") === "1";
  if (!listId) {
    return NextResponse.json({ error: "listId required" }, { status: 400 });
  }

  try {
    if (debug) {
      // Debug mode: test slide generation only (no video)
      const { generateImage } = await import("@/lib/gemini");
      const { getTopNLists, getTopBooks } = await import("@/lib/kv");
      const { renderTitleSlide, renderBookSlide } = await import("@/lib/render-topn-slide");

      const [lists, allBooks] = await Promise.all([getTopNLists(), getTopBooks()]);
      const list = lists.find((l: { id: string }) => l.id === listId);
      if (!list) return NextResponse.json({ error: "List not found" });

      const steps: string[] = [];
      steps.push(`List: ${list.name}, ${list.bookIds.length} bookIds`);

      // Test bg image
      let bgImage: string | null = null;
      if (list.backgroundPrompts && list.backgroundPrompts.length > 0) {
        const prompt = list.backgroundPrompts[0];
        steps.push(`Generating bg image: "${prompt.slice(0, 50)}..."`);
        bgImage = await generateImage(prompt);
        steps.push(`BG image: ${bgImage ? `${bgImage.length} chars` : "null"}`);
      }

      // Test title slide
      steps.push("Rendering title slide...");
      const titleBuf = await renderTitleSlide(list.titleTexts[0] || "Test", bgImage);
      steps.push(`Title slide: ${titleBuf.length} bytes`);

      // Test one book slide
      const book = allBooks.find((b: { id: string }) => list.bookIds.includes(b.id));
      if (book) {
        steps.push(`Rendering book slide: ${book.title}`);
        const b64 = book.coverData.includes(",") ? book.coverData.split(",")[1] : book.coverData;
        const coverBuf = Buffer.from(b64, "base64");
        const bookBuf = await renderBookSlide(coverBuf, book.title, book.author, bgImage);
        steps.push(`Book slide: ${bookBuf.length} bytes`);
      }

      // Test ffmpeg
      const { execFileSync } = await import("child_process");
      const ffmpegPath: string = (await import("ffmpeg-static")).default as string;
      const ver = execFileSync(ffmpegPath, ["-version"], { timeout: 5000, maxBuffer: 1024 * 1024 }).toString().split("\n")[0];
      steps.push(`ffmpeg: ${ver}`);

      return NextResponse.json({ ok: true, steps });
    }

    const videoBuf = await previewTopN(listId);
    return new Response(new Uint8Array(videoBuf), {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(videoBuf.length),
        "Content-Disposition": "inline",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : "";
    console.error("top-n-preview error:", msg, stack);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
