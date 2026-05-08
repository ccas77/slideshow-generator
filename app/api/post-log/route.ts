import { NextRequest, NextResponse } from "next/server";
import { getPostLog, appendPostLog, PostLogEntry } from "@/lib/kv";
import { listTikTokAccounts, pbFetch } from "@/lib/post-bridge";

function checkAuth(password: string | undefined) {
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword && password !== appPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const authError = checkAuth(url.searchParams.get("password") || undefined);
  if (authError) return authError;

  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  }

  const entries = await getPostLog(date);
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const { password, date } = await req.json();
  const authError = checkAuth(password);
  if (authError) return authError;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  }

  const accounts = await listTikTokAccounts();
  const existing = await getPostLog(date);
  const existingIds = new Set(existing.map((e) => e.postBridgeId));

  let added = 0;
  for (const acc of accounts) {
    try {
      const resp = await pbFetch(`/v1/posts?social_account_id=${acc.id}&limit=50`);
      const posts = resp.data || [];
      for (const p of posts) {
        const sched = p.scheduled_at || p.created_at || "";
        if (sched.slice(0, 10) !== date) continue;
        const postId = String(p.id || "");
        if (existingIds.has(postId)) continue;

        const entry: PostLogEntry = {
          date,
          time: sched.slice(11, 16),
          accountId: acc.id,
          accountName: acc.username,
          bookName: "",
          slideshowId: "",
          slideshowName: "",
          imagePromptId: "",
          imagePromptText: "",
          captionId: "",
          captionText: (p.caption || "").slice(0, 100),
          postBridgeId: postId,
          postBridgeUrl: p.url || "",
          source: "postbridge-sync",
          timestamp: new Date().toISOString(),
        };
        await appendPostLog(entry);
        existingIds.add(postId);
        added++;
      }
    } catch {}
  }

  const entries = await getPostLog(date);
  return NextResponse.json({ entries, added });
}
