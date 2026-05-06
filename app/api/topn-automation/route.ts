import { NextRequest, NextResponse } from "next/server";
import { getTopNAutomation, setTopNAutomation } from "@/lib/kv";

export async function GET() {
  const config = await getTopNAutomation();
  return NextResponse.json({ config });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (body.config) {
    // Full overwrite
    await setTopNAutomation(body.config);
  } else if (body.accountId && body.account) {
    // Patch a single account without touching others
    const existing = await getTopNAutomation();
    existing.accounts[body.accountId] = body.account;
    await setTopNAutomation(existing);
  } else if (body.accountId && body.patch) {
    // Partial update of a single account field (e.g. remove lastPostDate)
    const existing = await getTopNAutomation();
    const acc = existing.accounts[body.accountId];
    if (acc) {
      existing.accounts[body.accountId] = { ...acc, ...body.patch };
      await setTopNAutomation(existing);
    }
  }
  return NextResponse.json({ ok: true });
}
