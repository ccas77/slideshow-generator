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

export interface AutomationConfig {
  enabled: boolean;
  // Legacy fields (kept for migration)
  windowStart: string;
  windowEnd: string;
  windowStart2?: string;
  windowEnd2?: string;
  postsPerDay?: number;
  // New: array of posting intervals
  intervals?: TimeWindow[];
  bookId?: string;
  slideshowIds?: string[];
  selections?: Array<{ bookId: string; slideshowId: string }>;
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
  config: { enabled: false, windowStart: "18:00", windowEnd: "20:00" },
  prompts: [],
  texts: [],
  captions: [],
});

const key = (accountId: number) => `account:${accountId}`;

export async function getAccountData(accountId: number): Promise<AccountData> {
  const data = await redis.get<AccountData>(key(accountId));
  return data ?? defaultData();
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
  captions: string[]; // Pool of captions, one picked at random per publish
  backgroundPrompts?: string[]; // Pool of Gemini prompts, one picked at random per publish
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

export interface ExcerptSlide {
  id: string;
  type: "text-overlay" | "image" | "cover";
  imageData?: string;   // base64 data URL
  overlayText?: string; // text displayed on top (text-overlay type)
  label?: string;       // optional short label
}

export interface Excerpt {
  id: string;
  name: string;
  bookId?: string; // optional link to a book for grouping
  slides: ExcerptSlide[];
}

const EXCERPTS_KEY = "excerpts";

export async function getExcerpts(): Promise<Excerpt[]> {
  const data = await redis.get<Excerpt[]>(EXCERPTS_KEY);
  return data ?? [];
}

export async function setExcerpts(excerpts: Excerpt[]): Promise<void> {
  await redis.set(EXCERPTS_KEY, excerpts);
}
