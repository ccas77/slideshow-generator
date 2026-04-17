import { NextRequest, NextResponse } from "next/server";
import { getTopBooks, getTopBook, setTopBook, deleteTopBook, TopBook } from "@/lib/kv";

function checkAuth(req: NextRequest) {
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export async function GET(req: NextRequest) {
  const err = checkAuth(req);
  if (err) return err;

  const url = new URL(req.url);
  const minimal = url.searchParams.get("minimal") === "true";

  const books = await getTopBooks();
  if (minimal) {
    // Return without cover data for list views (faster)
    return NextResponse.json({
      books: books.map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author,
        genre: b.genre || "",
        pinned: b.pinned,
        hasCover: !!b.coverData,
      })),
    });
  }
  return NextResponse.json({ books });
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const body = await req.json();
  const { title, author, genre, coverData, pinned } = body as {
    title: string;
    author: string;
    genre?: string;
    coverData: string;
    pinned?: boolean;
  };

  if (!title || !coverData) {
    return NextResponse.json({ error: "title and coverData required" }, { status: 400 });
  }

  const book: TopBook = {
    id: uid(),
    title,
    author: author || "",
    genre: genre || "",
    coverData,
    pinned: !!pinned,
  };
  await setTopBook(book);

  return NextResponse.json({ book: { ...book, coverData: "[stored]" } });
}

export async function PUT(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const body = await req.json();
  const { id, title, author, genre, coverData, pinned } = body as {
    id: string;
    title?: string;
    author?: string;
    genre?: string;
    coverData?: string;
    pinned?: boolean;
  };

  const book = await getTopBook(id);
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (title !== undefined) book.title = title;
  if (author !== undefined) book.author = author;
  if (genre !== undefined) book.genre = genre;
  if (pinned !== undefined) book.pinned = pinned;
  if (coverData) book.coverData = coverData;

  await setTopBook(book);
  return NextResponse.json({ book: { ...book, coverData: "[stored]" } });
}

export async function DELETE(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await deleteTopBook(id);
  return NextResponse.json({ ok: true });
}
