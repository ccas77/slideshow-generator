import { NextRequest, NextResponse } from "next/server";
import { getAppSettings, setAppSettings } from "@/lib/kv";

function checkAuth(req: NextRequest) {
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const err = checkAuth(req);
  if (err) return err;
  return NextResponse.json(await getAppSettings());
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const body = await req.json();
  await setAppSettings(body);
  return NextResponse.json({ ok: true });
}
