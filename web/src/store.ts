// 全一全局 store：用 preact signals 管理应用状态
import { signal, computed } from "@preact/signals";
import type { BookMeta, BookSummary, Settings, SettingsResponse } from "./types";
import { api, subscribeBook } from "./api";
import { clearPosition, pruneBook } from "./playback";

// ---- 视图路由 ----
export type View = { name: "shelf" } | { name: "book"; bookId: string };
export const view = signal<View>({ name: "shelf" });

// ---- 书架 ----
export const books = signal<BookSummary[]>([]);
export const shelfLoading = signal(false);

// ---- 当前书 ----
export const currentBook = signal<BookMeta | null>(null);
let unsubSSE: (() => void) | null = null;

// ---- 选中章节 ----
export const selectedIndexes = signal<Set<number>>(new Set());

// ---- 全局播放器 ----
export interface PlayerState {
  bookId: string | null;
  index: number | null;
  paused: boolean;
}
export const player = signal<PlayerState>({
  bookId: null,
  index: null,
  paused: true,
});
// 播放来源书的可播章节列表
let playingDoneList: number[] = [];
// 缓存的书籍元数据（用于跨书播放时取标题/章节）
const bookCache = new Map<string, BookMeta>();

// ---- 设置 ----
export const settings = signal<Settings | null>(null);
export const voiceOptions = signal<{ id: string; name: string }[]>([]);
export const hasApiKey = signal(false);

// ---- Toast ----
export const toast = signal<{ text: string; kind: "info" | "error" | "success" } | null>(null);
let toastTimer: number | null = null;
export function showToast(text: string, kind: "info" | "error" | "success" = "info") {
  toast.value = { text, kind };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = null), 3000);
}

// ---- 设置抽屉 ----
export const settingsOpen = signal(false);

// ---- 文稿弹窗 ----
export const scriptModal = signal<{ bookId: string; index: number } | null>(null);

// ---- 动作 ----
export async function loadBooks() {
  shelfLoading.value = true;
  try {
    books.value = await api.listBooks();
  } catch (e) {
    showToast("加载书架失败", "error");
  } finally {
    shelfLoading.value = false;
  }
}

export async function loadSettings() {
  try {
    const res: SettingsResponse = await api.getSettings();
    settings.value = res.settings;
    voiceOptions.value = res.voice_options;
    hasApiKey.value = res.has_api_key;
  } catch {}
}

export function goShelf() {
  window.location.hash = "#/";
}

export function goBook(bookId: string) {
  window.location.hash = `#/book/${bookId}`;
}

export function parseLocation(): View {
  const hash = window.location.hash;
  if (hash.startsWith("#/book/")) {
    const id = hash.replace("#/book/", "");
    if (id) return { name: "book", bookId: id };
  }
  return { name: "shelf" };
}

export async function syncRoute() {
  const dest = parseLocation();
  if (dest.name === "shelf") {
    view.value = { name: "shelf" };
    if (unsubSSE) {
      unsubSSE();
      unsubSSE = null;
    }
    selectedIndexes.value = new Set();
    currentBook.value = null;
    await loadBooks();
  } else {
    const bookId = dest.bookId;
    view.value = { name: "book", bookId };
    selectedIndexes.value = new Set();
    try {
      const meta = await api.getBook(bookId);
      currentBook.value = meta;
      bookCache.set(bookId, meta);
      subscribeSSE(bookId);
    } catch {
      showToast("加载书籍失败", "error");
    }
  }
}

function subscribeSSE(bookId: string) {
  if (unsubSSE) unsubSSE();
  unsubSSE = subscribeBook(bookId, {
    onSnapshot: (meta) => {
      currentBook.value = meta;
      bookCache.set(bookId, meta);
    },
    onChapter: (ch) => {
      const meta = currentBook.value;
      if (!meta) return;
      const chapters = meta.chapters.map((c) =>
        c.index === ch.index ? ch : c
      );
      currentBook.value = { ...meta, chapters };
      bookCache.set(bookId, { ...meta, chapters });
    },
    onBook: () => {
      // 书级状态变化时重新拉一次完整 meta（含 running）
      api.getBook(bookId).then((meta) => {
        currentBook.value = meta;
        bookCache.set(bookId, meta);
      });
    },
    onDone: () => {
      api.getBook(bookId).then((meta) => {
        currentBook.value = meta;
        bookCache.set(bookId, meta);
      });
    },
  });
}

// ---- 选择管理 ----
export function toggleSelect(index: number) {
  const s = new Set(selectedIndexes.value);
  if (s.has(index)) s.delete(index);
  else s.add(index);
  selectedIndexes.value = s;
}

export function selectAll(selected: boolean) {
  const meta = currentBook.value;
  if (!meta) return;
  if (selected) {
    selectedIndexes.value = new Set(meta.chapters.map((c) => c.index));
  } else {
    selectedIndexes.value = new Set();
  }
}

export function selectPending() {
  const meta = currentBook.value;
  if (!meta) return;
  selectedIndexes.value = new Set(
    meta.chapters.filter((c) => c.status !== "done").map((c) => c.index)
  );
}

export const selectedCount = computed(() => selectedIndexes.value.size);

// ---- 生成 ----
export async function generateAll() {
  const meta = currentBook.value;
  if (!meta) return;
  try {
    await api.generate(meta.book_id, { reset: false });
    showToast("已开始生成", "success");
  } catch (e: any) {
    showToast(e.message || "启动失败", "error");
  }
}

