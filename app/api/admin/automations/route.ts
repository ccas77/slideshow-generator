import { NextRequest, NextResponse } from "next/server";
import { getIgAutomation, getVideoAutomation, getTopNAutomation } from "@/lib/kv";

export async function GET(req: NextRequest) {
  const pw = req.headers.get("x-password") || req.nextUrl.searchParams.get("pw");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [ig, video, topn] = await Promise.all([
    getIgAutomation(),
    getVideoAutomation(),
    getTopNAutomation(),
  ]);

  return NextResponse.json({ ig, video, topn });
}
