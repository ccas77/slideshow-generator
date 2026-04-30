"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface TikTokAccount {
  id: number;
  username: string;
}

interface PostAnalytics {
  view_count: number;
  like_count: number;
  comment_count: number;
  share_count: number;
  cover_image_url: string | null;
}

interface PostResult {
  accountId: number;
  username: string | null;
  profileUrl: string | null;
  postUrl: string | null;
  success: boolean;
  error: string | null;
  analytics: PostAnalytics | null;
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

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function captionFirstLine(caption: string): string {
  // Return text before the first hashtag, or the first line
  const beforeHash = caption.split("#")[0].trim();
  if (beforeHash) return beforeHash;
  const firstLine = caption.split("\n")[0].trim();
  return firstLine || caption;
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
  const [expandedCaptions, setExpandedCaptions] = useState<Set<string>>(new Set());

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
          <p><strong>Posts</strong> — view all your scheduled and published posts with engagement stats.</p>
          <p>Filter by account or status. Posted entries show views, likes, comments, and shares from TikTok. Click the post link to view it on TikTok.</p>
        </HowItWorks>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Posts</h1>
          <button
            onClick={load}
            className="text-sm text-zinc-500 hover:text-white transition-colors"
          >
            {loading ? "Loading..." : "Refresh"}
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
              const isPosted = p.status === "posted";
              // Aggregate analytics across all results for this post
              const hasAnalytics = p.results.some((r) => r.analytics);
              const totals = p.results.reduce(
                (acc, r) => {
                  if (r.analytics) {
                    acc.views += r.analytics.view_count;
                    acc.likes += r.analytics.like_count;
                    acc.comments += r.analytics.comment_count;
                    acc.shares += r.analytics.share_count;
                  }
                  return acc;
                },
                { views: 0, likes: 0, comments: 0, shares: 0 }
              );
              const coverUrl = p.results.find((r) => r.analytics?.cover_image_url)?.analytics?.cover_image_url;
              const errors = p.results.filter((r) => !r.success && r.error);
              const captionExpanded = expandedCaptions.has(p.id);
              const shortCaption = captionFirstLine(p.caption);
              const hasMoreCaption = p.caption.trim() !== shortCaption;

              return (
                <li
                  key={p.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"
                >
                  <div className="flex gap-3">
                    {/* Cover thumbnail */}
                    {coverUrl && (
                      <div className="shrink-0">
                        <img
                          src={coverUrl}
                          alt=""
                          className="w-16 h-24 rounded-lg object-cover bg-zinc-800"
                        />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      {/* Top row: status + slides + date */}
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span
                          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                            isScheduled
                              ? "bg-blue-500/20 text-blue-300"
                              : isPosted
                              ? "bg-green-500/20 text-green-300"
                              : "bg-zinc-700 text-zinc-300"
                          }`}
                        >
                          {p.status}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {p.slide_count} slides
                        </span>
                        {isPosted && p.posted_at && (
                          <span className="text-xs text-zinc-500">
                            {new Date(p.posted_at).toLocaleDateString()}
                          </span>
                        )}
                        {isScheduled && p.scheduled_at && (
                          <span className="text-xs text-zinc-500">
                            {new Date(p.scheduled_at).toLocaleString()}
                          </span>
                        )}
                        {isScheduled && (
                          <button
                            onClick={() => cancelPost(p.id)}
                            className="text-[10px] text-red-400 hover:text-red-300 transition-colors ml-auto"
                          >
                            Cancel
                          </button>
                        )}
                      </div>

                      {/* Account links — link to the actual post, not just profile */}
                      <div className="flex flex-wrap gap-2 mb-1.5">
                        {p.results.length > 0 ? (
                          p.results.map((r, idx) => {
                            const name = r.username || accountUsername(r.accountId);
                            const href = r.postUrl || r.profileUrl;
                            return href ? (
                              <a
                                key={idx}
                                href={href}
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

                      {/* Caption — first line only, expandable */}
                      {p.caption && (
                        <div className="mb-1.5">
                          <p className="text-sm text-zinc-300">
                            {captionExpanded ? p.caption : shortCaption}
                          </p>
                          {hasMoreCaption && (
                            <button
                              onClick={() => setExpandedCaptions((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.id)) next.delete(p.id);
                                else next.add(p.id);
                                return next;
                              })}
                              className="text-[11px] text-zinc-500 hover:text-zinc-300 mt-0.5"
                            >
                              {captionExpanded ? "Show less" : "Show full caption"}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Engagement stats */}
                      {hasAnalytics && (
                        <div className="flex gap-4 text-xs text-zinc-400">
                          <span>{formatCount(totals.views)} views</span>
                          <span>{formatCount(totals.likes)} likes</span>
                          {totals.comments > 0 && (
                            <span>{formatCount(totals.comments)} comments</span>
                          )}
                          {totals.shares > 0 && (
                            <span>{formatCount(totals.shares)} shares</span>
                          )}
                        </div>
                      )}

                      {/* Errors */}
                      {errors.length > 0 && (
                        <div className="mt-1.5">
                          {errors.map((r, idx) => (
                            <p key={idx} className="text-xs text-red-400">
                              @{r.username || accountUsername(r.accountId)}: {r.error}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
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
