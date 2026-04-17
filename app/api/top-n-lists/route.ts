import { NextRequest, NextResponse } from "next/server";
import { getTopNLists, setTopNLists, TopNList } from "@/lib/kv";

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
  return NextResponse.json({ lists: await getTopNLists() });
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const body = await req.json();

  if (body.lists) {
    // Bulk save
    await setTopNLists(body.lists);
    return NextResponse.json({ ok: true });
  }

  const { name, titleTexts, count, bookIds, captions } = body as {
    name: string;
    titleTexts: string[];
    count: number;
    bookIds: string[];
    captions?: string[];
  };

  const list: TopNList = {
    id: uid(),
    name,
    titleTexts: titleTexts || [],
    count,
    bookIds: bookIds || [],
    captions: captions || [],
  };

  const lists = await getTopNLists();
  lists.push(list);
  await setTopNLists(lists);
  return NextResponse.json({ list });
}

export async function DELETE(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const lists = await getTopNLists();
  await setTopNLists(lists.filter((l) => l.id !== id));
  return NextResponse.json({ ok: true });
}
