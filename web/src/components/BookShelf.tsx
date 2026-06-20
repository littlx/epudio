// 书架：上传 + 书籍卡片网格 + 进度环
import { useRef, useState } from "preact/hooks";
import { books, shelfLoading, goBook, loadBooks, showToast } from "../store";
import { api } from "../api";
import type { BookSummary } from "../types";
import { formatTime, pct } from "../utils";
import { IconUpload, IconBook } from "./icons";

export function BookShelf() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".epub")) {
      showToast("请上传 .epub 文件", "error");
      return;
    }
    setUploading(true);
    try {
      const meta = await api.uploadBook(file);
      showToast(`解析成功，共 ${meta.chapters.length} 章`, "success");
      await loadBooks();
      goBook(meta.book_id);
    } catch (e: any) {
      showToast(e.message || "上传失败", "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div
        class={"upload-zone" + (dragOver ? " dragover" : "")}
        onClick={() => fileRef.current?.click()}
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
          {uploading ? "解析中…" : "点击或拖拽上传 EPUB"}
        </p>
        <p class="muted" style={{ marginTop: 4 }}>
          上传后自动解析章节，每章生成一段深度对谈解读
        </p>
      </div>

      <h2 class="section-title">书架</h2>
      {shelfLoading.value ? (
        <div class="book-grid">
          {[0, 1, 2].map((i) => (
            <div class="skeleton" style={{ height: 220 }} key={i} />
          ))}
        </div>
      ) : books.value.length === 0 ? (
        <div class="empty-state">
          <div class="emoji">📚</div>
          <p>书架空空如也，上传一本开始吧</p>
        </div>
      ) : (
        <div class="book-grid">
          {books.value.map((b) => (
            <BookCard key={b.book_id} book={b} />
          ))}
        </div>
      )}
    </div>
  );
}

function BookCard({ book }: { book: BookSummary }) {
  const p = pct(book.done_count, book.chapter_count);
  return (
    <div class="book-card" onClick={() => goBook(book.book_id)}>
      <div class="cover">
        <IconBook size={40} />
      </div>
      <div class="body">
        <div class="title">{book.title}</div>
        <div
          class="meta"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 8,
          }}
        >
          <span>
            {book.author || "未知作者"} · {book.chapter_count}章
          </span>
          {p > 0 && (
            <div class="progress-ring" style={{ "--pct": p } as any}>
              <span class="pct-txt">{p}%</span>
            </div>
          )}
        </div>
        <div class="meta" style={{ marginTop: 4 }}>
          {formatTime(book.created_at)} · {book.done_count}/{book.chapter_count}已完成
        </div>
      </div>
    </div>
  );
}
