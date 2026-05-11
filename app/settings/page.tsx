"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";

export default function SettingsPage() {
  const router = useRouter();
  const [password, setPassword] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [censorLeetspeak, setCensorLeetspeak] = useState("");
  const [censorEmoji, setCensorEmoji] = useState("");
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
      const res = await fetch(`/api/settings?password=${encodeURIComponent(password)}`);
      if (res.ok) {
        const data = await res.json();
        setCensorLeetspeak(data.censorshipLeetspeak || "");
        setCensorEmoji(data.censorshipEmoji || "");
      }
    } catch {}
    setLoading(false);
  }, [password]);

  useEffect(() => { if (password) load(); }, [password, load]);

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          censorshipLeetspeak: censorLeetspeak,
          censorshipEmoji: censorEmoji,
        }),
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

        <h1 className="text-2xl font-bold mb-6 mt-8">Settings</h1>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
          <h2 className="text-lg font-medium mb-1">Censorship Substitutions</h2>
          <p className="text-sm text-zinc-500 mb-4">
            Edit the leetspeak and emoji substitutions used in Create Slides. Leave blank to use defaults.
          </p>

          <label className="block text-sm font-medium text-zinc-300 mb-1">Leetspeak</label>
          <textarea
            value={censorLeetspeak}
            onChange={(e) => { setCensorLeetspeak(e.target.value); setSaved(false); }}
            placeholder="c0p, ja!l, pr!son, d£ath, k!$, ..."
            rows={4}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none mb-4"
          />

          <label className="block text-sm font-medium text-zinc-300 mb-1">Emoji</label>
          <textarea
            value={censorEmoji}
            onChange={(e) => { setCensorEmoji(e.target.value); setSaved(false); }}
            placeholder="😻 = pussy, 🐓 = cock, ..."
            rows={3}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder-zinc-600 focus:border-blue-500 focus:outline-none mb-4"
          />

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-white text-black px-5 py-2 text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {saved && <span className="text-sm text-green-400">Saved</span>}
            {loading && <span className="text-sm text-zinc-500">Loading...</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
