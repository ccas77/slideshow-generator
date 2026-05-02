import { NextRequest, NextResponse } from "next/server";
import { getExcerptAutomation, setExcerptAutomation, ExcerptAutomation } from "@/lib/kv";

function checkAuth(req: NextRequest) {
  const pw =
    req.headers.get("x-password") ||
    new URL(req.url).searchParams.get("password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const config = await getExcerptAutomation();
  return NextResponse.json({ config });
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;
  const { config } = (await req.json()) as { config: ExcerptAutomation };
  if (!config) {
    return NextResponse.json({ error: "config required" }, { status: 400 });
  }
  await setExcerptAutomation(config);
  return NextResponse.json({ ok: true });
}
