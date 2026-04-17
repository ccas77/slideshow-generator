import { NextRequest, NextResponse } from "next/server";

const PB_BASE = "https://api.post-bridge.com";

function checkAuth(req: NextRequest) {
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const err = checkAuth(req);
  if (err) return err;

  try {
    const res = await fetch(`${PB_BASE}/v1/social-accounts?platform=tiktok&limit=100`, {
      headers: {
        Authorization: `Bearer ${process.env.POSTBRIDGE_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json({ error: `PostBridge error: ${res.status}` }, { status: 500 });
    }
    const data = await res.json();
    const accounts = (data.data || []).map((a: { id: number; username: string }) => ({
      id: a.id,
      username: a.username,
    }));
    return NextResponse.json({ accounts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
