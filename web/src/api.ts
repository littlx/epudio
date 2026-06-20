// 后端 API 封装 + SSE 订阅
import type {
  BookMeta,
  BookSummary,
  GenerateRequest,
  Script,
  Settings,
  SettingsResponse,
} from "./types";

const BASE = "/api";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = "请求失败";
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // 书籍
  listBooks: () => fetch(`${BASE}/books`).then(json<BookSummary[]>),

  uploadBook: (
    file: File,
    onProgress?: (loaded: number, total: number) => void
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    // 用 XMLHttpRequest 以获取上传进度（fetch 无法观测上传进度）
    return new Promise<BookMeta>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/books`);
      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded, e.total);
        };
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as BookMeta);
          } catch {
            reject(new Error("解析返回失败"));
          }
        } else {
          let detail = "上传失败";
          try {
            detail = JSON.parse(xhr.responseText).detail || detail;
          } catch {}
          reject(new Error(detail));
        }
      };
      xhr.onerror = () => reject(new Error("网络错误"));
      xhr.send(fd);
    });
  },

  getBook: (id: string) =>
    fetch(`${BASE}/books/${id}`).then(json<BookMeta>),

  deleteBook: (id: string) =>
    fetch(`${BASE}/books/${id}`, { method: "DELETE" }).then(json<{ message: string }>),

  updateBook: (id: string, req: { title: string }) =>
    fetch(`${BASE}/books/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then(json<BookSummary>),

  generate: (id: string, req: GenerateRequest) =>
    fetch(`${BASE}/books/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then(json<{ message: string }>),

  regenerateChapter: (id: string, n: number) =>
    fetch(`${BASE}/books/${id}/chapters/${n}/regenerate`, {
      method: "POST",
    }).then(json<{ message: string }>),

  deleteChapter: (id: string, n: number) =>
    fetch(`${BASE}/books/${id}/chapters/${n}`, {
      method: "DELETE",
    }).then(json<{ message: string }>),

  getScript: (id: string, n: number) =>
    fetch(`${BASE}/books/${id}/chapters/${n}/script`).then((res) => {
      if (!res.ok) throw new Error("请求失败");
      return res.json() as Promise<{ chapter_title: string; script: Script }>;
    }),

  updateScript: (id: string, n: number, script: Script) =>
    fetch(`${BASE}/books/${id}/chapters/${n}/script`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(script),
    }).then(json<{ message: string }>),

  audioUrl: (id: string, n: number) =>
    `${BASE}/books/${id}/chapters/${n}/audio`,

  exportBook: (id: string) =>
    fetch(`${BASE}/books/${id}/export`, { method: "POST" }).then((res) => {
      if (!res.ok) throw new Error("导出失败");
      return res.blob();
    }),

  // 设置
  getSettings: () => fetch(`${BASE}/settings`).then(json<SettingsResponse>),

  updateSettings: (s: Partial<Settings>) =>
    fetch(`${BASE}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    }).then(json<Settings>),

  previewVoice: (voice: string) =>
    fetch(`${BASE}/voices/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice }),
    }).then((res) => {
      if (!res.ok) throw new Error("试听失败");
      return res.blob();
    }),

  getConfig: () => fetch(`${BASE}/config`).then(json<any>),
};

// SSE 订阅：自动断线重连
export function subscribeBook(
  bookId: string,
  handlers: {
    onSnapshot?: (meta: BookMeta) => void;
    onChapter?: (chapter: BookMeta["chapters"][number]) => void;
    onBook?: (e: { running: boolean; done: number; total: number; errored: number }) => void;
    onDone?: () => void;
    onStateChange?: (state: "connecting" | "connected" | "error") => void;
  }
): () => void {
  let closed = false;
  let es: EventSource | null = null;
  let reconnectTimer: number | null = null;

  const connect = () => {
    if (closed) return;
    handlers.onStateChange?.("connecting");
    es = new EventSource(`${BASE}/books/${bookId}/stream`);

    es.onopen = () => {
      handlers.onStateChange?.("connected");
    };

    es.addEventListener("snapshot", (ev) => {
      handlers.onStateChange?.("connected");
      try {
        handlers.onSnapshot?.(JSON.parse((ev as MessageEvent).data));
      } catch {}
    });

    es.addEventListener("message", (ev) => {
      handlers.onStateChange?.("connected");
      try {
        const data = JSON.parse((ev as MessageEvent).data);
        if (data.type === "chapter" && handlers.onChapter) {
          handlers.onChapter(data.chapter);
        } else if (data.type === "book" && handlers.onBook) {
          handlers.onBook(data);
        } else if (data.type === "done" && handlers.onDone) {
          handlers.onDone();
        }
      } catch {}
    });

    es.onerror = () => {
      handlers.onStateChange?.("error");
      es?.close();
      es = null;
      if (!closed) {
        // 3 秒后重连
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    };
  };

  connect();

  return () => {
    closed = true;
    es?.close();
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}
