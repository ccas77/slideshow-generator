import { NextRequest, NextResponse } from "next/server";
import {
  getIgAutomation,
  getVideoAutomation,
  getTopNAutomation,
  getExcerptAutomation,
  getAccountData,
} from "@/lib/kv";
import { pbFetch } from "@/lib/post-bridge";

// Fans out to PostBridge for the account list plus one Redis read per account
// for the TikTok automation, so give it more than the platform default.
export const maxDuration = 60;

const PLATFORMS = ["tiktok", "instagram", "facebook"] as const;

interface SocialAccount {
  id: number;
  username: string;
  platform: string;
}

// The TikTok (home page) automation is stored per account under `account:{id}`
// with no index, so the only way to enumerate it is to walk the account list.
async function listAllAccounts(): Promise<SocialAccount[]> {
  const results = await Promise.all(
    PLATFORMS.map((p) =>
      pbFetch(`/v1/social-accounts?platform=${p}&limit=100`, {}, { retryable: true }).catch(
        () => ({ data: [] }),
      ),
    ),
  );
  return results.flatMap((r, i) =>
    ((r.data || []) as Array<{ id: number; username: string }>).map((a) => ({
      id: a.id,
      username: a.username,
      platform: PLATFORMS[i],
    })),
  );
}

export async function GET(req: NextRequest) {
  const pw = req.headers.get("x-password") || req.nextUrl.searchParams.get("pw");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [ig, video, topn, excerpt, accounts] = await Promise.all([
    getIgAutomation(),
    getVideoAutomation(),
    getTopNAutomation(),
    getExcerptAutomation(),
    listAllAccounts().catch(() => [] as SocialAccount[]),
  ]);

  // accountId -> username, so the page can show handles instead of bare numeric
  // ids. Finding an account by handle is the whole point of this screen — e.g.
  // switching off every automation for an account that has been banned.
  const usernames: Record<string, string> = {};
  const platforms: Record<string, string> = {};
  for (const a of accounts) {
    usernames[String(a.id)] = a.username;
    platforms[String(a.id)] = a.platform;
  }

  // TikTok daily-post automations: one Redis read per known account. Only
  // accounts that are actually configured come back.
  const tiktokAccounts: Record<
    string,
    {
      enabled: boolean;
      intervals: Array<{ start: string; end: string }>;
      selections: Array<{ bookId: string; slideshowId: string }>;
      pointer: number;
    }
  > = {};
  await Promise.all(
    accounts.map(async (a) => {
      try {
        const cfg = (await getAccountData(a.id)).config;
        if (!cfg) return;
        if (cfg.enabled || (cfg.selections && cfg.selections.length > 0)) {
          tiktokAccounts[String(a.id)] = {
            enabled: cfg.enabled,
            intervals: cfg.intervals || [],
            selections: cfg.selections || [],
            pointer: cfg.pointer || 0,
          };
        }
      } catch {
        // One unreadable account must not blank the whole page.
      }
    }),
  );

  return NextResponse.json({
    ig,
    video,
    topn,
    excerpt,
    tiktok: { accounts: tiktokAccounts },
    usernames,
    platforms,
  });
}
