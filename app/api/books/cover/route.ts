import { NextRequest, NextResponse } from "next/server";
import { getBookCover, setBookCover, deleteBookCover } from "@/lib/kv";

function checkAuth(password: string | undefined | null) {
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword && password !== appPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const password = url.searchParams.get("password");
  const authError = checkAuth(password);
  if (authError) return authError;
  const bookId = url.searchParams.get("bookId");
  if (!bookId) return NextResponse.json({ error: "bookId required" }, { status: 400 });
  const cover = await getBookCover(bookId);
  return NextResponse.json({ cover: cover || null });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const authError = checkAuth(body.password);
  if (authError) return authError;
  const { bookId, cover } = body as { bookId: string; cover: string };
  if (!bookId || !cover) {
    return NextResponse.json({ error: "bookId and cover required" }, { status: 400 });
  }
  await setBookCover(bookId, cover);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const password = url.searchParams.get("password");
  const authError = checkAuth(password);
  if (authError) return authError;
  const bookId = url.searchParams.get("bookId");
  if (!bookId) return NextResponse.json({ error: "bookId required" }, { status: 400 });
  await deleteBookCover(bookId);
  return NextResponse.json({ ok: true });
}
