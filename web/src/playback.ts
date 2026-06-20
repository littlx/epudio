// 播放进度持久化：用 localStorage 记录每章播放位置，刷新/返回后可恢复
// 仿 theme.ts 模式：单一 STORAGE_KEY，存 Record<"bookId:index", seconds>
import type { BookMeta } from "./types";

const STORAGE_KEY = "epubmp3-playback";
const SAVE_THROTTLE_MS = 1000;

type PositionMap = Record<string, number>;

function readAll(): PositionMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map: PositionMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // 配额满或隐私模式，忽略
  }
}

function key(bookId: string, index: number): string {
  return `${bookId}:${index}`;
}

export function loadPosition(bookId: string, index: number): number | null {
  const v = readAll()[key(bookId, index)];
  return typeof v === "number" && v > 1 ? v : null;
}

let lastSaveAt = 0;
let lastValue = -1;

export function savePosition(bookId: string, index: number, sec: number): void {
  // 节流：至少间隔 SAVE_THROTTLE_MS，且值变化超过 1s 才写
  const now = Date.now();
  if (now - lastSaveAt < SAVE_THROTTLE_MS) return;
  if (Math.abs(sec - lastValue) < 1) return;
  lastSaveAt = now;
  lastValue = sec;
  const map = readAll();
  map[key(bookId, index)] = sec;
  writeAll(map);
}

export function clearPosition(bookId: string, index: number): void {
  const map = readAll();
  const k = key(bookId, index);
  if (k in map) {
    delete map[k];
    writeAll(map);
  }
}

// 清理某本书所有已不在 done 列表的章节进度（章节被重做后旧进度失效）
export function pruneBook(bookId: string, meta: BookMeta): void {
  const map = readAll();
  const doneKeys = new Set(
    meta.chapters.filter((c) => c.status === "done").map((c) => key(bookId, c.index))
  );
  let changed = false;
  for (const k of Object.keys(map)) {
    if (k.startsWith(`${bookId}:`) && !doneKeys.has(k)) {
      delete map[k];
      changed = true;
    }
  }
  if (changed) writeAll(map);
}
