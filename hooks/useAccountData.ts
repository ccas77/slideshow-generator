"use client";

import { useState, useEffect } from "react";
import type { AutomationConfig, SavedItem, AccountData } from "@/types";

const DEFAULT_CONFIG: AutomationConfig = {
  enabled: false,
  intervals: [{ start: "17:00", end: "19:00" }],
  selections: [],
};

const LS = {
  savedPrompts: (id: number) => `sg.savedPrompts.${id}`,
  savedTexts: (id: number) => `sg.savedTexts.${id}`,
  savedCaptions: (id: number) => `sg.savedCaptions.${id}`,
  draft: (id: number) => `sg.draft.${id}`,
  migrated: (id: number) => `sg.migrated.${id}`,
};

export function useAccountData(
  accountId: number | null,
  hydrated: boolean,
  authed: boolean,
  password: string
) {
  const [savedPrompts, setSavedPrompts] = useState<SavedItem[]>([]);
  const [savedTexts, setSavedTexts] = useState<SavedItem[]>([]);
  const [savedCaptions, setSavedCaptions] = useState<SavedItem[]>([]);
  const [config, setConfig] = useState<AutomationConfig>(DEFAULT_CONFIG);
  const [lastRun, setLastRun] = useState<string | undefined>();
  const [lastStatus, setLastStatus] = useState<string | undefined>();
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [expandedBooks, setExpandedBooks] = useState<string[]>([]);

  // Draft form state (kept here because it's persisted per-account)
  const [imagePrompt, setImagePrompt] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [caption, setCaption] = useState("");

  // Load per-account data from KV (with one-time localStorage migration)
  useEffect(() => {
    if (!hydrated || accountId == null || !authed) return;
    setLoadingAccount(true);
    (async () => {
      try {
        const res = await fetch(
          `/api/account-data?accountId=${accountId}&password=${encodeURIComponent(
            password
          )}`
        );
        if (!res.ok) throw new Error("Failed to load");
        const { data } = (await res.json()) as { data: AccountData };

        // Migrate legacy localStorage → KV once if KV is empty
        const alreadyMigrated = localStorage.getItem(LS.migrated(accountId));
        const kvEmpty =
          !data.prompts.length && !data.texts.length && !data.captions.length;
        if (!alreadyMigrated && kvEmpty) {
          try {
            const sp = localStorage.getItem(LS.savedPrompts(accountId));
            const st = localStorage.getItem(LS.savedTexts(accountId));
            const sc = localStorage.getItem(LS.savedCaptions(accountId));
            const migrated: AccountData = {
              config: data.config || DEFAULT_CONFIG,
              prompts: sp ? JSON.parse(sp) : [],
              texts: st ? JSON.parse(st) : [],
              captions: sc ? JSON.parse(sc) : [],
            };
            if (
              migrated.prompts.length ||
              migrated.texts.length ||
              migrated.captions.length
            ) {
              await fetch("/api/account-data", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  password,
                  accountId,
                  data: migrated,
                }),
              });
              data.prompts = migrated.prompts;
              data.texts = migrated.texts;
              data.captions = migrated.captions;
            }
          } catch {}
          localStorage.setItem(LS.migrated(accountId), "1");
        }

        setSavedPrompts(data.prompts || []);
        setSavedTexts(data.texts || []);
        setSavedCaptions(data.captions || []);
        setConfig(data.config || DEFAULT_CONFIG);
        setLastRun(data.lastRun);
        setLastStatus(data.lastStatus);
        // Initialize expanded books from existing selections
        const existingSels = data.config?.selections || [];
        setExpandedBooks([...new Set(existingSels.map((s: { bookId: string }) => s.bookId))]);

        // Draft stays in localStorage (per-device, per-account)
        const draft = localStorage.getItem(LS.draft(accountId));
        if (draft) {
          const d = JSON.parse(draft);
          setImagePrompt(d.imagePrompt || "");
          setBulkText(d.bulkText || "");
          setCaption(d.caption || "");
        } else {
          setImagePrompt("");
          setBulkText("");
          setCaption("");
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingAccount(false);
      }
    })();
  }, [accountId, hydrated, authed, password]);

  // Persist draft per account (local only)
  useEffect(() => {
    if (!hydrated || accountId == null) return;
    localStorage.setItem(
      LS.draft(accountId),
      JSON.stringify({ imagePrompt, bulkText, caption })
    );
  }, [imagePrompt, bulkText, caption, accountId, hydrated]);

  // Debounced KV save whenever saved items or config change
  useEffect(() => {
    if (!hydrated || accountId == null || loadingAccount) return;
    const t = setTimeout(() => {
      // Strip pointer/promptPointer — these are managed by the cron, not the UI.
      const { pointer: _p, promptPointer: _pp, ...configWithoutPointers } = config;
      fetch("/api/account-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          accountId,
          data: {
            config: configWithoutPointers,
            prompts: savedPrompts,
            texts: savedTexts,
            captions: savedCaptions,
            lastRun,
            lastStatus,
          },
        }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [
    savedPrompts,
    savedTexts,
    savedCaptions,
    config,
    accountId,
    hydrated,
    loadingAccount,
    password,
    lastRun,
    lastStatus,
  ]);

  return {
    config,
    setConfig,
    savedPrompts,
    setSavedPrompts,
    savedTexts,
    setSavedTexts,
    savedCaptions,
    setSavedCaptions,
    lastRun,
    lastStatus,
    loadingAccount,
    expandedBooks,
    setExpandedBooks,
    imagePrompt,
    setImagePrompt,
    bulkText,
    setBulkText,
    caption,
    setCaption,
  };
}
