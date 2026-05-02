"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";
import SlidePreview from "@/components/SlidePreview";

interface NamedItem {
  id: string;
  name: string;
  value: string;
}

interface Slideshow {
  id: string;
  name: string;
  slideTexts: string;
  imagePromptIds: string[];
  captionIds: string[];
}

interface Book {
  id: string;
  name: string;
  coverImage?: string;
  imagePrompts: NamedItem[];
  captions: NamedItem[];
  slideshows: Slideshow[];
}

interface TimeWindow {
  start: string;
  end: string;
}

interface InstagramSlideshow {
  id: string;
  name: string;
  sourceBookId?: string;
  sourceSlideshowId?: string;
  slideTexts: string;
  imagePromptIds: string[];
  captionIds: string[];
  imagePrompts: NamedItem[];
  captions: NamedItem[];
}

interface IgAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  bookIds: string[];
  slideshowIds: string[];
  pointer: number;
}

interface MusicTrack {
  id: string;
  name: string;
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

interface VideoAutomation {
  accounts: Record<string, VideoAccountConfig>;
}

interface IgGlobalAutomation {
  enabled: boolean;
  accounts: Record<string, IgAccountConfig>;
  igAccountIds?: number[];
  tiktokAccountIds?: number[];
  intervals?: TimeWindow[];
  igPointer?: number;
  accountBookIds?: Record<string, string[]>;
}

interface TikTokAccount {
  id: number;
  username: string;
}

type Tab = "slideshows" | "import" | "music" | "automation" | "video";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function InstagramPage() {
  const router = useRouter();
  const [password, setPassword] = useState<string | null>(null);
  const [igSlideshows, setIgSlideshows] = useState<InstagramSlideshow[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [igAccounts, setIgAccounts] = useState<TikTokAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("slideshows");

  // Import
  const [importBookId, setImportBookId] = useState("");
  const [importSlideshowId, setImportSlideshowId] = useState("");
  const [truncating, setTruncating] = useState(false);

  // Preview
  const [previewSlideshow, setPreviewSlideshow] = useState<InstagramSlideshow | null>(null);
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());

  // Editor (inline on slideshows tab)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<InstagramSlideshow | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeUrl, setAnalyzeUrl] = useState("");

  // Automation
  const [autoConfig, setAutoConfig] = useState<IgGlobalAutomation>({
    enabled: false,
    accounts: {},
  });
  const [selectedAutoAccount, setSelectedAutoAccount] = useState<string>("");
  const [autoSaved, setAutoSaved] = useState(false);
  const [videoConfig, setVideoConfig] = useState<VideoAutomation>({ accounts: {} });
  const [selectedVideoAccount, setSelectedVideoAccount] = useState<string>("");
  const [videoSaved, setVideoSaved] = useState(false);
  const [videoMusicTracks, setVideoMusicTracks] = useState<MusicTrack[]>([]);
  const [uploadingVideoMusic, setUploadingVideoMusic] = useState(false);

  useEffect(() => {
    const pw = localStorage.getItem("sg.password");
    if (!pw) {
      router.push("/");
      return;
    }
    setPassword(pw);
  }, [router]);

  const loadAll = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    try {
      const [igRes, booksRes, ttRes, igAccRes, autoRes, videoRes, videoMusicRes] = await Promise.all([
        fetch("/api/ig-slideshows"),
        fetch(`/api/books?password=${encodeURIComponent(password)}`),
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=tiktok`),
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=instagram`),
        fetch("/api/ig-automation"),
        fetch("/api/video-automation"),
        fetch(`/api/video-music?password=${encodeURIComponent(password)}`),
      ]);
      if (igRes.ok) setIgSlideshows((await igRes.json()).slideshows || []);
      if (booksRes.ok) setBooks((await booksRes.json()).books || []);
      if (ttRes.ok) setAccounts((await ttRes.json()).accounts || []);
      if (igAccRes.ok) setIgAccounts((await igAccRes.json()).accounts || []);
      if (autoRes.ok) {
        const raw = (await autoRes.json()).config;
        setAutoConfig({ enabled: raw?.enabled ?? false, accounts: raw?.accounts ?? {} });
      }
      if (videoRes.ok) {
        const raw = (await videoRes.json()).config;
        setVideoConfig({ accounts: raw?.accounts ?? {} });
      }
      if (videoMusicRes.ok) {
        const tracks = (await videoMusicRes.json()).tracks || [];
        setVideoMusicTracks(tracks.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })));
      }
    } catch (e) {
      console.error("Load error:", e);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    if (password) loadAll();
  }, [password, loadAll]);

  const persist = useCallback(async (next: InstagramSlideshow[]) => {
    setSaving(true);
    setIgSlideshows(next);
    try {
      await fetch("/api/ig-slideshows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideshows: next }),
      });
    } catch {}
    setSaving(false);
  }, []);

  // ── Import ──

  async function importSlideshow(bookIdOverride?: string, slideshowIdOverride?: string, bulk?: boolean): Promise<InstagramSlideshow | undefined> {
    const bId = bookIdOverride || importBookId;
    const sId = slideshowIdOverride || importSlideshowId;
    const book = books.find((b) => b.id === bId);
    const slideshow = book?.slideshows.find((s) => s.id === sId);
    if (!book || !slideshow) return;

    const lines = slideshow.slideTexts.split("\n").filter((l) => l.trim());
    let truncatedText: string;

    if (lines.length <= 10) {
      truncatedText = slideshow.slideTexts;
    } else {
      setTruncating(true);
      try {
        const res = await fetch("/api/generate-slides", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-password": password || "",
          },
          body: JSON.stringify({ action: "truncate", slides: slideshow.slideTexts }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        truncatedText = data.text;
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Failed to truncate");
        setTruncating(false);
        return;
      }
      setTruncating(false);
    }

    const prompts = book.imagePrompts.filter((p) => slideshow.imagePromptIds.includes(p.id));
    const captions = book.captions.filter((c) => slideshow.captionIds.includes(c.id));
    const finalPrompts = prompts.length > 0 ? prompts : book.imagePrompts;
    const finalCaptions = captions.length > 0 ? captions : book.captions;

    const newIg: InstagramSlideshow = {
      id: uid(),
      name: `${slideshow.name} (IG)`,
      sourceBookId: book.id,
      sourceSlideshowId: slideshow.id,
      slideTexts: truncatedText,
      imagePromptIds: finalPrompts.map((p) => p.id),
      captionIds: finalCaptions.map((c) => c.id),
      imagePrompts: finalPrompts,
      captions: finalCaptions,
    };

    if (bulk) {
      return newIg;
    } else {
      setTab("slideshows");
      setEditingId(newIg.id);
      setEditDraft(newIg);
    }
    setImportBookId("");
    setImportSlideshowId("");
  }

  // ── Editor ──

  function startEditing(s: InstagramSlideshow) {
    setEditingId(s.id);
    setEditDraft({ ...s });
    setAnalyzeUrl("");
    if (s.sourceBookId) {
      setExpandedBooks((prev) => new Set(prev).add(s.sourceBookId!));
    }
  }

  function cancelEditing() {
    setEditingId(null);
    setEditDraft(null);
  }

  function saveEditing() {
    if (!editDraft) return;
    if (!editDraft.name.trim()) {
      window.alert("Name required");
      return;
    }
    const lines = editDraft.slideTexts.split("\n").filter((l) => l.trim());
    if (lines.length > 10) {
      window.alert(`Too many slides (${lines.length}). Maximum is 10.`);
      return;
    }
    const exists = igSlideshows.some((s) => s.id === editDraft.id);
    const next = exists
      ? igSlideshows.map((s) => (s.id === editDraft.id ? editDraft : s))
      : [...igSlideshows, editDraft];
    persist(next);
    setEditingId(null);
    setEditDraft(null);
  }

  function deleteSlideshow(id: string) {
    if (!window.confirm("Delete this Instagram slideshow?")) return;
    if (editingId === id) cancelEditing();
    persist(igSlideshows.filter((s) => s.id !== id));
  }

  function analyzeUpload() {
    if (!editDraft) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !editDraft) return;
      setAnalyzing(true);
      try {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        const res = await fetch("/api/analyze-slide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageData: dataUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        const newItem = { id: uid(), name: file.name.replace(/\.[^.]+$/, ""), value: data.prompt };
        setEditDraft({
          ...editDraft,
          imagePrompts: [...editDraft.imagePrompts, newItem],
          imagePromptIds: [...editDraft.imagePromptIds, newItem.id],
        });
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Failed to analyze");
      } finally {
        setAnalyzing(false);
      }
    };
    input.click();
  }

  async function analyzeFromUrl() {
    if (!analyzeUrl.trim() || !editDraft) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-slide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: analyzeUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const newItem = { id: uid(), name: "From URL", value: data.prompt };
      setEditDraft({
        ...editDraft,
        imagePrompts: [...editDraft.imagePrompts, newItem],
        imagePromptIds: [...editDraft.imagePromptIds, newItem.id],
      });
      setAnalyzeUrl("");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to analyze");
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Automation ──

  async function saveAutomation() {
    setSaving(true);
    try {
      await fetch("/api/ig-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: autoConfig }),
      });
      setAutoSaved(true);
      setTimeout(() => setAutoSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  // ── Video Music ──

  async function handleVideoMusicUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVideoMusic(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const mimeType = file.type || "audio/mpeg";
      const audioData = `data:${mimeType};base64,${base64}`;

      const name = file.name.replace(/\.[^.]+$/, "");
      const CHUNK_SIZE = 3_000_000;

      const authHeaders = { "Content-Type": "application/json", "x-password": password || "" };
      if (audioData.length <= CHUNK_SIZE) {
        await fetch("/api/video-music", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name, audioData }),
        });
      } else {
        const totalChunks = Math.ceil(audioData.length / CHUNK_SIZE);
        const firstChunk = audioData.slice(0, CHUNK_SIZE);
        const res = await fetch("/api/video-music", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name, audioData: firstChunk, chunked: true, chunkIndex: 0, totalChunks }),
        });
        const { id } = await res.json();

        for (let i = 1; i < totalChunks; i++) {
          const chunk = audioData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          await fetch("/api/video-music", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ id, audioData: chunk, chunked: true, chunkIndex: i, totalChunks }),
          });
        }
      }
      await loadAll();
    } catch (err) {
      alert("Upload failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
    setUploadingVideoMusic(false);
    e.target.value = "";
  }

  async function deleteVideoMusic(id: string) {
    if (!window.confirm("Delete this track?")) return;
    await fetch("/api/video-music", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-password": password || "" },
      body: JSON.stringify({ action: "delete", id }),
    });
    // Also remove from any video account configs
    const updated = { ...videoConfig };
    for (const [k, v] of Object.entries(updated.accounts)) {
      if (v.musicTrackIds.includes(id)) {
        updated.accounts[k] = { ...v, musicTrackIds: v.musicTrackIds.filter((x) => x !== id) };
      }
    }
    setVideoConfig(updated);
    await loadAll();
  }

  async function saveVideoAutomation() {
    setSaving(true);
    try {
      await fetch("/api/video-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: videoConfig }),
      });
      setVideoSaved(true);
      setTimeout(() => setVideoSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  if (!password) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "slideshows", label: `Slideshows (${igSlideshows.length})` },
    { key: "import", label: "Import" },
    { key: "music", label: `Music (${videoMusicTracks.length})` },
    { key: "automation", label: (() => { const count = Object.values(autoConfig.accounts).filter((c) => c.enabled).length; return count > 0 ? `Automation (${count})` : "Automation"; })() },
    { key: "video", label: (() => { const count = Object.values(videoConfig.accounts).filter((c) => c.enabled).length; return count > 0 ? `Video (${count})` : "Video"; })() },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white">
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Instagram</strong> — manage Instagram carousels adapted from your TikTok slideshows.</p>
          <p>The <strong>Slideshows</strong> tab shows your IG slideshows. Each has its own slide texts, image prompts, and captions. Click Edit to modify inline.</p>
          <p>The <strong>Import</strong> tab lets you pull slideshows from your books and adapt them for Instagram (max 10 slides).</p>
          <p>The <strong>Automation</strong> tab sets up daily posting — IG gets one carousel per day (round-robin through your slideshows), and each selected TikTok account gets a different slideshow as a video. Every post gets a fresh AI-generated image.</p>
        </HowItWorks>

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Instagram</h1>
          <p className="text-sm text-zinc-500">
            Short carousels for Instagram + video for TikTok
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-zinc-800">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                tab === t.key
                  ? "text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {t.label}
              {tab === t.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
              )}
            </button>
          ))}
          {saving && (
            <span className="ml-auto text-xs text-zinc-500 self-center">Saving…</span>
          )}
        </div>

        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : (
          <>
            {/* ═══ Slideshows Tab ═══ */}
            {tab === "slideshows" && (
              <div className="space-y-6">
                {igSlideshows.length === 0 ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
                    <p className="text-zinc-400 mb-2">No Instagram slideshows yet.</p>
                    <p className="text-xs text-zinc-500 mb-4">
                      Import slideshows from your books to get started.
                    </p>
                    <button
                      onClick={() => setTab("import")}
                      className="px-4 py-2 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm"
                    >
                      Go to Import
                    </button>
                  </div>
                ) : (
                  (() => {
                    const groups = new Map<string, InstagramSlideshow[]>();
                    for (const s of igSlideshows) {
                      const key = s.sourceBookId || "__none__";
                      if (!groups.has(key)) groups.set(key, []);
                      groups.get(key)!.push(s);
                    }
                    const sortedKeys = [...groups.keys()].sort((a, b) => {
                      if (a === "__none__") return 1;
                      if (b === "__none__") return -1;
                      const nameA = books.find((bk) => bk.id === a)?.name || "";
                      const nameB = books.find((bk) => bk.id === b)?.name || "";
                      return nameA.localeCompare(nameB);
                    });
                    return sortedKeys.map((bookId) => {
                      const group = groups.get(bookId)!;
                      const sourceBook = bookId !== "__none__" ? books.find((b) => b.id === bookId) : null;
                      const isExpanded = expandedBooks.has(bookId);
                      return (
                        <div key={bookId} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                          <button
                            onClick={() => {
                              setExpandedBooks((prev) => {
                                const next = new Set(prev);
                                if (next.has(bookId)) next.delete(bookId);
                                else next.add(bookId);
                                return next;
                              });
                            }}
                            className="w-full flex items-center gap-2 px-5 py-3.5 text-left hover:bg-zinc-800/50 transition-colors"
                          >
                            <span className="text-xs text-zinc-500 transition-transform" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>&#9654;</span>
                            <h3 className="text-sm font-semibold text-zinc-200 flex-1">
                              {sourceBook ? sourceBook.name : "Other"}
                            </h3>
                            <span className="text-xs text-zinc-500">{group.length} slideshow{group.length !== 1 ? "s" : ""}</span>
                          </button>
                          {isExpanded && <div className="space-y-3 px-5 pb-5">
                  {group.map((s) => {
                    const isEditing = editingId === s.id && editDraft;
                    const slideCount = s.slideTexts.split("\n").filter((l) => l.trim()).length;

                    if (isEditing && editDraft) {
                      return (
                        <div key={s.id} className="rounded-2xl border border-zinc-700 bg-zinc-900/80 p-6">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold">Editing slideshow</h3>
                            <div className="flex gap-2">
                              <button onClick={cancelEditing} className="text-xs text-zinc-400 hover:text-white">Cancel</button>
                              <button onClick={saveEditing} className="text-xs bg-white text-black px-3 py-1 rounded-lg font-semibold hover:bg-zinc-200">Save</button>
                            </div>
                          </div>

                          <label className="block text-xs font-medium text-zinc-400 mb-1">Name</label>
                          <input
                            value={editDraft.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-white/20"
                          />

                          <label className="block text-xs font-medium text-zinc-400 mb-1">
                            Slides (one per line, max 10)
                          </label>
                          <textarea
                            value={editDraft.slideTexts}
                            onChange={(e) => setEditDraft({ ...editDraft, slideTexts: e.target.value })}
                            rows={10}
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white text-sm mb-1 font-mono focus:outline-none focus:ring-2 focus:ring-white/20"
                          />
                          <p className="text-[11px] text-zinc-500 mb-5">
                            {editDraft.slideTexts.split("\n").filter((l) => l.trim()).length} / 10 slides
                          </p>

                          {/* Image prompts */}
                          <label className="block text-xs font-medium text-zinc-400 mb-1">
                            Image prompts ({editDraft.imagePrompts.length})
                          </label>
                          <div className="space-y-2 mb-2">
                            {editDraft.imagePrompts.map((p) => (
                              <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                                <div className="flex items-center gap-2 text-sm text-zinc-300 mb-1">
                                  <span className="truncate font-medium">{p.name}</span>
                                  <button
                                    onClick={() => setEditDraft({
                                      ...editDraft,
                                      imagePrompts: editDraft.imagePrompts.filter((x) => x.id !== p.id),
                                      imagePromptIds: editDraft.imagePromptIds.filter((x) => x !== p.id),
                                    })}
                                    className="text-xs text-red-500 hover:text-red-400 ml-auto shrink-0"
                                  >
                                    Remove
                                  </button>
                                </div>
                                <textarea
                                  value={p.value}
                                  onChange={(e) => setEditDraft({
                                    ...editDraft,
                                    imagePrompts: editDraft.imagePrompts.map((x) =>
                                      x.id === p.id ? { ...x, value: e.target.value } : x
                                    ),
                                  })}
                                  rows={3}
                                  className="w-full rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-400 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                                />
                              </div>
                            ))}
                            {editDraft.imagePrompts.length === 0 && (
                              <p className="text-xs text-zinc-600">No image prompts.</p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2 mb-2">
                            {(() => {
                              const srcBook = books.find((b) => b.id === editDraft.sourceBookId);
                              const available = srcBook?.imagePrompts.filter((p) => !editDraft.imagePromptIds.includes(p.id));
                              if (available && available.length > 0) {
                                return (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const item = available.find((p) => p.id === e.target.value);
                                      if (!item) return;
                                      setEditDraft({
                                        ...editDraft,
                                        imagePrompts: [...editDraft.imagePrompts, item],
                                        imagePromptIds: [...editDraft.imagePromptIds, item.id],
                                      });
                                    }}
                                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 focus:outline-none"
                                  >
                                    <option value="">+ Add from book pool…</option>
                                    {available.map((p) => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                );
                              }
                              return null;
                            })()}
                            <button
                              onClick={() => {
                                const newItem = { id: uid(), name: `Prompt ${editDraft.imagePrompts.length + 1}`, value: "" };
                                setEditDraft({
                                  ...editDraft,
                                  imagePrompts: [...editDraft.imagePrompts, newItem],
                                  imagePromptIds: [...editDraft.imagePromptIds, newItem.id],
                                });
                              }}
                              className="text-xs text-blue-400 hover:text-blue-300"
                            >
                              + New prompt
                            </button>
                            <button
                              onClick={analyzeUpload}
                              disabled={analyzing}
                              className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-40"
                            >
                              {analyzing ? "Analyzing…" : "Analyze image"}
                            </button>
                          </div>
                          <div className="flex gap-2 mb-5">
                            <input
                              value={analyzeUrl}
                              onChange={(e) => setAnalyzeUrl(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") analyzeFromUrl(); }}
                              placeholder="Paste image URL and press Enter…"
                              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-white/20"
                            />
                            <button
                              onClick={analyzeFromUrl}
                              disabled={!analyzeUrl.trim() || analyzing}
                              className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-40 shrink-0"
                            >
                              Extract
                            </button>
                          </div>

                          {/* Captions */}
                          <label className="block text-xs font-medium text-zinc-400 mb-1">
                            Captions ({editDraft.captions.length})
                          </label>
                          <div className="space-y-2 mb-2">
                            {editDraft.captions.map((c) => (
                              <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                                <div className="flex items-center gap-2 text-sm text-zinc-300 mb-1">
                                  <span className="truncate font-medium">{c.name}</span>
                                  <button
                                    onClick={() => setEditDraft({
                                      ...editDraft,
                                      captions: editDraft.captions.filter((x) => x.id !== c.id),
                                      captionIds: editDraft.captionIds.filter((x) => x !== c.id),
                                    })}
                                    className="text-xs text-red-500 hover:text-red-400 ml-auto shrink-0"
                                  >
                                    Remove
                                  </button>
                                </div>
                                <textarea
                                  value={c.value}
                                  onChange={(e) => setEditDraft({
                                    ...editDraft,
                                    captions: editDraft.captions.map((x) =>
                                      x.id === c.id ? { ...x, value: e.target.value } : x
                                    ),
                                  })}
                                  rows={3}
                                  className="w-full rounded bg-zinc-900 border border-zinc-800 px-2 py-1.5 text-xs text-zinc-400 focus:outline-none focus:ring-1 focus:ring-white/20 resize-none"
                                />
                              </div>
                            ))}
                            {editDraft.captions.length === 0 && (
                              <p className="text-xs text-zinc-600">No captions.</p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(() => {
                              const srcBook = books.find((b) => b.id === editDraft.sourceBookId);
                              const available = srcBook?.captions.filter((c) => !editDraft.captionIds.includes(c.id));
                              if (available && available.length > 0) {
                                return (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const item = available.find((c) => c.id === e.target.value);
                                      if (!item) return;
                                      setEditDraft({
                                        ...editDraft,
                                        captions: [...editDraft.captions, item],
                                        captionIds: [...editDraft.captionIds, item.id],
                                      });
                                    }}
                                    className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-400 focus:outline-none"
                                  >
                                    <option value="">+ Add from book pool…</option>
                                    {available.map((c) => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                  </select>
                                );
                              }
                              return null;
                            })()}
                            <button
                              onClick={() => {
                                const newItem = { id: uid(), name: `Caption ${editDraft.captions.length + 1}`, value: "" };
                                setEditDraft({
                                  ...editDraft,
                                  captions: [...editDraft.captions, newItem],
                                  captionIds: [...editDraft.captionIds, newItem.id],
                                });
                              }}
                              className="text-xs text-blue-400 hover:text-blue-300"
                            >
                              + New caption
                            </button>
                          </div>

                        </div>
                      );
                    }

                    return (
                      <div key={s.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm">{s.name}</div>
                            <div className="text-xs text-zinc-500 mt-0.5">
                              {slideCount} slides · {s.imagePrompts.length} prompts · {s.captions.length} captions
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => setPreviewSlideshow(s)}
                              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                            >
                              Preview
                            </button>
                            <button
                              onClick={() => startEditing(s)}
                              className="text-xs text-zinc-400 hover:text-white transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteSlideshow(s.id)}
                              className="text-xs text-red-500 hover:text-red-400 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                          </div>}
                        </div>
                      );
                    });
                  })()
                )}

                {/* Show new slideshow being reviewed (from import) */}
                {editingId && editDraft && !igSlideshows.some((s) => s.id === editingId) && (
                  <div className="rounded-2xl border border-zinc-700 bg-zinc-900/80 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold">Review imported slideshow</h3>
                      <div className="flex gap-2">
                        <button onClick={cancelEditing} className="text-xs text-zinc-400 hover:text-white">Discard</button>
                        <button onClick={saveEditing} className="text-xs bg-white text-black px-3 py-1 rounded-lg font-semibold hover:bg-zinc-200">Save</button>
                      </div>
                    </div>

                    <label className="block text-xs font-medium text-zinc-400 mb-1">Name</label>
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-white/20"
                    />

                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Slides (one per line, max 10)
                    </label>
                    <textarea
                      value={editDraft.slideTexts}
                      onChange={(e) => setEditDraft({ ...editDraft, slideTexts: e.target.value })}
                      rows={10}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white text-sm mb-1 font-mono focus:outline-none focus:ring-2 focus:ring-white/20"
                    />
                    <p className="text-[11px] text-zinc-500 mb-4">
                      {editDraft.slideTexts.split("\n").filter((l) => l.trim()).length} / 10 slides
                    </p>

                    <p className="text-xs text-zinc-500">
                      {editDraft.imagePrompts.length} image prompts · {editDraft.captions.length} captions imported from book
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ═══ Import Tab ═══ */}
            {tab === "import" && (
              <div className="space-y-4">
                <p className="text-xs text-zinc-500">
                  Import slideshows from your books. Slideshows with more than 10 slides will be truncated by Claude. Already-imported slideshows are grayed out.
                </p>

                {truncating && (
                  <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-400">
                    Claude is selecting the best slides for Instagram…
                  </div>
                )}

                {books.length === 0 ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center text-zinc-500">
                    No books yet. Create a book first.
                  </div>
                ) : (
                  books.map((book) => {
                    const importedSlideshowIds = new Set(
                      igSlideshows
                        .filter((s) => s.sourceBookId === book.id && s.sourceSlideshowId)
                        .map((s) => s.sourceSlideshowId!)
                    );
                    const newSlideshows = book.slideshows.filter((s) => !importedSlideshowIds.has(s.id));
                    const importExpanded = expandedBooks.has(`import:${book.id}`);

                    return (
                      <div key={book.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden">
                        <div className="flex items-center gap-2 px-5 py-3.5">
                          <button
                            onClick={() => {
                              setExpandedBooks((prev) => {
                                const next = new Set(prev);
                                const key = `import:${book.id}`;
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              });
                            }}
                            className="flex items-center gap-2 flex-1 text-left"
                          >
                            <span className="text-xs text-zinc-500 transition-transform" style={{ transform: importExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>&#9654;</span>
                            <h3 className="text-sm font-semibold">{book.name}</h3>
                            <span className="text-xs text-zinc-500">
                              {book.slideshows.length} slideshow{book.slideshows.length !== 1 ? "s" : ""} · {importedSlideshowIds.size} imported · {newSlideshows.length} new
                            </span>
                          </button>
                          {newSlideshows.length > 0 && (
                            <button
                              onClick={async () => {
                                const imported: InstagramSlideshow[] = [];
                                for (const ss of newSlideshows) {
                                  const result = await importSlideshow(book.id, ss.id, true);
                                  if (result) imported.push(result);
                                }
                                if (imported.length > 0) {
                                  await persist([...igSlideshows, ...imported]);
                                }
                              }}
                              disabled={truncating}
                              className="text-xs bg-white text-black px-3 py-1.5 rounded-lg font-medium hover:bg-zinc-200 transition-colors disabled:opacity-40 shrink-0"
                            >
                              Import all new ({newSlideshows.length})
                            </button>
                          )}
                        </div>
                        {importExpanded && <div className="space-y-1 px-5 pb-4">
                          {book.slideshows.map((ss) => {
                            const alreadyImported = importedSlideshowIds.has(ss.id);
                            const slideCount = ss.slideTexts.split("\n").filter((l) => l.trim()).length;
                            return (
                              <div
                                key={ss.id}
                                className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                                  alreadyImported ? "bg-zinc-950/50 text-zinc-600" : "bg-zinc-950/50 text-zinc-300"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {alreadyImported && (
                                    <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded shrink-0">imported</span>
                                  )}
                                  <span className="text-sm truncate">{ss.name}</span>
                                  <span className="text-[10px] text-zinc-600 shrink-0">
                                    {slideCount} slides{slideCount > 10 ? " → truncate" : ""}
                                  </span>
                                </div>
                                {!alreadyImported && (
                                  <button
                                    onClick={() => importSlideshow(book.id, ss.id)}
                                    disabled={truncating}
                                    className="text-xs text-blue-400 hover:text-blue-300 shrink-0 ml-2 disabled:opacity-40"
                                  >
                                    Import
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ═══ Automation Tab ═══ */}
            {tab === "automation" && (() => {
              const allAccs = [...igAccounts.map((a) => ({ ...a, platform: "instagram" as const })), ...accounts.map((a) => ({ ...a, platform: "tiktok" as const }))];
              const selConfig = selectedAutoAccount ? autoConfig.accounts[selectedAutoAccount] : null;
              const updateAccConfig = (patch: Partial<IgAccountConfig>) => {
                if (!selectedAutoAccount) return;
                const current = autoConfig.accounts[selectedAutoAccount] || { enabled: false, intervals: [{ start: "18:00", end: "20:00" }], bookIds: [], slideshowIds: [], pointer: 0 };
                setAutoConfig({
                  ...autoConfig,
                  accounts: { ...autoConfig.accounts, [selectedAutoAccount]: { ...current, ...patch } },
                });
              };
              const currentConfig = selConfig || { enabled: false, intervals: [{ start: "18:00", end: "20:00" }], bookIds: [], slideshowIds: [], pointer: 0 };
              const configuredCount = Object.values(autoConfig.accounts).filter((c) => c.enabled).length;

              return (
              <div className="space-y-6">
                {/* Summary */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
                  <p className="text-xs text-zinc-500">
                    {configuredCount} account{configuredCount !== 1 ? "s" : ""} enabled. Each account round-robins through its assigned slideshows.
                  </p>
                </div>

                {/* Account selector */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
                  <h3 className="text-sm font-semibold mb-3">Configure Account</h3>
                  {allAccs.length === 0 ? (
                    <p className="text-xs text-zinc-500">No accounts connected in PostBridge.</p>
                  ) : (
                    <select
                      value={selectedAutoAccount}
                      onChange={(e) => setSelectedAutoAccount(e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                    >
                      <option value="">Select an account…</option>
                      {allAccs.map((a) => {
                        const cfg = autoConfig.accounts[String(a.id)];
                        return (
                          <option key={a.id} value={String(a.id)}>
                            @{a.username} ({a.platform}){cfg?.enabled ? " ✓" : ""}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>

                {/* Per-account config */}
                {selectedAutoAccount && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-5">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={currentConfig.enabled}
                        onChange={(e) => updateAccConfig({ enabled: e.target.checked })}
                        className="accent-white w-4 h-4"
                      />
                      <span className="text-sm font-medium">Enable for this account</span>
                    </label>

                    {/* Books */}
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Books</h4>
                      <p className="text-[11px] text-zinc-500 mb-2">
                        {currentConfig.bookIds.length === 0 ? "All books (none selected = all)" : `${currentConfig.bookIds.length} selected`}
                      </p>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {books.map((b) => (
                          <label key={b.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={currentConfig.bookIds.includes(b.id)}
                              onChange={() => {
                                const removing = currentConfig.bookIds.includes(b.id);
                                const next = removing
                                  ? currentConfig.bookIds.filter((x) => x !== b.id)
                                  : [...currentConfig.bookIds, b.id];
                                // Only drop slideshows that belonged to the removed book
                                const nextSlideshows = removing
                                  ? currentConfig.slideshowIds.filter((sid) => {
                                      const ss = igSlideshows.find((s) => s.id === sid);
                                      return ss?.sourceBookId !== b.id;
                                    })
                                  : currentConfig.slideshowIds;
                                updateAccConfig({ bookIds: next, slideshowIds: nextSlideshows });
                              }}
                              className="accent-white w-3.5 h-3.5"
                            />
                            <span className="text-sm text-zinc-300">{b.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Slideshows — only shown after selecting books */}
                    {currentConfig.bookIds.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Slideshows</h4>
                      {(() => {
                        const pool = igSlideshows.filter((s) => s.sourceBookId && currentConfig.bookIds.includes(s.sourceBookId));
                        return pool.length === 0 ? (
                          <p className="text-xs text-zinc-500">No slideshows available for selected books.</p>
                        ) : (
                          <>
                            <p className="text-[11px] text-zinc-500 mb-2">
                              {currentConfig.slideshowIds.length === 0 ? `All ${pool.length} slideshows` : `${currentConfig.slideshowIds.length} of ${pool.length} selected`}
                            </p>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {pool.map((s) => (
                                <label key={s.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={currentConfig.slideshowIds.includes(s.id)}
                                    onChange={() => {
                                      const next = currentConfig.slideshowIds.includes(s.id)
                                        ? currentConfig.slideshowIds.filter((x) => x !== s.id)
                                        : [...currentConfig.slideshowIds, s.id];
                                      updateAccConfig({ slideshowIds: next });
                                    }}
                                    className="accent-white w-3.5 h-3.5"
                                  />
                                  <span className="text-sm text-zinc-300 truncate">{s.name}</span>
                                </label>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    )}

                    {/* Time windows */}
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Posting Windows (UTC)</h4>
                      <div className="space-y-2 mb-3">
                        {currentConfig.intervals.map((w, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="time"
                              value={w.start}
                              onChange={(e) => updateAccConfig({ intervals: currentConfig.intervals.map((x, j) => j === i ? { ...x, start: e.target.value } : x) })}
                              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                            <span className="text-xs text-zinc-600">→</span>
                            <input
                              type="time"
                              value={w.end}
                              onChange={(e) => updateAccConfig({ intervals: currentConfig.intervals.map((x, j) => j === i ? { ...x, end: e.target.value } : x) })}
                              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                            {currentConfig.intervals.length > 1 && (
                              <button
                                onClick={() => updateAccConfig({ intervals: currentConfig.intervals.filter((_, j) => j !== i) })}
                                className="text-xs text-red-500 hover:text-red-400"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => updateAccConfig({ intervals: [...currentConfig.intervals, { start: "12:00", end: "14:00" }] })}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        + Add window
                      </button>
                    </div>
                  </div>
                )}

                {/* Save */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={saveAutomation}
                    className="px-5 py-2.5 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm"
                  >
                    Save Automation
                  </button>
                  {autoSaved && <span className="text-xs text-green-400">Saved</span>}
                </div>
              </div>
              );
            })()}

            {tab === "music" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white">Music Tracks</h2>
                  <label className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${uploadingVideoMusic ? "bg-zinc-700 text-zinc-400" : "bg-white text-black hover:bg-zinc-200"}`}>
                    {uploadingVideoMusic ? "Uploading..." : "+ Upload Track"}
                    <input type="file" accept="audio/*" onChange={handleVideoMusicUpload} className="hidden" disabled={uploadingVideoMusic} />
                  </label>
                </div>
                <p className="text-xs text-zinc-500">Upload MP3 or M4A files. Assign them to accounts in the Video tab. A random track is picked for each video post.</p>
                {videoMusicTracks.length === 0 ? (
                  <p className="text-zinc-500 text-sm text-center py-8">No music tracks yet. Upload one to get started.</p>
                ) : (
                  <div className="space-y-3">
                    {videoMusicTracks.map((t) => {
                      const usedIn = Object.entries(videoConfig.accounts).filter(([, c]) => c.musicTrackIds?.includes(t.id)).map(([id]) => {
                        const acc = [...igAccounts, ...accounts].find((a) => String(a.id) === id);
                        return acc ? `@${acc.username}` : id;
                      });
                      const audioUrl = `/api/video-music?id=${t.id}`;
                      return (
                        <div key={t.id} className="bg-zinc-900 rounded-lg px-4 py-3 border border-zinc-800 space-y-2">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-white text-sm">{t.name}</span>
                              {usedIn.length > 0 && (
                                <span className="text-xs text-purple-400 ml-2">Used by: {usedIn.join(", ")}</span>
                              )}
                            </div>
                            <button onClick={() => deleteVideoMusic(t.id)} className="text-xs text-red-400 hover:text-red-300 transition-colors">Delete</button>
                          </div>
                          <audio controls preload="none" src={audioUrl} className="w-full h-8 [&::-webkit-media-controls-panel]:bg-zinc-800" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === "video" && (() => {
              const allAccs = [...igAccounts.map((a) => ({ ...a, platform: "instagram" as const })), ...accounts.map((a) => ({ ...a, platform: "tiktok" as const }))];
              const selConfig = selectedVideoAccount ? videoConfig.accounts[selectedVideoAccount] : null;
              const updateVideoAccConfig = (patch: Partial<VideoAccountConfig>) => {
                if (!selectedVideoAccount) return;
                const current = videoConfig.accounts[selectedVideoAccount] || { enabled: false, intervals: [{ start: "18:00", end: "20:00" }], bookIds: [], slideshowIds: [], pointer: 0, musicTrackIds: [], durationPerSlide: 2 };
                setVideoConfig({
                  ...videoConfig,
                  accounts: { ...videoConfig.accounts, [selectedVideoAccount]: { ...current, ...patch } },
                });
              };
              const currentConfig = selConfig || { enabled: false, intervals: [{ start: "18:00", end: "20:00" }], bookIds: [], slideshowIds: [], pointer: 0, musicTrackIds: [], durationPerSlide: 2 };
              const configuredCount = Object.values(videoConfig.accounts).filter((c) => c.enabled).length;

              return (
              <div className="space-y-6">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
                  <p className="text-xs text-zinc-500">
                    {configuredCount} account{configuredCount !== 1 ? "s" : ""} enabled for video posts. Each account round-robins through its assigned slideshows, rendering a video (2s/slide) with music.
                  </p>
                </div>

                {/* Account selector */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
                  <h3 className="text-sm font-semibold mb-3">Configure Account</h3>
                  {allAccs.length === 0 ? (
                    <p className="text-xs text-zinc-500">No accounts connected in PostBridge.</p>
                  ) : (
                    <select
                      value={selectedVideoAccount}
                      onChange={(e) => setSelectedVideoAccount(e.target.value)}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                    >
                      <option value="">Select an account...</option>
                      {allAccs.map((a) => {
                        const cfg = videoConfig.accounts[String(a.id)];
                        return (
                          <option key={a.id} value={String(a.id)}>
                            @{a.username} ({a.platform}){cfg?.enabled ? " \u2713" : ""}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>

                {/* Per-account config */}
                {selectedVideoAccount && (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-5">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={currentConfig.enabled}
                        onChange={(e) => updateVideoAccConfig({ enabled: e.target.checked })}
                        className="accent-white w-4 h-4"
                      />
                      <span className="text-sm font-medium">Enable video posts for this account</span>
                    </label>

                    {/* Books */}
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Books</h4>
                      <p className="text-[11px] text-zinc-500 mb-2">
                        {currentConfig.bookIds.length === 0 ? "All books (none selected = all)" : `${currentConfig.bookIds.length} selected`}
                      </p>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {books.map((b) => (
                          <label key={b.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={currentConfig.bookIds.includes(b.id)}
                              onChange={() => {
                                const removing = currentConfig.bookIds.includes(b.id);
                                const next = removing
                                  ? currentConfig.bookIds.filter((x) => x !== b.id)
                                  : [...currentConfig.bookIds, b.id];
                                const nextSlideshows = removing
                                  ? currentConfig.slideshowIds.filter((sid) => {
                                      const ss = igSlideshows.find((s) => s.id === sid);
                                      return ss?.sourceBookId !== b.id;
                                    })
                                  : currentConfig.slideshowIds;
                                updateVideoAccConfig({ bookIds: next, slideshowIds: nextSlideshows });
                              }}
                              className="accent-white w-3.5 h-3.5"
                            />
                            <span className="text-sm text-zinc-300">{b.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Slideshows */}
                    {currentConfig.bookIds.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Slideshows</h4>
                      {(() => {
                        const pool = igSlideshows.filter((s) => s.sourceBookId && currentConfig.bookIds.includes(s.sourceBookId));
                        return pool.length === 0 ? (
                          <p className="text-xs text-zinc-500">No slideshows available for selected books.</p>
                        ) : (
                          <>
                            <p className="text-[11px] text-zinc-500 mb-2">
                              {currentConfig.slideshowIds.length === 0 ? `All ${pool.length} slideshows` : `${currentConfig.slideshowIds.length} of ${pool.length} selected`}
                            </p>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {pool.map((s) => (
                                <label key={s.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={currentConfig.slideshowIds.includes(s.id)}
                                    onChange={() => {
                                      const next = currentConfig.slideshowIds.includes(s.id)
                                        ? currentConfig.slideshowIds.filter((x) => x !== s.id)
                                        : [...currentConfig.slideshowIds, s.id];
                                      updateVideoAccConfig({ slideshowIds: next });
                                    }}
                                    className="accent-white w-3.5 h-3.5"
                                  />
                                  <span className="text-sm text-zinc-300 truncate">{s.name}</span>
                                </label>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    )}

                    {/* Music */}
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Music</h4>
                      {videoMusicTracks.length === 0 ? (
                        <p className="text-xs text-zinc-500">No music tracks yet. Upload tracks in the Music tab.</p>
                      ) : (
                        <>
                          <p className="text-[11px] text-zinc-500 mb-2">
                            {currentConfig.musicTrackIds.length === 0
                              ? "No music (silent video)"
                              : `${currentConfig.musicTrackIds.length} track${currentConfig.musicTrackIds.length !== 1 ? "s" : ""} — random pick per post`}
                          </p>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {videoMusicTracks.map((t) => (
                              <label key={t.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={currentConfig.musicTrackIds.includes(t.id)}
                                  onChange={() => {
                                    const next = currentConfig.musicTrackIds.includes(t.id)
                                      ? currentConfig.musicTrackIds.filter((x) => x !== t.id)
                                      : [...currentConfig.musicTrackIds, t.id];
                                    updateVideoAccConfig({ musicTrackIds: next });
                                  }}
                                  className="accent-white w-3.5 h-3.5"
                                />
                                <span className="text-sm text-zinc-300">{t.name}</span>
                              </label>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Time windows */}
                    <div>
                      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Posting Windows (UTC)</h4>
                      <div className="space-y-2 mb-3">
                        {currentConfig.intervals.map((w, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="time"
                              value={w.start}
                              onChange={(e) => updateVideoAccConfig({ intervals: currentConfig.intervals.map((x, j) => j === i ? { ...x, start: e.target.value } : x) })}
                              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                            <span className="text-xs text-zinc-600">&rarr;</span>
                            <input
                              type="time"
                              value={w.end}
                              onChange={(e) => updateVideoAccConfig({ intervals: currentConfig.intervals.map((x, j) => j === i ? { ...x, end: e.target.value } : x) })}
                              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                            {currentConfig.intervals.length > 1 && (
                              <button
                                onClick={() => updateVideoAccConfig({ intervals: currentConfig.intervals.filter((_, j) => j !== i) })}
                                className="text-xs text-red-500 hover:text-red-400"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => updateVideoAccConfig({ intervals: [...currentConfig.intervals, { start: "12:00", end: "14:00" }] })}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        + Add window
                      </button>
                    </div>
                  </div>
                )}

                {/* Save */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={saveVideoAutomation}
                    className="px-5 py-2.5 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm"
                  >
                    Save Video Automation
                  </button>
                  {videoSaved && <span className="text-xs text-green-400">Saved</span>}
                </div>
              </div>
              );
            })()}
          </>
        )}
        {previewSlideshow && (() => {
          const srcBook = books.find((b) => b.id === previewSlideshow.sourceBookId);
          const allSlides = previewSlideshow.slideTexts.split("\n").filter(Boolean);
          // Drop last text slide (book tag) when cover replaces it
          const slides = srcBook?.coverImage && allSlides.length > 2
            ? allSlides.slice(0, -1)
            : allSlides;
          return (
            <SlidePreview
              slides={slides}
              caption={previewSlideshow.captions.length > 0 ? previewSlideshow.captions[0].value : undefined}
              coverImage={srcBook?.coverImage}
              onClose={() => setPreviewSlideshow(null)}
            />
          );
        })()}
      </div>
    </div>
  );
}
