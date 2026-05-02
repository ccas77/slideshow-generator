import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/kv";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const pw = url.searchParams.get("password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const b64 = await redis.get<string>(id);
  if (!b64) {
    return NextResponse.json({ error: "Video expired or not found" }, { status: 404 });
  }

  const buf = Buffer.from(b64, "base64");
  return new Response(buf, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(buf.length),
    },
  });
}
