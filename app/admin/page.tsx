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

interface AutomationData {
  ig: { accounts: Record<string, IgAccountConfig> };
  video: { accounts: Record<string, VideoAccountConfig> };
  topn: { accounts: Record<string, TopNAccountConfig> };
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

function AccountCard({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className="bg-stone-100/70 border border-stone-300/60 rounded-xl p-4 space-y-2">
      <div className="text-sm font-mono text-stone-600">Account {id}</div>
      {children}
    </div>
  );
}

export default function AdminPage() {
  const [data, setData] = useState<AutomationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/automations", {
      headers: { "x-password": localStorage.getItem("app-password") || "" },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="min-h-screen bg-stone-100 text-stone-900 flex items-center justify-center">Loading...</div>;
  if (error) return <div className="min-h-screen bg-stone-100 text-red-600 flex items-center justify-center">{error}</div>;
  if (!data) return null;

  const igAccounts = Object.entries(data.ig.accounts || {});
  const videoAccounts = Object.entries(data.video.accounts || {});
  const topnAccounts = Object.entries(data.topn.accounts || {});

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-8">Admin - All Automations</h1>

        {/* IG Carousel */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4 text-blue-600">IG/TikTok Carousel Automation</h2>
          {igAccounts.length === 0 ? (
            <p className="text-stone-500 text-sm">No accounts configured.</p>
          ) : (
            <div className="grid gap-3">
              {igAccounts.map(([id, cfg]) => (
                <AccountCard key={id} id={id}>
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
            <p className="text-stone-500 text-sm">No accounts configured.</p>
          ) : (
            <div className="grid gap-3">
              {videoAccounts.map(([id, cfg]) => (
                <AccountCard key={id} id={id}>
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
            <p className="text-stone-500 text-sm">No accounts configured.</p>
          ) : (
            <div className="grid gap-3">
              {topnAccounts.map(([id, cfg]) => (
                <AccountCard key={id} id={id}>
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
