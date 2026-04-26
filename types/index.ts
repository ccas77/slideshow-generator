export interface TikTokAccount {
  id: number;
  username: string;
}

export interface GeneratedSlideshow {
  image: string | null;
  texts: string[];
}

export interface SavedItem {
  name: string;
  value: string;
}

export interface TimeWindow {
  start: string;
  end: string;
}

export interface AutomationConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  selections: Array<{ bookId: string; slideshowId: string }>;
}

export interface NamedItem {
  id: string;
  name: string;
  value: string;
}

export interface Slideshow {
  id: string;
  name: string;
  slideTexts: string;
  imagePromptIds: string[];
  captionIds: string[];
}

export interface Book {
  id: string;
  name: string;
  coverImage?: string;
  imagePrompts: NamedItem[];
  captions: NamedItem[];
  slideshows: Slideshow[];
}

export interface AccountData {
  config: AutomationConfig;
  prompts: SavedItem[];
  texts: SavedItem[];
  captions: SavedItem[];
  lastRun?: string;
  lastStatus?: string;
}

export type Tab = "automation" | "post-now";
