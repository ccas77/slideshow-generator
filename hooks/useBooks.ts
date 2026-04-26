"use client";

import { useState, useCallback, useEffect } from "react";
import type { Book, Slideshow } from "@/types";

export function useBooks(authed: boolean, password: string) {
  const [books, setBooks] = useState<Book[]>([]);

  const fetchBooks = useCallback(async () => {
    if (!authed) return;
    try {
      const res = await fetch(
        `/api/books?password=${encodeURIComponent(password)}`
      );
      if (res.ok) {
        const data = await res.json();
        setBooks(data.books || []);
      }
    } catch {}
  }, [authed, password]);

  useEffect(() => {
    if (authed) fetchBooks();
  }, [authed, fetchBooks]);

  async function saveBooks(next: Book[]) {
    setBooks(next);
    try {
      await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, books: next }),
      });
    } catch {}
  }

  function loadSlideshowIntoEditor(
    s: Slideshow,
    book: Book | undefined,
    setImagePrompt: (v: string) => void,
    setBulkText: (v: string) => void,
    setCaption: (v: string) => void,
    setSelectedBookId: (v: string | null) => void
  ) {
    const firstPrompt =
      book?.imagePrompts.find((p) => s.imagePromptIds.includes(p.id)) ||
      book?.imagePrompts[0];
    const firstCaption =
      book?.captions.find((c) => s.captionIds.includes(c.id)) ||
      book?.captions[0];
    setImagePrompt(firstPrompt?.value || "");
    setBulkText(s.slideTexts);
    setCaption(firstCaption?.value || "");
    setSelectedBookId(book?.id || null);
  }

  return { books, saveBooks, loadSlideshowIntoEditor };
}
