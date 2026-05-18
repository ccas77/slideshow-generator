import { NextRequest, NextResponse } from "next/server";
import { getAccountData } from "@/lib/kv";

export async function POST(req: NextRequest) {
  const pw = req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { accountIds } = (await req.json()) as { accountIds: number[] };
  if (!accountIds?.length) return NextResponse.json({ configs: {} });

  const configs: Record<number, { enabled: boolean; intervals: { start: string; end: string }[]; selections: { bookId: string; slideshowId: string }[]; pointer: number }> = {};

  await Promise.all(
    accountIds.map(async (id) => {
      const data = await getAccountData(id);
      if (data.config && (data.config.enabled || (data.config.selections && data.config.selections.length > 0))) {
        configs[id] = {
          enabled: data.config.enabled,
          intervals: data.config.intervals || [],
          selections: data.config.selections || [],
          pointer: data.config.pointer || 0,
        };
      }
    })
  );

  return NextResponse.json({ configs });
}
