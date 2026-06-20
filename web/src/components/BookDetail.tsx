// 书详情：章节列表 + 多选生成 + 导出 + 删除 + 进度
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
} from "../store";
import { api } from "../api";
import { ChapterRow } from "./ChapterRow";
import { IconDownload, IconTrash, IconRefresh } from "./icons";

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
    <div>
      <div class="book-header">
        <div>
          <h2>{meta.title}</h2>
          <p class="muted">
            {meta.author || "未知作者"} · 共 {total} 章
            {err > 0 && ` · 失败 ${err}`}
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
            生成选中 ({selectedCount.value})
          </button>
          {done > 0 && (
            <button class="btn ghost" onClick={handleExport}>
              <IconDownload size={16} /> 导出
            </button>
          )}
          <button class="btn danger" onClick={() => deleteBook(bookId)}>
            <IconTrash size={16} />
          </button>
        </div>
      </div>

      <div class="progress-bar">
        <div class="fill" style={{ width: `${p}%` }} />
      </div>
      <p class="muted" style={{ margin: "8px 0 0" }}>
        已完成 {done}/{total}
        {meta.running ? " · 生成中…" : err > 0 ? " · 有失败章节可重做" : ""}
      </p>

      <div class="chapter-toolbar">
        <label>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => selectAll((e.target as HTMLInputElement).checked)}
          />{" "}
          全选
        </label>
        <button class="btn sm ghost" onClick={selectPending}>
          选中未完成
        </button>
        <span class="muted" style={{ marginLeft: "auto" }}>
          已选 {selectedCount.value} 章
        </span>
      </div>

      <div class="chapter-list">
        {meta.chapters.map((ch) => (
          <ChapterRow key={ch.index} bookId={bookId} chapter={ch} />
        ))}
      </div>
    </div>
  );
}
