// 对谈文稿弹窗：预览 / 内联编辑（可增删 turn、改说话人），保存后重新合成
import { useEffect, useState, useRef } from "preact/hooks";
import { scriptModal, showToast } from "../store";
import { api } from "../api";
import type { Script, Turn } from "../types";
import { IconClose, IconEdit, IconPlus, IconTrash, IconRefresh } from "./icons";

export function ScriptModal() {
  const modal = scriptModal.value;
  const [render, setRender] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // 缓存上一次的 modal 信息，在关闭动画进行中依然可以用来渲染内容而不会突变为空
  const [lastModal, setLastModal] = useState<{ bookId: string; index: number } | null>(null);

  useEffect(() => {
    if (modal) {
      triggerRef.current = document.activeElement as HTMLElement;
      setLastModal(modal);
      setRender(true);
      const timer = setTimeout(() => {
        setAnimOpen(true);
        closeBtnRef.current?.focus();
      }, 50);

      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") scriptModal.value = null;
      };
      window.addEventListener("keydown", handleEsc);

      return () => {
        clearTimeout(timer);
        window.removeEventListener("keydown", handleEsc);
      };
    } else {
      setAnimOpen(false);
      const timer = setTimeout(() => {
        setRender(false);
        if (triggerRef.current) {
          triggerRef.current.focus();
          triggerRef.current = null;
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [modal]);

  const activeModal = modal || lastModal;
  const [script, setScript] = useState<Script | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Script | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeModal) return;
    setLoading(true);
    setEditing(false);
    setDraft(null);
    api
      .getScript(activeModal.bookId, activeModal.index)
      .then((res) => {
        setScript(res.script);
        setTitle(res.chapter_title);
      })
      .catch(() => setScript(null))
      .finally(() => setLoading(false));
  }, [activeModal?.bookId, activeModal?.index]);

  const startEdit = () => {
    if (!script) return;
    // 深拷贝成可编辑草稿
    setDraft({
      title: script.title,
      summary: script.summary,
      turns: script.turns.map((t) => ({ ...t })),
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(null);
  };

  const updateTurn = (i: number, patch: Partial<Turn>) => {
    if (!draft) return;
    const turns = draft.turns.map((t, idx) => (idx === i ? { ...t, ...patch } : t));
    setDraft({ ...draft, turns });
  };

  const removeTurn = (i: number) => {
    if (!draft) return;
    setDraft({ ...draft, turns: draft.turns.filter((_, idx) => idx !== i) });
  };

  const addTurn = () => {
    if (!draft) return;
    const last = draft.turns[draft.turns.length - 1];
    const speaker: "甲" | "乙" = last?.speaker === "甲" ? "乙" : "甲";
    setDraft({ ...draft, turns: [...draft.turns, { speaker, text: "" }] });
  };

  const saveEdit = async () => {
    if (!draft || !activeModal) return;
    const turns = draft.turns.filter((t) => t.text.trim());
    if (turns.length === 0) {
      showToast("至少需要一段内容", "error");
      return;
    }
    if (turns.some((t) => t.text.trim().length > 500)) {
      showToast("单段内容过长（>500字）", "error");
      return;
    }
    setSaving(true);
    try {
      await api.updateScript(activeModal.bookId, activeModal.index, {
        title: draft.title.trim() || "本期解读",
        summary: draft.summary.trim(),
        turns,
      });
      showToast("已保存，开始重新合成", "success");
      setScript({
        title: draft.title.trim() || "本期解读",
        summary: draft.summary.trim(),
        turns,
      });
      setEditing(false);
      setDraft(null);
    } catch (e: any) {
      showToast(e.message || "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab") {
      const container = e.currentTarget as HTMLElement;
      const focusables = Array.from(
        container.querySelectorAll(
          'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, [tabindex="0"]'
        )
      ) as HTMLElement[];
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  };

  if (!render || !activeModal) return null;

  const displayScript = editing ? draft : script;

  return (
    <div
      class={`modal-backdrop ${animOpen ? "open" : ""}`}
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) scriptModal.value = null;
      }}
      role="presentation"
    >
      <div
        class={`modal script-modal ${animOpen ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="script-title"
      >
        <div class="modal-head">
          <h3 id="script-title">{title || "解读文稿"}</h3>
          <div class="modal-head-actions">
            {!loading && script && !editing && (
              <button class="btn sm ghost" onClick={startEdit}>
                <IconEdit size={14} /> 编辑
              </button>
            )}
            {editing && (
              <>
                <button
                  class="btn sm"
                  onClick={saveEdit}
                  disabled={saving}
                >
                  <IconRefresh size={14} /> {saving ? "保存中…" : "保存并合成"}
                </button>
                <button class="btn sm ghost" onClick={cancelEdit}>
                  取消
                </button>
              </>
            )}
            <button
              ref={closeBtnRef}
              class="icon-btn"
              onClick={() => (scriptModal.value = null)}
              aria-label="关闭文稿"
            >
              <IconClose size={18} />
            </button>
          </div>
        </div>
        <div class="modal-body">
          {loading ? (
            <div class="skeleton" style={{ height: 200 }} />
          ) : !displayScript ? (
            <p class="muted">文稿暂不可用</p>
          ) : editing ? (
            <div class="script-editor">
              <div class="script-edit-field">
                <label>标题</label>
                <input
                  type="text"
                  class="title-edit-input"
                  value={draft!.title}
                  onInput={(e) =>
                    setDraft({
                      ...draft!,
                      title: (e.target as HTMLInputElement).value,
                    })
                  }
                />
              </div>
              <div class="script-edit-field">
                <label>摘要</label>
                <textarea
                  class="script-edit-textarea"
                  rows={2}
                  value={draft!.summary}
                  onInput={(e) =>
                    setDraft({
                      ...draft!,
                      summary: (e.target as HTMLTextAreaElement).value,
                    })
                  }
                />
              </div>
              <div class="script-edit-divider">对谈内容（{draft!.turns.length} 段）</div>
              {draft!.turns.map((t, i) => (
                <div class="turn-edit-row" key={i}>
                  <select
                    class="turn-edit-speaker"
                    value={t.speaker}
                    onChange={(e) =>
                      updateTurn(i, {
                        speaker: (e.target as HTMLSelectElement)
                          .value as "甲" | "乙",
                      })
                    }
                  >
                    <option value="甲">甲</option>
                    <option value="乙">乙</option>
                  </select>
                  <textarea
                    class="script-edit-textarea"
                    rows={2}
                    value={t.text}
                    placeholder="输入这一段内容…"
                    onInput={(e) =>
                      updateTurn(i, {
                        text: (e.target as HTMLTextAreaElement).value,
                      })
                    }
                  />
                  <button
                    class="icon-btn turn-edit-del"
                    title="删除该段"
                    onClick={() => removeTurn(i)}
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              ))}
              <button class="btn sm ghost script-add-turn" onClick={addTurn}>
                <IconPlus size={14} /> 添加一段
              </button>
              <p class="muted" style={{ fontSize: 12, marginTop: 8 }}>
                保存后将用编辑后的文稿重新合成音频，不会重新调用大模型解读。
              </p>
            </div>
          ) : (
            <>
              {script!.summary && (
                <div class="script-summary">{script!.summary}</div>
              )}
              {(script!.turns || []).map((t, i) => (
                <div
                  class={`turn speaker-${t.speaker === "甲" ? "a" : "b"}`}
                  key={i}
                >
                  <div class="speaker">{t.speaker}</div>
                  <div class="speech-bubble">{t.text}</div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
