"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface TikTokAccount {
  id: number;
  username: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [password, setPassword] = useState<string | null>(null);
  const [allAccounts, setAllAccounts] = useState<TikTokAccount[]>([]);
  const [allowedIds, setAllowedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const pw = localStorage.getItem("sg.password");
    if (!pw) { router.push("/"); return; }
    setPassword(pw);
  }, [router]);

  const headers = useCallback(() => {
    return { "Content-Type": "application/json", "x-password": password || "" };
  }, [password]);

  const load = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    try {
      // Fetch ALL accounts from PostBridge (bypass the filter)
      const [accRes, settingsRes] = await Promise.all([
        fetch(`/api/settings/all-accounts?password=${encodeURIComponent(password)}`),
        fetch(`/api/settings?password=${encodeURIComponent(password)}`),
      ]);
      if (accRes.ok) setAllAccounts((await accRes.json()).accounts || []);
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setAllowedIds(data.allowedAccountIds || []);
      }
    } catch {}
    setLoading(false);
  }, [password]);

  useEffect(() => { if (password) load(); }, [password, load]);

  function toggleAccount(id: number) {
    setAllowedIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
    setSaved(false);
  }

  function selectAll() {
    setAllowedIds([]);
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ allowedAccountIds: allowedIds }),
      });
      setSaved(true);
    } catch {}
    setSaving(false);
  }

  if (!password) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white">
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Settings</strong> — choose which TikTok accounts are available across the app.</p>
          <p>Check the accounts you want to use for posting and automation. Unchecked accounts won&apos;t appear in account pickers on other pages.</p>
        </HowItWorks>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Settings</h1>
          <button onClick={load} className="text-sm text-zinc-500 hover:text-white transition-colors">
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-medium">Visible Accounts</h2>
              <p className="text-sm text-zinc-500 mt-1">
                Choose which TikTok accounts appear in this instance. Leave none selected to show all.
              </p>
            </div>
            <button
              onClick={selectAll}
              className="text-xs text-zinc-400 hover:text-white transition-colors"
            >
              Show All
            </button>
          </div>

          {allAccounts.length === 0 ? (
            <p className="text-sm text-zinc-500">{loading ? "Loading accounts..." : "No accounts found"}</p>
          ) : (
            <div className="space-y-2">
              {allAccounts.map((a) => {
                const explicit = allowedIds.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                      explicit
                        ? "border-blue-500/50 bg-blue-500/10"
                        : allowedIds.length === 0
                        ? "border-zinc-700 bg-zinc-800/50"
                        : "border-zinc-800 bg-zinc-900/30 opacity-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={explicit}
                      onChange={() => toggleAccount(a.id)}
                      className="rounded"
                    />
                    <span className="text-sm">@{a.username}</span>
                    <span className="text-[10px] text-zinc-600 ml-auto">ID: {a.id}</span>
                  </label>
                );
              })}
            </div>
          )}

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-white text-black px-5 py-2 text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {saved && <span className="text-sm text-green-400">Saved</span>}
            {allowedIds.length > 0 && (
              <span className="text-xs text-zinc-500">
                {allowedIds.length} account{allowedIds.length !== 1 ? "s" : ""} selected
              </span>
            )}
            {allowedIds.length === 0 && (
              <span className="text-xs text-zinc-500">All accounts visible</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
