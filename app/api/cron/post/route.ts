import { NextRequest, NextResponse } from "next/server";
import { acquireLock, releaseLock } from "@/lib/cron/lock";
import { getScheduledToday } from "@/lib/cron/scheduled-today";
import { runTikTokPhase } from "@/lib/cron/tiktok";
import { runTopNPhase } from "@/lib/cron/topn";
import { runInstagramPhase } from "@/lib/cron/instagram";
import { runVideoPhase } from "@/lib/cron/video";
import { runExcerptPhase } from "@/lib/cron/excerpts";

export const maxDuration = 300; // 5 min for Hobby

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Acquire a Redis lock to prevent concurrent cron runs from creating duplicates.
    const lockAcquired = await acquireLock();
    if (!lockAcquired) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Another cron run in progress" });
    }

    let cronResult;
    try {
      const scheduledToday = await getScheduledToday();

      // Phases 1–4: TikTok automation
      const { results, debugLog } = await runTikTokPhase(scheduledToday);

      // Phase 5: Top N list automation
      const topNResults = await runTopNPhase(scheduledToday);

      // Phase 6: IG slideshow automation (carousels)
      const igAutoResults = await runInstagramPhase(scheduledToday);

      // Phase 7: Video automation
      const videoResults = await runVideoPhase(scheduledToday);

      // Phase 8: Excerpt automation
      const excerptResults = await runExcerptPhase(scheduledToday);

      cronResult = NextResponse.json({ ok: true, results, topNResults, igAutoResults, videoResults, excerptResults, debugLog });
    } finally {
      await releaseLock();
    }

    return cronResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
