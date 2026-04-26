import { NextRequest, NextResponse } from "next/server";
import {
  redis,
  getTopNAutomation,
  getIgAutomation,
} from "@/lib/kv";
import type { LegacyAutomationConfig } from "@/lib/kv";
import { listTikTokAccounts } from "@/lib/post-bridge";

function checkAuth(req: NextRequest) {
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function isValidWindow(start: string, end: string): boolean {
  const s = parseTime(start);
  const e = parseTime(end);
  const [sh] = start.split(":").map(Number);
  const [eh] = end.split(":").map(Number);
  if (sh < 0 || sh > 23 || eh < 0 || eh > 23) return false;
  if (e <= s) return false;
  return true;
}

type ConfigShape = "legacy" | "intervals" | "both" | "none";
type ContentShape = "legacy" | "selections" | "both" | "none";

export async function GET(req: NextRequest) {
  const err = checkAuth(req);
  if (err) return err;

  try {
    const accounts = await listTikTokAccounts();
    const topNAuto = await getTopNAutomation();
    const igAuto = await getIgAutomation();

    // --- TikTok account configs (read RAW to detect legacy fields) ---
    const tiktokReports = [];
    const shapeCounts: Record<ConfigShape, number> = { legacy: 0, intervals: 0, both: 0, none: 0 };
    const contentCounts: Record<ContentShape, number> = { legacy: 0, selections: 0, both: 0, none: 0 };
    let enabledEmptyIntervals = 0;
    let invalidWindows = 0;
    let mixedConfigs = 0;

    for (const acc of accounts) {
      const rawData = await redis.get<{ config?: LegacyAutomationConfig; lastRun?: string; lastStatus?: string }>(`account:${acc.id}`);
      const cfg: LegacyAutomationConfig = rawData?.config || {};

      // Classify config shape
      const hasLegacy = !!(cfg.windowStart && cfg.windowEnd);
      const hasIntervals = !!(cfg.intervals && cfg.intervals.length > 0);
      let configShape: ConfigShape = "none";
      if (hasLegacy && hasIntervals) { configShape = "both"; mixedConfigs++; }
      else if (hasIntervals) configShape = "intervals";
      else if (hasLegacy) configShape = "legacy";
      shapeCounts[configShape]++;

      // Classify content shape
      const hasLegacyContent = !!(cfg.bookId && cfg.slideshowIds && cfg.slideshowIds.length > 0);
      const hasSelections = !!(cfg.selections && cfg.selections.length > 0);
      let contentShape: ContentShape = "none";
      if (hasLegacyContent && hasSelections) { contentShape = "both"; }
      else if (hasSelections) contentShape = "selections";
      else if (hasLegacyContent) contentShape = "legacy";
      contentCounts[contentShape]++;

      // Check for enabled but empty intervals
      if (cfg.enabled && !hasIntervals && !hasLegacy) enabledEmptyIntervals++;

      // Collect all windows and validate
      const allWindows: Array<{ start: string; end: string; source: string }> = [];
      if (hasLegacy) {
        allWindows.push({ start: cfg.windowStart!, end: cfg.windowEnd!, source: "legacy-primary" });
        if (cfg.windowStart2 && cfg.windowEnd2) {
          allWindows.push({ start: cfg.windowStart2, end: cfg.windowEnd2, source: "legacy-secondary" });
        }
      }
      if (hasIntervals) {
        cfg.intervals!.forEach((w, i) => allWindows.push({ start: w.start, end: w.end, source: `interval[${i}]` }));
      }

      const windowDetails = allWindows.map((w) => {
        const valid = isValidWindow(w.start, w.end);
        if (!valid) invalidWindows++;
        return { ...w, valid };
      });

      tiktokReports.push({
        accountId: acc.id,
        username: acc.username,
        enabled: !!cfg.enabled,
        configShape,
        contentShape,
        windows: windowDetails,
        legacyBookId: cfg.bookId || null,
        legacySlideshowIds: cfg.slideshowIds || [],
        selections: cfg.selections || [],
        lastRun: rawData?.lastRun || null,
        lastStatus: rawData?.lastStatus || null,
      });
    }

    // --- TopN automation configs ---
    const topNReports = [];
    for (const [accIdStr, cfg] of Object.entries(topNAuto.accounts)) {
      const windowDetails = cfg.intervals.map((w, i) => ({
        start: w.start,
        end: w.end,
        source: `interval[${i}]`,
        valid: isValidWindow(w.start, w.end),
      }));
      topNReports.push({
        accountId: accIdStr,
        enabled: cfg.enabled,
        platform: cfg.platform,
        intervals: windowDetails,
        listIds: cfg.listIds,
        pointer: cfg.pointer,
        frequencyDays: cfg.frequencyDays,
        lastPostDate: cfg.lastPostDate || null,
      });
    }

    // --- IG automation configs ---
    const igReports = [];
    for (const [accIdStr, cfg] of Object.entries(igAuto.accounts || {})) {
      const windowDetails = cfg.intervals.map((w, i) => ({
        start: w.start,
        end: w.end,
        source: `interval[${i}]`,
        valid: isValidWindow(w.start, w.end),
      }));
      igReports.push({
        accountId: accIdStr,
        enabled: cfg.enabled,
        intervals: windowDetails,
        bookIds: cfg.bookIds,
        slideshowIds: cfg.slideshowIds,
        pointer: cfg.pointer,
      });
    }
    // Flag IG legacy fields if present
    const igLegacyFields = {
      hasLegacyIgAccountIds: !!(igAuto.igAccountIds && igAuto.igAccountIds.length > 0),
      hasLegacyTiktokAccountIds: !!(igAuto.tiktokAccountIds && igAuto.tiktokAccountIds.length > 0),
      hasLegacyIntervals: !!(igAuto.intervals && igAuto.intervals.length > 0),
      hasLegacyIgPointer: igAuto.igPointer !== undefined,
    };

    return NextResponse.json({
      summary: {
        totalAccounts: accounts.length,
        tiktokConfigShapes: shapeCounts,
        tiktokContentShapes: contentCounts,
        mixedConfigShapes: mixedConfigs,
        enabledButEmptyIntervals: enabledEmptyIntervals,
        invalidWindows,
        topNAccountCount: Object.keys(topNAuto.accounts).length,
        igAccountCount: Object.keys(igAuto.accounts || {}).length,
        igLegacyFields,
      },
      tiktokAccounts: tiktokReports,
      topNAccounts: topNReports,
      igAccounts: igReports,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
