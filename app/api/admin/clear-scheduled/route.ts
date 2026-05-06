import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/kv";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const prefix = body.prefix as string | undefined; // e.g. "topn:61833" or "57063:18:00"
  const today = new Date().toISOString().slice(0, 10);
  const key = `cron-scheduled:${today}`;

  if (prefix) {
    // Only remove entries matching the prefix
    const existing = await redis.get<string[]>(key);
    if (!existing) return NextResponse.json({ ok: true, removed: [] });
    const removed = existing.filter((e) => e.startsWith(prefix));
    const remaining = existing.filter((e) => !e.startsWith(prefix));
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 1, 0, 0));
    const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
    await redis.set(key, remaining, { ex: ttl });
    return NextResponse.json({ ok: true, removed });
  }

  // No prefix = clear everything (dangerous, use with caution)
  await redis.del(key);
  return NextResponse.json({ ok: true, cleared: key });
}
