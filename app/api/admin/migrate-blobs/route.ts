import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/kv";
import { uploadDataUrlToBlob, parseDataUrl, isRemoteUrl } from "@/lib/blob";

// One-time backfill endpoint. Walks every base64-shaped record in the four
// blob-heavy Redis stores (music-track:*, video-music:*, top-book:*,
// book-cover:*), uploads the payload to Vercel Blob, and rewrites the
// record with the URL replacing the base64.
//
// Idempotent: records whose field is already a remote URL are skipped, so
// re-running is safe (nothing double-uploads).
//
// Auth: x-password header OR Authorization: Bearer <CRON_SECRET>.

export const maxDuration = 800;

interface Report {
  scanned: number;
  migrated: number;
  already_url: number;
  failed: number;
  freed_bytes: number;
  errors: string[];
  by_prefix: Record<string, { migrated: number; freed_bytes: number }>;
}

function authOk(req: NextRequest): boolean {
  const pw = req.headers.get("x-password");
  if (pw && pw === process.env.APP_PASSWORD) return true;
  const bearer = req.headers.get("authorization") || "";
  if (bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

async function migrateRecord(
  prefix: string,
  id: string,
  fieldName: "audioData" | "coverData",
  report: Report,
): Promise<void> {
  const key = `${prefix}:${id}`;
  report.scanned++;
  const entry = await redis.get<Record<string, unknown>>(key);
  if (!entry || typeof entry !== "object") {
    report.errors.push(`${key}: not an object`);
    report.failed++;
    return;
  }
  const raw = entry[fieldName];
  if (typeof raw !== "string" || raw.length === 0) {
    report.errors.push(`${key}: missing ${fieldName}`);
    report.failed++;
    return;
  }
  if (isRemoteUrl(raw)) {
    report.already_url++;
    return;
  }
  const parsed = parseDataUrl(raw);
  if (!parsed) {
    report.errors.push(`${key}: unparseable data URL`);
    report.failed++;
    return;
  }
  const before_bytes = raw.length;
  try {
    const url = await uploadDataUrlToBlob(`${prefix}/${id}`, raw);
    if (!url) {
      report.errors.push(`${key}: upload returned null`);
      report.failed++;
      return;
    }
    const updated = { ...entry, [fieldName]: url };
    await redis.set(key, updated);
    report.migrated++;
    report.freed_bytes += before_bytes - url.length;
    const b = report.by_prefix[prefix] || { migrated: 0, freed_bytes: 0 };
    b.migrated++;
    b.freed_bytes += before_bytes - url.length;
    report.by_prefix[prefix] = b;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.errors.push(`${key}: ${msg}`);
    report.failed++;
  }
}

async function migrateBookCoverKey(key: string, report: Report): Promise<void> {
  report.scanned++;
  const raw = await redis.get<string>(key);
  if (typeof raw !== "string" || raw.length === 0) {
    report.errors.push(`${key}: empty`);
    report.failed++;
    return;
  }
  if (isRemoteUrl(raw)) {
    report.already_url++;
    return;
  }
  const parsed = parseDataUrl(raw);
  if (!parsed) {
    report.errors.push(`${key}: unparseable data URL`);
    report.failed++;
    return;
  }
  const bookId = key.slice("book-cover:".length);
  const before_bytes = raw.length;
  try {
    const url = await uploadDataUrlToBlob(`book-cover/${bookId}`, raw);
    if (!url) {
      report.errors.push(`${key}: upload returned null`);
      report.failed++;
      return;
    }
    await redis.set(key, url);
    report.migrated++;
    report.freed_bytes += before_bytes - url.length;
    const b = report.by_prefix["book-cover"] || { migrated: 0, freed_bytes: 0 };
    b.migrated++;
    b.freed_bytes += before_bytes - url.length;
    report.by_prefix["book-cover"] = b;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.errors.push(`${key}: ${msg}`);
    report.failed++;
  }
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report: Report = {
    scanned: 0,
    migrated: 0,
    already_url: 0,
    failed: 0,
    freed_bytes: 0,
    errors: [],
    by_prefix: {},
  };

  // 1. music-track:* via its index
  const mtIds = (await redis.get<string[]>("music-tracks-index")) || [];
  for (const id of mtIds) {
    await migrateRecord("music-track", id, "audioData", report);
  }

  // 2. video-music:* via its index
  const vmIds = (await redis.get<string[]>("video-music-index")) || [];
  for (const id of vmIds) {
    await migrateRecord("video-music", id, "audioData", report);
  }

  // 3. top-book:* via its index
  const tbIds = (await redis.get<string[]>("top-books-index")) || [];
  for (const id of tbIds) {
    await migrateRecord("top-book", id, "coverData", report);
  }

  // 4. book-cover:* — no index, scan by pattern
  let cursor = 0;
  const bookCoverKeys: string[] = [];
  do {
    const [next, batch] = await redis.scan(cursor, {
      match: "book-cover:*",
      count: 100,
    });
    bookCoverKeys.push(...batch);
    cursor = Number(next);
  } while (cursor !== 0);

  for (const key of bookCoverKeys) {
    await migrateBookCoverKey(key, report);
  }

  return NextResponse.json(report);
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Dry preview: count records + byte totals per prefix, no writes.
  const summary: Record<string, { count: number; total_bytes: number; already_url: number }> = {};

  async function scan(prefix: string, ids: string[], field: "audioData" | "coverData") {
    const s = { count: 0, total_bytes: 0, already_url: 0 };
    for (const id of ids) {
      const entry = await redis.get<Record<string, unknown>>(`${prefix}:${id}`);
      if (!entry || typeof entry !== "object") continue;
      const raw = entry[field];
      if (typeof raw !== "string") continue;
      s.count++;
      s.total_bytes += raw.length;
      if (isRemoteUrl(raw)) s.already_url++;
    }
    summary[prefix] = s;
  }

  await scan("music-track", (await redis.get<string[]>("music-tracks-index")) || [], "audioData");
  await scan("video-music", (await redis.get<string[]>("video-music-index")) || [], "audioData");
  await scan("top-book", (await redis.get<string[]>("top-books-index")) || [], "coverData");

  // book-cover:*
  let cursor = 0;
  const bcSummary = { count: 0, total_bytes: 0, already_url: 0 };
  do {
    const [next, batch] = await redis.scan(cursor, {
      match: "book-cover:*",
      count: 100,
    });
    for (const key of batch) {
      const raw = await redis.get<string>(key);
      if (typeof raw !== "string") continue;
      bcSummary.count++;
      bcSummary.total_bytes += raw.length;
      if (isRemoteUrl(raw)) bcSummary.already_url++;
    }
    cursor = Number(next);
  } while (cursor !== 0);
  summary["book-cover"] = bcSummary;

  return NextResponse.json(summary);
}
