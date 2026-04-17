import { NextRequest, NextResponse } from "next/server";
import { getAccountData, setAccountData, AccountData } from "@/lib/kv";

function checkAuth(password: string | undefined) {
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword && password !== appPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const password = url.searchParams.get("password") || undefined;
  const accountId = Number(url.searchParams.get("accountId"));
  const authError = checkAuth(password);
  if (authError) return authError;
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }
  const data = await getAccountData(accountId);
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const authError = checkAuth(body.password);
  if (authError) return authError;
  const { accountId, data } = body as {
    accountId: number;
    data: AccountData;
  };
  if (!accountId || !data) {
    return NextResponse.json(
      { error: "accountId and data required" },
      { status: 400 }
    );
  }
  await setAccountData(accountId, data);
  return NextResponse.json({ ok: true });
}
