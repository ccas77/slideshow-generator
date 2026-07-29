"use client";

import { useEffect, useState } from "react";

interface TimeWindow { start: string; end: string }

interface IgAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  bookIds: string[];
  slideshowIds: string[];
  pointer: number;
}

interface VideoAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  bookIds: string[];
  slideshowIds: string[];
  pointer: number;
  musicTrackIds: string[];
  durationPerSlide: number;
}

interface TopNAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  listIds: string[];
  pointer: number;
  frequencyDays: number;
  lastPostDate?: string;
  platform: string;
  backgroundPrompts?: string[];
}

interface TikTokAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  selections: Array<{ bookId: string; slideshowId: string }>;
  pointer: number;
}

interface ExcerptAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  excerptIds: string[];
  pointer: number;
  platform: string;
}

interface AutomationData {
  ig: { accounts: Record<string, IgAccountConfig> };
  video: { accounts: Record<string, VideoAccountConfig> };
  topn: { accounts: Record<string, TopNAccountConfig> };
  excerpt: { accounts: Record<string, ExcerptAccountConfig> };
  tiktok: { accounts: Record<string, TikTokAccountConfig> };
  usernames: Record<string, string>;
  platforms: Record<string, string>;
}

function WindowList({ windows }: { windows: TimeWindow[] }) {
  if (windows.length === 0) return <span className="text-stone-500">none</span>;
  return (
    <span className="text-stone-700">
      {windows.map((w, i) => (
        <span key={i}>{w.start}-{w.end}{i < windows.length - 1 ? ", " : ""}</span>
      ))}
    </span>
  );
}

