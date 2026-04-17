import { NextRequest, NextResponse } from "next/server";
import { publishTopN } from "@/lib/topn-publisher";

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

  const body = await req.json();
  const { listId, accountIds, scheduledAt } = body as {
    listId: string;
    accountIds: number[];
    scheduledAt?: string;
  };

  if (!listId || !accountIds?.length) {
    return NextResponse.json({ error: "listId and accountIds required" }, { status: 400 });
  }

  try {
    const result = await publishTopN({ listId, accountIds, scheduledAt });
    return NextResponse.json({
      ok: true,
      postId: result.postId,
      slides: result.slides,
      books: result.books,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === "List not found" ? 404 : msg === "No books selected" ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
