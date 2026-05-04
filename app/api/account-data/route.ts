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
  // The UI strips pointer/promptPointer from config saves.
  // To avoid a race condition where the UI overwrites cron-managed fields
  // (pointer, promptPointer, lastRun, lastStatus), we read the existing data
  // and only overlay the UI-managed fields onto it.
  const existing = await getAccountData(accountId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const incomingConfig = data.config as any;
  const isUiSave = incomingConfig && !("pointer" in incomingConfig);

  if (isUiSave) {
    // UI save: overlay UI fields onto existing, preserve cron fields
    const merged: AccountData = {
      config: {
        ...existing.config,           // keeps pointer, promptPointer
        ...incomingConfig,             // overwrites enabled, intervals, selections, etc.
        pointer: existing.config.pointer,
        promptPointer: existing.config.promptPointer,
      },
      prompts: data.prompts,
      texts: data.texts,
      captions: data.captions,
      // Always keep cron-managed fields from existing
      lastRun: existing.lastRun,
      lastStatus: existing.lastStatus,
    };
    await setAccountData(accountId, merged);
  } else {
    // Cron save or full save (includes pointer) — write as-is
    await setAccountData(accountId, data);
  }
  return NextResponse.json({ ok: true });
}
