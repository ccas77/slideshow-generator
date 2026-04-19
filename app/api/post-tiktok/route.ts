import { NextRequest, NextResponse } from "next/server";

const PB_BASE = "https://api.post-bridge.com";

async function pbFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${PB_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.POSTBRIDGE_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`post-bridge ${path} ${res.status}: ${body}`);
  }
  return res.json();
}

function checkAuth(password: string | undefined) {
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword && password !== appPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  return null;
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1];
  const buf = Buffer.from(base64, "base64");
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

// GET: list TikTok accounts, or scheduled posts (requires ?password=...)
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const password = url.searchParams.get("password") || undefined;
    const action = url.searchParams.get("action");
    const authError = checkAuth(password);
    if (authError) return authError;

    if (action === "posts") {
      const accountId = url.searchParams.get("accountId");
      const [postsResp, resultsResp] = await Promise.all([
        pbFetch("/v1/posts?limit=50"),
        pbFetch("/v1/post-results?limit=100").catch(() => ({ data: [] })),
      ]);

      // Build per-post result info (account-level profile URLs)
      const postResults = new Map<string, Array<{
        accountId: number;
        username: string | null;
        profileUrl: string | null;
      }>>();
      for (const r of (resultsResp.data || []) as Array<{
        post_id: string;
        social_account_id: number;
        platform_data?: { url?: string; username?: string; id?: string };
      }>) {
        const pd = r.platform_data;
        const entry = {
          accountId: r.social_account_id,
          username: pd?.username || null,
          profileUrl: pd?.username ? `https://www.tiktok.com/@${pd.username}` : null,
        };
        const existing = postResults.get(r.post_id) || [];
        existing.push(entry);
        postResults.set(r.post_id, existing);
      }

      const all = (postsResp.data || []) as Array<{
        id: string;
        caption: string;
        status: string;
        scheduled_at: string | null;
        created_at: string;
        updated_at: string;
        social_accounts: number[];
        media: string[];
      }>;
      const filtered = accountId
        ? all.filter((p) => p.social_accounts.includes(Number(accountId)))
        : all;
      const posts = filtered.map((p) => {
        const results = postResults.get(p.id) || [];
        return {
          id: p.id,
          caption: p.caption,
          status: p.status,
          scheduled_at: p.scheduled_at,
          posted_at: p.status === "posted" ? (p.updated_at || p.created_at) : null,
          social_accounts: p.social_accounts,
          slide_count: p.media?.length || 0,
          results,
        };
      });
      return NextResponse.json({ posts });
    }

    const platform = url.searchParams.get("platform") || "tiktok";
    const accountsResp = await pbFetch(`/v1/social-accounts?platform=${platform}&limit=100`);
    const accounts = (accountsResp.data || []).map(
      (a: { id: number; username: string }) => ({
        id: a.id,
        username: a.username,
      })
    );
    return NextResponse.json({ accounts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: cancel a scheduled post
export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const password = url.searchParams.get("password") || undefined;
    const postId = url.searchParams.get("postId");
    const authError = checkAuth(password);
    if (authError) return authError;
    if (!postId) {
      return NextResponse.json({ error: "postId required" }, { status: 400 });
    }
    const res = await fetch(`${PB_BASE}/v1/posts/${postId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${process.env.POSTBRIDGE_API_KEY}`,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`post-bridge DELETE ${res.status}: ${body}`);
    }
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const body = await req.json();
    const authError = checkAuth(body.password);
    if (authError) return authError;

    // Upload a single image (browser sends PNG as base64 data URL)
    if (action === "upload") {
      const { image, index } = body as { image: string; index: number };
      const ab = dataUrlToArrayBuffer(image);

      const upload = await pbFetch("/v1/media/create-upload-url", {
        method: "POST",
        body: JSON.stringify({
          name: `slide-${index + 1}.png`,
          mime_type: "image/png",
          size_bytes: ab.byteLength,
        }),
      });

      const putRes = await fetch(upload.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: ab,
      });
      if (!putRes.ok) {
        const t = await putRes.text();
        throw new Error(`S3 upload failed: ${putRes.status} ${t}`);
      }

      return NextResponse.json({ media_id: upload.media_id });
    }

    // Publish the post to selected accounts
    if (action === "publish") {
      const { caption, mediaIds, accountIds } = body as {
        caption: string;
        mediaIds: string[];
        accountIds: number[];
      };

      if (!accountIds || accountIds.length === 0) {
        return NextResponse.json(
          { error: "Select at least one TikTok account" },
          { status: 400 }
        );
      }
      if (!mediaIds || mediaIds.length < 2) {
        return NextResponse.json(
          { error: "Need at least 2 slides for a TikTok carousel" },
          { status: 400 }
        );
      }

      const post = await pbFetch("/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          caption: caption || "",
          media: mediaIds,
          social_accounts: accountIds,
          platform_configurations: {
            tiktok: { draft: false, is_aigc: true },
          },
        }),
      });

      return NextResponse.json({ success: true, post });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Post failed";
    console.error("post-bridge error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
