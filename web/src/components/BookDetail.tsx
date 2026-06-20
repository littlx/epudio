// 书详情：章节列表（折叠+跳转）+ 多选生成/重做 + 失败概览 + 导出 + 删除 + 进度
import { useState, useEffect, useRef } from "preact/hooks";
import {
  currentBook,
  selectedIndexes,
  selectedCount,
  selectAll,
  selectPending,
  generateAll,
  generateSelected,
  regenerateSelected,
  deleteBook,
  showToast,
  updateBookTitle,
  regenerateChapter,
} from "../store";
import { api } from "../api";
import { ChapterRow } from "./ChapterRow";
import {
  IconDownload,
  IconTrash,
  IconRefresh,
  IconEdit,
  IconChevron,
  IconPlay,
} from "./icons";
import { getBookGradient } from "../utils";
import type { Chapter } from "../types";

export function BookDetail({ bookId }: { bookId: string }) {
  const meta = currentBook.value;

  // 注意：所有 hooks 必须在条件 return 之前调用
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [collapsedDone, setCollapsedDone] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (meta) setEditTitle(meta.title);
  }, [meta?.book_id, meta?.title]);

  if (!meta) {
    return (
      <div class="empty-state">
        <div class="skeleton" style={{ height: 60, marginBottom: 16 }} />
        <div class="skeleton" style={{ height: 200 }} />
      </div>
    );
  }

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
  const errorChapters = meta.chapters.filter((c) => c.status === "error");

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

  const scrollToFirstUndone = () => {
    const list = listRef.current;
    if (!list) return;
    const undone = meta.chapters.find(
      (c) => c.status !== "done"
    );
    if (!undone) {
      showToast("全部章节已完成", "info");
      return;
    }
    const el = list.querySelector<HTMLElement>(
      `[data-chapter-idx="${undone.index}"]`
    );
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleDelete = () => {
    if (confirm(`确定要删除《${meta.title}》吗？所有章节和音频数据将被永久删除！`)) {
      deleteBook(meta.book_id);
    }
  };

  // 折叠已完成时，把列表拆成 done（折叠为一行）与其余
  const visibleChapters: Chapter[] = collapsedDone
    ? meta.chapters.filter((c) => c.status !== "done")
    : meta.chapters;

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
            <div class="title-edit-form" style={{ marginBottom: 12 }}>
              <input
                type="text"
                class="title-edit-input"
                value={editTitle}
                onInput={(e) => setEditTitle((e.target as HTMLInputElement).value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
              <div class="title-edit-buttons">
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
            </div>
          ) : (
            <div class="book-title-meta-row">
              <span class="title-clickable" onClick={() => setIsEditing(true)} title="点击修改书名">
                {meta.title} <IconEdit size={14} class="inline-edit-icon" />
              </span>
              <span class="divider">·</span>
              <span class="author">{meta.author || "未知作者"}</span>
            </div>
          )}
          <div class="progress-section">
            <div class="progress-label">
              <span>已完成 {done}/{total} 章</span>
              <span>{Math.round(p)}%</span>
            </div>
            <div class="progress-bar">
              <div class="fill" style={{ width: `${p}%` }} />
            </div>
            <p
              class={
                "muted-status" +
                (err > 0 && !meta.running ? " clickable" : "")
              }
              onClick={() => err > 0 && !meta.running && setShowErrors((v) => !v)}
            >
              {meta.running
                ? "正在执行后台生成服务…"
                : err > 0
                ? `有 ${err} 章节生成失败，点击查看详情或勾选并重试`
                : "所有章节已处于最新状态"}
              {err > 0 && !meta.running && (
                <IconChevron
                  size={14}
                  style={{
                    marginLeft: 4,
                    transform: showErrors ? "rotate(180deg)" : "none",
                    transition: "transform 0.2s",
                    verticalAlign: "middle",
                  }}
                />
              )}
            </p>
            {showErrors && err > 0 && (
              <div class="error-panel">
                {errorChapters.map((c) => (
                  <div class="error-panel-row" key={c.index}>
                    <div class="error-panel-info">
                      <span class="error-panel-idx">第 {c.index + 1} 章</span>
                      <span class="error-panel-title">{c.title}</span>
                      <span class="error-panel-msg">{c.message}</span>
                    </div>
                    <button
                      class="btn sm"
                      onClick={() => regenerateChapter(c.index)}
                    >
                      <IconRefresh size={14} /> 重做
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div class="book-actions-bar">
            <div class="actions-group-left">
              {meta.running ? (
                <button class="btn-action primary running" disabled>
                  <span class="pulse-dot" />
                  正在后台生成中...
                </button>
              ) : selectedCount.value > 0 ? (
                <button class="btn-action primary" onClick={generateSelected}>
                  <IconPlay size={16} />
                  生成选中章节 ({selectedCount.value})
                </button>
              ) : (
                <button class="btn-action primary" onClick={generateAll}>
                  <IconPlay size={16} />
                  生成全部未完成
                </button>
              )}

              {selectedCount.value > 0 && !meta.running && (
                <button class="btn-action secondary" onClick={regenerateSelected}>
                  <IconRefresh size={16} />
                  重做选中 ({selectedCount.value})
                </button>
              )}

              {done > 0 && (
                <button class="btn-action secondary" onClick={handleExport}>
                  <IconDownload size={16} />
                  导出整书 ({done}/{total})
                </button>
              )}
            </div>

            <div class="actions-group-right">
              <button class="btn-action danger-outline" onClick={handleDelete} title="删除书籍">
                <IconTrash size={16} />
                <span>删除书籍</span>
              </button>
            </div>
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
          <button class="btn sm ghost" onClick={scrollToFirstUndone}>
            跳到未完成
          </button>
          {done > 0 && (
            <button
              class="btn sm ghost"
              onClick={() => setCollapsedDone((v) => !v)}
            >
              {collapsedDone ? `展开已完成(${done})` : `收起已完成(${done})`}
            </button>
          )}
          <span class="muted" style={{ marginLeft: "auto" }}>
            已选中 {selectedCount.value} / {total} 章
          </span>
        </div>

        <div class="chapter-list" ref={listRef}>
          {collapsedDone && done > 0 && (
            <div
              class="chapter-row collapsed-done-row"
              onClick={() => setCollapsedDone(false)}
            >
              <div class="checkbox" />
              <div class="idx">
                <IconChevron size={14} />
              </div>
              <div class="ch-main">
                <div class="ch-title muted">已完成 {done} 章（点击展开）</div>
              </div>
              <div class="ch-actions" />
            </div>
          )}
          {visibleChapters.map((ch) => (
            <div key={ch.index} data-chapter-idx={ch.index}>
              <ChapterRow bookId={bookId} chapter={ch} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
