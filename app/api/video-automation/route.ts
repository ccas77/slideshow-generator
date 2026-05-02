import { NextRequest, NextResponse } from "next/server";
import { getVideoAutomation, setVideoAutomation } from "@/lib/kv";

export async function GET() {
  const config = await getVideoAutomation();
  return NextResponse.json({ config });
}

export async function POST(req: NextRequest) {
  const { config } = await req.json();
  await setVideoAutomation(config);
  return NextResponse.json({ ok: true });
}
