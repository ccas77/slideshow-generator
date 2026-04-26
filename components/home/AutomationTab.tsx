"use client";

import type { TikTokAccount, AutomationConfig, Book } from "@/types";
import { utcToLocal, localToUtc } from "@/lib/slide-utils";

interface AutomationTabProps {
  accounts: TikTokAccount[];
  accountId: number | null;
  setAccountId: (id: number | null) => void;
  loadingAccount: boolean;
  config: AutomationConfig;
  setConfig: (c: AutomationConfig) => void;
  lastRun?: string;
  lastStatus?: string;
  books: Book[];
  expandedBooks: string[];
  setExpandedBooks: React.Dispatch<React.SetStateAction<string[]>>;
}

export default function AutomationTab({
  accounts,
  accountId,
  setAccountId,
  loadingAccount,
  config,
  setConfig,
  lastRun,
  lastStatus,
  books,
  expandedBooks,
  setExpandedBooks,
}: AutomationTabProps) {
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8">
        <h2 className="text-lg font-semibold mb-1">Automation</h2>
        <p className="text-sm text-zinc-500 mb-6">
          Set up scheduled daily posting for your TikTok accounts.
        </p>

        {accounts.length === 0 ? (
          <p className="text-sm text-zinc-500">Loading accounts…</p>
        ) : (
          <>
            <label className="block text-sm font-medium text-zinc-400 mb-2">
              Account
            </label>
            <select
              value={accountId ?? ""}
              onChange={(e) =>
                setAccountId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-white/20 mb-6"
            >
              <option value="">Select an account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.username}
                </option>
              ))}
            </select>

            {accountId != null && !loadingAccount && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm font-medium text-white">
                      Automate daily posts
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      Picks a random slideshow from your selected books and
                      generates a fresh image each time.
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setConfig({ ...config, enabled: !config.enabled })
                    }
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      config.enabled ? "bg-green-500" : "bg-zinc-700"
                    }`}
                    aria-label="Toggle automation"
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                        config.enabled ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>

                {config.enabled && (
                  <>
                    <div className="mb-1">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-zinc-500">
                          Posting intervals (1 post per interval)
                        </label>
                        <button
                          onClick={() => {
                            const intervals = [
                              ...config.intervals,
                              { start: "18:00", end: "20:00" },
                            ];
                            setConfig({ ...config, intervals });
                          }}
                          className="text-xs text-zinc-400 hover:text-white transition-colors"
                        >
                          + Add interval
                        </button>
                      </div>
                      {config.intervals.map((win, idx) => (
                        <div
                          key={idx}
                          className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2 items-end"
                        >
                          <div>
                            <label className="block text-xs text-zinc-500 mb-1">
                              From
                            </label>
                            <input
                              type="time"
                              value={utcToLocal(win.start)}
                              onChange={(e) => {
                                const intervals = [...config.intervals];
                                intervals[idx] = {
                                  ...intervals[idx],
                                  start: localToUtc(e.target.value),
                                };
                                setConfig({ ...config, intervals });
                              }}
                              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-500 mb-1">
                              To
                            </label>
                            <input
                              type="time"
                              value={utcToLocal(win.end)}
                              onChange={(e) => {
                                const intervals = [...config.intervals];
                                intervals[idx] = {
                                  ...intervals[idx],
                                  end: localToUtc(e.target.value),
                                };
                                setConfig({ ...config, intervals });
                              }}
                              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                          </div>
                          <button
                            onClick={() => {
                              const intervals = [...config.intervals];
                              if (intervals.length <= 1) return;
                              intervals.splice(idx, 1);
                              setConfig({ ...config, intervals });
                            }}
                            className="pb-2 text-zinc-600 hover:text-red-400 transition-colors text-sm"
                            title="Remove interval"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <p className="text-xs text-zinc-600 mt-1">
                        Each interval schedules 1 post at a random time within it.
                      </p>
                    </div>
                    {lastRun && (
                      <p className="text-xs text-zinc-600 mt-2">
                        Last run: {new Date(lastRun).toLocaleString()} —{" "}
                        {lastStatus}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {accountId != null && config.enabled && (
              <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
                <div className="text-sm font-medium text-white mb-3">
                  Source book & slideshows
                </div>
                {books.length === 0 ? (
                  <p className="text-xs text-zinc-500">
                    No books yet. Create one on the{" "}
                    <a href="/books" className="underline hover:text-white">
                      Books
                    </a>{" "}
                    page first.
                  </p>
                ) : (() => {
                  const sels = config.selections;
                  const selectedBooks = books.filter((b) =>
                    expandedBooks.includes(b.id)
                  );
                  return (
                    <>
                      <label className="text-xs text-zinc-500 mb-1 block">
                        Books
                      </label>
                      <div className="space-y-1 max-h-40 overflow-y-auto mb-4">
                        {books.map((b) => {
                          const bookSelected = expandedBooks.includes(b.id);
                          return (
                            <label
                              key={b.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-900 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={bookSelected}
                                onChange={() => {
                                  if (bookSelected) {
                                    setConfig({
                                      ...config,
                                      selections: sels.filter(
                                        (s) => s.bookId !== b.id
                                      ),
                                    });
                                    setExpandedBooks((prev) =>
                                      prev.filter((id) => id !== b.id)
                                    );
                                  } else {
                                    setExpandedBooks((prev) => [...prev, b.id]);
                                  }
                                }}
                                className="accent-white"
                              />
                              <span className="text-sm text-zinc-300">
                                {b.name}
                              </span>
                              <span className="text-xs text-zinc-600 ml-auto">
                                {b.slideshows.length} slideshows
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      {selectedBooks.length > 0 && (
                        <>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs text-zinc-500">
                              Slideshows
                            </label>
                            <div className="flex gap-3 text-xs">
                              <button
                                onClick={() => {
                                  const all: Array<{
                                    bookId: string;
                                    slideshowId: string;
                                  }> = [];
                                  selectedBooks.forEach((b) =>
                                    b.slideshows.forEach((s) =>
                                      all.push({
                                        bookId: b.id,
                                        slideshowId: s.id,
                                      })
                                    )
                                  );
                                  setConfig({
                                    ...config,
                                    selections: all,
                                  });
                                }}
                                className="text-zinc-500 hover:text-white transition-colors"
                              >
                                All
                              </button>
                              <button
                                onClick={() => {
                                  setConfig({
                                    ...config,
                                    selections: [],
                                  });
                                }}
                                className="text-zinc-500 hover:text-white transition-colors"
                              >
                                None
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {selectedBooks.map((b) => (
                              <div key={b.id}>
                                <div className="text-xs font-medium text-zinc-400 px-2 pt-2 pb-1">
                                  {b.name}
                                </div>
                                {b.slideshows.map((s) => {
                                  const checked = sels.some(
                                    (sel) =>
                                      sel.bookId === b.id &&
                                      sel.slideshowId === s.id
                                  );
                                  return (
                                    <label
                                      key={s.id}
                                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-900 cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => {
                                          setConfig({
                                            ...config,
                                            selections: checked
                                              ? sels.filter(
                                                  (sel) =>
                                                    !(
                                                      sel.bookId === b.id &&
                                                      sel.slideshowId ===
                                                        s.id
                                                    )
                                                )
                                              : [
                                                  ...sels,
                                                  {
                                                    bookId: b.id,
                                                    slideshowId: s.id,
                                                  },
                                                ],
                                          });
                                        }}
                                        className="accent-white"
                                      />
                                      <span className="text-sm text-zinc-300">
                                        {s.name}
                                      </span>
                                      <span className="text-xs text-zinc-600 ml-auto">
                                        {
                                          s.slideTexts
                                            .split("\n")
                                            .filter((t) => t.trim()).length
                                        }{" "}
                                        slides
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                      <p className="text-xs text-zinc-600 mt-2">
                        Pick books first, then choose which slideshows to
                        include. Cron picks randomly across all selected.
                      </p>
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
