"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface ExcerptSlide {
  id: string;
  type: "text-overlay" | "image" | "cover";
  imageData?: string;
  overlayText?: string;
  label?: string;
}

interface Excerpt {
  id: string;
  name: string;
  bookId?: string; // optional link to a book for grouping
  slides: ExcerptSlide[];
}

interface Book {
  id: string;
  name: string;
  coverImage?: string;
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
  const [editingSlide, setEditingSlide] = useState<ExcerptSlide | null>(null);

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
      const [exRes, bkRes] = await Promise.all([
        fetch(`/api/excerpts?password=${encodeURIComponent(password)}`),
        fetch(`/api/books?password=${encodeURIComponent(password)}`),
      ]);
      if (exRes.ok) setExcerpts((await exRes.json()).excerpts || []);
      if (bkRes.ok) setBooks((await bkRes.json()).books || []);
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
    const ex: Excerpt = { id: uid(), name: name.trim(), slides: [] };
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
    if (!window.confirm("Delete this excerpt and all its slides?")) return;
    persist(excerpts.filter((e) => e.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function moveSlide(excerptId: string, slideIndex: number, dir: -1 | 1) {
    updateExcerpt(excerptId, (ex) => {
      const slides = [...ex.slides];
      const target = slideIndex + dir;
      if (target < 0 || target >= slides.length) return ex;
      [slides[slideIndex], slides[target]] = [slides[target], slides[slideIndex]];
      return { ...ex, slides };
    });
  }

  function deleteSlide(excerptId: string, slideId: string) {
    if (!window.confirm("Delete this slide?")) return;
    updateExcerpt(excerptId, (ex) => ({
      ...ex,
      slides: ex.slides.filter((s) => s.id !== slideId),
    }));
  }

  function saveSlide(slide: ExcerptSlide) {
    if (!activeId) return;
    updateExcerpt(activeId, (ex) => {
      const exists = ex.slides.some((s) => s.id === slide.id);
      return {
        ...ex,
        slides: exists
          ? ex.slides.map((s) => (s.id === slide.id ? slide : s))
          : [...ex.slides, slide],
      };
    });
    setEditingSlide(null);
  }

  const active = excerpts.find((e) => e.id === activeId);

  // Group excerpts by book for sidebar
  const bookName = (bookId?: string) =>
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
  // Books first (alphabetical), then ungrouped at the end
  const bookIds = [...byBook.keys()]
    .filter((k) => k !== undefined)
    .sort((a, b) => (bookName(a) || "").localeCompare(bookName(b) || ""));
  for (const bid of bookIds) {
    grouped.push({ label: bookName(bid) || "Unknown book", bookId: bid, items: byBook.get(bid)! });
  }
  if (byBook.has(undefined)) {
    grouped.push({ label: "Ungrouped", bookId: undefined, items: byBook.get(undefined)! });
  }

  if (!password) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white">
      <div className="mx-auto w-full max-w-5xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p>
            <strong>Excerpts</strong> — build mixed-media slideshows combining
            photos, book excerpts, and covers.
          </p>
          <p>
            Each excerpt is an ordered set of slides. A slide can be a{" "}
            <strong>photo with text overlay</strong> (e.g. a hook line on a
            lifestyle image), a <strong>pre-uploaded image</strong> (e.g. a
            screenshot of a book page), or a <strong>book cover</strong>.
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
                        {e.slides.length} slide
                        {e.slides.length === 1 ? "" : "s"}
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
                  Select an excerpt to manage its slides.
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
                  <div className="mb-5">
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
                      <option value="">No book (ungrouped)</option>
                      {books.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Slide list */}
                  <div className="space-y-3 mb-4">
                    {active.slides.map((slide, i) => (
                      <div
                        key={slide.id}
                        className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                      >
                        <div className="flex items-start gap-3">
                          {/* Thumbnail */}
                          <div className="shrink-0">
                            {slide.imageData ? (
                              <img
                                src={slide.imageData}
                                alt=""
                                className="w-12 h-16 rounded-lg object-cover border border-zinc-700"
                              />
                            ) : (
                              <div className="w-12 h-16 rounded-lg border border-dashed border-zinc-700 flex items-center justify-center">
                                <span className="text-zinc-600 text-xs">
                                  {slide.type === "cover"
                                    ? "CVR"
                                    : slide.type === "image"
                                    ? "IMG"
                                    : "TXT"}
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                {slide.type === "text-overlay"
                                  ? "Text overlay"
                                  : slide.type === "image"
                                  ? "Image"
                                  : "Cover"}
                              </span>
                              <span className="text-xs text-zinc-600">
                                Slide {i + 1}
                              </span>
                            </div>
                            {slide.label && (
                              <div className="text-sm text-zinc-300 truncate">
                                {slide.label}
                              </div>
                            )}
                            {slide.overlayText && (
                              <p className="text-xs text-zinc-500 truncate mt-0.5">
                                {slide.overlayText}
                              </p>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex flex-col gap-1 shrink-0">
                            <div className="flex gap-1">
                              <button
                                onClick={() => moveSlide(active.id, i, -1)}
                                disabled={i === 0}
                                className="text-xs text-zinc-500 hover:text-white disabled:text-zinc-800 disabled:cursor-not-allowed transition-colors"
                              >
                                ↑
                              </button>
                              <button
                                onClick={() => moveSlide(active.id, i, 1)}
                                disabled={i === active.slides.length - 1}
                                className="text-xs text-zinc-500 hover:text-white disabled:text-zinc-800 disabled:cursor-not-allowed transition-colors"
                              >
                                ↓
                              </button>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setEditingSlide(slide)}
                                className="text-xs text-zinc-400 hover:text-white transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteSlide(active.id, slide.id)}
                                className="text-xs text-red-500 hover:text-red-400 transition-colors"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {active.slides.length === 0 && (
                    <p className="text-zinc-600 text-sm mb-4">
                      No slides yet. Add your first slide below.
                    </p>
                  )}

                  <button
                    onClick={() =>
                      setEditingSlide({
                        id: uid(),
                        type: "text-overlay",
                      })
                    }
                    className="w-full px-5 py-3 rounded-lg border border-dashed border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors text-sm font-medium"
                  >
                    + Add slide
                  </button>
                </>
              )}
            </main>
          </div>
        )}
      </div>

      {/* Slide editor modal */}
      {editingSlide && (
        <SlideEditorModal
          slide={editingSlide}
          password={password || ""}
          onSave={saveSlide}
          onCancel={() => setEditingSlide(null)}
        />
      )}
    </div>
  );
}

function SlideEditorModal({
  slide: initial,
  password,
  onSave,
  onCancel,
}: {
  slide: ExcerptSlide;
  password: string;
  onSave: (slide: ExcerptSlide) => void;
  onCancel: () => void;
}) {
  const [slide, setSlide] = useState<ExcerptSlide>(initial);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState("");

  function handleFileUpload() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        setSlide((s) => ({ ...s, imageData: dataUrl }));
      } catch {
        window.alert("Failed to read image.");
      }
      setUploading(false);
    };
    input.click();
  }

