"use client";

import { useState, useCallback } from "react";
import type {
  TikTokAccount,
  GeneratedSlideshow,
  Book,
  NamedItem,
  Slideshow,
} from "@/types";
import { renderSlideToCanvas } from "@/lib/slide-utils";

interface PostNowTabProps {
  accounts: TikTokAccount[];
  accountId: number | null;
  setAccountId: (id: number | null) => void;
  selectedAccount: TikTokAccount | null;
  password: string;
  books: Book[];
  saveBooks: (next: Book[]) => Promise<void>;
  loadSlideshowIntoEditor: (
    s: Slideshow,
    book: Book | undefined,
    setImagePrompt: (v: string) => void,
    setBulkText: (v: string) => void,
    setCaption: (v: string) => void,
    setSelectedBookId: (v: string | null) => void
  ) => void;
  imagePrompt: string;
  setImagePrompt: (v: string) => void;
  bulkText: string;
  setBulkText: (v: string) => void;
  caption: string;
  setCaption: (v: string) => void;
  setAuthFailed: () => void;
}

export default function PostNowTab({
  accounts,
  accountId,
  setAccountId,
  selectedAccount,
  password,
  books,
  saveBooks,
  loadSlideshowIntoEditor,
  imagePrompt,
  setImagePrompt,
  bulkText,
  setBulkText,
  caption,
  setCaption,
  setAuthFailed,
}: PostNowTabProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slideshow, setSlideshow] = useState<GeneratedSlideshow | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [posting, setPosting] = useState(false);
  const [postStatus, setPostStatus] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  const slideCount = bulkText.split("\n").filter((t) => t.trim()).length;

  async function saveDraftToBook() {
    if (!imagePrompt.trim() || !bulkText.trim()) {
      window.alert("Need at least an image prompt and slide texts.");
      return;
    }
    const uid = () =>
      Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    // Re-fetch latest books from KV to avoid overwriting changes made on other pages
    const freshRes = await fetch(`/api/books?password=${encodeURIComponent(password)}`);
    let workingBooks: Book[] = freshRes.ok ? (await freshRes.json()).books || [] : books;
    let targetBookId: string;
    if (books.length === 0) {
      const bookName = window.prompt("No books yet. Name a new book:");
      if (!bookName?.trim()) return;
      targetBookId = uid();
      workingBooks = [
        ...workingBooks,
        {
          id: targetBookId,
          name: bookName.trim(),
          imagePrompts: [],
          captions: [],
          slideshows: [],
        },
      ];
    } else {
      const choice = window.prompt(
        `Save to which book? Enter a number:\n${books
          .map((b, i) => `${i + 1}. ${b.name}`)
          .join("\n")}\n\nOr type a new book name.`
      );
      if (!choice?.trim()) return;
      const asNum = Number(choice);
      if (!isNaN(asNum) && asNum >= 1 && asNum <= books.length) {
        targetBookId = books[asNum - 1].id;
      } else {
        targetBookId = uid();
        workingBooks = [
          ...workingBooks,
          {
            id: targetBookId,
            name: choice.trim(),
            imagePrompts: [],
            captions: [],
            slideshows: [],
          },
        ];
      }
    }
    const slideshowName = window.prompt("Name this slideshow:");
    if (!slideshowName?.trim()) return;

    const promptItem: NamedItem = {
      id: uid(),
      name: `${slideshowName.trim()} prompt`,
      value: imagePrompt,
    };
    const captionItem: NamedItem | null = caption.trim()
      ? { id: uid(), name: `${slideshowName.trim()} caption`, value: caption }
      : null;
    const newSlideshow: Slideshow = {
      id: uid(),
      name: slideshowName.trim(),
      slideTexts: bulkText,
      imagePromptIds: [promptItem.id],
      captionIds: captionItem ? [captionItem.id] : [],
    };
    const next = workingBooks.map((b) =>
      b.id === targetBookId
        ? {
            ...b,
            imagePrompts: [...b.imagePrompts, promptItem],
            captions: captionItem ? [...b.captions, captionItem] : b.captions,
            slideshows: [...b.slideshows, newSlideshow],
          }
        : b
    );
    await saveBooks(next);
    window.alert(`Saved "${newSlideshow.name}" to book.`);
  }

  async function generate() {
    const validTexts = bulkText.split("\n").filter((t) => t.trim());
    if (validTexts.length === 0 || !imagePrompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePrompt, texts: validTexts, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        if (res.status === 401) {
          setAuthFailed();
          return;
        }
        throw new Error(data.error || "Generation failed");
      }

      const data = await res.json();
      setSlideshow(data);
      setCurrentSlide(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const postToTikTok = useCallback(async () => {
    if (!slideshow || accountId == null) return;
    if (slideshow.texts.length < 2) {
      setPostStatus("TikTok carousels need at least 2 slides");
      return;
    }
    setPosting(true);
    setPostStatus(null);
    try {
      const mediaIds: string[] = [];
      const coverImage = selectedBookId
        ? books.find((b) => b.id === selectedBookId)?.coverImage
        : undefined;
      // If book has cover, drop the last text slide (book tag) since cover replaces it
      const textSlides = coverImage && slideshow.texts.length > 2
        ? slideshow.texts.slice(0, -1)
        : slideshow.texts;
      const totalSlides = textSlides.length + (coverImage ? 1 : 0);

      for (let i = 0; i < textSlides.length; i++) {
        setPostStatus(`Uploading slide ${i + 1} of ${totalSlides}...`);
        const canvas = await renderSlideToCanvas(slideshow.image, textSlides[i]);
        const dataUrl = canvas.toDataURL("image/png");

        const res = await fetch("/api/post-tiktok?action=upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, image: dataUrl, index: i }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Upload ${i + 1} failed`);
        mediaIds.push(data.media_id);
      }

      // Upload book cover as final slide
      if (coverImage) {
        setPostStatus(`Uploading cover slide ${totalSlides} of ${totalSlides}...`);
        const res = await fetch("/api/post-tiktok?action=upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, image: coverImage, index: textSlides.length }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Cover upload failed");
        mediaIds.push(data.media_id);
      }

      setPostStatus("Publishing...");
      const pubRes = await fetch("/api/post-tiktok?action=publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          caption,
          mediaIds,
          accountIds: [accountId],
        }),
      });
      const pubData = await pubRes.json();
      if (!pubRes.ok) throw new Error(pubData.error || "Publish failed");

      setPostStatus(`Posted to @${selectedAccount?.username}!`);
    } catch (err) {
      setPostStatus(err instanceof Error ? err.message : "Posting failed");
    } finally {
      setPosting(false);
    }
  }, [slideshow, password, caption, accountId, selectedAccount, selectedBookId, books]);

  const downloadAll = useCallback(async () => {
    if (!slideshow) return;
    setDownloading(true);
    for (let i = 0; i < slideshow.texts.length; i++) {
      const canvas = await renderSlideToCanvas(slideshow.image, slideshow.texts[i]);
      const link = document.createElement("a");
      link.download = `slide-${i + 1}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      await new Promise((r) => setTimeout(r, 300));
    }
    setDownloading(false);
  }, [slideshow]);

  // Preview computed values
  const previewCover = selectedBookId
    ? books.find((b) => b.id === selectedBookId)?.coverImage
    : undefined;
  const previewTexts = slideshow
    ? (previewCover && slideshow.texts.length > 2
        ? slideshow.texts.slice(0, -1)
        : slideshow.texts)
    : [];
  const totalPreviewSlides = previewTexts.length + (previewCover ? 1 : 0);
  const isCoverSlide = previewCover && currentSlide === totalPreviewSlides - 1;

  return (
    <section className="space-y-6">
      {/* Account selector for posting */}
      <div className="rounded-2xl border border-stone-200 bg-white/70 p-6">
        <label className="block text-sm font-medium text-stone-600 mb-2">
          Post to account
        </label>
        {accounts.length === 0 ? (
          <p className="text-sm text-stone-500">Loading accounts…</p>
        ) : (
          <select
            value={accountId ?? ""}
            onChange={(e) =>
              setAccountId(e.target.value ? Number(e.target.value) : null)
            }
            className="w-full rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/15"
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
        )}
      </div>

      {/* Library actions */}
      <div className="rounded-2xl border border-stone-200 bg-white/70 p-5 space-y-3">
        <div className="text-sm text-stone-600">Library:</div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedBookId || ""}
            onChange={(e) => setSelectedBookId(e.target.value || null)}
            className="rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
          >
            <option value="">Select a book…</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {selectedBookId && (() => {
            const book = books.find((b) => b.id === selectedBookId);
            if (!book || book.slideshows.length === 0) return <span className="text-xs text-stone-500">No slideshows</span>;
            return (
              <select
                value=""
                onChange={(e) => {
                  const s = book.slideshows.find((x) => x.id === e.target.value);
                  if (s) loadSlideshowIntoEditor(s, book, setImagePrompt, setBulkText, setCaption, setSelectedBookId);
                }}
                className="rounded-lg border border-stone-200 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
              >
                <option value="">Select a slideshow…</option>
                {book.slideshows.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            );
          })()}
          <button
            onClick={saveDraftToBook}
            className="px-4 py-2 rounded-lg border border-stone-300 text-stone-800 hover:bg-stone-100 transition-colors text-sm font-medium"
          >
            Save to book
          </button>
        </div>
      </div>

      {/* Image prompt */}
      <div className="rounded-2xl border border-stone-200 bg-white/70 p-6">
        <label className="block text-sm font-medium text-stone-700 mb-2">
          Background image prompt
        </label>
        <textarea
          value={imagePrompt}
          onChange={(e) => setImagePrompt(e.target.value)}
          placeholder="Describe the background image for all slides..."
          rows={3}
          className="w-full rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/15 resize-none"
        />
      </div>

      {/* Slide texts */}
      <div className="rounded-2xl border border-stone-200 bg-white/70 p-6">
        <label className="block text-sm font-medium text-stone-700 mb-2">
          Slide texts
        </label>
        <p className="text-xs text-stone-500 mb-3">
          One slide per line. Empty lines are ignored.
        </p>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={"First slide text\nSecond slide text\nThird slide text"}
          rows={8}
          className="w-full rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/15"
        />
        <p className="text-xs text-stone-400 mt-2">
          {slideCount} slide{slideCount !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Caption */}
      <div className="rounded-2xl border border-stone-200 bg-white/70 p-6">
        <label className="block text-sm font-medium text-stone-700 mb-2">
          TikTok caption
        </label>
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption that appears on the TikTok post..."
          rows={3}
          className="w-full rounded-lg border border-stone-200 bg-stone-100 px-4 py-3 text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/15 resize-none"
        />
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-100/70 border border-red-200 text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={generate}
        disabled={loading || !imagePrompt.trim() || slideCount === 0}
        className="w-full px-6 py-3 rounded-lg bg-stone-900 text-white font-semibold hover:bg-stone-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span
              className="inline-block w-4 h-4 border-2 border-stone-900/15 border-t-black rounded-full"
              style={{ animation: "spin 0.6s linear infinite" }}
            />
            Generating…
          </>
        ) : (
          "Generate slideshow"
        )}
      </button>

      {/* Preview + Post (appears after generation) */}
      {slideshow && (
        <div className="rounded-2xl border border-stone-200 bg-white/70 p-6 sm:p-8">
          <div className="flex flex-col items-center">
            {/* Slide frame */}
            <div
              className="relative rounded-2xl overflow-hidden shadow-2xl bg-stone-100"
              style={{
                width: "min(100%, 320px)",
                aspectRatio: "9 / 16",
                maxHeight: "60vh",
              }}
            >
              {isCoverSlide ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewCover}
                  alt="Book cover"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    background: "#000",
                  }}
                />
              ) : (
                <>
                  {slideshow.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={slideshow.image}
                      alt={imagePrompt}
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    // Stand-in for the AI image. Kept dark to match the posted
                    // slide, which renders on #18181b under a black scrim with
                    // white text (see lib/render-slide.ts, lib/slide-utils.ts).
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "linear-gradient(to bottom, #27272a, #18181b)",
                      }}
                    />
                  )}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(to top, rgba(0,0,0,0.85) 15%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.4) 100%)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "1.5rem",
                    }}
                  >
                    <p
                      style={{
                        fontSize: "1.4rem",
                        fontWeight: 700,
                        lineHeight: 1.3,
                        color: "white",
                        textShadow: "0 2px 8px rgba(0,0,0,0.5)",
                        textAlign: "center",
                      }}
                    >
                      {previewTexts[currentSlide]}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Prev / counter / Next */}
            <div className="flex items-center gap-4 mt-5">
              <button
                onClick={() => setCurrentSlide((i) => Math.max(0, i - 1))}
                disabled={currentSlide === 0}
                className="w-10 h-10 rounded-full border border-stone-300 text-stone-900 disabled:text-stone-300 disabled:border-stone-200 hover:bg-stone-100 transition-colors"
              >
                ‹
              </button>
              <div className="text-sm text-stone-600 tabular-nums">
                {currentSlide + 1} / {totalPreviewSlides}
              </div>
              <button
                onClick={() =>
                  setCurrentSlide((i) =>
                    Math.min(totalPreviewSlides - 1, i + 1)
                  )
                }
                disabled={currentSlide === totalPreviewSlides - 1}
                className="w-10 h-10 rounded-full border border-stone-300 text-stone-900 disabled:text-stone-300 disabled:border-stone-200 hover:bg-stone-100 transition-colors"
              >
                ›
              </button>
            </div>

            {/* Dots */}
            <div className="flex gap-2 mt-4 flex-wrap justify-center">
              {Array.from({ length: totalPreviewSlides }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentSlide(i)}
                  style={{
                    width: i === currentSlide ? 24 : 8,
                    height: 8,
                    borderRadius: 4,
                    border: "none",
                    background:
                      i === currentSlide ? "#1c1917" : "rgba(28,25,23,0.25)",
                    cursor: "pointer",
                    transition: "all 0.3s",
                  }}
                />
              ))}
            </div>

            {postStatus && (
              <div
                className={`mt-5 text-sm ${
                  postStatus.includes("Posted") ? "text-green-600" : "text-red-600"
                }`}
              >
                {postStatus}
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex flex-wrap justify-center gap-3 w-full">
              <button
                onClick={() => {
                  setSlideshow(null);
                  setPostStatus(null);
                  setCurrentSlide(0);
                }}
                className="px-5 py-2.5 rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-100 transition-colors text-sm font-medium"
              >
                Clear preview
              </button>
              <button
                onClick={downloadAll}
                disabled={downloading}
                className="px-5 py-2.5 rounded-lg bg-stone-100 text-stone-900 hover:bg-stone-200 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {downloading ? "Downloading…" : "Download all"}
              </button>
              <button
                onClick={postToTikTok}
                disabled={posting || accountId == null}
                className="px-5 py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, #ff0050, #00f2ea)",
                }}
              >
                {posting
                  ? "Posting…"
                  : accountId == null
                  ? "Select account to post"
                  : `Post to @${selectedAccount?.username ?? ""}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
