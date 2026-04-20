import { NextRequest, NextResponse } from "next/server";
import { getTopNAutomation, setTopNAutomation } from "@/lib/kv";

export async function GET() {
  const config = await getTopNAutomation();
  return NextResponse.json({ config });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  await setTopNAutomation(body.config);
  return NextResponse.json({ ok: true });
}
