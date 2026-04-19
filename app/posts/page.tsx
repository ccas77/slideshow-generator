"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface TikTokAccount {
  id: number;
  username: string;
}

interface PostResult {
  accountId: number;
  username: string | null;
  profileUrl: string | null;
}

interface Post {
  id: string;
  caption: string;
  status: string;
  scheduled_at: string | null;
  posted_at: string | null;
  social_accounts: number[];
  slide_count: number;
  results: PostResult[];
}

export default function PostsPage() {
  const router = useRouter();
  const [password, setPassword] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterAccount, setFilterAccount] = useState<number | "all">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "scheduled" | "posted">(
    "all"
  );

  useEffect(() => {
    const pw = localStorage.getItem("sg.password");
    if (!pw) {
      router.push("/");
      return;
    }
    setPassword(pw);
  }, [router]);

  const load = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    try {
      const [accRes, postsRes] = await Promise.all([
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}`),
        fetch(
          `/api/post-tiktok?action=posts&password=${encodeURIComponent(
            password
          )}`
        ),
      ]);
      if (accRes.ok) setAccounts((await accRes.json()).accounts || []);
      if (postsRes.ok) setPosts((await postsRes.json()).posts || []);
    } catch {}
    setLoading(false);
  }, [password]);

  useEffect(() => {
    if (password) load();
  }, [password, load]);

  async function cancelPost(id: string) {
    if (!window.confirm("Cancel this scheduled post?")) return;
    try {
      const res = await fetch(
        `/api/post-tiktok?postId=${id}&password=${encodeURIComponent(
          password ?? ""
        )}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setPosts((prev) => prev.filter((p) => p.id !== id));
      } else {
        const d = await res.json();
        window.alert(d.error || "Failed");
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  }

  const accountUsername = (id: number) =>
    accounts.find((a) => a.id === id)?.username || `#${id}`;

  const filtered = posts.filter((p) => {
    if (filterAccount !== "all" && !p.social_accounts.includes(filterAccount))
      return false;
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    return true;
  });

  if (!password) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white">
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Posts</strong> — view all your scheduled and published posts.</p>
          <p>Filter by account to see what's been posted or what's coming up. Each entry shows the caption, slide count, and when it was scheduled or posted.</p>
        </HowItWorks>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Posts</h1>
          <button
            onClick={load}
            className="text-sm text-zinc-500 hover:text-white transition-colors"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={filterAccount}
            onChange={(e) =>
              setFilterAccount(
                e.target.value === "all" ? "all" : Number(e.target.value)
              )
            }
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as "all" | "scheduled" | "posted")
            }
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            <option value="all">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="posted">Posted</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center text-zinc-500">
            No posts match your filters.
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((p) => {
              const isScheduled = p.status === "scheduled";
              return (
                <li
                  key={p.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span
                          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                            isScheduled
                              ? "bg-blue-500/20 text-blue-300"
                              : p.status === "posted"
                              ? "bg-green-500/20 text-green-300"
                              : "bg-zinc-700 text-zinc-300"
                          }`}
                        >
                          {p.status}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {p.slide_count} slides
                        </span>
                      </div>

                      {/* Date/time info */}
                      <div className="flex flex-col gap-0.5 mb-2">
                        {p.status === "posted" && p.posted_at && (
                          <span className="text-xs text-zinc-500">
                            Posted {new Date(p.posted_at).toLocaleString()}
                          </span>
                        )}
                        {isScheduled && p.scheduled_at && (
                          <span className="text-xs text-zinc-500">
                            Scheduled for {new Date(p.scheduled_at).toLocaleString()}
                          </span>
                        )}
                        {p.status === "posted" && !p.posted_at && p.scheduled_at && (
                          <span className="text-xs text-zinc-500">
                            Scheduled {new Date(p.scheduled_at).toLocaleString()}
                          </span>
                        )}
                      </div>

                      {/* Account links */}
                      <div className="flex flex-wrap gap-2 mb-2">
                        {p.results && p.results.length > 0 ? (
                          p.results.map((r, idx) => {
                            const name = r.username || accountUsername(r.accountId);
                            return r.profileUrl ? (
                              <a
                                key={idx}
                                href={r.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                              >
                                @{name}
                              </a>
                            ) : (
                              <span key={idx} className="text-xs text-zinc-400">
                                @{name}
                              </span>
                            );
                          })
                        ) : (
                          p.social_accounts.map((id) => (
                            <span key={id} className="text-xs text-zinc-400">
                              @{accountUsername(id)}
                            </span>
                          ))
                        )}
                      </div>

                      <p className="text-sm text-zinc-300 line-clamp-3 whitespace-pre-wrap">
                        {p.caption || "(no caption)"}
                      </p>
                    </div>
                    {isScheduled && (
                      <button
                        onClick={() => cancelPost(p.id)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
