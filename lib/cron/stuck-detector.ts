import {
  getPostLog,
  getTopNLists,
  getTopNAutomation,
  type PostLogEntry,
} from "@/lib/kv";
import { notify } from "@/lib/notify";

// Looks back at the last two complete days of post-log. For each account, if
// the same slideshow/list ID was posted on both days, flag as stuck.
// Yesterday's data is read because today's data is mid-flight when the cron
// runs and incomplete entries would produce false positives.
//
// Pool-size-1 accounts are intentionally locked to one list (TopN account
// dedicated to a single theme). Those are NOT bugs and get filtered out
// before we email so the detector doesn't cry wolf every day.
export async function checkStuckRotations(): Promise<void> {
  const today = new Date();
  const yesterday = isoDate(daysAgo(today, 1));
  const dayBefore = isoDate(daysAgo(today, 2));

  let yLog: PostLogEntry[] = [];
  let dLog: PostLogEntry[] = [];
  try {
    [yLog, dLog] = await Promise.all([
      getPostLog(yesterday),
      getPostLog(dayBefore),
    ]);
  } catch {
    return;
  }

  if (yLog.length === 0 || dLog.length === 0) return;

  const yByAcc = groupByAccount(yLog);
  const dByAcc = groupByAccount(dLog);

  const candidates: Array<{
    accountId: number;
    sample: PostLogEntry;
    sharedName: string;
  }> = [];

  for (const [accId, yEntries] of yByAcc) {
    const dEntries = dByAcc.get(accId);
    if (!dEntries) continue;
    const ySlideshowIds = new Set(yEntries.map((e) => e.slideshowId).filter(Boolean));
    const dSlideshowIds = new Set(dEntries.map((e) => e.slideshowId).filter(Boolean));
    const shared = [...ySlideshowIds].filter((id) => dSlideshowIds.has(id));
    if (shared.length === 0) continue;

    const sample = yEntries.find((e) => shared.includes(e.slideshowId));
    const name = sample?.slideshowName || sample?.bookName || shared[0];
    candidates.push({ accountId: accId, sample: sample!, sharedName: name });
  }

  if (candidates.length === 0) return;

  // Filter out accounts whose effective TopN pool size is 1 (intentional
  // single-list config). Those aren't bugs.
  let topNLists: Awaited<ReturnType<typeof getTopNLists>> = [];
  let topNAuto: Awaited<ReturnType<typeof getTopNAutomation>> = { accounts: {} };
  try {
    [topNLists, topNAuto] = await Promise.all([
      getTopNLists(),
      getTopNAutomation(),
    ]);
  } catch {
    // If we can't load config, fall through and notify on everything.
  }

  const eligibleListsAllPools = topNLists.filter(
    (l) => l.bookIds.length > 0 || (l.genres && l.genres.length > 0)
  );

  const stuckRows: string[] = [];
  for (const c of candidates) {
    const accConfig = topNAuto.accounts?.[String(c.accountId)];
    if (accConfig && c.sample.source === "cron-topn") {
      let pool = eligibleListsAllPools;
      if (accConfig.listIds.length > 0) {
        pool = pool.filter((l) => accConfig.listIds.includes(l.id));
      }
      if (pool.length <= 1) continue; // intentional single-list config
    }
    const accountLabel = c.sample.accountName || String(c.accountId);
    stuckRows.push(
      `${accountLabel} (${c.accountId}): posted "${c.sharedName}" on both ${dayBefore} and ${yesterday}`
    );
  }

  if (stuckRows.length === 0) return;

  await notify({
    subject: `Slideshow Generator: ${stuckRows.length} account${stuckRows.length === 1 ? "" : "s"} stuck on same content`,
    body: [
      `Detected accounts posting the same slideshow/list two days in a row (${dayBefore} and ${yesterday}). This usually means a pointer never advanced or the pool is too small.`,
      "",
      ...stuckRows,
      "",
      "Single-list TopN configs are already filtered out, so these are real candidates.",
      "Check the post log and pointer audit. Past incidents: same class as 2026-05-07 (TikTok) and 2026-06-02 (TopN).",
    ].join("\n"),
    dedupeKey: `stuck-rotation:${yesterday}`,
    cooldownSec: 86400,
  });
}

function groupByAccount(entries: PostLogEntry[]): Map<number, PostLogEntry[]> {
  const out = new Map<number, PostLogEntry[]>();
  for (const e of entries) {
    if (!out.has(e.accountId)) out.set(e.accountId, []);
    out.get(e.accountId)!.push(e);
  }
  return out;
}

function daysAgo(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - n);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
