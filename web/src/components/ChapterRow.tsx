// 单章行：复选框 + 标题 + 分阶段进度 + 状态徽章 + 播放/文稿/重做
import { useState } from "preact/hooks";
import {
  selectedIndexes,
  toggleSelect,
  togglePlay,
  isPlaying,
  regenerateChapter,
  scriptModal,
  deleteChapter,
} from "../store";
import type { Chapter, ChapterStatus } from "../types";
import { formatDuration, formatChars } from "../utils";
import {
  IconPlay,
  IconPause,
  IconDoc,
  IconRefresh,
  IconChevron,
  IconTrash,
} from "./icons";

const STATUS_LABEL: Record<ChapterStatus, string> = {
  pending: "待生成",
  interpreting: "解读中",
  synthesizing: "合成中",
  retrying: "重试中",
  done: "完成",
  error: "失败",
};

const STAGE_LABEL: Record<string, string> = {
  idle: "",
  reading: "读取原文",
  calling_model: "调用模型",
  parsing: "解析脚本",
  synthesizing_turns: "合成语音",
  concatenating: "拼接音频",
  done: "完成",
  error: "失败",
};

export function ChapterRow({
  bookId,
  chapter,
}: {
  bookId: string;
  chapter: Chapter;
}) {
  const checked = selectedIndexes.value.has(chapter.index);
  const playing = isPlaying(bookId, chapter.index);
  const inProgress = ["interpreting", "synthesizing", "retrying"].includes(
    chapter.status
  );
  const [expanded, setExpanded] = useState(false);

  const metaParts = [formatChars(chapter.char_count)];
  if (chapter.audio_seconds != null)
    metaParts.push(`音频 ${formatDuration(chapter.audio_seconds)}`);
  if (chapter.status === "error" && chapter.message)
    metaParts.push(chapter.message);

  const hasErrorDetail = chapter.status === "error" && !!chapter.error_detail;

  return (
    <div class={"chapter-row" + (chapter.status === "error" ? " has-error" : "")}>
      <div class="checkbox">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleSelect(chapter.index)}
        />
      </div>
      <div class="idx">{chapter.index + 1}</div>
      <div class="ch-main">
        <div class="ch-title">{chapter.title}</div>
        <div class="ch-stage">
          {inProgress && (
            <div class="stage-bar">
              <div
                class="stage-fill"
                style={{ width: `${Math.round(chapter.progress * 100)}%` }}
              />
            </div>
          )}
          <span>
            {inProgress
              ? chapter.stage_detail ||
                STAGE_LABEL[chapter.stage] ||
                chapter.message
              : metaParts.join(" · ")}
          </span>
          {hasErrorDetail && (
            <button
              class="error-toggle"
              title={expanded ? "收起详情" : "查看详情"}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
              }}
            >
              <IconChevron
                size={14}
                style={{
                  transform: expanded ? "rotate(180deg)" : "none",
                  transition: "transform 0.2s",
                }}
              />
            </button>
          )}
        </div>
        {hasErrorDetail && expanded && (
          <pre class="error-detail">{chapter.error_detail}</pre>
        )}
      </div>
      <div class="ch-actions">
        <span class={`status-badge status-${chapter.status}`}>
          <span class="dot" />
          {STATUS_LABEL[chapter.status]}
        </span>
        {chapter.status === "done" && (
          <>
            <button
              class={`icon-btn play-btn ${playing ? "playing" : ""}`}
              title={playing ? "暂停" : "播放"}
              onClick={() => togglePlay(bookId, chapter.index)}
            >
              {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
            </button>
            <button
              class="icon-btn"
              title="查看文稿"
              onClick={() =>
                (scriptModal.value = { bookId, index: chapter.index })
              }
            >
              <IconDoc size={18} />
            </button>
            <button
              class="icon-btn"
              title="重做"
              onClick={() => regenerateChapter(chapter.index)}
            >
              <IconRefresh size={16} />
            </button>
          </>
        )}
        {chapter.status === "error" && (
          <button
            class="btn sm"
            title="重做"
            onClick={() => regenerateChapter(chapter.index)}
          >
            <IconRefresh size={14} /> 重做
          </button>
        )}
        {chapter.status !== "interpreting" &&
          chapter.status !== "synthesizing" &&
          chapter.status !== "retrying" && (
            <button
              class="icon-btn delete-btn"
              title="删除章节"
              onClick={() => deleteChapter(bookId, chapter.index)}
            >
              <IconTrash size={16} />
            </button>
          )}
      </div>
    </div>
  );
}
