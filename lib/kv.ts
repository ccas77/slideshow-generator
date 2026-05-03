import { Redis } from "@upstash/redis";

// Auto-detects KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN
export const redis = Redis.fromEnv();

export interface SavedItem {
  name: string;
  value: string;
}

export interface TimeWindow {
  start: string; // UTC "HH:MM"
  end: string;   // UTC "HH:MM"
}

// Legacy shape — used only by the migration function for type-safe access.
export interface LegacyAutomationConfig {
  enabled?: boolean;
  windowStart?: string;
  windowEnd?: string;
  windowStart2?: string;
  windowEnd2?: string;
  postsPerDay?: number;
  intervals?: TimeWindow[];
  bookId?: string;
  slideshowIds?: string[];
  selections?: Array<{ bookId: string; slideshowId: string }>;
  pointer?: number;
  promptPointer?: number;
}

// Canonical shape — all consumers receive this after migration.
export interface AutomationConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  selections: Array<{ bookId: string; slideshowId: string }>;
  pointer: number;
  promptPointer: number;
}

// Migrate any stored config (legacy, new, or mixed) to the canonical shape.
//
// Sample inputs/outputs:
//
//   Legacy-only:  { enabled: true, windowStart: "18:00", windowEnd: "20:00", bookId: "b1", slideshowIds: ["s1","s2"] }
//     → { enabled: true, intervals: [{ start: "18:00", end: "20:00" }], selections: [{ bookId: "b1", slideshowId: "s1" }, { bookId: "b1", slideshowId: "s2" }] }
//
//   Intervals-only:  { enabled: true, intervals: [{ start: "15:00", end: "17:00" }], selections: [{ bookId: "b1", slideshowId: "s1" }] }
//     → { enabled: true, intervals: [{ start: "15:00", end: "17:00" }], selections: [{ bookId: "b1", slideshowId: "s1" }] }
//
//   Mixed:  { enabled: true, windowStart: "18:00", windowEnd: "20:00", intervals: [{ start: "15:30", end: "17:00" }], bookId: "b1", slideshowIds: ["s1"], selections: [{ bookId: "b1", slideshowId: "s2" }] }
//     → { enabled: true, intervals: [{ start: "15:30", end: "17:00" }], selections: [{ bookId: "b1", slideshowId: "s2" }] }
//
export function migrateAutomationConfig(raw: unknown): AutomationConfig {
  if (!raw || typeof raw !== "object") {
    return { enabled: false, intervals: [{ start: "18:00", end: "20:00" }], selections: [], pointer: 0, promptPointer: 0 };
  }
  const r = raw as LegacyAutomationConfig;

  const enabled = !!r.enabled;

  // Intervals: prefer new field, fall back to legacy windows
  let intervals: TimeWindow[];
  if (r.intervals && r.intervals.length > 0) {
    intervals = r.intervals;
  } else {
    intervals = [];
    if (r.windowStart && r.windowEnd) {
      intervals.push({ start: r.windowStart, end: r.windowEnd });
    }
    if (r.windowStart2 && r.windowEnd2) {
      intervals.push({ start: r.windowStart2, end: r.windowEnd2 });
    }
    if (intervals.length === 0) {
      intervals = [{ start: "18:00", end: "20:00" }];
    }
  }

  // Selections: prefer new field, fall back to legacy bookId+slideshowIds
  let selections: Array<{ bookId: string; slideshowId: string }>;
  if (r.selections && r.selections.length > 0) {
    selections = r.selections;
  } else if (r.bookId && r.slideshowIds && r.slideshowIds.length > 0) {
    selections = r.slideshowIds.map((sid) => ({ bookId: r.bookId!, slideshowId: sid }));
  } else {
    selections = [];
  }

  return { enabled, intervals, selections, pointer: r.pointer ?? 0, promptPointer: r.promptPointer ?? 0 };
}

export interface NamedItem {
  id: string;
  name: string;
  value: string;
}

export interface Slideshow {
  id: string;
  name: string;
  slideTexts: string; // newline-separated
  imagePromptIds: string[];
  captionIds: string[];
}

