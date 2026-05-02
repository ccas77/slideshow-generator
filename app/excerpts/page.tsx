"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface ExcerptImage {
  id: string;
  imageData: string; // base64 data URL
  label?: string;
}

interface Excerpt {
  id: string;
  name: string;
  bookId?: string;
  imagePrompts: string[];  // AI prompts for hook image (random pick)
  overlayTexts: string[];  // hook texts on the hook image (random pick)
  excerptImages: ExcerptImage[]; // uploaded book page screenshots
}

interface GeneratedSlide {
  label: string;
  imageData: string;
}

interface Book {
  id: string;
  name: string;
  coverImage?: string;
}

interface TikTokAccount {
  id: number;
  username: string;
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function ExcerptsPage() {
  const router = useRouter();
  const [password, setPassword] = useState<string | null>(null);
  const [excerpts, setExcerpts] = useState<Excerpt[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [igAccounts, setIgAccounts] = useState<TikTokAccount[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  // Generate + post flow
  const [generatedSlides, setGeneratedSlides] = useState<GeneratedSlide[] | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

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
      const [exRes, bkRes, ttRes, igRes] = await Promise.all([
        fetch(`/api/excerpts?password=${encodeURIComponent(password)}`),
        fetch(`/api/books?password=${encodeURIComponent(password)}`),
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=tiktok`),
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=instagram`),
      ]);
      if (exRes.ok) {
        const raw = (await exRes.json()).excerpts || [];
        setExcerpts(raw.map((e: Excerpt & { imagePrompt?: string; overlayText?: string }) => ({
          ...e,
          imagePrompts: e.imagePrompts?.length ? e.imagePrompts : e.imagePrompt ? [e.imagePrompt] : [],
          overlayTexts: e.overlayTexts?.length ? e.overlayTexts : e.overlayText ? [e.overlayText] : [],
          excerptImages: e.excerptImages || [],
        })));
      }
      if (bkRes.ok) setBooks((await bkRes.json()).books || []);
      if (ttRes.ok) setAccounts((await ttRes.json()).accounts || []);
      if (igRes.ok) setIgAccounts((await igRes.json()).accounts || []);
    } catch (e) {
      console.error("Excerpts fetch error:", e);
    }
    setLoading(false);
  }, [password]);

  useEffect(() => {
    if (password) load();
  }, [password, load]);

  const persist = useCallback(
    async (next: Excerpt[]) => {
      if (!password) return;
      setSaving(true);
      setExcerpts(next);
      try {
        const res = await fetch("/api/excerpts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, excerpts: next }),
        });
        if (!res.ok) {
          const text = await res.text();
          console.error("Excerpts save failed:", res.status, text);
          window.alert(`Save failed: ${res.status} ${text}`);
        }
      } catch (e) {
        console.error("Excerpts save error:", e);
        window.alert("Save failed — check console for details.");
      }
      setSaving(false);
    },
    [password]
  );

  function updateExcerpt(id: string, updater: (e: Excerpt) => Excerpt) {
    persist(excerpts.map((e) => (e.id === id ? updater(e) : e)));
  }

  function createExcerpt() {
    const name = window.prompt("Excerpt name:");
    if (!name?.trim()) return;
    const ex: Excerpt = {
      id: uid(),
      name: name.trim(),
      imagePrompts: [],
      overlayTexts: [],
      excerptImages: [],
    };
    persist([...excerpts, ex]);
    setActiveId(ex.id);
  }

  function renameExcerpt(id: string) {
    const ex = excerpts.find((e) => e.id === id);
    if (!ex) return;
    const name = window.prompt("Excerpt name:", ex.name);
    if (!name?.trim()) return;
    updateExcerpt(id, (e) => ({ ...e, name: name.trim() }));
  }

  function deleteExcerpt(id: string) {
    if (!window.confirm("Delete this excerpt?")) return;
    persist(excerpts.filter((e) => e.id !== id));
    if (activeId === id) setActiveId(null);
  }

  async function extractPromptFromImage(imageData: string, excerptId: string) {
    setExtracting(true);
    try {
      const res = await fetch("/api/extract-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-password": password || "" },
        body: JSON.stringify({ imageData }),
      });
      const data = await res.json();
      if (res.ok && data.prompt) {
        updateExcerpt(excerptId, (ex) => ({ ...ex, imagePrompts: [...ex.imagePrompts, data.prompt] }));
      } else {
        window.alert(data.error || "Failed to extract prompt");
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed");
    }
    setExtracting(false);
  }

  function uploadAndExtractPrompt(excerptId: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      await extractPromptFromImage(dataUrl, excerptId);
    };
    input.click();
  }

  async function extractPromptFromUrl(excerptId: string) {
    if (!imageUrl.trim()) return;
    setExtracting(true);
    try {
      const fetchRes = await fetch("/api/fetch-image-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-password": password || "" },
        body: JSON.stringify({ url: imageUrl.trim() }),
      });
      const fetchData = await fetchRes.json();
      if (!fetchRes.ok || !fetchData.coverData) {
        window.alert(fetchData.error || "Failed to fetch image");
        setExtracting(false);
        return;
      }
      const res = await fetch("/api/extract-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-password": password || "" },
        body: JSON.stringify({ imageData: fetchData.coverData }),
      });
      const data = await res.json();
      if (res.ok && data.prompt) {
        updateExcerpt(excerptId, (ex) => ({ ...ex, imagePrompts: [...ex.imagePrompts, data.prompt] }));
        setImageUrl("");
      } else {
        window.alert(data.error || "Failed to extract prompt");
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed");
    }
    setExtracting(false);
  }

  function addExcerptImage(excerptId: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      const newImages: ExcerptImage[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        newImages.push({
          id: uid(),
          imageData: dataUrl,
          label: file.name.replace(/\.[^.]+$/, ""),
        });
      }
      updateExcerpt(excerptId, (ex) => ({
        ...ex,
        excerptImages: [...ex.excerptImages, ...newImages],
      }));
    };
    input.click();
  }

  function removeExcerptImage(excerptId: string, imageId: string) {
    updateExcerpt(excerptId, (ex) => ({
      ...ex,
      excerptImages: ex.excerptImages.filter((img) => img.id !== imageId),
    }));
  }

  function moveExcerptImage(excerptId: string, index: number, dir: -1 | 1) {
    updateExcerpt(excerptId, (ex) => {
      const images = [...ex.excerptImages];
      const target = index + dir;
      if (target < 0 || target >= images.length) return ex;
      [images[index], images[target]] = [images[target], images[index]];
      return { ...ex, excerptImages: images };
    });
  }

  async function generateSlideshow() {
    if (!active) return;
    setGenerating(true);
    setGeneratedSlides(null);
    setGenerationId(null);
    setPostResult(null);
    setPreviewIndex(0);
    try {
      const res = await fetch("/api/excerpt-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-password": password || "" },
        body: JSON.stringify({ excerptId: active.id }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        window.alert(`Server returned ${res.status} — ${text.slice(0, 200)}`);
        setGenerating(false);
        return;
      }
      if (res.ok && data.slides) {
        setGeneratedSlides(data.slides as GeneratedSlide[]);
        setGenerationId(data.generationId as string);
      } else {
        window.alert(data.error || "Generation failed");
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
    setGenerating(false);
  }

  async function postSlideshow(accountId: number, platform: "tiktok" | "instagram", scheduledAt?: string) {
    if (!generationId) return;
    setPosting(true);
    setPostResult(null);
    try {
      const res = await fetch("/api/excerpt-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-password": password || "" },
        body: JSON.stringify({
          generationId,
          accountIds: [accountId],
          platform,
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        setPostResult(`Error: Server returned ${res.status} — ${text.slice(0, 200)}`);
        setPosting(false);
        return;
      }
      if (res.ok) {
        setPostResult(`Posted ${data.slides} slides [post:${data.postId}]`);
      } else {
        setPostResult(`Error: ${data.error}`);
      }
    } catch (e) {
      setPostResult(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    }
    setPosting(false);
  }

  const active = excerpts.find((e) => e.id === activeId);
  const activeBook = active?.bookId
    ? books.find((b) => b.id === active.bookId)
    : undefined;

  // Group excerpts by book for sidebar
  const getBookName = (bookId?: string) =>
    books.find((b) => b.id === bookId)?.name;
  const filtered = excerpts.filter((e) =>
    e.name.toLowerCase().includes(search.toLowerCase())
  );
  const grouped: { label: string; bookId: string | undefined; items: Excerpt[] }[] = [];
  const byBook = new Map<string | undefined, Excerpt[]>();
  for (const e of filtered) {
    const key = e.bookId || undefined;
    if (!byBook.has(key)) byBook.set(key, []);
    byBook.get(key)!.push(e);
  }
  const bookIds = [...byBook.keys()]
    .filter((k) => k !== undefined)
    .sort((a, b) => (getBookName(a) || "").localeCompare(getBookName(b) || ""));
  for (const bid of bookIds) {
    grouped.push({ label: getBookName(bid) || "Unknown book", bookId: bid, items: byBook.get(bid)! });
  }
  if (byBook.has(undefined)) {
    grouped.push({ label: "Ungrouped", bookId: undefined, items: byBook.get(undefined)! });
  }

  if (!password) return null;

  const slideCount = (ex: Excerpt) =>
    1 + ex.excerptImages.length + (ex.bookId && books.find((b) => b.id === ex.bookId)?.coverImage ? 1 : 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white">
      <div className="mx-auto w-full max-w-5xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p>
            <strong>Excerpts</strong> — build mixed-media slideshows from book
            passages.
          </p>
          <p>
            Each excerpt has three parts: a <strong>hook slide</strong>{" "}
            (AI-generated image with overlay text), one or more{" "}
            <strong>excerpt images</strong> (uploaded screenshots of book
            pages), and the <strong>book cover</strong> as the final slide.
          </p>
        </HowItWorks>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Excerpts</h1>
          <div className="flex items-center gap-3">
            {saving && (
              <span className="text-xs text-zinc-500">Saving…</span>
            )}
            <button
              onClick={createExcerpt}
              className="px-4 py-2 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm"
            >
              + New excerpt
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-zinc-500">Loading…</p>
        ) : excerpts.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center">
            <p className="text-zinc-400 mb-4">No excerpts yet.</p>
            <button
              onClick={createExcerpt}
              className="px-5 py-2 rounded-lg bg-white text-black font-semibold text-sm"
            >
              Create your first excerpt
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
            {/* Sidebar */}
            <aside className="space-y-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search excerpts..."
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-white/20 placeholder:text-zinc-600"
              />
              {grouped.map((group) => (
                <div key={group.bookId ?? "__ungrouped"}>
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 px-2 pt-3 pb-1">
                    {group.label}
                  </div>
                  {group.items.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setActiveId(e.id)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-colors mb-1 ${
                        activeId === e.id
                          ? "border-white bg-zinc-900 text-white"
                          : "border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700"
                      }`}
                    >
                      <div className="font-medium text-sm truncate">
                        {e.name}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {slideCount(e)} slide{slideCount(e) === 1 ? "" : "s"}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </aside>

            {/* Main panel */}
            <main className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
              {!active ? (
                <p className="text-zinc-500 text-sm">
                  Select an excerpt to edit it.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="text-xl font-semibold">{active.name}</h2>
                    <div className="flex gap-2">
                      <button
                        onClick={() => renameExcerpt(active.id)}
                        className="text-xs text-zinc-500 hover:text-white transition-colors"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => deleteExcerpt(active.id)}
                        className="text-xs text-red-500 hover:text-red-400 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Book selector */}
                  <div className="mb-6">
                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                      Book
                    </label>
                    <select
                      value={active.bookId || ""}
                      onChange={(e) =>
                        updateExcerpt(active.id, (ex) => ({
                          ...ex,
                          bookId: e.target.value || undefined,
                        }))
                      }
                      className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 w-full sm:w-auto"
                    >
                      <option value="">Select a book...</option>
                      {books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* SLIDE 1: Hook */}
                  <Section number={1} title="Hook slide" subtitle="AI-generated image with overlay text (random pick each generate)">
                    {/* Image prompts */}
                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Image prompts ({active.imagePrompts.length})
                    </label>
                    {active.imagePrompts.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {active.imagePrompts.map((p, i) => (
                          <div key={i} className="flex gap-2">
                            <textarea
                              value={p}
                              onChange={(e) => {
                                const next = [...active.imagePrompts];
                                next[i] = e.target.value;
                                updateExcerpt(active.id, (ex) => ({ ...ex, imagePrompts: next }));
                              }}
                              rows={2}
                              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                            <button
                              onClick={() => updateExcerpt(active.id, (ex) => ({ ...ex, imagePrompts: ex.imagePrompts.filter((_, j) => j !== i) }))}
                              className="text-xs text-red-500 hover:text-red-400 shrink-0 self-start mt-2"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 mb-4">
                      <button
                        onClick={() => updateExcerpt(active.id, (ex) => ({ ...ex, imagePrompts: [...ex.imagePrompts, ""] }))}
                        className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                      >
                        + Add prompt
                      </button>
                      <button
                        onClick={() => uploadAndExtractPrompt(active.id)}
                        disabled={extracting}
                        className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40"
                      >
                        {extracting ? "Extracting..." : "Extract from image"}
                      </button>
                    </div>
                    <div className="flex gap-2 mb-4">
                      <input
                        type="text"
                        value={imageUrl}
                        onChange={(e) => setImageUrl(e.target.value)}
                        placeholder="Paste image URL to extract prompt..."
                        className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder:text-zinc-600"
                      />
                      <button
                        onClick={() => extractPromptFromUrl(active.id)}
                        disabled={extracting || !imageUrl.trim()}
                        className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 shrink-0"
                      >
                        Extract
                      </button>
                    </div>

                    {/* Overlay texts (hooks) */}
                    <label className="block text-xs font-medium text-zinc-400 mb-1">
                      Hook texts ({active.overlayTexts.length})
                    </label>
                    {active.overlayTexts.length > 0 && (
                      <div className="space-y-2 mb-3">
                        {active.overlayTexts.map((t, i) => (
                          <div key={i} className="flex gap-2">
                            <input
                              type="text"
                              value={t}
                              onChange={(e) => {
                                const next = [...active.overlayTexts];
                                next[i] = e.target.value;
                                updateExcerpt(active.id, (ex) => ({ ...ex, overlayTexts: next }));
                              }}
                              placeholder='e.g. Why are you blushing? It&apos;s only a book.'
                              className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder:text-zinc-600"
                            />
                            <button
                              onClick={() => updateExcerpt(active.id, (ex) => ({ ...ex, overlayTexts: ex.overlayTexts.filter((_, j) => j !== i) }))}
                              className="text-xs text-red-500 hover:text-red-400 shrink-0"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => updateExcerpt(active.id, (ex) => ({ ...ex, overlayTexts: [...ex.overlayTexts, ""] }))}
                      className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      + Add hook text
                    </button>
                  </Section>

                  {/* SLIDES 2+: Excerpt images */}
                  <Section
                    number={2}
                    title="Excerpt images"
                    subtitle="Uploaded screenshots of book pages"
                  >
                    {active.excerptImages.length > 0 && (
                      <div className="space-y-3 mb-4">
                        {active.excerptImages.map((img, i) => (
                          <div
                            key={img.id}
                            className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-3"
                          >
                            <img
                              src={img.imageData}
                              alt=""
                              className="w-16 h-20 rounded-lg object-cover border border-zinc-700 shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-zinc-300 truncate">
                                {img.label || `Image ${i + 1}`}
                              </div>
                              <div className="text-xs text-zinc-600 mt-0.5">
                                Slide {i + 2}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              <div className="flex gap-1">
                                <button
                                  onClick={() =>
                                    moveExcerptImage(active.id, i, -1)
                                  }
                                  disabled={i === 0}
                                  className="text-xs text-zinc-500 hover:text-white disabled:text-zinc-800 disabled:cursor-not-allowed transition-colors"
                                >
                                  ↑
                                </button>
                                <button
                                  onClick={() =>
                                    moveExcerptImage(active.id, i, 1)
                                  }
                                  disabled={
                                    i === active.excerptImages.length - 1
                                  }
                                  className="text-xs text-zinc-500 hover:text-white disabled:text-zinc-800 disabled:cursor-not-allowed transition-colors"
                                >
                                  ↓
                                </button>
                              </div>
                              <button
                                onClick={() =>
                                  removeExcerptImage(active.id, img.id)
                                }
                                className="text-xs text-red-500 hover:text-red-400 transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => addExcerptImage(active.id)}
                      className="w-full px-4 py-3 rounded-lg border border-dashed border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors text-sm"
                    >
                      + Upload excerpt image{active.excerptImages.length > 0 ? "s" : ""}
                    </button>
                  </Section>

                  {/* FINAL SLIDE: Cover */}
                  <Section
                    number={active.excerptImages.length + 2}
                    title="Book cover"
                    subtitle="Pulled automatically from the selected book"
                  >
                    {!active.bookId ? (
                      <p className="text-xs text-zinc-600">
                        Select a book above to use its cover as the final slide.
                      </p>
                    ) : activeBook?.coverImage ? (
                      <div className="flex items-center gap-3">
                        <img
                          src={activeBook.coverImage}
                          alt="Book cover"
                          className="w-12 h-[72px] rounded-lg object-cover border border-zinc-700"
                        />
                        <span className="text-sm text-zinc-400">
                          {activeBook.name} cover
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-600">
                        No cover image set for {activeBook?.name || "this book"}.
                        Upload one on the Books page.
                      </p>
                    )}
                  </Section>

                  {/* Generate & Post */}
                  <div className="mt-8 pt-6 border-t border-zinc-800">
                    <h3 className="text-sm font-semibold mb-3">Generate & Post</h3>

                    <button
                      onClick={generateSlideshow}
                      disabled={generating || active.imagePrompts.length === 0}
                      className="px-5 py-2.5 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm disabled:opacity-40"
                    >
                      {generating ? "Generating..." : "Generate Slideshow"}
                    </button>

                    {generatedSlides && (
                      <div className="mt-5 space-y-4">
                        {/* Preview carousel */}
                        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-zinc-400">
                              Slide {previewIndex + 1} of {generatedSlides.length} — {generatedSlides[previewIndex].label}
                            </span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                                disabled={previewIndex === 0}
                                className="text-xs text-zinc-500 hover:text-white disabled:text-zinc-800 transition-colors"
                              >
                                ← Prev
                              </button>
                              <button
                                onClick={() => setPreviewIndex((i) => Math.min(generatedSlides!.length - 1, i + 1))}
                                disabled={previewIndex === generatedSlides.length - 1}
                                className="text-xs text-zinc-500 hover:text-white disabled:text-zinc-800 transition-colors"
                              >
                                Next →
                              </button>
                            </div>
                          </div>
                          <img
                            src={generatedSlides[previewIndex].imageData}
                            alt={generatedSlides[previewIndex].label}
                            className="w-full max-w-[280px] mx-auto rounded-lg border border-zinc-700"
                          />
                        </div>

                        {/* Post controls */}
                        <div className="space-y-3">
                          <label className="text-xs text-zinc-400 block">Post to account</label>
                          <select
                            id="post-account"
                            defaultValue=""
                            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                          >
                            <option value="" disabled>Select account...</option>
                            {accounts.length > 0 && (
                              <optgroup label="TikTok">
                                {accounts.map((a) => (
                                  <option key={`tt-${a.id}`} value={`tiktok:${a.id}`}>@{a.username}</option>
                                ))}
                              </optgroup>
                            )}
                            {igAccounts.length > 0 && (
                              <optgroup label="Instagram">
                                {igAccounts.map((a) => (
                                  <option key={`ig-${a.id}`} value={`instagram:${a.id}`}>@{a.username}</option>
                                ))}
                              </optgroup>
                            )}
                          </select>

                          <div>
                            <label className="text-xs text-zinc-500 block mb-1">Schedule (optional)</label>
                            <input
                              id="post-schedule"
                              type="datetime-local"
                              className="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                            />
                          </div>

                          <button
                            onClick={() => {
                              const sel = (document.getElementById("post-account") as HTMLSelectElement).value;
                              if (!sel) { window.alert("Select an account"); return; }
                              const [platform, idStr] = sel.split(":");
                              const schedule = (document.getElementById("post-schedule") as HTMLInputElement).value;
                              postSlideshow(Number(idStr), platform as "tiktok" | "instagram", schedule || undefined);
                            }}
                            disabled={posting}
                            className="px-5 py-2.5 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm disabled:opacity-40"
                          >
                            {posting ? "Posting..." : "Post"}
                          </button>
                        </div>

                        {postResult && (
                          <div className={`text-sm p-3 rounded-lg ${postResult.startsWith("Error") ? "bg-red-900/30 text-red-400" : "bg-green-900/30 text-green-400"}`}>
                            {postResult}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  number,
  title,
  subtitle,
  children,
}: {
  number: number;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-400 text-xs font-semibold flex items-center justify-center shrink-0">
          {number}
        </span>
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-zinc-500">{subtitle}</div>
        </div>
      </div>
      <div className="ml-9">{children}</div>
    </div>
  );
}
