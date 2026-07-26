"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";

interface PostLogEntry {
  date: string;
  time: string;
  accountId: number;
  accountName: string;
  bookName: string;
  slideshowId: string;
  slideshowName: string;
  imagePromptId: string;
  imagePromptText: string;
  captionId: string;
  captionText: string;
  postBridgeId: string;
  postBridgeUrl: string;
  source: string;
  timestamp: string;
}

function toLocalTime(utcTime: string, date: string): string {
  try {
    const d = new Date(`${date}T${utcTime}:00Z`);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return utcTime;
  }
}

function getPassword() {
  return typeof window !== "undefined" ? localStorage.getItem("sg.password") || "" : "";
}

export default function PostLogPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<PostLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  function loadLog() {
    setLoading(true);
    fetch(`/api/admin/post-log?date=${date}&password=${getPassword()}`)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadLog();
  }, [date]);

  async function syncFromPostBridge() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await fetch("/api/admin/post-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, password: getPassword() }),
      });
      const d = await r.json();
      setEntries(d.entries || []);
      setSyncMsg(`Synced — ${d.added || 0} new posts pulled from PostBridge`);
    } catch {
      setSyncMsg("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  async function backfill() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await fetch(`/api/admin/post-log/backfill?password=${getPassword()}`, { method: "POST" });
      const d = await r.json();
      setSyncMsg(`Backfilled ${d.entriesAdded} posts from ${d.accountsWithData} accounts (${(d.datesFound || []).join(", ")})`);
      loadLog();
    } catch {
      setSyncMsg("Backfill failed");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = entries.filter((e) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      e.accountName.toLowerCase().includes(q) ||
      e.bookName.toLowerCase().includes(q) ||
      e.slideshowName.toLowerCase().includes(q) ||
      e.source.toLowerCase().includes(q)
    );
  });

  const dupeKeys = new Set<string>();
  const seen = new Map<string, number>();
  for (const e of filtered) {
    if (!e.slideshowName) continue;
    const key = `${e.accountId}:${e.slideshowName}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) dupeKeys.add(key);
  }

  const dupeCount = filtered.filter((e) => {
    if (!e.slideshowName) return false;
    const key = `${e.accountId}:${e.slideshowName}`;
    return dupeKeys.has(key);
  }).length;

  return (
    <main className="min-h-screen bg-stone-100 text-stone-900">
      <div className="max-w-7xl mx-auto px-6 sm:px-10 py-10">
        <AppHeader />
        <h1 className="text-2xl font-bold mb-6 mt-8">Post Log</h1>

        <div className="flex flex-wrap gap-4 mb-6 items-center">
          <div>
            <label className="text-sm font-medium text-stone-600 mr-2">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-stone-300 bg-white rounded px-3 py-1.5 text-sm text-stone-900"
            />
          </div>
          <div>
            <input
              type="text"
              placeholder="Filter by account, book, slideshow..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="border border-stone-300 bg-white rounded px-3 py-1.5 text-sm w-72 text-stone-900 placeholder-stone-400"
            />
          </div>
          <button
            onClick={syncFromPostBridge}
            disabled={syncing}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync from PostBridge"}
          </button>
          <button
            onClick={backfill}
            disabled={syncing}
            className="px-4 py-1.5 text-sm bg-stone-200 text-stone-900 rounded hover:bg-stone-300 disabled:opacity-50"
          >
            {syncing ? "..." : "Backfill History"}
          </button>
          <div className="text-sm text-stone-600">
            {filtered.length} posts
            {dupeCount > 0 && (
              <span className="ml-2 text-red-600 font-medium">
                ({dupeCount} potential duplicates)
              </span>
            )}
            {syncMsg && <span className="ml-2 text-green-600">{syncMsg}</span>}
          </div>
        </div>

        {loading ? (
          <p className="text-stone-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-stone-500">No posts logged for {date}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-white text-left">
                  <th className="px-3 py-2 border-b border-stone-200 font-medium">Time</th>
                  <th className="px-3 py-2 border-b border-stone-200 font-medium">Account</th>
                  <th className="px-3 py-2 border-b border-stone-200 font-medium">Book</th>
                  <th className="px-3 py-2 border-b border-stone-200 font-medium">Slideshow</th>
                  <th className="px-3 py-2 border-b border-stone-200 font-medium">Image Prompt</th>
                  <th className="px-3 py-2 border-b border-stone-200 font-medium">Caption</th>
                  <th className="px-3 py-2 border-b border-stone-200 font-medium">Source</th>
                  <th className="px-3 py-2 border-b border-stone-200 font-medium">PostBridge</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => {
                  const key = e.slideshowName ? `${e.accountId}:${e.slideshowName}` : "";
                  const isDupe = key ? dupeKeys.has(key) : false;
                  return (
                    <tr
                      key={i}
                      className={isDupe ? "bg-red-100" : i % 2 === 0 ? "bg-stone-100" : "bg-white/70"}
                    >
                      <td className="px-3 py-2 border-b border-stone-200 whitespace-nowrap">
                        {toLocalTime(e.time, e.date)}
                      </td>
                      <td className="px-3 py-2 border-b border-stone-200">{e.accountName}</td>
                      <td className="px-3 py-2 border-b border-stone-200">{e.bookName || "—"}</td>
                      <td className="px-3 py-2 border-b border-stone-200">
                        <span title={e.slideshowId}>{e.slideshowName || "—"}</span>
                      </td>
                      <td className="px-3 py-2 border-b border-stone-200 max-w-48 truncate" title={e.imagePromptText}>
                        <span title={`ID: ${e.imagePromptId}`}>
                          {e.imagePromptText || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-stone-200 max-w-48 truncate" title={e.captionText}>
                        <span title={`ID: ${e.captionId}`}>
                          {e.captionText || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-stone-200">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          e.source === "cron" ? "bg-blue-100 text-blue-600" :
                          e.source === "cron-topn" ? "bg-purple-100 text-purple-600" :
                          e.source === "cron-ig" ? "bg-pink-100 text-pink-600" :
                          e.source === "cron-fallback" ? "bg-orange-100 text-orange-600" :
                          "bg-stone-100 text-stone-700"
                        }`}>
                          {e.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-stone-200">
                        {e.postBridgeUrl ? (
                          <a
                            href={e.postBridgeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline"
                            title={e.postBridgeId}
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-stone-500" title={e.postBridgeId}>
                            {e.postBridgeId ? `${e.postBridgeId.slice(0, 8)}...` : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {dupeCount > 0 && (
          <div className="mt-4 p-3 bg-red-100 border border-red-300 rounded text-sm text-red-600">
            Rows highlighted in red indicate potential duplicates — same account and slideshow posted more than once on this date.
          </div>
        )}
      </div>
    </main>
  );
}