export interface Book {
  id: string;
  name: string;
  coverImage?: string; // base64 data URL for book cover
  imagePrompts: NamedItem[];
  captions: NamedItem[];
  slideshows: Slideshow[];
}

// Migrate legacy book shape (slideshows had imagePrompt/caption inline)
// to the new pooled shape.
export function migrateBook(raw: unknown): Book {
  const b = raw as {
    id: string;
    name: string;
    coverImage?: string;
    imagePrompts?: NamedItem[];
    captions?: NamedItem[];
    slideshows?: Array<{
      id: string;
      name: string;
      slideTexts: string;
      imagePrompt?: string;
      caption?: string;
      imagePromptIds?: string[];
      captionIds?: string[];
    }>;
  };
  if (b.imagePrompts && b.captions) {
    // already new shape
    return {
      id: b.id,
      name: b.name,
      coverImage: b.coverImage,
      imagePrompts: b.imagePrompts,
      captions: b.captions,
      slideshows: (b.slideshows || []).map((s) => ({
        id: s.id,
        name: s.name,
        slideTexts: s.slideTexts || "",
        imagePromptIds: s.imagePromptIds || [],
        captionIds: s.captionIds || [],
      })),
    };
  }
  // legacy → new: collect unique prompts/captions into pools
  const imagePrompts: NamedItem[] = [];
  const captions: NamedItem[] = [];
  const slideshows: Slideshow[] = [];
  const uid = () =>
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  for (const s of b.slideshows || []) {
    const ipIds: string[] = [];
    const capIds: string[] = [];
    if (s.imagePrompt && s.imagePrompt.trim()) {
      const existing = imagePrompts.find((p) => p.value === s.imagePrompt);
      if (existing) ipIds.push(existing.id);
      else {
        const item: NamedItem = {
          id: uid(),
          name: s.name + " prompt",
          value: s.imagePrompt,
        };
        imagePrompts.push(item);
        ipIds.push(item.id);
      }
    }
    if (s.caption && s.caption.trim()) {
      const existing = captions.find((p) => p.value === s.caption);
      if (existing) capIds.push(existing.id);
      else {
        const item: NamedItem = {
          id: uid(),
          name: s.name + " caption",
          value: s.caption,
        };
        captions.push(item);
        capIds.push(item.id);
      }
    }
    slideshows.push({
      id: s.id,
      name: s.name,
      slideTexts: s.slideTexts || "",
      imagePromptIds: ipIds,
      captionIds: capIds,
    });
  }
  return { id: b.id, name: b.name, coverImage: b.coverImage, imagePrompts, captions, slideshows };
}

export interface AccountData {
  config: AutomationConfig;
  prompts: SavedItem[];
  texts: SavedItem[];
  captions: SavedItem[];
  lastRun?: string;
  lastStatus?: string;
}

const defaultData = (): AccountData => ({
  config: { enabled: false, intervals: [{ start: "18:00", end: "20:00" }], selections: [], pointer: 0, promptPointer: 0 },
  prompts: [],
  texts: [],
  captions: [],
});

const key = (accountId: number) => `account:${accountId}`;

export async function getAccountData(accountId: number): Promise<AccountData> {
  const data = await redis.get<AccountData>(key(accountId));
  if (!data) return defaultData();
  return { ...data, config: migrateAutomationConfig(data.config) };
}

export async function setAccountData(
  accountId: number,
  data: AccountData
): Promise<void> {
  await redis.set(key(accountId), data);
}

const BOOKS_KEY = "books";

export async function getBooks(): Promise<Book[]> {
  const data = await redis.get<unknown[]>(BOOKS_KEY);
  if (!data) return [];
  return data.map((b) => migrateBook(b));
}

export async function setBooks(books: Book[]): Promise<void> {
  await redis.set(BOOKS_KEY, books);
}

// ── Top Books (for "Top N" slideshows) ──

export interface TopBook {
  id: string;
  title: string;
  author: string;
  genre: string;
  coverData: string; // base64 data URL
  pinned: boolean;
}

