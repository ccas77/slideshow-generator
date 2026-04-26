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

  // Fetch accounts once authed
  useEffect(() => {
    if (!authed) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/post-tiktok?password=${encodeURIComponent(password)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        setAccounts(data.accounts || []);
      } catch {}
    })();
  }, [authed, password]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) || null,
    [accounts, accountId]
  );

  return { accounts, accountId, setAccountId, selectedAccount };
}
