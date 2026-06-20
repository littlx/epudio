// 书架：上传（带进度）+ 搜索/筛选 + 书籍卡片网格 + running 徽标
import { useRef, useState } from "preact/hooks";
import { books, shelfLoading, goBook, loadBooks, showToast } from "../store";
import { api } from "../api";
import type { BookSummary } from "../types";
import { formatTime, pct, getBookGradient } from "../utils";
import { IconUpload, IconBook, IconSearch } from "./icons";

type ShelfFilter = "all" | "undone" | "done" | "running";

const FILTERS: { value: ShelfFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "running", label: "生成中" },
  { value: "undone", label: "未完成" },
  { value: "done", label: "已完成" },
];

export function BookShelf() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShelfFilter>("all");

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".epub")) {
      showToast("请上传 .epub 文件", "error");
      return;
    }
    setUploading(true);
    setUploadPct(0);
    try {
      const meta = await api.uploadBook(file, (loaded, total) => {
        setUploadPct(total ? Math.round((loaded / total) * 100) : 0);
      });
      showToast(`解析成功，共 ${meta.chapters.length} 章`, "success");
      await loadBooks();
      goBook(meta.book_id);
    } catch (e: any) {
      showToast(e.message || "上传失败", "error");
    } finally {
      setUploading(false);
      setUploadPct(0);
    }
  };

  const q = query.trim().toLowerCase();
  const filtered = books.value.filter((b) => {
    if (q && !`${b.title} ${b.author}`.toLowerCase().includes(q)) return false;
    if (filter === "done") return b.done_count === b.chapter_count && b.chapter_count > 0;
    if (filter === "undone") return b.done_count < b.chapter_count;
    if (filter === "running") return b.running;
    return true;
  });

  return (
    <div>
      <div
        class={"upload-zone" + (dragOver ? " dragover" : "")}
        onClick={() => !uploading && fileRef.current?.click()}
        onKeyDown={(e) => {
          if (!uploading && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        role="button"
        tabIndex={uploading ? -1 : 0}
        aria-label="上传电子书，支持 EPUB 格式"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer?.files?.[0];
          if (f) handleFile(f);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".epub"
          onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            if (f) handleFile(f);
          }}
        />
        <IconUpload size={32} />
        <p style={{ marginTop: 12, fontWeight: 600 }}>
          {uploading
            ? uploadPct > 0 && uploadPct < 100
              ? `上传中 ${uploadPct}%`
              : "解析中…"
            : "点击或拖拽上传 EPUB"}
        </p>
        <p class="muted" style={{ marginTop: 4 }}>
          上传后自动解析章节，每章生成一段深度对谈解读
        </p>
        {uploading && (
          <div class="upload-progress">
            <div
              class="upload-progress-fill"
              style={{ width: `${uploadPct >= 100 ? 100 : uploadPct}%` }}
            />
          </div>
        )}
      </div>

      <h2 class="section-title">书架</h2>

      {books.value.length > 0 && (
        <>
          <div class="shelf-toolbar">
            <div class="shelf-search" style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <IconSearch size={16} />
              <input
                type="text"
                placeholder="搜索书名或作者"
                value={query}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                style={{ paddingRight: 32 }}
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  style={{
                    position: "absolute",
                    right: 8,
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: 18,
                    padding: "2px 8px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="清空搜索"
                  aria-label="清空搜索"
                >
                  ×
                </button>
              )}
            </div>
            <div class="shelf-filter-bar">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  class={`btn sm ${filter === f.value ? "" : "ghost"}`}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div class="shelf-info-bar" style={{ marginTop: 8, marginBottom: 16, fontSize: 12, color: "var(--text-muted)", display: "flex", justifyContent: "flex-end" }}>
            <span>已筛选出 {filtered.length} 本书（共 {books.value.length} 本）</span>
          </div>
        </>
      )}

      {shelfLoading.value ? (
        <div class="book-grid">
          {[0, 1, 2].map((i) => (
            <div class="skeleton" style={{ height: 220 }} key={i} />
          ))}
        </div>
      ) : books.value.length === 0 ? (
        <div class="empty-state">
          <IconBook size={48} class="icon" />
          <p>书架空空如也，上传一本开始吧</p>
        </div>
      ) : filtered.length === 0 ? (
        <div class="empty-state">
          <IconSearch size={40} class="icon" />
          <p>没有匹配的书籍</p>
        </div>
      ) : (
        <div class="book-grid">
          {filtered.map((b) => (
            <BookCard key={b.book_id} book={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookCard({ book }: { book: BookSummary }) {
  const p = pct(book.done_count, book.chapter_count);
  
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      goBook(book.book_id);
    }
  };

  return (
    <div
      class="book-card"
      onClick={() => goBook(book.book_id)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`书籍卡片：${book.title}，作者：${book.author || "未知"}，进度 ${p}%`}
    >
      <div class="cover" style={{ background: getBookGradient(book.book_id) }}>
        <div class="cover-title">{book.title}</div>
        <div class="cover-author">{book.author || "未知作者"}</div>
        <div class="cover-spine" />
        {book.running && (
          <div class="shelf-running-badge">
            <span class="dot" />生成中
          </div>
        )}
      </div>
      <div class="body">
        <div class="meta-title-row">
          <span class="book-meta-chapters">{book.chapter_count} 章节</span>
          <span class="book-meta-done">{book.done_count}已完成</span>
        </div>
        {book.chapter_count > 0 && (
          <div class="book-progress-bar">
            <div class="fill" style={{ width: `${p}%` }} />
          </div>
        )}
        <div class="meta-footer">
          <span class="pct-txt">{p}% 已就绪</span>
          <span class="meta-date">{formatTime(book.created_at)}</span>
        </div>
      </div>
    </div>
  );
}