export interface TopNAutomation {
  enabled: boolean;
  accountIds: number[]; // TikTok carousel accounts
  videoAccountIds?: number[]; // TikTok video accounts
  fbAccountIds?: number[]; // Facebook video accounts
  igCarouselAccountIds?: number[]; // Instagram carousel accounts
  igVideoAccountIds?: number[]; // Instagram video accounts
  intervals: TimeWindow[]; // one post scheduled per interval per day
}

export interface TopNList {
  id: string;
  name: string;
  titleTexts: string[]; // Pool of title slide texts, one picked at random
  count: number; // How many books to include
  bookIds: string[]; // Pool of TopBook IDs to pick from
  genres?: string[]; // Auto-select books matching these genres (merged with bookIds)
  captions: string[]; // Pool of captions, one picked at random per publish
  backgroundPrompts?: string[]; // Pool of Gemini prompts, one picked at random per publish
  musicTrackIds?: string[]; // Pool of music tracks for video posts (random pick)
  automation?: TopNAutomation;
}

const TOP_BOOKS_INDEX_KEY = "top-books-index"; // stores IDs only
const TOP_N_LISTS_KEY = "top-n-lists";

function topBookKey(id: string) {
  return `top-book:${id}`;
}

export async function getTopBooks(): Promise<TopBook[]> {
  const ids = await redis.get<string[]>(TOP_BOOKS_INDEX_KEY);
  if (!ids || ids.length === 0) return [];
  const books: TopBook[] = [];
  for (const id of ids) {
    const book = await redis.get<TopBook>(topBookKey(id));
    if (book) books.push(book);
  }
  return books;
}

export async function getTopBook(id: string): Promise<TopBook | null> {
  return await redis.get<TopBook>(topBookKey(id));
}

export async function setTopBook(book: TopBook): Promise<void> {
  await redis.set(topBookKey(book.id), book);
  const ids = (await redis.get<string[]>(TOP_BOOKS_INDEX_KEY)) || [];
  if (!ids.includes(book.id)) {
    ids.push(book.id);
    await redis.set(TOP_BOOKS_INDEX_KEY, ids);
  }
}

export async function deleteTopBook(id: string): Promise<void> {
  await redis.del(topBookKey(id));
  const ids = (await redis.get<string[]>(TOP_BOOKS_INDEX_KEY)) || [];
  await redis.set(TOP_BOOKS_INDEX_KEY, ids.filter((i) => i !== id));
}

// Keep for backward compat but shouldn't be needed
export async function setTopBooks(books: TopBook[]): Promise<void> {
  for (const book of books) {
    await redis.set(topBookKey(book.id), book);
  }
  await redis.set(TOP_BOOKS_INDEX_KEY, books.map((b) => b.id));
}

export async function getTopNLists(): Promise<TopNList[]> {
  const data = await redis.get<TopNList[]>(TOP_N_LISTS_KEY);
  return data ?? [];
}

export async function setTopNLists(lists: TopNList[]): Promise<void> {
  await redis.set(TOP_N_LISTS_KEY, lists);
}

// ── Top N Per-Account Automation ──

export interface TopNAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  listIds: string[];       // which lists to rotate through (empty = all)
  pointer: number;         // round-robin index
  frequencyDays: number;   // post every N days (1 = daily)
  lastPostDate?: string;   // YYYY-MM-DD of last successful post
  platform: "tiktok-carousel" | "tiktok-video" | "fb-video" | "ig-carousel" | "ig-video";
}

export interface TopNGlobalAutomation {
  accounts: Record<string, TopNAccountConfig>;
}

const TOPN_AUTOMATION_KEY = "topn-automation";

export async function getTopNAutomation(): Promise<TopNGlobalAutomation> {
  const data = await redis.get<TopNGlobalAutomation>(TOPN_AUTOMATION_KEY);
  return data ?? { accounts: {} };
}

export async function setTopNAutomation(config: TopNGlobalAutomation): Promise<void> {
  await redis.set(TOPN_AUTOMATION_KEY, config);
}

// ── Instagram Slideshows ──

export interface InstagramSlideshow {
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

export interface IgAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  bookIds: string[];        // which books to pull from (empty = all)
  slideshowIds: string[];   // specific slideshows (empty = all from selected books)
  pointer: number;          // round-robin index for this account
}

// ── Video Automation (separate stream from carousel) ──

