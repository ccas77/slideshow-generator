import { NextRequest, NextResponse } from "next/server";
import { getExcerpts, setExcerpts, Excerpt } from "@/lib/kv";

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
  const excerpts = await getExcerpts();
  return NextResponse.json({ excerpts });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const authError = checkAuth(body.password);
  if (authError) return authError;
  const { excerpts } = body as { excerpts: Excerpt[] };
  if (!Array.isArray(excerpts)) {
    return NextResponse.json({ error: "excerpts array required" }, { status: 400 });
  }
  await setExcerpts(excerpts);
  return NextResponse.json({ ok: true });
}
