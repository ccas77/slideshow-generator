"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface TopBook {
  id: string;
  title: string;
  author: string;
  genre: string;
  coverData: string;
  pinned: boolean;
}

interface TimeWindow {
  start: string;
  end: string;
}

interface TopNAutomation {
  enabled: boolean;
  accountIds: number[]; // TikTok carousel accounts
  videoAccountIds?: number[]; // TikTok video accounts
  fbAccountIds?: number[]; // Facebook video accounts
  igCarouselAccountIds?: number[]; // Instagram carousel accounts
  igVideoAccountIds?: number[]; // Instagram video accounts
  intervals: TimeWindow[];
}

interface TopNAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  listIds: string[];
  pointer: number;
  frequencyDays: number;
  lastPostDate?: string;
  platform: "tiktok-carousel" | "tiktok-video" | "fb-video" | "ig-carousel" | "ig-video";
  backgroundPrompts?: string[];
}

interface TopNGlobalAutomation {
  accounts: Record<string, TopNAccountConfig>;
}

interface TopNList {
  id: string;
  name: string;
  titleTexts: string[];
  count: number;
  bookIds: string[];
  genres?: string[];
  captions: string[];
  backgroundPrompts: string[];
  musicTrackIds?: string[];
  automation?: TopNAutomation;
}

interface MusicTrack {
  id: string;
  name: string;
}

interface TikTokAccount {
  id: number;
  username: string;
}

