import { getPostLog, type PostLogEntry } from "@/lib/kv";
import { notify } from "@/lib/notify";

// Looks back at the last two complete days of post-log. For each account, if
// the same slideshow/list ID was posted on both days, flag as stuck.
// Yesterday's data is read because today's data is mid-flight when the cron
// runs and incomplete entries would produce false positives.
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

  const stuckRows: string[] = [];
  for (const [accId, yEntries] of yByAcc) {
    const dEntries = dByAcc.get(accId);
    if (!dEntries) continue;
    const ySlideshowIds = new Set(yEntries.map((e) => e.slideshowId).filter(Boolean));
    const dSlideshowIds = new Set(dEntries.map((e) => e.slideshowId).filter(Boolean));
    const shared = [...ySlideshowIds].filter((id) => dSlideshowIds.has(id));
    if (shared.length === 0) continue;

    const sample = yEntries.find((e) => shared.includes(e.slideshowId));
    const name = sample?.slideshowName || sample?.bookName || shared[0];
    const accountLabel = sample?.accountName || String(accId);
    stuckRows.push(
      `${accountLabel} (${accId}): posted "${name}" on both ${dayBefore} and ${yesterday}`
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
