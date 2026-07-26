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
      <div className="rounded-2xl border border-stone-200 bg-white/70 p-8">
        <h2 className="text-lg font-semibold mb-1">Automation</h2>
        <p className="text-sm text-stone-500 mb-6">
          Set up scheduled daily posting for your TikTok accounts.
        </p>

        {accounts.length === 0 ? (
          <p className="text-sm text-stone-500">Loading accounts…</p>
        ) : (
          <>
            <label className="block text-sm font-medium text-stone-600 mb-2">
              Account
            </label>
            <select
              value={accountId ?? ""}
              onChange={(e) =>
                setAccountId(e.target.value ? Number(e.target.value) : null)
              }
              className="w-full rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/15 mb-6"
            >
              <option value="">Select an account…</option>
              {(["tiktok", "instagram", "facebook"] as const).map((plat) => {
                const platAccounts = accounts.filter((a) => (a.platform || "tiktok") === plat);
                if (platAccounts.length === 0) return null;
                const label = plat === "tiktok" ? "TikTok" : plat === "instagram" ? "Instagram" : "Facebook";
                return (
                  <optgroup key={plat} label={label}>
                    {platAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        @{a.username}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>

            {accountId != null && !loadingAccount && (
              <div className="rounded-xl border border-stone-200 bg-stone-100 p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm font-medium text-stone-900">
                      Automate daily posts
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      Picks a random slideshow from your selected books and
                      generates a fresh image each time.
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      setConfig({ ...config, enabled: !config.enabled })
                    }
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      config.enabled ? "bg-green-500" : "bg-stone-200"
                    }`}
                    aria-label="Toggle automation"
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-stone-900 rounded-full transition-transform ${
                        config.enabled ? "translate-x-5" : ""
                      }`}
                    />
                  </button>
                </div>

                {config.enabled && (
                  <>
                    <div className="mb-1">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-stone-500">
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
                          className="text-xs text-stone-600 hover:text-stone-900 transition-colors"
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
                            <label className="block text-xs text-stone-500 mb-1">
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
                              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-stone-500 mb-1">
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
                              className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                            />
                          </div>
                          <button
                            onClick={() => {
                              const intervals = [...config.intervals];
                              if (intervals.length <= 1) return;
                              intervals.splice(idx, 1);
                              setConfig({ ...config, intervals });
                            }}
                            className="pb-2 text-stone-400 hover:text-red-600 transition-colors text-sm"
                            title="Remove interval"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <p className="text-xs text-stone-400 mt-1">
                        Each interval schedules 1 post at a random time within it.
                      </p>
                    </div>
                    {lastRun && (
                      <p className="text-xs text-stone-400 mt-2">
                        Last run: {new Date(lastRun).toLocaleString()} —{" "}
                        {lastStatus}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {accountId != null && config.enabled && (
              <div className="mt-6 rounded-xl border border-stone-200 bg-stone-100 p-5">
                <div className="text-sm font-medium text-stone-900 mb-3">
                  Source book & slideshows
                </div>
                {books.length === 0 ? (
                  <p className="text-xs text-stone-500">
                    No books yet. Create one on the{" "}
                    <a href="/books" className="underline hover:text-stone-900">
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
                      <label className="text-xs text-stone-500 mb-1 block">
                        Books
                      </label>
                      <div className="space-y-1 max-h-40 overflow-y-auto mb-4">
                        {books.map((b) => {
                          const bookSelected = expandedBooks.includes(b.id);
                          return (
                            <label
                              key={b.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-stone-50 cursor-pointer"
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
                                    // Auto-select all slideshows under this book
                                    const newSels = b.slideshows.map((s) => ({
                                      bookId: b.id,
                                      slideshowId: s.id,
                                    }));
                                    setConfig({
                                      ...config,
                                      selections: [
                                        ...sels.filter((s) => s.bookId !== b.id),
                                        ...newSels,
                                      ],
                                    });
                                    setExpandedBooks((prev) => [...prev, b.id]);
                                  }
                                }}
                                className="accent-stone-900"
                              />
                              <span className="text-sm text-stone-700">
                                {b.name}
                              </span>
                              <span className="text-xs text-stone-400 ml-auto">
                                {b.slideshows.length} slideshows
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      {selectedBooks.length > 0 && (
                        <>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs text-stone-500">
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
                                className="text-stone-500 hover:text-stone-900 transition-colors"
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
                                className="text-stone-500 hover:text-stone-900 transition-colors"
                              >
                                None
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1 max-h-48 overflow-y-auto">
                            {selectedBooks.map((b) => (
                              <div key={b.id}>
                                <div className="text-xs font-medium text-stone-600 px-2 pt-2 pb-1">
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
                                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-stone-50 cursor-pointer"
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
                                        className="accent-stone-900"
                                      />
                                      <span className="text-sm text-stone-700">
                                        {s.name}
                                      </span>
                                      <span className="text-xs text-stone-400 ml-auto">
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
                      <p className="text-xs text-stone-400 mt-2">
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
