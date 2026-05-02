export interface Job {
  acc: { id: number; username: string };
  win: { start: string; end: string };
  imagePrompt: string;
  slideTexts: string[];
  captionText: string;
  source: string;
  coverImage?: string;
  schedKey: string;
}

export interface CronAccountResult {
  accountId: number;
  username: string;
  status: string;
}

export interface TopNResult {
  listName: string;
  status: string;
}

export interface IgAutoResult {
  status: string;
}

export interface VideoAutoResult {
  status: string;
}

export interface ExcerptAutoResult {
  status: string;
}
