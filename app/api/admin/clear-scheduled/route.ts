import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/kv";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const key = `cron-scheduled:${today}`;
  await redis.del(key);
  return NextResponse.json({ ok: true, cleared: key });
}
