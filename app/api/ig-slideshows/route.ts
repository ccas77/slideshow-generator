import { NextRequest, NextResponse } from "next/server";
import { getIgSlideshows, setIgSlideshows } from "@/lib/kv";

export async function GET() {
  const slideshows = await getIgSlideshows();
  return NextResponse.json({ slideshows });
}

export async function POST(req: NextRequest) {
  const { slideshows } = await req.json();
  await setIgSlideshows(slideshows);
  return NextResponse.json({ ok: true });
}
