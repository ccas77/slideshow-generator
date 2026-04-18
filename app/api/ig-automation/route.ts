import { NextRequest, NextResponse } from "next/server";
import { getIgAutomation, setIgAutomation } from "@/lib/kv";

export async function GET() {
  const config = await getIgAutomation();
  return NextResponse.json({ config });
}

export async function POST(req: NextRequest) {
  const { config } = await req.json();
  await setIgAutomation(config);
  return NextResponse.json({ ok: true });
}
