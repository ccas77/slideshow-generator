import { NextRequest, NextResponse } from "next/server";
import { uploadPng, pbFetch } from "@/lib/post-bridge";

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

  const { slides, accountIds, scheduledAt, platform } = (await req.json()) as {
    slides: { imageData: string }[];
    accountIds: number[];
    scheduledAt?: string;
    platform?: "tiktok" | "instagram";
  };

  if (!slides?.length || !accountIds?.length) {
    return NextResponse.json({ error: "slides and accountIds required" }, { status: 400 });
  }

  if (slides.length < 2) {
    return NextResponse.json({ error: "Need at least 2 slides to post a carousel" }, { status: 400 });
  }

  try {
    const mediaIds: string[] = [];
    for (let i = 0; i < slides.length; i++) {
      const b64 = slides[i].imageData.includes(",")
        ? slides[i].imageData.split(",")[1]
        : slides[i].imageData;
      const buf = Buffer.from(b64, "base64");
      mediaIds.push(await uploadPng(buf, `excerpt-slide-${i + 1}.png`));
    }

    const platformConfig: Record<string, unknown> = {};
    if (platform === "instagram") {
      platformConfig.instagram = {};
    } else {
      platformConfig.tiktok = { draft: false, is_aigc: true };
    }

    const postBody: Record<string, unknown> = {
      caption: "",
      media: mediaIds,
      social_accounts: accountIds,
      platform_configurations: platformConfig,
    };
    if (scheduledAt) postBody.scheduled_at = scheduledAt;

    const postResp = await pbFetch("/v1/posts", {
      method: "POST",
      body: JSON.stringify(postBody),
    });

    const postId = postResp.id || postResp.data?.id || "unknown";
    return NextResponse.json({ ok: true, postId, slides: mediaIds.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
