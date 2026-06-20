// 与后端 app/schemas.py 对齐的类型定义

export type ChapterStatus =
  | "pending"
  | "interpreting"
  | "synthesizing"
  | "retrying"
  | "done"
  | "error";

export type Stage =
  | "idle"
  | "reading"
  | "calling_model"
  | "parsing"
  | "synthesizing_turns"
  | "concatenating"
  | "done"
  | "error";

export type InterpretStyle = "deep" | "casual" | "storytelling" | "dialogue" | "monologue";
export type Theme = "light" | "dark" | "system";

export interface Chapter {
  index: number;
  title: string;
  char_count: number;
  status: ChapterStatus;
  message: string;
  stage: Stage;
  stage_detail: string;
  progress: number;
  audio_seconds: number | null;
  attempts: number;
}

export interface BookMeta {
  book_id: string;
  title: string;
  author: string;
  cover: string | null;
  created_at: number;
  chapters: Chapter[];
  running: boolean;
}

export interface BookSummary {
  book_id: string;
  title: string;
  author: string;
  chapter_count: number;
  done_count: number;
  created_at: number;
}

export interface Turn {
  speaker: "甲" | "乙";
  text: string;
}

export interface Script {
  title: string;
  summary: string;
  turns: Turn[];
}

export interface Settings {
  style: InterpretStyle;
  turns_min: number;
  turns_max: number;
  voice_a: string;
  voice_b: string;
  concurrency: number;
  deepseek_rpm: number;
  edge_concurrency: number;
  theme: Theme;
}

export interface VoiceOption {
  id: string;
  name: string;
}

export interface SettingsResponse {
  settings: Settings;
  voice_options: VoiceOption[];
  has_api_key: boolean;
  model: string;
}

export interface GenerateRequest {
  chapters?: number[];
  reset?: boolean;
}

// SSE 事件
export interface SSEChapterEvent {
  type: "chapter";
  chapter: Chapter;
}

export interface SSEBookEvent {
  type: "book";
  running: boolean;
  done: number;
  total: number;
  errored: number;
}

export interface SSEDoneEvent {
  type: "done";
}