export interface VideoAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  bookIds: string[];
  slideshowIds: string[];
  pointer: number;
  musicTrackIds: string[];  // random pick per post
  durationPerSlide: number; // seconds per slide (default 2)
}

export interface VideoAutomation {
  accounts: Record<string, VideoAccountConfig>;
}

const VIDEO_AUTOMATION_KEY = "video-automation";

export async function getVideoAutomation(): Promise<VideoAutomation> {
  const data = await redis.get<VideoAutomation>(VIDEO_AUTOMATION_KEY);
  return data ?? { accounts: {} };
}

export async function setVideoAutomation(config: VideoAutomation): Promise<void> {
  await redis.set(VIDEO_AUTOMATION_KEY, config);
}

export interface IgGlobalAutomation {
  enabled: boolean;
  accounts: Record<string, IgAccountConfig>; // accountId → config
  // Legacy fields (kept for backwards compat)
  igAccountIds?: number[];
  tiktokAccountIds?: number[];
  intervals?: TimeWindow[];
  igPointer?: number;
  accountBookIds?: Record<string, string[]>;
}

const IG_SLIDESHOWS_KEY = "ig-slideshows";
const IG_AUTOMATION_KEY = "ig-automation";

export async function getIgSlideshows(): Promise<InstagramSlideshow[]> {
  const data = await redis.get<InstagramSlideshow[]>(IG_SLIDESHOWS_KEY);
  return data ?? [];
}

export async function setIgSlideshows(
  slideshows: InstagramSlideshow[]
): Promise<void> {
  await redis.set(IG_SLIDESHOWS_KEY, slideshows);
}

export async function getIgAutomation(): Promise<IgGlobalAutomation> {
  const data = await redis.get<IgGlobalAutomation>(IG_AUTOMATION_KEY);
  return data ?? { enabled: false, accounts: {} };
}

export async function setIgAutomation(config: IgGlobalAutomation): Promise<void> {
  await redis.set(IG_AUTOMATION_KEY, config);
}

// ── Music Tracks ──

export interface MusicTrack {
  id: string;
  name: string;
  audioData: string; // base64 data URL (audio/mpeg or audio/mp4)
}

const MUSIC_INDEX_KEY = "music-tracks-index";

function musicTrackKey(id: string) {
  return `music-track:${id}`;
}

export async function getMusicTracks(): Promise<MusicTrack[]> {
  const ids = await redis.get<string[]>(MUSIC_INDEX_KEY);
  if (!ids || ids.length === 0) return [];
  const tracks: MusicTrack[] = [];
  for (const id of ids) {
    const track = await redis.get<MusicTrack>(musicTrackKey(id));
    if (track) tracks.push(track);
  }
  return tracks;
}

export async function getMusicTrack(id: string): Promise<MusicTrack | null> {
  return await redis.get<MusicTrack>(musicTrackKey(id));
}

export async function setMusicTrack(track: MusicTrack): Promise<void> {
  await redis.set(musicTrackKey(track.id), track);
  const ids = (await redis.get<string[]>(MUSIC_INDEX_KEY)) || [];
  if (!ids.includes(track.id)) {
    ids.push(track.id);
    await redis.set(MUSIC_INDEX_KEY, ids);
  }
}

export async function deleteMusicTrack(id: string): Promise<void> {
  await redis.del(musicTrackKey(id));
  const ids = (await redis.get<string[]>(MUSIC_INDEX_KEY)) || [];
  await redis.set(MUSIC_INDEX_KEY, ids.filter((i) => i !== id));
}

// ── Video Music Tracks (separate from Top N music) ──

const VIDEO_MUSIC_INDEX_KEY = "video-music-index";

function videoMusicKey(id: string) {
  return `video-music:${id}`;
}

export async function getVideoMusicTracks(): Promise<MusicTrack[]> {
  const ids = await redis.get<string[]>(VIDEO_MUSIC_INDEX_KEY);
  if (!ids || ids.length === 0) return [];
  const tracks: MusicTrack[] = [];
  for (const id of ids) {
    const track = await redis.get<MusicTrack>(videoMusicKey(id));
    if (track) tracks.push(track);
  }
  return tracks;
}

