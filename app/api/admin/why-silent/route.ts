import { NextRequest, NextResponse } from "next/server";
import {
  redis,
  getTopNAutomation,
  getTopNLists,
  TopNAccountConfig,
  TopNList,
} from "@/lib/kv";
import { shouldProcessWindow } from "@/lib/cron/window";

function checkAuth(req: NextRequest) {
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

type PostLogEntry = {
  date: string;
  time: string;
  accountId: number;
  accountName: string;
  slideshowName: string;
  postBridgeId: string;
  source: string;
  timestamp: string;
};

type AttemptLogEntry = {
  timestamp: string;
  path?: string;
  status?: number;
  outcome?: string;
  error?: string | null;
  accountId?: number;
};

function daysBetween(a: string, b: string): number {
  const aMs = Date.parse(a + "T00:00:00Z");
  const bMs = Date.parse(b + "T00:00:00Z");
  return Math.floor((bMs - aMs) / 86400000);
}

function resolvePool(
  cfg: TopNAccountConfig,
  allLists: TopNList[],
): { size: number; lists: Array<{ id: string; name: string }>; reason?: string } {
  let pool = allLists.filter(
    (l) => l.bookIds.length > 0 || (l.genres && l.genres.length > 0),
  );
  if (cfg.listIds.length > 0) {
    pool = pool.filter((l) => cfg.listIds.includes(l.id));
  }
  const out = {
    size: pool.length,
    lists: pool.map((l) => ({ id: l.id, name: l.name })),
  };
  if (pool.length === 0) {
    const configuredButEmpty = cfg.listIds.length > 0
      ? `listIds references ${cfg.listIds.length} list(s), but none survived the "has bookIds or genres" filter`
      : "no lists in the account (or none have bookIds/genres)";
    return { ...out, reason: configuredButEmpty };
  }
  return out;
}

export async function GET(req: NextRequest) {
  const err = checkAuth(req);
  if (err) return err;

  const url = new URL(req.url);
  const accIdStr = url.searchParams.get("accountId");
  if (!accIdStr) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  const accId = Number(accIdStr);
  if (!Number.isFinite(accId)) {
    return NextResponse.json({ error: "accountId must be a number" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();
  const DAY_MS = 86400000;

  const [auto, lists] = await Promise.all([getTopNAutomation(), getTopNLists()]);
  const cfg = auto.accounts[accIdStr];

  if (!cfg) {
    return NextResponse.json({
      accountId: accId,
      verdict: "NOT IN TOPN AUTOMATION CONFIG — this account has no TopN entry, so the TopN cron will never touch it.",
      configuredAccounts: Object.keys(auto.accounts),
    });
  }

  // Reconstruct the exact skip decision the cron would make right now.
  const reasons: string[] = [];
  if (!cfg.enabled) reasons.push("enabled=false");
  if (cfg.intervals.length === 0) reasons.push("intervals=[] (no time windows configured)");

  let daysSinceLastPost: number | null = null;
  if (cfg.lastPostDate) {
    daysSinceLastPost = daysBetween(cfg.lastPostDate, today);
    if (daysSinceLastPost < cfg.frequencyDays) {
      reasons.push(
        `frequency-gated: lastPostDate=${cfg.lastPostDate}, frequencyDays=${cfg.frequencyDays}, daysSince=${daysSinceLastPost} → SILENT SKIP until daysSince ≥ ${cfg.frequencyDays}`,
      );
    }
  }

  const pool = resolvePool(cfg, lists);
  if (pool.size === 0) reasons.push(`pool empty: ${pool.reason}`);

  const activeWindows = cfg.intervals.filter((w) => shouldProcessWindow(w.start));
  if (cfg.intervals.length > 0 && activeWindows.length === 0) {
    reasons.push(`no active windows right now (all ${cfg.intervals.length} configured windows are in the past for today)`);
  }

  // Pull the last 14 days of post-log entries for this account.
  const dayKeys: string[] = [];
  for (let i = 0; i < 14; i++) {
    dayKeys.push(new Date(nowMs - i * DAY_MS).toISOString().slice(0, 10));
  }
  const postLogs = await Promise.all(
    dayKeys.map((d) => redis.get<PostLogEntry[]>(`post-log:${d}`).catch(() => null)),
  );
  const postLogForAccount: PostLogEntry[] = [];
  for (const arr of postLogs) {
    if (Array.isArray(arr)) {
      for (const e of arr) if (e.accountId === accId) postLogForAccount.push(e);
    }
  }
  postLogForAccount.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  // Retry-log (last 2 days) for this account.
  const retryRaw = await Promise.all([
    redis.get<unknown[]>(`retry-log:${today}`).catch(() => null),
    redis.get<unknown[]>(`retry-log:${dayKeys[1]}`).catch(() => null),
  ]);
  const retryForAccount: AttemptLogEntry[] = [];
  for (const arr of retryRaw) {
    if (Array.isArray(arr)) {
      for (const raw of arr) {
        try {
          const parsed = typeof raw === "string" ? JSON.parse(raw) : (raw as AttemptLogEntry);
          if (parsed.accountId === accId) retryForAccount.push(parsed);
        } catch {}
      }
    }
  }
  retryForAccount.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

  const verdict =
    reasons.length === 0
      ? "No silent-skip reason detected — cron SHOULD attempt this account. If it isn't posting, the failure is downstream (publishTopN throw) and should be in retry-log or emails."
      : reasons.join(" | ");

  return NextResponse.json({
    accountId: accId,
    today,
    verdict,
    silentSkipReasons: reasons,
    config: {
      enabled: cfg.enabled,
      platform: cfg.platform,
      intervals: cfg.intervals,
      listIds: cfg.listIds,
      pointer: cfg.pointer,
      frequencyDays: cfg.frequencyDays,
      lastPostDate: cfg.lastPostDate ?? null,
      backgroundPromptsCount: cfg.backgroundPrompts?.length ?? 0,
    },
    daysSinceLastPost,
    activeWindowsNow: activeWindows.map((w) => `${w.start}-${w.end}`),
    resolvedPool: pool,
    lastPostLogEntries: postLogForAccount.slice(0, 20).map((e) => ({
      timestamp: e.timestamp,
      slideshowName: e.slideshowName,
      source: e.source,
      postBridgeId: e.postBridgeId,
    })),
    lastRetryLogEntries: retryForAccount.slice(0, 20),
  });
}
