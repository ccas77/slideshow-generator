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
    fetch(`/api/post-log?date=${date}&password=${getPassword()}`)
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
      const r = await fetch("/api/post-log", {
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
      const r = await fetch(`/api/post-log/backfill?password=${getPassword()}`, { method: "POST" });
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
    <main className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-7xl mx-auto px-6 sm:px-10 py-10">
        <AppHeader />
        <h1 className="text-2xl font-bold mb-6 mt-8">Post Log</h1>

        <div className="flex flex-wrap gap-4 mb-6 items-center">
          <div>
            <label className="text-sm font-medium text-zinc-400 mr-2">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-zinc-700 bg-zinc-900 rounded px-3 py-1.5 text-sm text-white"
            />
          </div>
          <div>
            <input
              type="text"
              placeholder="Filter by account, book, slideshow..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="border border-zinc-700 bg-zinc-900 rounded px-3 py-1.5 text-sm w-72 text-white placeholder-zinc-500"
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
            className="px-4 py-1.5 text-sm bg-zinc-700 text-white rounded hover:bg-zinc-600 disabled:opacity-50"
          >
            {syncing ? "..." : "Backfill History"}
          </button>
          <div className="text-sm text-zinc-400">
            {filtered.length} posts
            {dupeCount > 0 && (
              <span className="ml-2 text-red-400 font-medium">
                ({dupeCount} potential duplicates)
              </span>
            )}
            {syncMsg && <span className="ml-2 text-green-400">{syncMsg}</span>}
          </div>
        </div>

        {loading ? (
          <p className="text-zinc-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-zinc-500">No posts logged for {date}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-zinc-900 text-left">
                  <th className="px-3 py-2 border-b border-zinc-800 font-medium">Time</th>
                  <th className="px-3 py-2 border-b border-zinc-800 font-medium">Account</th>
                  <th className="px-3 py-2 border-b border-zinc-800 font-medium">Book</th>
                  <th className="px-3 py-2 border-b border-zinc-800 font-medium">Slideshow</th>
                  <th className="px-3 py-2 border-b border-zinc-800 font-medium">Image Prompt</th>
                  <th className="px-3 py-2 border-b border-zinc-800 font-medium">Caption</th>
                  <th className="px-3 py-2 border-b border-zinc-800 font-medium">Source</th>
                  <th className="px-3 py-2 border-b border-zinc-800 font-medium">PostBridge</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => {
                  const key = e.slideshowName ? `${e.accountId}:${e.slideshowName}` : "";
                  const isDupe = key ? dupeKeys.has(key) : false;
                  return (
                    <tr
                      key={i}
                      className={isDupe ? "bg-red-950" : i % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/50"}
                    >
                      <td className="px-3 py-2 border-b border-zinc-800 whitespace-nowrap">
                        {toLocalTime(e.time, e.date)}
                      </td>
                      <td className="px-3 py-2 border-b border-zinc-800">{e.accountName}</td>
                      <td className="px-3 py-2 border-b border-zinc-800">{e.bookName || "—"}</td>
                      <td className="px-3 py-2 border-b border-zinc-800">
                        <span title={e.slideshowId}>{e.slideshowName || "—"}</span>
                      </td>
                      <td className="px-3 py-2 border-b border-zinc-800 max-w-48 truncate" title={e.imagePromptText}>
                        <span title={`ID: ${e.imagePromptId}`}>
                          {e.imagePromptText || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-zinc-800 max-w-48 truncate" title={e.captionText}>
                        <span title={`ID: ${e.captionId}`}>
                          {e.captionText || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-zinc-800">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          e.source === "cron" ? "bg-blue-900 text-blue-300" :
                          e.source === "cron-topn" ? "bg-purple-900 text-purple-300" :
                          e.source === "cron-ig" ? "bg-pink-900 text-pink-300" :
                          e.source === "cron-fallback" ? "bg-orange-900 text-orange-300" :
                          "bg-zinc-800 text-zinc-300"
                        }`}>
                          {e.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-zinc-800">
                        {e.postBridgeUrl ? (
                          <a
                            href={e.postBridgeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-400 underline"
                            title={e.postBridgeId}
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-zinc-500" title={e.postBridgeId}>
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
          <div className="mt-4 p-3 bg-red-950 border border-red-800 rounded text-sm text-red-300">
            Rows highlighted in red indicate potential duplicates — same account and slideshow posted more than once on this date.
          </div>
        )}
      </div>
    </main>
  );
}