function Badge({ on }: { on: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${on ? "bg-green-500/20 text-green-600" : "bg-stone-200 text-stone-600"}`}>
      {on ? "ON" : "OFF"}
    </span>
  );
}

function AccountCard({
  id,
  username,
  platform,
  children,
}: {
  id: string;
  username?: string;
  platform?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-stone-100/70 border border-stone-300/60 rounded-xl p-4 space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-stone-900">
          {username ? `@${username}` : `Account ${id}`}
        </span>
        {platform && (
          <span className="text-[10px] uppercase tracking-wide text-stone-500">{platform}</span>
        )}
        <span className="text-xs font-mono text-stone-400">{id}</span>
      </div>
      {children}
    </div>
  );
}

export default function AdminPage() {
  const [data, setData] = useState<AutomationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    // Login stores the password under "sg.password" (see hooks/useAuth.ts) and
    // every other page reads that key. This page read "app-password", which is
    // never written, so it always sent an empty password and rendered a bare
    // "Unauthorized" — making the one screen that lists every automation for
    // every account unusable.
    const password =
      localStorage.getItem("sg.password") || localStorage.getItem("app-password") || "";
    fetch("/api/admin/automations", {
      headers: { "x-password": password },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(
            password
              ? d.error
              : "Not signed in. Open the main app, log in, then reload this page.",
          );
        } else setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="min-h-screen bg-stone-100 text-stone-900 flex items-center justify-center">Loading...</div>;
  if (error) return <div className="min-h-screen bg-stone-100 text-red-600 flex items-center justify-center">{error}</div>;
  if (!data) return null;

  const usernames = data.usernames || {};
  const platforms = data.platforms || {};
  const q = filter.trim().toLowerCase().replace(/^@/, "");
  // Match on handle or numeric id, so pasting either finds every automation
  // an account appears in.
  const keep = <T,>(entries: Array<[string, T]>) =>
    q === ""
      ? entries
      : entries.filter(
          ([id]) => id.includes(q) || (usernames[id] || "").toLowerCase().includes(q),
        );

  const igAccounts = keep(Object.entries(data.ig.accounts || {}));
  const videoAccounts = keep(Object.entries(data.video.accounts || {}));
  const topnAccounts = keep(Object.entries(data.topn.accounts || {}));
  const tiktokAccounts = keep(Object.entries(data.tiktok?.accounts || {}));
  const excerptAccounts = keep(Object.entries(data.excerpt?.accounts || {}));
  const totalShown =
    igAccounts.length +
    videoAccounts.length +
    topnAccounts.length +
    tiktokAccounts.length +
    excerptAccounts.length;

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-2">Admin - All Automations</h1>
        <p className="text-sm text-stone-600 mb-4">
          Every automation an account appears in. Search a handle to check you have not missed one
          — e.g. before switching off a banned account.
        </p>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by handle or account id…"
          className="w-full mb-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/15"
        />
        <p className="text-xs text-stone-500 mb-8">
          {q === ""
            ? `${totalShown} automation${totalShown === 1 ? "" : "s"} configured across all accounts.`
            : `${totalShown} automation${totalShown === 1 ? "" : "s"} matching “${filter.trim()}”.`}
        </p>

        {/* TikTok daily posts (home page automation) */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-stone-900">TikTok Daily Posts</h2>
          {tiktokAccounts.length === 0 ? (
            <p className="text-stone-500 text-sm">{q === "" ? "No accounts configured." : "No match in this automation."}</p>
          ) : (
            <div className="grid gap-3">
              {tiktokAccounts.map(([id, cfg]) => (
                <AccountCard key={id} id={id} username={usernames[id]} platform={platforms[id]}>
                  <div className="flex items-center gap-3">
                    <Badge on={cfg.enabled} />
                    <span className="text-sm text-stone-700">Pointer: {cfg.pointer}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Windows: </span>
                    <WindowList windows={cfg.intervals} />
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Slideshows: </span>
                    <span className="text-stone-700">
                      {cfg.selections.length === 0 ? "none" : `${cfg.selections.length} selected`}
                    </span>
                  </div>
                </AccountCard>
              ))}
            </div>
          )}
        </section>

        {/* Excerpts */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-green-600">Excerpt Automation</h2>
          {excerptAccounts.length === 0 ? (
            <p className="text-stone-500 text-sm">{q === "" ? "No accounts configured." : "No match in this automation."}</p>
          ) : (
            <div className="grid gap-3">
              {excerptAccounts.map(([id, cfg]) => (
                <AccountCard key={id} id={id} username={usernames[id]} platform={platforms[id]}>
                  <div className="flex items-center gap-3">
                    <Badge on={cfg.enabled} />
                    <span className="text-sm text-stone-700">Pointer: {cfg.pointer}</span>
                    <span className="text-sm text-stone-700">Platform: {cfg.platform}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Windows: </span>
                    <WindowList windows={cfg.intervals} />
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Excerpts: </span>
                    <span className="text-stone-700">
                      {cfg.excerptIds.length === 0 ? "all" : `${cfg.excerptIds.length} selected`}
                    </span>
                  </div>
                </AccountCard>
              ))}
            </div>
          )}
        </section>

        {/* IG Carousel */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-blue-600">IG/TikTok Carousel Automation</h2>
          {igAccounts.length === 0 ? (
            <p className="text-stone-500 text-sm">{q === "" ? "No accounts configured." : "No match in this automation."}</p>
          ) : (
            <div className="grid gap-3">
              {igAccounts.map(([id, cfg]) => (
                <AccountCard key={id} id={id} username={usernames[id]} platform={platforms[id]}>
                  <div className="flex items-center gap-3">
                    <Badge on={cfg.enabled} />
                    <span className="text-sm text-stone-700">Pointer: {cfg.pointer}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Windows: </span>
                    <WindowList windows={cfg.intervals} />
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Books: </span>
                    <span className="text-stone-700">{cfg.bookIds.length === 0 ? "all" : cfg.bookIds.join(", ")}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Slideshows: </span>
                    <span className="text-stone-700">{cfg.slideshowIds.length === 0 ? "all" : `${cfg.slideshowIds.length} selected`}</span>
                  </div>
                </AccountCard>
              ))}
            </div>
          )}
        </section>

        {/* Video */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-purple-600">Video Automation</h2>
          {videoAccounts.length === 0 ? (
            <p className="text-stone-500 text-sm">{q === "" ? "No accounts configured." : "No match in this automation."}</p>
          ) : (
            <div className="grid gap-3">
              {videoAccounts.map(([id, cfg]) => (
                <AccountCard key={id} id={id} username={usernames[id]} platform={platforms[id]}>
                  <div className="flex items-center gap-3">
                    <Badge on={cfg.enabled} />
                    <span className="text-sm text-stone-700">Pointer: {cfg.pointer}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Windows: </span>
                    <WindowList windows={cfg.intervals} />
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Books: </span>
                    <span className="text-stone-700">{cfg.bookIds.length === 0 ? "all" : cfg.bookIds.join(", ")}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Music tracks: </span>
                    <span className="text-stone-700">{cfg.musicTrackIds.length === 0 ? "none" : `${cfg.musicTrackIds.length} tracks`}</span>
                  </div>
                </AccountCard>
              ))}
            </div>
          )}
        </section>

        {/* Top N */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-amber-600">Top N Automation</h2>
          {topnAccounts.length === 0 ? (
            <p className="text-stone-500 text-sm">{q === "" ? "No accounts configured." : "No match in this automation."}</p>
          ) : (
            <div className="grid gap-3">
              {topnAccounts.map(([id, cfg]) => (
                <AccountCard key={id} id={id} username={usernames[id]} platform={platforms[id]}>
                  <div className="flex items-center gap-3">
                    <Badge on={cfg.enabled} />
                    <span className="text-sm text-stone-700">Pointer: {cfg.pointer}</span>
                    <span className="text-sm text-stone-700">Platform: {cfg.platform}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Windows: </span>
                    <WindowList windows={cfg.intervals} />
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Frequency: </span>
                    <span className="text-stone-700">every {cfg.frequencyDays} day(s)</span>
                    {cfg.lastPostDate && (
                      <span className="text-stone-500 ml-2">last: {cfg.lastPostDate}</span>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="text-stone-500">Lists: </span>
                    <span className="text-stone-700">{cfg.listIds.length === 0 ? "all" : `${cfg.listIds.length} selected`}</span>
                  </div>
                  {cfg.backgroundPrompts && cfg.backgroundPrompts.length > 0 && (
                    <div className="text-sm">
                      <span className="text-stone-500">BG prompts: </span>
                      <span className="text-stone-700">{cfg.backgroundPrompts.length}</span>
                    </div>
                  )}
                </AccountCard>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