  async function handleUrlFetch() {
    if (!urlInput.trim()) return;
    setUploading(true);
    try {
      const res = await fetch("/api/fetch-image-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-password": password,
        },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = await res.json();
      if (data.coverData) {
        setSlide((s) => ({ ...s, imageData: data.coverData }));
        setUrlInput("");
      } else {
        window.alert("Could not fetch image from URL.");
      }
    } catch {
      window.alert("Failed to fetch image.");
    }
    setUploading(false);
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">
          {initial.imageData || initial.overlayText || initial.label
            ? "Edit slide"
            : "New slide"}
        </h3>

        {/* Type selector */}
        <label className="block text-xs font-medium text-zinc-400 mb-2">
          Slide type
        </label>
        <div className="flex gap-2 mb-5">
          {(
            [
              ["text-overlay", "Text overlay"],
              ["image", "Image only"],
              ["cover", "Cover"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSlide((s) => ({ ...s, type: value }))}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                slide.type === value
                  ? "bg-white text-black"
                  : "border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Label */}
        <label className="block text-xs font-medium text-zinc-400 mb-1">
          Label (optional)
        </label>
        <input
          value={slide.label || ""}
          onChange={(e) => setSlide((s) => ({ ...s, label: e.target.value }))}
          placeholder="e.g. Hook slide, Page 42 excerpt"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-white/20"
        />

        {/* Overlay text — only for text-overlay */}
        {slide.type === "text-overlay" && (
          <>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Overlay text
            </label>
            <textarea
              value={slide.overlayText || ""}
              onChange={(e) =>
                setSlide((s) => ({ ...s, overlayText: e.target.value }))
              }
              rows={3}
              placeholder="e.g. Why are you blushing? It's only a book."
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </>
        )}

        {/* Image upload */}
        <label className="block text-xs font-medium text-zinc-400 mb-2">
          Image
        </label>
        {slide.imageData ? (
          <div className="mb-4">
            <img
              src={slide.imageData}
              alt="Slide preview"
              className="w-full max-h-48 object-contain rounded-lg border border-zinc-800 mb-2"
            />
            <button
              onClick={() => setSlide((s) => ({ ...s, imageData: undefined }))}
              className="text-xs text-red-500 hover:text-red-400"
            >
              Remove image
            </button>
          </div>
        ) : (
          <div className="mb-4 space-y-3">
            <button
              onClick={handleFileUpload}
              disabled={uploading}
              className="w-full px-4 py-3 rounded-lg border border-dashed border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors text-sm disabled:opacity-40"
            >
              {uploading ? "Uploading…" : "Upload image"}
            </button>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-zinc-800" />
              <span className="text-xs text-zinc-600">or</span>
              <div className="flex-1 h-px bg-zinc-800" />
            </div>
            <div className="flex gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste image URL"
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20 placeholder:text-zinc-600"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleUrlFetch();
                }}
              />
              <button
                onClick={handleUrlFetch}
                disabled={!urlInput.trim() || uploading}
                className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-40"
              >
                Fetch
              </button>
            </div>
          </div>
        )}

        {/* Save / Cancel */}
        <div className="flex gap-3 justify-end mt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(slide)}
            className="px-4 py-2 rounded-lg bg-white text-black font-semibold hover:bg-zinc-200 transition-colors text-sm"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
