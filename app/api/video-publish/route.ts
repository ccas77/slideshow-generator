import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/kv";
import { uploadVideo, pbFetch } from "@/lib/post-bridge";

export const maxDuration = 300;

function checkAuth(req: NextRequest) {
  const pw = req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const authErr = checkAuth(req);
  if (authErr) return authErr;

  const { generationId, accountId, platform, caption, scheduledAt } = (await req.json()) as {
    generationId: string;
    accountId: number;
    platform: "tiktok" | "instagram";
    caption?: string;
    scheduledAt?: string;
  };

  if (!generationId || !accountId) {
    return NextResponse.json({ error: "generationId and accountId required" }, { status: 400 });
  }

  const b64 = await redis.get<string>(generationId);
  if (!b64) {
    return NextResponse.json({ error: "Video expired or not found. Please regenerate." }, { status: 404 });
  }

  try {
    const buf = Buffer.from(b64, "base64");
    const mediaId = await uploadVideo(buf, "manual-video.mp4");

    const platformConfig: Record<string, unknown> = {};
    if (platform === "instagram") {
      platformConfig.instagram = {};
    } else {
      platformConfig.tiktok = { draft: false, is_aigc: true };
    }

    const postBody: Record<string, unknown> = {
      caption: caption || " ",
      media: [mediaId],
      social_accounts: [accountId],
      platform_configurations: platformConfig,
    };
    if (scheduledAt) postBody.scheduled_at = scheduledAt;

    const postResp = await pbFetch("/v1/posts", {
      method: "POST",
      body: JSON.stringify(postBody),
    });

    const postId = postResp.id || postResp.data?.id || "unknown";
    return NextResponse.json({ ok: true, postId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
