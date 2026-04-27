import { NextRequest, NextResponse } from "next/server";
import {
  redis,
  getAccountData,
  setAccountData,
} from "@/lib/kv";
import { listTikTokAccounts } from "@/lib/post-bridge";

function checkAuth(req: NextRequest) {
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const err = checkAuth(req);
  if (err) return err;

  const report: {
    accountsMigrated: number;
    accountsAlreadyClean: number;
    accountErrors: Array<{ accountId: number; error: string }>;
  } = {
    accountsMigrated: 0,
    accountsAlreadyClean: 0,
    accountErrors: [],
  };

  try {
    const accounts = await listTikTokAccounts();

    for (const acc of accounts) {
      try {
        // Read raw data to check if legacy fields exist
        const rawData = await redis.get<Record<string, unknown>>(`account:${acc.id}`);
        if (!rawData) {
          report.accountsAlreadyClean++;
          continue;
        }

        const rawConfig = rawData.config as Record<string, unknown> | undefined;
        if (!rawConfig) {
          report.accountsAlreadyClean++;
          continue;
        }

        // Check if any legacy fields are present
        const hasLegacy =
          "windowStart" in rawConfig ||
          "windowEnd" in rawConfig ||
          "windowStart2" in rawConfig ||
          "windowEnd2" in rawConfig ||
          "bookId" in rawConfig ||
          "slideshowIds" in rawConfig ||
          "postsPerDay" in rawConfig;

        if (!hasLegacy) {
          report.accountsAlreadyClean++;
          continue;
        }

        // Read through the migrating getter, then write back canonical shape
        const data = await getAccountData(acc.id);
        await setAccountData(acc.id, data);
        report.accountsMigrated++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        report.accountErrors.push({ accountId: acc.id, error: msg });
      }
    }

    return NextResponse.json({
      ok: true,
      ...report,
      total: accounts.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
