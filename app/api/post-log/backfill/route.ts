import { NextRequest, NextResponse } from "next/server";
import { getAccountData, getPostLog, appendPostLog, PostLogEntry } from "@/lib/kv";
import { listTikTokAccounts, pbFetch } from "@/lib/post-bridge";

export const maxDuration = 300;

function checkAuth(password: string | undefined) {
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword && password !== appPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const password = url.searchParams.get("password") || undefined;
  const authError = checkAuth(password);
  if (authError) return authError;

  const accounts = await listTikTokAccounts();
  const stats = { accounts: 0, entriesAdded: 0, datesFound: new Set<string>() };

  for (const acc of accounts) {
    const data = await getAccountData(acc.id);
    if (!data.recentPosts || data.recentPosts.length === 0) continue;

    stats.accounts++;

    const pbUrlMap = new Map<string, string>();
    try {
      const resp = await pbFetch(`/v1/posts?social_account_id=${acc.id}&limit=50`);
      const posts = resp.data || [];
      for (const p of posts) {
        if (p.id && p.url) {
          pbUrlMap.set(String(p.id), String(p.url));
        }
      }
    } catch {}

    for (const post of data.recentPosts) {
      const schedDate = post.scheduledAt?.slice(0, 10);
      if (!schedDate) continue;

      stats.datesFound.add(schedDate);

      const existing = await getPostLog(schedDate);
      if (existing.some((e) => e.postBridgeId === post.postId)) continue;

      const entry: PostLogEntry = {
        date: schedDate,
        time: post.scheduledAt?.slice(11, 16) || "",
        accountId: acc.id,
        accountName: acc.username,
        bookName: post.bookName || "",
        slideshowId: "",
        slideshowName: post.slideshowName || "",
        imagePromptId: "",
        imagePromptText: post.promptSnippet || "",
        captionId: "",
        captionText: "",
        postBridgeId: post.postId || "",
        postBridgeUrl: pbUrlMap.get(post.postId) || "",
        source: "backfill",
        timestamp: post.timestamp || post.scheduledAt || "",
      };
      await appendPostLog(entry);
      stats.entriesAdded++;
    }
  }

  return NextResponse.json({
    ok: true,
    accountsWithData: stats.accounts,
    entriesAdded: stats.entriesAdded,
    datesFound: [...stats.datesFound].sort(),
  });
}
