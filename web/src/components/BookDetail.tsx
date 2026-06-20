// 书详情：章节列表 + 多选生成 + 导出 + 删除 + 进度
import { useState, useEffect } from "preact/hooks";
import {
  currentBook,
  selectedIndexes,
  selectedCount,
  selectAll,
  selectPending,
  generateAll,
  generateSelected,
  deleteBook,
  showToast,
  updateBookTitle,
} from "../store";
import { api } from "../api";
import { ChapterRow } from "./ChapterRow";
import { IconDownload, IconTrash, IconRefresh, IconEdit } from "./icons";
import { getBookGradient } from "../utils";

export function BookDetail({ bookId }: { bookId: string }) {
  const meta = currentBook.value;
  if (!meta) {
    return (
      <div class="empty-state">
        <div class="skeleton" style={{ height: 60, marginBottom: 16 }} />
        <div class="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(meta.title);

  useEffect(() => {
    setEditTitle(meta.title);
  }, [meta.book_id, meta.title]);

  const handleSave = () => {
    const t = editTitle.trim();
    if (!t) {
      showToast("书名不能为空", "error");
      return;
    }
    updateBookTitle(meta.book_id, t);
    setIsEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditTitle(meta.title);
      setIsEditing(false);
    }
  };

  const total = meta.chapters.length;
  const done = meta.chapters.filter((c) => c.status === "done").length;
  const err = meta.chapters.filter((c) => c.status === "error").length;
  const p = total ? (done / total) * 100 : 0;
  const allSelected = selectedIndexes.value.size === total && total > 0;

  const handleExport = async () => {
    try {
      showToast("正在打包导出…", "info");
      const blob = await api.exportBook(bookId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${meta.title}_有声解读.zip`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("导出完成", "success");
    } catch (e: any) {
      showToast(e.message || "导出失败", "error");
    }
  };

  return (
    <div class="book-detail-container">
      <div class="book-detail-hero">
        <div class="book-hero-cover" style={{ background: getBookGradient(meta.book_id) }}>
          <div class="cover-title">{meta.title}</div>
          <div class="cover-author">{meta.author || "未知作者"}</div>
          <div class="cover-spine" />
        </div>
        <div class="book-hero-info">
          {isEditing ? (
            <div class="title-edit-form">
              <input
                type="text"
                class="title-edit-input"
                value={editTitle}
                onInput={(e) => setEditTitle((e.target as HTMLInputElement).value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              <button class="btn sm" onClick={handleSave}>
                保存
              </button>
              <button
                class="btn sm ghost"
                onClick={() => {
                  setIsEditing(false);
                  setEditTitle(meta.title);
                }}
              >
                取消
              </button>
            </div>
          ) : (
            <h2
              class="book-title-heading"
              onClick={() => setIsEditing(true)}
              title="点击编辑书名"
            >
              {meta.title}
              <span class="edit-icon-indicator">
                <IconEdit size={16} />
              </span>
            </h2>
          )}
          <p class="author-name">{meta.author || "未知作者"}</p>
          <div class="progress-section">
            <div class="progress-label">
              <span>已完成 {done}/{total} 章</span>
              <span>{Math.round(p)}%</span>
            </div>
            <div class="progress-bar">
              <div class="fill" style={{ width: `${p}%` }} />
            </div>
            <p class="muted-status">
              {meta.running
                ? "正在执行后台生成服务…"
                : err > 0
                ? `有 ${err} 章节生成失败，您可以勾选并重试`
                : "所有章节已处于最新状态"}
            </p>
          </div>

          <div class="book-actions">
            <button class="btn" onClick={generateAll}>
              <IconRefresh size={16} /> 生成缺失
            </button>
            <button
              class="btn ghost"
              disabled={selectedCount.value === 0}
              onClick={generateSelected}
            >
              生成选中{selectedCount.value > 0 ? `(${selectedCount.value})` : ""}
            </button>
            {done > 0 && (
              <button class="btn ghost" onClick={handleExport}>
                <IconDownload size={16} /> 导出整书
              </button>
            )}
            <button class="btn danger" title="删除书籍" onClick={() => deleteBook(bookId)}>
              <IconTrash size={16} /> 删除
            </button>
          </div>
        </div>
      </div>

      <div class="book-detail-main">
        <div class="chapter-toolbar">
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => selectAll((e.target as HTMLInputElement).checked)}
            />{" "}
            全选章节
          </label>
          <button class="btn sm ghost" onClick={selectPending}>
            选中未完成
          </button>
          <span class="muted" style={{ marginLeft: "auto" }}>
            已选中 {selectedCount.value} / {total} 章
          </span>
        </div>

        <div class="chapter-list">
          {meta.chapters.map((ch) => (
            <ChapterRow key={ch.index} bookId={bookId} chapter={ch} />
          ))}
        </div>
      </div>
    </div>
  );
}