export async function generateSelected() {
  const meta = currentBook.value;
  if (!meta || selectedIndexes.value.size === 0) return;
  const indexes = Array.from(selectedIndexes.value).sort((a, b) => a - b);
  try {
    await api.generate(meta.book_id, { chapters: indexes, reset: false });
    showToast(`已开始生成 ${indexes.length} 章`, "success");
    selectedIndexes.value = new Set();
  } catch (e: any) {
    showToast(e.message || "启动失败", "error");
  }
}

export async function regenerateChapter(index: number) {
  const meta = currentBook.value;
  if (!meta) return;
  try {
    await api.regenerateChapter(meta.book_id, index);
    showToast("已开始重做", "info");
  } catch (e: any) {
    showToast(e.message || "重做失败", "error");
  }
}

export async function regenerateSelected() {
  const meta = currentBook.value;
  if (!meta || selectedIndexes.value.size === 0) return;
  // 仅对 done / error 章节重做有实际意义
  const targets = Array.from(selectedIndexes.value)
    .filter((i) => {
      const ch = meta.chapters.find((c) => c.index === i);
      return ch && (ch.status === "done" || ch.status === "error");
    })
    .sort((a, b) => a - b);
  if (targets.length === 0) {
    showToast("选中章节无可重做项", "info");
    return;
  }
  let ok = 0;
  let fail = 0;
  for (const i of targets) {
    try {
      await api.regenerateChapter(meta.book_id, i);
      ok++;
    } catch {
      fail++;
    }
  }
  if (fail === 0) {
    showToast(`已开始重做 ${ok} 章`, "success");
  } else {
    showToast(`重做 ${ok} 章，失败 ${fail} 章`, "info");
  }
  selectedIndexes.value = new Set();
}

export async function deleteBook(bookId: string) {
  try {
    await api.deleteBook(bookId);
    showToast("已删除", "info");
    goShelf();
  } catch (e: any) {
    showToast(e.message || "删除失败", "error");
  }
}

export async function deleteChapter(bookId: string, index: number) {
  if (currentBook.value?.running) {
    showToast("该书正在生成中，暂无法删除章节", "error");
    return;
  }
  if (!confirm("确定要删除这一章吗？该操作不可恢复。")) {
    return;
  }
  try {
    await api.deleteChapter(bookId, index);
    showToast("章节已删除", "success");
    if (selectedIndexes.value.has(index)) {
      const s = new Set(selectedIndexes.value);
      s.delete(index);
      selectedIndexes.value = s;
    }
    if (currentBook.value && currentBook.value.book_id === bookId) {
      const chapters = currentBook.value.chapters.filter((c) => c.index !== index);
      currentBook.value = { ...currentBook.value, chapters };
      bookCache.set(bookId, currentBook.value);
    }
  } catch (e: any) {
    showToast(e.message || "删除失败", "error");
  }
}

export async function updateBookTitle(bookId: string, title: string) {
  try {
    await api.updateBook(bookId, { title });
    if (currentBook.value && currentBook.value.book_id === bookId) {
      currentBook.value = { ...currentBook.value, title };
      bookCache.set(bookId, currentBook.value);
    }
    books.value = books.value.map((b) =>
      b.book_id === bookId ? { ...b, title } : b
    );
    showToast("修改成功", "success");
  } catch (e: any) {
    showToast(e.message || "修改书名失败", "error");
  }
}

// ---- 播放 ----
export async function togglePlay(bookId: string, index: number) {
  const cur = player.value;
  if (cur.bookId === bookId && cur.index === index) {
    // 同一章：切换播放/暂停（由 GlobalPlayer 执行）
    player.value = { ...cur, paused: !cur.paused };
    return;
  }
  await playChapter(bookId, index);
}

async function playChapter(bookId: string, index: number) {
  // 确保缓存了该书元数据，用于续播列表
  if (!bookCache.has(bookId)) {
    try {
      const meta = await api.getBook(bookId);
      bookCache.set(bookId, meta);
    } catch {}
  }
  const meta = bookCache.get(bookId);
  if (meta) {
    playingDoneList = meta.chapters
      .filter((c) => c.status === "done")
      .map((c) => c.index)
      .sort((a, b) => a - b);
    // 清理该书已不在 done 列表的章节旧进度
    pruneBook(bookId, meta);
  }
  player.value = { bookId, index, paused: false };
}

// 播放来源书的标题
export function playingTitle(): string {
  const meta = bookCache.get(player.value.bookId || "");
  if (!meta) return "";
  const ch = meta.chapters.find((c) => c.index === player.value.index);
  return `${meta.title} · ${ch?.title ?? ""}`;
}

// 自动续下一章
export function onTrackEnded() {
  const cur = player.value;
  if (!cur.bookId || cur.index == null) return;
  // 本章已听完，清除其进度
  clearPosition(cur.bookId, cur.index);
  const pos = playingDoneList.indexOf(cur.index);
  if (pos !== -1 && pos + 1 < playingDoneList.length) {
    playChapter(cur.bookId, playingDoneList[pos + 1]);
  } else {
    player.value = { bookId: null, index: null, paused: true };
  }
}

export function playPrev() {
  const cur = player.value;
  if (!cur.bookId || cur.index == null) return;
  const pos = playingDoneList.indexOf(cur.index);
  if (pos > 0) playChapter(cur.bookId, playingDoneList[pos - 1]);
}

export function playNext() {
  const cur = player.value;
  if (!cur.bookId || cur.index == null) return;
  const pos = playingDoneList.indexOf(cur.index);
  if (pos !== -1 && pos + 1 < playingDoneList.length)
    playChapter(cur.bookId, playingDoneList[pos + 1]);
}

export function isPlaying(bookId: string, index: number): boolean {
  const cur = player.value;
  return cur.bookId === bookId && cur.index === index && !cur.paused;
}

export function audioUrlFor(bookId: string, index: number): string {
  return api.audioUrl(bookId, index);
}
