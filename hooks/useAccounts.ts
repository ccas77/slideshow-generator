"use client";

import { useState, useEffect, useMemo } from "react";
import type { TikTokAccount } from "@/types";

const LS_ACCOUNT_ID = "sg.accountId";

export function useAccounts(authed: boolean, password: string) {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);

  // Hydrate accountId from localStorage
  useEffect(() => {
    try {
      const aid = localStorage.getItem(LS_ACCOUNT_ID);
      if (aid) setAccountId(Number(aid));
    } catch {}
  }, []);

  // Persist accountId
  useEffect(() => {
    if (accountId != null) {
      localStorage.setItem(LS_ACCOUNT_ID, String(accountId));
    }
  }, [accountId]);

  // Fetch accounts from all platforms once authed
  useEffect(() => {
    if (!authed) return;
    (async () => {
      try {
        const [tkRes, igRes, fbRes] = await Promise.all([
          fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=tiktok`),
          fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=instagram`),
          fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=facebook`),
        ]);
        const tk = tkRes.ok ? ((await tkRes.json()).accounts || []).map((a: TikTokAccount) => ({ ...a, platform: "tiktok" as const })) : [];
        const ig = igRes.ok ? ((await igRes.json()).accounts || []).map((a: TikTokAccount) => ({ ...a, platform: "instagram" as const })) : [];
        const fb = fbRes.ok ? ((await fbRes.json()).accounts || []).map((a: TikTokAccount) => ({ ...a, platform: "facebook" as const })) : [];
        const all = [...tk, ...ig, ...fb];
        all.sort((a, b) => a.username.localeCompare(b.username));
        setAccounts(all);
      } catch {}
    })();
  }, [authed, password]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) || null,
    [accounts, accountId]
  );

  return { accounts, accountId, setAccountId, selectedAccount };
}