export default function TopBooksPage() {
  const router = useRouter();
  const [password, setPassword] = useState<string | null>(null);
  const [books, setBooks] = useState<TopBook[]>([]);
  const [lists, setLists] = useState<TopNList[]>([]);
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [igAccounts, setIgAccounts] = useState<TikTokAccount[]>([]);
  const [fbAccounts, setFbAccounts] = useState<TikTokAccount[]>([]);
  const [loading, setLoading] = useState(false);

  // Book form
  const [showBookForm, setShowBookForm] = useState(false);
  const [editBookId, setEditBookId] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [bookPinned, setBookPinned] = useState(false);
  const [bookCover, setBookCover] = useState<string | null>(null);
  const [bookCoverPreview, setBookCoverPreview] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [bookGenre, setBookGenre] = useState("");
  const [bookUrl, setBookUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [fetchUrlError, setFetchUrlError] = useState("");
  const [genreFilter, setGenreFilter] = useState<string>("all");
  const [bookSearch, setBookSearch] = useState("");

  // Bulk genre tagging
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkGenre, setBulkGenre] = useState("");
  const [bulkAppend, setBulkAppend] = useState(true);

  // List form
  const [showListForm, setShowListForm] = useState(false);
  const [editListId, setEditListId] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [listTitles, setListTitles] = useState("");
  const [listCount, setListCount] = useState(10);
  const [listBookIds, setListBookIds] = useState<string[]>([]);
  const [listGenres, setListGenres] = useState<string[]>([]);
  const [listCaptions, setListCaptions] = useState("");
  const [listBgPrompts, setListBgPrompts] = useState("");
  const [listMusicTrackIds, setListMusicTrackIds] = useState<string[]>([]);

  // BookTok AI generation
  const [generatingBookTok, setGeneratingBookTok] = useState(false);
  const [bookTokError, setBookTokError] = useState<string | null>(null);

  // Publish
  const [publishListId, setPublishListId] = useState<string | null>(null);
  const [publishAccounts, setPublishAccounts] = useState<number[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);

  // Automation (per-account)
  const [topnAutoConfig, setTopnAutoConfig] = useState<TopNGlobalAutomation>({ accounts: {} });
  const [selectedTopnAccount, setSelectedTopnAccount] = useState<string | null>(null);
  const [savingAuto, setSavingAuto] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const [describingImage, setDescribingImage] = useState(false);
  const [bgImageUrl, setBgImageUrl] = useState("");
  const [bgPromptsText, setBgPromptsText] = useState("");
  useEffect(() => {
    const cfg = selectedTopnAccount ? topnAutoConfig.accounts[selectedTopnAccount] : null;
    setBgPromptsText((cfg?.backgroundPrompts || []).join("\n"));
  }, [selectedTopnAccount, topnAutoConfig]);

  // Music
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);

  // Preview
  const [previewListId, setPreviewListId] = useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [generatingVideoForList, setGeneratingVideoForList] = useState<string | null>(null);

  // Active tab
  const [tab, setTab] = useState<"books" | "lists" | "music" | "automation" | "overview">("books");

  useEffect(() => {
    const pw = localStorage.getItem("sg.password");
    if (!pw) { router.push("/"); return; }
    setPassword(pw);
  }, [router]);

  const headers = useCallback(() => {
    return { "Content-Type": "application/json", "x-password": password || "" };
  }, [password]);

  const load = useCallback(async () => {
    if (!password) return;
    setLoading(true);
    try {
      const [bRes, lRes, aRes, igRes, fbRes, autoRes, musicRes] = await Promise.all([
        fetch(`/api/top-books?password=${encodeURIComponent(password)}`),
        fetch(`/api/top-n-lists?password=${encodeURIComponent(password)}`),
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=tiktok`),
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=instagram`),
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=facebook`),
        fetch(`/api/topn-automation?password=${encodeURIComponent(password)}`),
        fetch(`/api/music-tracks?password=${encodeURIComponent(password)}`),
      ]);
      if (bRes.ok) setBooks((await bRes.json()).books || []);
      if (lRes.ok) setLists((await lRes.json()).lists || []);
      if (aRes.ok) setAccounts((await aRes.json()).accounts || []);
      if (igRes.ok) setIgAccounts((await igRes.json()).accounts || []);
      if (fbRes.ok) setFbAccounts((await fbRes.json()).accounts || []);
      if (musicRes.ok) setMusicTracks((await musicRes.json()).tracks || []);
      if (autoRes.ok) {
        const autoData = await autoRes.json();
        if (autoData.config) setTopnAutoConfig(autoData.config);
      }
    } catch {}
    setLoading(false);
  }, [password]);

  useEffect(() => { if (password) load(); }, [password, load]);

  useEffect(() => {
    const handler = () => { refreshAccounts(); };
    window.addEventListener("app:refresh-accounts", handler);
    return () => window.removeEventListener("app:refresh-accounts", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [password]);

  // ── Book CRUD ──

  function openBookForm(book?: TopBook) {
    if (book) {
      setEditBookId(book.id);
      setBookTitle(book.title);
      setBookAuthor(book.author);
      setBookGenre(book.genre || "");
      setBookPinned(book.pinned);
      setBookCover(null);
      setBookCoverPreview(book.coverData);
    } else {
      setEditBookId(null);
      setBookTitle("");
      setBookAuthor("");
      setBookGenre("");
      setBookPinned(false);
      setBookCover(null);
      setBookCoverPreview(null);
    }
    setBookUrl("");
    setShowBookForm(true);
  }

  async function fetchBookUrl() {
    if (!bookUrl.trim()) return;
    setFetchingUrl(true);
    setFetchUrlError("");
    try {
      // Fetch the image via our proxy endpoint
      const res = await fetch("/api/fetch-image-url", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ url: bookUrl.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.coverData) {
        setBookCover(data.coverData);
        setBookCoverPreview(data.coverData);
        // Auto-recognize title and author from the cover
        if (!bookTitle && !bookAuthor) {
          setRecognizing(true);
          try {
            const recRes = await fetch("/api/recognize-cover", {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ imageData: data.coverData }),
            });
            if (recRes.ok) {
              const recData = await recRes.json();
              if (recData.title) setBookTitle(recData.title);
              if (recData.author) setBookAuthor(recData.author);
            }
          } catch {}
          setRecognizing(false);
        }
      } else {
        setFetchUrlError(data.error || "Failed to fetch image");
      }
    } catch (e) {
      setFetchUrlError(e instanceof Error ? e.message : "Failed to fetch");
    }
    setFetchingUrl(false);
  }

  function handleCoverFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setBookCover(dataUrl);
      setBookCoverPreview(dataUrl);
      // Auto-recognize title and author if fields are empty
      if (!bookTitle && !bookAuthor) {
        setRecognizing(true);
        try {
          const res = await fetch("/api/recognize-cover", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ imageData: dataUrl }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.title) setBookTitle(data.title);
            if (data.author) setBookAuthor(data.author);
          }
        } catch {}
        setRecognizing(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveBook() {
    if (!bookTitle.trim()) return;
    if (!editBookId && !bookCover) return;
    setLoading(true);
    try {
      if (editBookId) {
        await fetch(`/api/top-books?password=${encodeURIComponent(password || "")}`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({
            id: editBookId,
            title: bookTitle,
            author: bookAuthor,
            genre: bookGenre,
            pinned: bookPinned,
            ...(bookCover ? { coverData: bookCover } : {}),
          }),
        });
      } else {
        await fetch(`/api/top-books?password=${encodeURIComponent(password || "")}`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            title: bookTitle,
            author: bookAuthor,
            genre: bookGenre,
            pinned: bookPinned,
            coverData: bookCover,
          }),
        });
      }
      setShowBookForm(false);
      await load();
    } catch {}
    setLoading(false);
  }

  async function deleteBook(id: string) {
    if (!window.confirm("Delete this book?")) return;
    await fetch(`/api/top-books?password=${encodeURIComponent(password || "")}&id=${id}`, {
      method: "DELETE",
    });
    await load();
  }

  async function togglePinned(book: TopBook) {
    await fetch(`/api/top-books?password=${encodeURIComponent(password || "")}`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ id: book.id, pinned: !book.pinned }),
    });
    await load();
  }

  async function bulkApplyGenre() {
    if (bulkSelected.size === 0 || !bulkGenre.trim()) return;
    setLoading(true);
    try {
      for (const bookId of bulkSelected) {
        const book = books.find((b) => b.id === bookId);
        if (!book) continue;
        let newGenre: string;
        if (bulkAppend) {
          const existing = book.genre ? book.genre.split(",").map((s) => s.trim()).filter(Boolean) : [];
          if (!existing.some((g) => g.toLowerCase() === bulkGenre.trim().toLowerCase())) {
            existing.push(bulkGenre.trim());
          }
          newGenre = existing.join(", ");
        } else {
          newGenre = bulkGenre.trim();
        }
        await fetch(`/api/top-books?password=${encodeURIComponent(password || "")}`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({ id: bookId, genre: newGenre }),
        });
      }
      setBulkMode(false);
      setBulkSelected(new Set());
      setBulkGenre("");
      await load();
    } catch {}
    setLoading(false);
  }

  // ── List CRUD ──

  function openListForm(list?: TopNList) {
    if (list) {
      setEditListId(list.id);
      setListName(list.name);
      setListTitles((list.titleTexts || []).join("\n"));
      setListCount(list.count);
      setListBookIds(list.bookIds);
      setListGenres(list.genres || []);
      setListCaptions((list.captions || []).join("\n\n"));
      setListBgPrompts((list.backgroundPrompts || []).join("\n"));
      setListMusicTrackIds(list.musicTrackIds || []);
    } else {
      setEditListId(null);
      setListName("");
      setListTitles("");
      setListCount(10);
      setListBookIds([]);
      setListGenres([]);
      setListCaptions("");
      setListBgPrompts("");
      setListMusicTrackIds([]);
    }
    setBookTokError(null);
    setShowListForm(true);
  }

  async function saveList() {
    const parsedTitles = listTitles.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!listName.trim() || parsedTitles.length === 0) return;
    const parsedCaptions = listCaptions.split("\n\n").map((s) => s.trim()).filter(Boolean);
    const parsedBgPrompts = listBgPrompts.split("\n").map((s) => s.trim()).filter(Boolean);
    const allLists = await (await fetch(`/api/top-n-lists?password=${encodeURIComponent(password || "")}`)).json();
    let updated = allLists.lists || [];
    if (editListId) {
      updated = updated.map((l: TopNList) =>
        l.id === editListId
          ? { ...l, name: listName, titleTexts: parsedTitles, count: listCount, bookIds: listBookIds, genres: listGenres, captions: parsedCaptions, backgroundPrompts: parsedBgPrompts, musicTrackIds: listMusicTrackIds }
          : l
      );
    } else {
      updated.push({
        id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        name: listName,
        titleTexts: parsedTitles,
        count: listCount,
        bookIds: listBookIds,
        genres: listGenres,
        captions: parsedCaptions,
        backgroundPrompts: parsedBgPrompts,
        musicTrackIds: listMusicTrackIds,
      });
    }
    await fetch(`/api/top-n-lists?password=${encodeURIComponent(password || "")}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ lists: updated }),
    });
    setShowListForm(false);
    await load();
  }

  async function generateBookTokContent() {
    const name = listName.trim();
    if (!name) {
      setBookTokError("Add a list name first.");
      return;
    }
    setBookTokError(null);
    setGeneratingBookTok(true);
    try {
      const existingTitles = listTitles.split("\n").map((s) => s.trim()).filter(Boolean);
      const existingCaptions = listCaptions.split("\n\n").map((s) => s.trim()).filter(Boolean);
      const existingImagePrompts = listBgPrompts.split("\n").map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/api/topn-booktok", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          listName: name,
          genre: listGenres.join(", "),
          existingTitles,
          existingCaptions,
          existingImagePrompts,
          quantity: 18,
          inHookBookCount: listCount,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      const newTitles: string[] = Array.isArray(data.titles) ? data.titles : [];
      const newCaptions: string[] = Array.isArray(data.captions) ? data.captions : [];
      const newImagePrompts: string[] = Array.isArray(data.imagePrompts) ? data.imagePrompts : [];

      if (newTitles.length) {
        setListTitles((prev) => {
          const base = prev.replace(/\s+$/, "");
          const joined = newTitles.join("\n");
          return base ? `${base}\n${joined}` : joined;
        });
      }
      if (newCaptions.length) {
        setListCaptions((prev) => {
          const base = prev.replace(/\s+$/, "");
          const joined = newCaptions.join("\n\n");
          return base ? `${base}\n\n${joined}` : joined;
        });
      }
      if (newImagePrompts.length) {
        setListBgPrompts((prev) => {
          const base = prev.replace(/\s+$/, "");
          const joined = newImagePrompts.join("\n");
          return base ? `${base}\n${joined}` : joined;
        });
      }
    } catch (err) {
      setBookTokError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setGeneratingBookTok(false);
    }
  }

  async function deleteList(id: string) {
    if (!window.confirm("Delete this list?")) return;
    await fetch(`/api/top-n-lists?password=${encodeURIComponent(password || "")}&id=${id}`, {
      method: "DELETE",
    });
    await load();
  }

  function toggleBookInList(bookId: string) {
    setListBookIds((prev) =>
      prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
    );
  }

  // ── Music ──

  async function uploadOneMusicFile(file: File) {
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

    if (audioData.length <= CHUNK_SIZE) {
      await fetch("/api/music-tracks", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ name, audioData }),
      });
      return;
    }
    const totalChunks = Math.ceil(audioData.length / CHUNK_SIZE);
    const firstChunk = audioData.slice(0, CHUNK_SIZE);
    const res = await fetch("/api/music-tracks", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name, audioData: firstChunk, chunked: true, chunkIndex: 0, totalChunks }),
    });
    const { id } = await res.json();

    for (let i = 1; i < totalChunks; i++) {
      const chunk = audioData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      await fetch("/api/music-tracks", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ id, audioData: chunk, chunked: true, chunkIndex: i, totalChunks }),
      });
    }
  }

  async function handleMusicUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadingMusic(true);
    setUploadProgress({ current: 0, total: files.length });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setUploadProgress({ current: i + 1, total: files.length });
      try {
        await uploadOneMusicFile(files[i]);
      } catch (err) {
        failed.push(`${files[i].name}: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }
    await load();
    setUploadingMusic(false);
    setUploadProgress(null);
    e.target.value = "";
    if (failed.length > 0) {
      alert(`${failed.length} of ${files.length} uploads failed:\n\n${failed.join("\n")}`);
    }
  }

  async function deleteMusic(id: string) {
    if (!window.confirm("Delete this track?")) return;
    await fetch("/api/music-tracks", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action: "delete", id }),
    });
    await load();
  }

  function toggleMusicInList(trackId: string) {
    setListMusicTrackIds((prev) =>
      prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId]
    );
  }

  // ── Video Preview ──

  async function generateVideoPreview(listId: string, accountId?: string) {
    setGeneratingVideoForList(listId);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(null);
    try {
      // Use account-level bg prompts if available
      const accKey = accountId || selectedTopnAccount;
      const accBgPrompts = accKey ? topnAutoConfig.accounts[accKey]?.backgroundPrompts : undefined;
      const bgParam = accBgPrompts && accBgPrompts.length > 0 ? `&backgroundPrompts=${encodeURIComponent(accBgPrompts.join("|"))}` : "";
      const res = await fetch(`/api/top-n-preview?password=${encodeURIComponent(password || "")}&listId=${listId}${bgParam}`, {
        signal: AbortSignal.timeout(300000),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("video")) {
        const text = await res.text();
        let errMsg = `${res.status} ${res.statusText}`;
        try {
          const data = JSON.parse(text);
          errMsg = data.error || errMsg;
        } catch {
          if (text.length < 500) errMsg = text || errMsg;
        }
        alert("Preview failed: " + errMsg);
        setGeneratingVideoForList(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setVideoPreviewUrl(url);
    } catch (err) {
      alert("Preview failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
    setGeneratingVideoForList(null);
  }

  // ── Publish ──

  async function publishList() {
    if (!publishListId || publishAccounts.length === 0) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      // Look up account-level background prompts for the first selected account
      const firstAccKey = String(publishAccounts[0]);
      const accBgPrompts = topnAutoConfig.accounts[firstAccKey]?.backgroundPrompts;
      const platform = detectPlatform(String(publishAccounts[0]));
      const res = await fetch("/api/top-n-generate", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          listId: publishListId,
          accountIds: publishAccounts,
          platform,
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
          ...(accBgPrompts && accBgPrompts.length > 0 ? { backgroundPrompts: accBgPrompts } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPublishResult(`Posted ${data.slides} slides: ${data.books?.join(", ")}`);
      } else {
        setPublishResult(`Error: ${data.error}`);
      }
    } catch (e) {
      setPublishResult(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    }
    setPublishing(false);
  }

  function togglePublishAccount(id: number) {
    setPublishAccounts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

  async function refreshAccounts() {
    if (!password) return;
    setRefreshingAccounts(true);
    try {
      const [aRes, igRes, fbRes] = await Promise.all([
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=tiktok`),
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=instagram`),
        fetch(`/api/post-tiktok?password=${encodeURIComponent(password)}&platform=facebook`),
      ]);
      if (aRes.ok) setAccounts((await aRes.json()).accounts || []);
      if (igRes.ok) setIgAccounts((await igRes.json()).accounts || []);
      if (fbRes.ok) setFbAccounts((await fbRes.json()).accounts || []);
    } catch {}
    setRefreshingAccounts(false);
  }

  // ── Automation (per-account) ──

  function detectPlatform(accountId: string): TopNAccountConfig["platform"] {
    const numId = Number(accountId);
    if (igAccounts.some((a) => a.id === numId)) return "ig-carousel";
    if (fbAccounts.some((a) => a.id === numId)) return "fb-video";
    return "tiktok-carousel";
  }

  function updateAccountConfig(accountKey: string, patch: Partial<TopNAccountConfig>) {
    setTopnAutoConfig((prev) => ({
      ...prev,
      accounts: {
        ...prev.accounts,
        [accountKey]: { ...prev.accounts[accountKey], ...patch },
      },
    }));
  }

  function updateAccountInterval(accountKey: string, i: number, key: "start" | "end", value: string) {
    setTopnAutoConfig((prev) => {
      const cfg = prev.accounts[accountKey];
      if (!cfg) return prev;
      const newIntervals = cfg.intervals.map((w, idx) => (idx === i ? { ...w, [key]: value } : w));
      return { ...prev, accounts: { ...prev.accounts, [accountKey]: { ...cfg, intervals: newIntervals } } };
    });
  }

  function addAccountInterval(accountKey: string) {
    setTopnAutoConfig((prev) => {
      const cfg = prev.accounts[accountKey];
      if (!cfg) return prev;
      return { ...prev, accounts: { ...prev.accounts, [accountKey]: { ...cfg, intervals: [...cfg.intervals, { start: "12:00", end: "14:00" }] } } };
    });
  }

  function removeAccountInterval(accountKey: string, i: number) {
    setTopnAutoConfig((prev) => {
      const cfg = prev.accounts[accountKey];
      if (!cfg) return prev;
      return { ...prev, accounts: { ...prev.accounts, [accountKey]: { ...cfg, intervals: cfg.intervals.filter((_, idx) => idx !== i) } } };
    });
  }

  function toggleListForAccount(accountKey: string, listId: string) {
    setTopnAutoConfig((prev) => {
      const cfg = prev.accounts[accountKey];
      if (!cfg) return prev;
      const listIds = cfg.listIds.includes(listId)
        ? cfg.listIds.filter((id) => id !== listId)
        : [...cfg.listIds, listId];
      return { ...prev, accounts: { ...prev.accounts, [accountKey]: { ...cfg, listIds } } };
    });
  }

  function ensureAccountConfig(accountKey: string) {
    if (!topnAutoConfig.accounts[accountKey]) {
      const platform = detectPlatform(accountKey);
      setTopnAutoConfig((prev) => ({
        ...prev,
        accounts: {
          ...prev.accounts,
          [accountKey]: {
            enabled: false,
            intervals: [{ start: "18:00", end: "20:00" }],
            listIds: [],
            pointer: 0,
            frequencyDays: 1,
            platform,
          },
        },
      }));
    }
    setSelectedTopnAccount(accountKey);
  }

  async function saveTopnAutomation() {
    setSavingAuto(true);
    try {
      // Patch each account individually to avoid overwriting accounts
      // that were added in another session
      for (const [accId, accConfig] of Object.entries(topnAutoConfig.accounts)) {
        await fetch(`/api/topn-automation`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ accountId: accId, account: accConfig }),
        });
      }
      await load();
    } catch {}
    setSavingAuto(false);
  }

  if (!password) return null;

  function parseGenres(g: string): string[] {
    return g ? g.split(",").map((s) => s.trim()).filter(Boolean) : [];
  }
  const genres = Array.from(new Set(books.flatMap((b) => parseGenres(b.genre) || ["Uncategorized"]))).sort();
  const filteredBooks = books.filter((b) => {
    if (genreFilter !== "all") {
      const bg = parseGenres(b.genre);
      if (!(bg.length === 0 ? genreFilter === "Uncategorized" : bg.includes(genreFilter))) return false;
    }
    if (bookSearch.trim()) {
      const q = bookSearch.toLowerCase();
      if (!b.title.toLowerCase().includes(q) && !b.author.toLowerCase().includes(q) && !b.genre.toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (a.pinned === b.pinned ? 0 : a.pinned ? -1 : 1));

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-white to-stone-100 text-stone-900">
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Top Books</strong> — create curated &quot;Top N&quot; book lists and automate posting them.</p>
          <p>Add books with cover images (upload or paste a URL). The AI can recognize title and author from the cover. Pin books to guarantee they appear in every generated list.</p>
          <p>Create a <strong>list</strong> with a name, title text variations, caption pool, and background prompt pool. When published, it picks N books (pinned ones always included), shuffles the order, and generates a slideshow.</p>
          <p>The <strong>automation</strong> tab lets you configure per-account auto-posting with frequency, list selection, and time windows.</p>
        </HowItWorks>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Top Books</h1>
          <button onClick={load} className="text-sm text-stone-500 hover:text-stone-900 transition-colors">
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 w-fit">
          {(["books", "lists", "music", "automation", "overview"] as const).map((t) => {
            const configuredCount = Object.values(topnAutoConfig.accounts).filter((c) => c.enabled).length;
            const label = t === "books" ? `Books (${books.length})` : t === "lists" ? `Lists (${lists.length})` : t === "music" ? `Music (${musicTracks.length})` : t === "overview" ? "Overview" : `Automation${configuredCount > 0 ? ` (${configuredCount})` : ""}`;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-md text-sm transition-colors ${
                  tab === t ? "bg-stone-200 text-stone-900" : "text-stone-600 hover:text-stone-900"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* ═══ BOOKS TAB ═══ */}
        {tab === "books" && (
          <>
            {bulkMode && (
              <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-amber-600">{bulkSelected.size} book{bulkSelected.size !== 1 ? "s" : ""} selected</span>
                  <button onClick={() => { setBulkMode(false); setBulkSelected(new Set()); }} className="text-xs text-stone-600 hover:text-stone-900">Cancel</button>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <input
                    value={bulkGenre}
                    onChange={(e) => setBulkGenre(e.target.value)}
                    placeholder="Genre to apply..."
                    className="flex-1 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                  <button
                    onClick={bulkApplyGenre}
                    disabled={bulkSelected.size === 0 || !bulkGenre.trim() || loading}
                    className="rounded-lg bg-amber-500 text-white px-4 py-2 text-sm font-medium hover:bg-amber-400 transition-colors disabled:opacity-50"
                  >
                    {loading ? "Saving..." : "Apply"}
                  </button>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={bulkAppend} onChange={() => setBulkAppend(true)} className="accent-amber-500" />
                    <span className="text-stone-700">Append to existing</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" checked={!bulkAppend} onChange={() => setBulkAppend(false)} className="accent-amber-500" />
                    <span className="text-stone-700">Replace</span>
                  </label>
                  <button
                    onClick={() => setBulkSelected(new Set(filteredBooks.map((b) => b.id)))}
                    className="ml-auto text-amber-600 hover:text-amber-700"
                  >
                    Select all visible
                  </button>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <button
                onClick={() => openBookForm()}
                className="rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700 transition-colors"
              >
                + Add Book
              </button>
              <button
                onClick={() => { setBulkMode(!bulkMode); setBulkSelected(new Set()); }}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  bulkMode ? "bg-amber-500 text-white" : "border border-stone-300 text-stone-600 hover:text-stone-900 hover:border-stone-400"
                }`}
              >
                Bulk Tag Genre
              </button>
              <input
                value={bookSearch}
                onChange={(e) => setBookSearch(e.target.value)}
                placeholder="Search by title, author, or genre..."
                className="flex-1 min-w-[200px] rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/15"
              />
              {genres.length > 1 && (
                <div className="flex gap-1 bg-white rounded-lg p-1 flex-wrap">
                  <button
                    onClick={() => setGenreFilter("all")}
                    className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                      genreFilter === "all" ? "bg-stone-200 text-stone-900" : "text-stone-600 hover:text-stone-900"
                    }`}
                  >
                    All ({books.length})
                  </button>
                  {genres.map((g) => {
                    const count = books.filter((b) => {
                      const bg = parseGenres(b.genre);
                      return bg.length === 0 ? g === "Uncategorized" : bg.includes(g);
                    }).length;
                    return (
                      <button
                        key={g}
                        onClick={() => setGenreFilter(g)}
                        className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                          genreFilter === g ? "bg-stone-200 text-stone-900" : "text-stone-600 hover:text-stone-900"
                        }`}
                      >
                        {g} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {filteredBooks.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filteredBooks.map((b) => (
                  <div key={b.id} className="relative">
                    {bulkMode && (
                      <button
                        onClick={() => setBulkSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                          return next;
                        })}
                        className={`absolute top-2 left-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-colors ${
                          bulkSelected.has(b.id)
                            ? "bg-amber-500 border-amber-500 text-white"
                            : "bg-stone-900/35 border-stone-400 text-transparent hover:border-stone-900"
                        }`}
                      >
                        ✓
                      </button>
                    )}
                    <BookCard book={b} onEdit={() => openBookForm(b)} onDelete={() => deleteBook(b.id)} onTogglePin={() => togglePinned(b)} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-stone-200 bg-white/70 p-10 text-center text-stone-500">
                No books yet. Add some to get started.
              </div>
            )}
          </>
        )}

        {/* ═══ LISTS TAB ═══ */}
        {tab === "lists" && (
          <>
            <button
              onClick={() => openListForm()}
              className="mb-6 rounded-lg bg-stone-900 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700 transition-colors"
            >
              + New List
            </button>

            {lists.length === 0 ? (
              <div className="rounded-2xl border border-stone-200 bg-white/70 p-10 text-center text-stone-500">
                No lists yet. Create one to build a Top N slideshow.
              </div>
            ) : (
              <div className="space-y-3">
                {lists.map((l) => {
                  const manualBooks = l.bookIds.map((id) => books.find((b) => b.id === id)).filter(Boolean) as TopBook[];
                  const genreBooks = (l.genres && l.genres.length > 0)
                    ? books.filter((b) => {
                        const bg = parseGenres(b.genre);
                        return bg.some((g) => l.genres!.some((lg) => lg.toLowerCase() === g.toLowerCase())) && !l.bookIds.includes(b.id);
                      })
                    : [];
                  const listBooks = [...manualBooks, ...genreBooks];
                  return (
                    <div key={l.id} className="rounded-xl border border-stone-200 bg-white/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{l.name}</span>
                          </div>
                          <div className="text-sm text-stone-600 mt-1">
                            {(l.titleTexts || []).length} title{(l.titleTexts || []).length !== 1 ? "s" : ""} &middot; {l.count} books from {listBooks.length} in pool
                            {l.genres && l.genres.length > 0 && <span className="text-green-600"> ({l.genres.join(", ")})</span>}
                          </div>
                          {listBooks.length > 0 && (
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {listBooks.slice(0, 8).map((b) => (
                                <img key={b.id} src={b.coverData} alt={b.title} className="w-8 h-12 rounded object-cover" />
                              ))}
                              {listBooks.length > 8 && (
                                <span className="text-xs text-stone-500 self-center ml-1">+{listBooks.length - 8}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => setPreviewListId(l.id)}
                            className="text-xs text-blue-600 hover:text-blue-700 transition-colors"
                          >
                            Preview
                          </button>
                          <button
                            onClick={() => generateVideoPreview(l.id)}
                            disabled={generatingVideoForList !== null}
                            className="text-xs text-purple-600 hover:text-purple-700 transition-colors disabled:text-stone-400"
                          >
                            {generatingVideoForList === l.id ? "Generating..." : "Preview Video"}
                          </button>
                          <button
                            onClick={() => { setPublishListId(l.id); setPublishAccounts([]); setPublishResult(null); setScheduledAt(""); }}
                            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Publish
                          </button>
                          <button onClick={() => openListForm(l)} className="text-xs text-stone-600 hover:text-stone-900 transition-colors">
                            Edit
                          </button>
                          <button onClick={() => deleteList(l.id)} className="text-xs text-red-600 hover:text-red-700 transition-colors">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ═══ AUTOMATION TAB ═══ */}
        {tab === "music" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900">Music Tracks</h2>
              <label className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer transition-colors ${uploadingMusic ? "bg-stone-200 text-stone-600" : "bg-stone-900 text-white hover:bg-stone-700"}`}>
                {uploadingMusic
                  ? uploadProgress
                    ? `Uploading ${uploadProgress.current}/${uploadProgress.total}...`
                    : "Uploading..."
                  : "+ Upload Tracks"}
                <input type="file" accept="audio/*" multiple onChange={handleMusicUpload} className="hidden" disabled={uploadingMusic} />
              </label>
            </div>
            <p className="text-xs text-stone-500">Upload MP3 or M4A files. Assign them to lists in the list editor. A random track is picked for each video post.</p>
            {musicTracks.length === 0 ? (
              <p className="text-stone-500 text-sm text-center py-8">No music tracks yet. Upload one to get started.</p>
            ) : (
              <div className="space-y-3">
                {musicTracks.map((t) => {
                  const usedIn = lists.filter((l) => l.musicTrackIds?.includes(t.id)).map((l) => l.name);
                  const audioUrl = `/api/music-tracks?password=${encodeURIComponent(password || "")}&id=${t.id}`;
                  return (
                    <div key={t.id} className="bg-white rounded-lg px-4 py-3 border border-stone-200 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-stone-900 text-sm">{t.name}</span>
                          {usedIn.length > 0 && (
                            <span className="text-xs text-purple-600 ml-2">Used in: {usedIn.join(", ")}</span>
                          )}
                        </div>
                        <button onClick={() => deleteMusic(t.id)} className="text-xs text-red-600 hover:text-red-700 transition-colors">Delete</button>
                      </div>
                      <audio controls preload="none" src={audioUrl} className="w-full h-8 [&::-webkit-media-controls-panel]:bg-stone-100" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === "automation" && (() => {
          const allAccts: { id: number; username: string; platformLabel: string }[] = [
            ...accounts.map((a) => ({ ...a, platformLabel: "TikTok" })),
            ...igAccounts.map((a) => ({ ...a, platformLabel: "Instagram" })),
            ...fbAccounts.map((a) => ({ ...a, platformLabel: "Facebook" })),
          ];
          const selectedCfg = selectedTopnAccount ? topnAutoConfig.accounts[selectedTopnAccount] : null;

          return (
            <>
              {allAccts.length === 0 ? (
                <div className="rounded-2xl border border-stone-200 bg-white/70 p-10 text-center text-stone-500">
                  No accounts available. Connect TikTok, Instagram, or Facebook accounts first.
                </div>
              ) : (
                <>
                  {/* Account selector with search */}
                  <div className="mb-4">
                    <label className="text-xs text-stone-600 block mb-2">Select account to configure</label>
                    <input
                      placeholder="Search accounts..."
                      value={accountSearch}
                      onChange={(e) => setAccountSearch(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/15 mb-2"
                    />
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-stone-300 bg-stone-100">
                      {allAccts
                        .filter((a) => !accountSearch.trim() || a.username.toLowerCase().includes(accountSearch.toLowerCase()))
                        .map((a) => {
                          const cfg = topnAutoConfig.accounts[String(a.id)];
                          const isSelected = selectedTopnAccount === String(a.id);
                          return (
                            <button
                              key={`${a.platformLabel}-${a.id}`}
                              onClick={() => { ensureAccountConfig(String(a.id)); setAccountSearch(""); }}
                              className={`w-full text-left px-3 py-2 text-sm border-b border-stone-300/60 last:border-0 transition-colors ${
                                isSelected ? "bg-stone-200 text-stone-900" : "text-stone-700 hover:bg-stone-200/60"
                              }`}
                            >
                              @{a.username} <span className="text-stone-500">({a.platformLabel})</span>
                              {cfg?.enabled && <span className="text-green-600 ml-1">[ON]</span>}
                            </button>
                          );
                        })}
                    </div>

                    {/* Summary of all enabled accounts */}
                    {Object.entries(topnAutoConfig.accounts).filter(([, c]) => c.enabled).length > 0 && (
                      <div className="mt-4 space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">All enabled accounts</h4>
                        {Object.entries(topnAutoConfig.accounts).filter(([, c]) => c.enabled).map(([accId, cfg]) => {
                          const acc = allAccts.find((a) => String(a.id) === accId);
                          const listCount = cfg.listIds.length > 0 ? cfg.listIds.length : lists.length;
                          const pLabel = (() => { switch(cfg.platform) { case "tiktok-carousel": return "TikTok Carousel"; case "tiktok-video": return "TikTok Video"; case "fb-video": return "FB Video"; case "ig-carousel": return "IG Carousel"; case "ig-video": return "IG Video"; default: return cfg.platform; } })();
                          return (
                            <div key={accId} className="rounded-lg border border-stone-300/60 bg-stone-100/70 px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-stone-900">@{acc?.username || accId}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-200 text-stone-700">{pLabel}</span>
                              </div>
                              <div className="text-xs text-stone-600">
                                {cfg.intervals.map((w) => `${w.start}–${w.end}`).join(", ") || "no windows"} · every {cfg.frequencyDays}d · {listCount} list{listCount !== 1 ? "s" : ""} · ptr {cfg.pointer}{cfg.lastPostDate ? ` · last ${cfg.lastPostDate}` : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Per-account config */}
                  {selectedTopnAccount && selectedCfg && (
                    <div className="rounded-xl border border-stone-200 bg-white/70 p-5 space-y-5">
                      {/* Enable toggle */}
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedCfg.enabled}
                          onChange={(e) => updateAccountConfig(selectedTopnAccount, { enabled: e.target.checked })}
                          className="rounded"
                        />
                        Enable auto-posting
                      </label>

                      {/* Platform */}
                      <div>
                        <label className="text-xs text-stone-600 block mb-1">Platform</label>
                        <select
                          value={selectedCfg.platform}
                          onChange={(e) => updateAccountConfig(selectedTopnAccount, { platform: e.target.value as TopNAccountConfig["platform"] })}
                          className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                        >
                          <option value="tiktok-carousel">TikTok Carousel</option>
                          <option value="tiktok-video">TikTok Video</option>
                          <option value="ig-carousel">Instagram Carousel</option>
                          <option value="ig-video">Instagram Video</option>
                          <option value="fb-video">Facebook Video</option>
                        </select>
                      </div>

                      {/* Frequency */}
                      <div>
                        <label className="text-xs text-stone-600 block mb-1">Frequency</label>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-stone-700">Post every</span>
                          <input
                            type="number"
                            min={1}
                            value={selectedCfg.frequencyDays}
                            onChange={(e) => updateAccountConfig(selectedTopnAccount, { frequencyDays: Math.max(1, Number(e.target.value)) })}
                            className="w-20 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                          />
                          <span className="text-sm text-stone-700">day{selectedCfg.frequencyDays !== 1 ? "s" : ""}</span>
                        </div>
                      </div>

                      {/* List selection */}
                      <div>
                        <label className="text-xs text-stone-600 block mb-2">
                          Lists to include ({selectedCfg.listIds.length === 0 ? "all" : selectedCfg.listIds.length + " selected"})
                        </label>
                        <p className="text-[11px] text-stone-400 mb-2">Leave none checked to include all lists.</p>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {lists.map((l) => (
                            <label key={l.id} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={selectedCfg.listIds.includes(l.id)}
                                onChange={() => toggleListForAccount(selectedTopnAccount, l.id)}
                                className="rounded"
                              />
                              {l.name}
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* Background prompts (account-level) */}
                      <div>
                        <label className="text-xs text-stone-600 block mb-1">Background prompts (one per line)</label>
                        <p className="text-[11px] text-stone-400 mb-2">Overrides list-level background prompts. Leave empty to use each list&apos;s own prompts.</p>
                        <textarea
                          value={bgPromptsText}
                          onChange={(e) => setBgPromptsText(e.target.value)}
                          onBlur={() => {
                            const lines = bgPromptsText.split("\n").filter((l) => l.trim());
                            updateAccountConfig(selectedTopnAccount, { backgroundPrompts: lines.length > 0 ? lines : undefined });
                          }}
                          rows={3}
                          placeholder="e.g. A dark moody bookshelf with candlelight"
                          className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                        />
                        <div className="mt-2 space-y-2">
                          <p className="text-[11px] text-stone-400">Generate a prompt from an image:</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={bgImageUrl}
                              onChange={(e) => setBgImageUrl(e.target.value)}
                              placeholder="Paste image URL"
                              className="flex-1 rounded-lg border border-stone-300 bg-stone-100 px-3 py-1.5 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                            />
                            <button
                              disabled={describingImage || !bgImageUrl.trim()}
                              onClick={async () => {
                                setDescribingImage(true);
                                try {
                                  const res = await fetch("/api/describe-image", {
                                    method: "POST",
                                    headers: headers(),
                                    body: JSON.stringify({ imageUrl: bgImageUrl.trim() }),
                                  });
                                  const json = await res.json();
                                  if (json.prompt) {
                                    const newText = bgPromptsText ? bgPromptsText + "\n" + json.prompt : json.prompt;
                                    setBgPromptsText(newText);
                                    const lines = newText.split("\n").filter((l: string) => l.trim());
                                    updateAccountConfig(selectedTopnAccount, { backgroundPrompts: lines });
                                    setBgImageUrl("");
                                  } else {
                                    alert(json.error || "Failed to describe image");
                                  }
                                } catch (e) { alert(String(e)); }
                                finally { setDescribingImage(false); }
                              }}
                              className="rounded-lg bg-stone-200 px-3 py-1.5 text-xs text-stone-900 hover:bg-stone-300 disabled:opacity-50"
                            >
                              {describingImage ? "..." : "Get prompt"}
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="rounded-lg bg-stone-200 px-3 py-1.5 text-xs text-stone-900 hover:bg-stone-300 cursor-pointer text-center">
                              Upload image
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  setDescribingImage(true);
                                  try {
                                    const reader = new FileReader();
                                    const base64 = await new Promise<string>((resolve) => {
                                      reader.onload = () => resolve(reader.result as string);
                                      reader.readAsDataURL(file);
                                    });
                                    const res = await fetch("/api/describe-image", {
                                      method: "POST",
                                      headers: headers(),
                                      body: JSON.stringify({ imageBase64: base64 }),
                                    });
                                    const json = await res.json();
                                    if (json.prompt) {
                                      const newText = bgPromptsText ? bgPromptsText + "\n" + json.prompt : json.prompt;
                                      setBgPromptsText(newText);
                                      const lines = newText.split("\n").filter((l: string) => l.trim());
                                      updateAccountConfig(selectedTopnAccount, { backgroundPrompts: lines });
                                    } else {
                                      alert(json.error || "Failed to describe image");
                                    }
                                  } catch (err) { alert(String(err)); }
                                  finally { setDescribingImage(false); e.target.value = ""; }
                                }}
                              />
                            </label>
                            {describingImage && <span className="text-xs text-stone-500">Analyzing image...</span>}
                          </div>
                        </div>
                      </div>

                      {/* Time windows */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs text-stone-600">Time windows (UTC)</label>
                          <button
                            onClick={() => addAccountInterval(selectedTopnAccount)}
                            className="text-xs text-blue-600 hover:text-blue-700"
                          >
                            + Add window
                          </button>
                        </div>
                        <p className="text-[11px] text-stone-400 mb-2">
                          One post is scheduled per window per day, at a random time inside the window.
                        </p>
                        <div className="space-y-2">
                          {selectedCfg.intervals.map((w, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <input
                                type="time"
                                value={w.start}
                                onChange={(e) => updateAccountInterval(selectedTopnAccount, i, "start", e.target.value)}
                                className="rounded-lg border border-stone-300 bg-stone-100 px-2 py-1.5 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                              />
                              <span className="text-stone-500 text-sm">&rarr;</span>
                              <input
                                type="time"
                                value={w.end}
                                onChange={(e) => updateAccountInterval(selectedTopnAccount, i, "end", e.target.value)}
                                className="rounded-lg border border-stone-300 bg-stone-100 px-2 py-1.5 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                              />
                              {selectedCfg.intervals.length > 1 && (
                                <button
                                  onClick={() => removeAccountInterval(selectedTopnAccount, i)}
                                  className="text-xs text-red-600 hover:text-red-700 ml-auto"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Save */}
                      <button
                        onClick={saveTopnAutomation}
                        disabled={savingAuto}
                        className="w-full rounded-lg bg-stone-900 text-white py-2 text-sm font-medium hover:bg-stone-700 transition-colors disabled:opacity-50"
                      >
                        {savingAuto ? "Saving..." : "Save automation"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          );
        })()}

        {/* ═══ OVERVIEW TAB ═══ */}
        {tab === "overview" && (() => {
          const allAccts = [
            ...accounts.map((a) => ({ ...a, platform: "tiktok" as const })),
            ...(igAccounts || []).map((a) => ({ ...a, platform: "instagram" as const })),
            ...(fbAccounts || []).map((a) => ({ ...a, platform: "facebook" as const })),
          ].sort((a, b) => a.username.localeCompare(b.username));

          const enabled = Object.entries(topnAutoConfig.accounts).filter(([, c]) => c.enabled);

          return (
            <div className="space-y-6">
              <div className="rounded-2xl border border-stone-200 bg-white/70 p-6">
                <h2 className="text-lg font-semibold mb-1">Top Books Automation Overview</h2>
                <p className="text-sm text-stone-500 mb-6">
                  {enabled.length} active account{enabled.length !== 1 ? "s" : ""}
                </p>

                {enabled.length === 0 ? (
                  <p className="text-sm text-stone-500 text-center py-4">No accounts have automation enabled.</p>
                ) : (
                  <div className="space-y-2">
                    {enabled.map(([accId, cfg]) => {
                      const acc = allAccts.find((a) => String(a.id) === accId);
                      const listCount = cfg.listIds.length > 0 ? cfg.listIds.length : lists.length;
                      const pLabel = (() => { switch(cfg.platform) { case "tiktok-carousel": return "TikTok Carousel"; case "tiktok-video": return "TikTok Video"; case "fb-video": return "FB Video"; case "ig-carousel": return "IG Carousel"; case "ig-video": return "IG Video"; default: return cfg.platform; } })();
                      return (
                        <div key={accId} className="rounded-lg border border-stone-300/60 bg-stone-100/70 px-4 py-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-stone-900">@{acc?.username || accId}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-200 text-stone-700">{pLabel}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-600 font-medium">ON</span>
                          </div>
                          <div className="text-xs text-stone-600">
                            {cfg.intervals.map((w) => `${w.start}–${w.end}`).join(", ") || "no windows"} · every {cfg.frequencyDays}d · {listCount} list{listCount !== 1 ? "s" : ""} · ptr {cfg.pointer}{cfg.lastPostDate ? ` · last ${cfg.lastPostDate}` : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ═══ BOOK FORM MODAL ═══ */}
        {showBookForm && (
          <Modal onClose={() => setShowBookForm(false)} title={editBookId ? "Edit Book" : "Add Book"}>
            <div className="space-y-4">
              {!editBookId && (
                <div>
                  <label className="text-xs text-stone-600 block mb-1">Cover Image URL {fetchingUrl && <span className="text-blue-600 ml-1">Fetching...</span>}</label>
                  <div className="flex gap-2">
                    <input
                      value={bookUrl}
                      onChange={(e) => setBookUrl(e.target.value)}
                      placeholder="Paste image URL (right-click cover → Copy Image Address)"
                      className="flex-1 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fetchBookUrl(); } }}
                    />
                    <button
                      onClick={fetchBookUrl}
                      disabled={fetchingUrl || !bookUrl.trim()}
                      className="rounded-lg bg-stone-200 hover:bg-stone-300 px-3 py-2 text-sm text-stone-900 transition-colors disabled:opacity-50 shrink-0"
                    >
                      Fetch
                    </button>
                  </div>
                  <p className="text-[11px] text-stone-400 mt-1">Fetches cover and auto-detects title &amp; author</p>
                  {fetchUrlError && <p className="text-[11px] text-red-600 mt-1">{fetchUrlError}</p>}
                </div>
              )}
              <div>
                <label className="text-xs text-stone-600 block mb-1">Title * {recognizing && <span className="text-blue-600 ml-1">Recognizing...</span>}</label>
                <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-1">Author</label>
                <input value={bookAuthor} onChange={(e) => setBookAuthor(e.target.value)} className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-1">Genre</label>
                <input value={bookGenre} onChange={(e) => setBookGenre(e.target.value)} placeholder="e.g. Dark Romance, Thriller, Fantasy" className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
                <p className="text-[11px] text-stone-400 mt-1">Separate multiple genres with commas</p>
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-1">Cover Image {!editBookId && "*"}</label>
                <input type="file" accept="image/*" onChange={handleCoverFile} className="text-sm text-stone-600" />
                {bookCoverPreview && (
                  <img src={bookCoverPreview} alt="Cover" className="mt-2 w-24 h-36 rounded object-cover" />
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={bookPinned} onChange={(e) => setBookPinned(e.target.checked)} className="rounded" />
                Always recommended (pinned)
              </label>
              <button onClick={saveBook} disabled={loading} className="w-full rounded-lg bg-stone-900 text-white py-2 text-sm font-medium hover:bg-stone-700 transition-colors disabled:opacity-50">
                {loading ? "Saving..." : "Save"}
              </button>
            </div>
          </Modal>
        )}

        {/* ═══ LIST FORM MODAL ═══ */}
        {showListForm && (
          <Modal onClose={() => setShowListForm(false)} title={editListId ? "Edit List" : "New List"}>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-stone-600 block mb-1">List Name *</label>
                <input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="e.g. Dark Romance" className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
              </div>
              <div className="rounded-lg border border-stone-200 bg-white/60 p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm text-stone-900 font-medium">Generate hooks, captions and image prompts</div>
                    <div className="text-[11px] text-stone-500 mt-0.5">
                      Uses the list name {listGenres.length ? `and genres (${listGenres.join(", ")})` : "(set genres below for sharper results)"}. Appends to whatever is already in the three fields. Click again later for more, no repeats.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={generateBookTokContent}
                    disabled={generatingBookTok || !listName.trim()}
                    className="shrink-0 px-3 py-2 rounded-lg text-sm font-medium bg-stone-900 text-white hover:bg-stone-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {generatingBookTok ? "Generating…" : "Generate"}
                  </button>
                </div>
                {bookTokError && (
                  <div className="mt-2 text-[12px] text-red-600">{bookTokError}</div>
                )}
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-1">Title Slide Texts * (one per line, random pick each publish)</label>
                <textarea value={listTitles} onChange={(e) => setListTitles(e.target.value)} rows={3} placeholder={"Top 10 Dark Romance Books\nDark Romance Must-Reads\nBooks That Will Ruin You"} className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-1">Number of books to include</label>
                <input type="number" min={1} value={listCount} onChange={(e) => setListCount(Number(e.target.value))} className="w-24 rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-1">Captions (separate each caption with a blank line)</label>
                <textarea value={listCaptions} onChange={(e) => setListCaptions(e.target.value)} rows={5} placeholder={"First caption here with #hashtags\n\nSecond caption variation\n\nThird caption option"} className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-1">Background image prompts (one per line, random pick each publish)</label>
                <textarea value={listBgPrompts} onChange={(e) => setListBgPrompts(e.target.value)} rows={3} placeholder={"Dark moody roses and shadows\nMystery bookshelf with candlelight\nGothic castle at night"} className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15" />
                <p className="text-[11px] text-stone-400 mt-1">Leave empty for plain dark background</p>
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-2">
                  Music tracks for video posts ({listMusicTrackIds.length} selected)
                </label>
                {musicTracks.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {musicTracks.map((t) => {
                      const selected = listMusicTrackIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggleMusicInList(t.id)}
                          className={`px-3 py-1 rounded-full text-xs transition-colors ${
                            selected
                              ? "bg-purple-500/20 border-purple-500 text-purple-600 border"
                              : "border border-stone-300 text-stone-600 hover:border-stone-400"
                          }`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-stone-500 mb-2">No music tracks uploaded yet. Upload tracks below.</p>
                )}
                <p className="text-[11px] text-stone-400">Random pick per video publish. Only used for video platform types.</p>
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-2">
                  Auto-select by genre ({listGenres.length} selected)
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {genres.map((g) => {
                    const selected = listGenres.includes(g);
                    return (
                      <button
                        key={g}
                        onClick={() => setListGenres(selected ? listGenres.filter((x) => x !== g) : [...listGenres, g])}
                        className={`px-3 py-1 rounded-full text-xs transition-colors ${
                          selected
                            ? "bg-green-500/20 border-green-500 text-green-600 border"
                            : "border border-stone-300 text-stone-600 hover:border-stone-400"
                        }`}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
                {listGenres.length > 0 && (
                  <p className="text-[11px] text-stone-400 mb-3">
                    Books matching these genres will be automatically included. You can also manually select additional books below.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-2">
                  Select books ({listBookIds.length} selected, {books.filter((b) => b.pinned).length} pinned)
                </label>
                <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                  {books.map((b) => {
                    const selected = listBookIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        onClick={() => toggleBookInList(b.id)}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs transition-colors ${
                          selected
                            ? "border-blue-500 bg-blue-500/10 text-blue-700"
                            : "border-stone-300 bg-stone-100 text-stone-600 hover:border-stone-400"
                        }`}
                      >
                        <img src={b.coverData} alt="" className="w-6 h-9 rounded object-cover shrink-0" />
                        <span className="truncate">
                          {b.pinned && "* "}{b.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={saveList} className="w-full rounded-lg bg-stone-900 text-white py-2 text-sm font-medium hover:bg-stone-700 transition-colors">
                Save
              </button>
            </div>
          </Modal>
        )}

        {/* ═══ PUBLISH MODAL ═══ */}
        {publishListId && (
          <Modal onClose={() => setPublishListId(null)} title="Publish Top N">
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  onClick={refreshAccounts}
                  disabled={refreshingAccounts}
                  className="text-xs text-blue-600 hover:text-blue-700 disabled:text-stone-400 transition-colors"
                >
                  {refreshingAccounts ? "Refreshing..." : "Refresh accounts"}
                </button>
              </div>
              <div className="space-y-4">
                {accounts.length > 0 && (
                  <div>
                    <label className="text-xs text-stone-600 block mb-2">TikTok accounts</label>
                    <div className="space-y-2">
                      {accounts.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={publishAccounts.includes(a.id)}
                            onChange={() => togglePublishAccount(a.id)}
                            className="appearance-none w-5 h-5 rounded border border-stone-400 bg-stone-200 checked:bg-blue-500 checked:border-blue-500 hover:border-stone-400 cursor-pointer transition-colors shrink-0 relative after:absolute after:inset-0 after:flex after:items-center after:justify-center after:text-white after:text-sm after:font-bold checked:after:content-['✓']"
                          />
                          @{a.username}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {igAccounts.length > 0 && (
                  <div>
                    <label className="text-xs text-stone-600 block mb-2">Instagram accounts</label>
                    <div className="space-y-2">
                      {igAccounts.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={publishAccounts.includes(a.id)}
                            onChange={() => togglePublishAccount(a.id)}
                            className="appearance-none w-5 h-5 rounded border border-stone-400 bg-stone-200 checked:bg-blue-500 checked:border-blue-500 hover:border-stone-400 cursor-pointer transition-colors shrink-0 relative after:absolute after:inset-0 after:flex after:items-center after:justify-center after:text-white after:text-sm after:font-bold checked:after:content-['✓']"
                          />
                          @{a.username}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {fbAccounts.length > 0 && (
                  <div>
                    <label className="text-xs text-stone-600 block mb-2">Facebook accounts</label>
                    <div className="space-y-2">
                      {fbAccounts.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer">
                          <input
                            type="checkbox"
                            checked={publishAccounts.includes(a.id)}
                            onChange={() => togglePublishAccount(a.id)}
                            className="appearance-none w-5 h-5 rounded border border-stone-400 bg-stone-200 checked:bg-blue-500 checked:border-blue-500 hover:border-stone-400 cursor-pointer transition-colors shrink-0 relative after:absolute after:inset-0 after:flex after:items-center after:justify-center after:text-white after:text-sm after:font-bold checked:after:content-['✓']"
                          />
                          @{a.username}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-stone-600 block mb-1">Schedule (optional)</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-stone-100 px-3 py-2 text-stone-900 text-sm focus:outline-none focus:ring-2 focus:ring-stone-900/15"
                />
                <p className="text-[11px] text-stone-400 mt-1">Leave empty to publish immediately</p>
              </div>
              <button
                onClick={publishList}
                disabled={publishing || publishAccounts.length === 0}
                className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 text-white py-2 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {publishing ? "Publishing..." : scheduledAt ? "Schedule" : "Publish Now"}
              </button>
              {publishResult && (
                <div className={`text-sm p-3 rounded-lg ${publishResult.startsWith("Error") ? "bg-red-500/10 text-red-600" : "bg-green-500/10 text-green-600"}`}>
                  {publishResult}
                </div>
              )}
            </div>
          </Modal>
        )}


        {/* ═══ VIDEO GENERATING OVERLAY ═══ */}
        {generatingVideoForList && !videoPreviewUrl && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-stone-900/50 backdrop-blur-sm">
            <div className="animate-spin w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full mb-4" />
            <p className="text-stone-900 text-sm">Generating video preview...</p>
            <p className="text-stone-500 text-xs mt-1">This can take up to a minute</p>
          </div>
        )}

        {/* ═══ VIDEO PREVIEW MODAL ═══ */}
        {videoPreviewUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 backdrop-blur-sm" onClick={() => { URL.revokeObjectURL(videoPreviewUrl); setVideoPreviewUrl(null); }}>
            <div className="relative w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
              <video
                src={videoPreviewUrl}
                controls
                autoPlay
                className="w-full rounded-2xl shadow-2xl"
              />
              <button
                onClick={() => { URL.revokeObjectURL(videoPreviewUrl); setVideoPreviewUrl(null); }}
                className="w-full text-xs text-stone-500 hover:text-stone-900 transition-colors py-2 mt-2"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* ═══ LIST PREVIEW MODAL ═══ */}
        {previewListId && (() => {
          const list = lists.find((l) => l.id === previewListId);
          if (!list) return null;
          const manualPool = list.bookIds
            .map((id) => books.find((b) => b.id === id))
            .filter(Boolean) as TopBook[];
          const genrePool = (list.genres && list.genres.length > 0)
            ? books.filter((b) => {
                const bg = parseGenres(b.genre);
                return bg.some((g) => list.genres!.some((lg) => lg.toLowerCase() === g.toLowerCase())) && !list.bookIds.includes(b.id);
              })
            : [];
          const poolBooks = [...manualPool, ...genrePool];
          const pinned = poolBooks.filter((b) => b.pinned);
          const unpinned = poolBooks.filter((b) => !b.pinned).sort(() => Math.random() - 0.5);
          const selected = [...pinned];
          for (const b of unpinned) {
            if (selected.length >= list.count) break;
            selected.push(b);
          }
          const finalOrder = selected.sort(() => Math.random() - 0.5);
          const titleText = list.titleTexts.length > 0
            ? list.titleTexts[Math.floor(Math.random() * list.titleTexts.length)]
            : list.name;
          const caption = list.captions.length > 0
            ? list.captions[Math.floor(Math.random() * list.captions.length)]
            : undefined;

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/45 backdrop-blur-sm" onClick={() => setPreviewListId(null)}>
              <div className="relative w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
                {/* Title slide */}
                <div className="rounded-2xl overflow-hidden bg-gradient-to-br from-stone-100 via-stone-200 to-white border border-stone-300 shadow-2xl p-6 mb-3">
                  <div className="text-[10px] text-stone-500 uppercase tracking-widest mb-3">Title slide</div>
                  <div className="text-lg font-bold text-stone-900 leading-snug">{titleText}</div>
                  <div className="text-[10px] text-stone-500 mt-3">Background image generated at post time</div>
                </div>

                {/* Book grid */}
                <div className="rounded-2xl overflow-hidden bg-white/90 border border-stone-300 p-4 mb-3">
                  <div className="text-[10px] text-stone-500 uppercase tracking-widest mb-3">
                    {finalOrder.length} books selected (shuffled)
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {finalOrder.map((b, i) => (
                      <div key={b.id} className="relative">
                        <img src={b.coverData} alt={b.title} className="w-full aspect-[2/3] rounded-lg object-cover" />
                        <div className="absolute top-0.5 left-0.5 bg-stone-900/60 text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold">
                          {i + 1}
                        </div>
                        {b.pinned && (
                          <div className="absolute bottom-0.5 right-0.5 bg-amber-500/80 text-[8px] px-1 rounded text-white font-bold">
                            PIN
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Caption */}
                {caption && (
                  <div className="text-xs text-stone-600 bg-white/80 border border-stone-200 rounded-lg p-3 mb-3 max-h-20 overflow-y-auto">
                    <span className="text-stone-400 uppercase text-[10px] tracking-wide block mb-1">Caption</span>
                    {caption}
                  </div>
                )}

                <p className="text-[10px] text-stone-400 text-center mb-2">
                  Each preview shuffles differently. Pinned books always appear.
                </p>

                <button
                  onClick={() => setPreviewListId(null)}
                  className="w-full text-xs text-stone-500 hover:text-stone-900 transition-colors py-1"
                >
                  Close preview
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function BookCard({
  book,
  onEdit,
  onDelete,
  onTogglePin,
}: {
  book: TopBook;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white/70 p-3 group">
      <img src={book.coverData} alt={book.title} className="w-full aspect-[2/3] rounded-lg object-cover mb-2" />
      <div className="text-sm font-medium truncate">{book.title}</div>
      {book.author && <div className="text-xs text-stone-500 truncate">{book.author}</div>}
      {book.genre && <div className="text-[10px] text-stone-400 truncate">{book.genre}</div>}
      <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onTogglePin} className={`text-[10px] px-1.5 py-0.5 rounded ${book.pinned ? "bg-amber-500/20 text-amber-600" : "bg-stone-200 text-stone-600"}`}>
          {book.pinned ? "Pinned" : "Pin"}
        </button>
        <button onClick={onEdit} className="text-[10px] text-stone-600 hover:text-stone-900">Edit</button>
        <button onClick={onDelete} className="text-[10px] text-red-600 hover:text-red-700">Delete</button>
      </div>
    </div>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/45 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white border border-stone-200 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-900 text-xl">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}
