import { NextRequest, NextResponse } from "next/server";
import { redis, getAccountData } from "@/lib/kv";
import { listTikTokAccounts } from "@/lib/post-bridge";

function checkAuth(req: NextRequest) {
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  if (process.env.APP_PASSWORD && pw !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const authError = checkAuth(req);
  if (authError) return authError;

  const url = new URL(req.url);
  const filterAccountId = url.searchParams.get("accountId");

  const allAccounts = await listTikTokAccounts();

  const result: Record<
    string,
    {
      username: string;
      currentPointer: number;
      currentPromptPointer: number;
      log: string[];
    }
  > = {};

  for (const acc of allAccounts) {
    if (filterAccountId && acc.id !== Number(filterAccountId)) continue;
    const logKey = `pointer-audit:${acc.id}`;
    const entries = (await redis.get<string[]>(logKey)) || [];
    const data = await getAccountData(acc.id);
    result[`${acc.id} (${acc.username})`] = {
      username: acc.username,
      currentPointer: data.config.pointer,
      currentPromptPointer: data.config.promptPointer,
      log: entries,
    };
  }

  return NextResponse.json(result);
}