export async function getVideoMusicTrack(id: string): Promise<MusicTrack | null> {
  return await redis.get<MusicTrack>(videoMusicKey(id));
}

export async function setVideoMusicTrack(track: MusicTrack): Promise<void> {
  await redis.set(videoMusicKey(track.id), track);
  const ids = (await redis.get<string[]>(VIDEO_MUSIC_INDEX_KEY)) || [];
  if (!ids.includes(track.id)) {
    ids.push(track.id);
    await redis.set(VIDEO_MUSIC_INDEX_KEY, ids);
  }
}

export async function deleteVideoMusicTrack(id: string): Promise<void> {
  await redis.del(videoMusicKey(id));
  const ids = (await redis.get<string[]>(VIDEO_MUSIC_INDEX_KEY)) || [];
  await redis.set(VIDEO_MUSIC_INDEX_KEY, ids.filter((i) => i !== id));
}

// ── Settings ──

const SETTINGS_KEY = "app-settings";

export interface AppSettings {
  allowedAccountIds?: number[]; // empty or missing = show all
}

export async function getAppSettings(): Promise<AppSettings> {
  const data = await redis.get<AppSettings>(SETTINGS_KEY);
  return data ?? {};
}

export async function setAppSettings(settings: AppSettings): Promise<void> {
  await redis.set(SETTINGS_KEY, settings);
}

export async function listAutomatedAccounts(
  accountIds: number[]
): Promise<{ id: number; data: AccountData }[]> {
  const result: { id: number; data: AccountData }[] = [];
  for (const id of accountIds) {
    const data = await getAccountData(id);
    if (data.config.enabled) result.push({ id, data });
  }
  return result;
}

// ── Excerpts ──

export interface ExcerptImage {
  id: string;
  imageData: string;  // base64 data URL
  label?: string;
}

export interface Excerpt {
  id: string;
  name: string;
  bookId?: string;         // link to a book for grouping + cover slide
  imagePrompts: string[];  // AI prompts for generating the hook image (random pick)
  overlayTexts: string[];  // hook texts displayed on the hook image (random pick)
  extraImagePrompts?: string[];  // AI prompts for second hook image (random pick)
  extraOverlayTexts?: string[];  // texts for second hook slide (random pick)
  excerptImages: ExcerptImage[]; // uploaded book page screenshots (optional)
  // Legacy single-value fields (migrated to arrays on read)
  imagePrompt?: string;
  overlayText?: string;
  hookImage?: string;
}

const EXCERPTS_KEY = "excerpts";

export async function getExcerpts(): Promise<Excerpt[]> {
  const data = await redis.get<Excerpt[]>(EXCERPTS_KEY);
  if (!data) return [];
  // Migrate legacy single-value fields to arrays
  return data.map((e) => ({
    ...e,
    imagePrompts: e.imagePrompts?.length ? e.imagePrompts : e.imagePrompt ? [e.imagePrompt] : [],
    overlayTexts: e.overlayTexts?.length ? e.overlayTexts : e.overlayText ? [e.overlayText] : [],
    extraImagePrompts: e.extraImagePrompts || [],
    extraOverlayTexts: e.extraOverlayTexts || [],
    excerptImages: e.excerptImages || [],
  }));
}

export async function setExcerpts(excerpts: Excerpt[]): Promise<void> {
  await redis.set(EXCERPTS_KEY, excerpts);
}

// ── Excerpt Automation ──

export interface ExcerptAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  excerptIds: string[];   // which excerpts to post (empty = all)
  pointer: number;        // round-robin index
  platform: "tiktok" | "instagram";
}

export interface ExcerptAutomation {
  accounts: Record<string, ExcerptAccountConfig>; // accountId → config
}

const EXCERPT_AUTOMATION_KEY = "excerpt-automation";

export async function getExcerptAutomation(): Promise<ExcerptAutomation> {
  const data = await redis.get<ExcerptAutomation>(EXCERPT_AUTOMATION_KEY);
  return data ?? { accounts: {} };
}

export async function setExcerptAutomation(config: ExcerptAutomation): Promise<void> {
  await redis.set(EXCERPT_AUTOMATION_KEY, config);
}
