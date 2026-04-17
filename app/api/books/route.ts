import { NextRequest, NextResponse } from "next/server";
import { getBooks, setBooks, Book } from "@/lib/kv";

function checkAuth(password: string | undefined) {
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword && password !== appPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const password = url.searchParams.get("password") || undefined;
  const authError = checkAuth(password);
  if (authError) return authError;
  const books = await getBooks();
  return NextResponse.json({ books });
}

// Replaces the full books list. Client does read-modify-write.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const authError = checkAuth(body.password);
  if (authError) return authError;
  const { books } = body as { books: Book[] };
  if (!Array.isArray(books)) {
    return NextResponse.json({ error: "books array required" }, { status: 400 });
  }
  await setBooks(books);
  return NextResponse.json({ ok: true });
}
