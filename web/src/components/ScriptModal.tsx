// 对谈文稿弹窗
import { useEffect, useState } from "preact/hooks";
import { scriptModal } from "../store";
import { api } from "../api";
import type { Script } from "../types";
import { IconClose } from "./icons";

export function ScriptModal() {
  const modal = scriptModal.value;
  const [render, setRender] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);

  // 缓存上一次的 modal 信息，在关闭动画进行中依然可以用来渲染内容而不会突变为空
  const [lastModal, setLastModal] = useState<{ bookId: string; index: number } | null>(null);

  useEffect(() => {
    if (modal) {
      setLastModal(modal);
      setRender(true);
      const timer = setTimeout(() => setAnimOpen(true), 10);
      return () => clearTimeout(timer);
    } else {
      setAnimOpen(false);
      const timer = setTimeout(() => setRender(false), 200);
      return () => clearTimeout(timer);
    }
  }, [modal]);

  const activeModal = modal || lastModal;
  const [script, setScript] = useState<Script | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeModal) return;
    setLoading(true);
    api
      .getScript(activeModal.bookId, activeModal.index)
      .then((res) => {
        setScript(res.script);
        setTitle(res.chapter_title);
      })
      .catch(() => setScript(null))
      .finally(() => setLoading(false));
  }, [activeModal?.bookId, activeModal?.index]);

  if (!render || !activeModal) return null;

  return (
    <div
      class={`modal-backdrop ${animOpen ? "open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) scriptModal.value = null;
      }}
    >
      <div class={`modal ${animOpen ? "open" : ""}`}>
        <div class="modal-head">
          <h3>{title || "解读文稿"}</h3>
          <button class="icon-btn" onClick={() => (scriptModal.value = null)}>
            <IconClose size={18} />
          </button>
        </div>
        <div class="modal-body">
          {loading ? (
            <div class="skeleton" style={{ height: 200 }} />
          ) : script ? (
            <>
              {script.summary && (
                <div class="script-summary">{script.summary}</div>
              )}
              {(script.turns || []).map((t, i) => (
                <div
                  class={`turn speaker-${t.speaker === "甲" ? "a" : "b"}`}
                  key={i}
                >
                  <div class="speaker">{t.speaker}</div>
                  <div class="speech-bubble">{t.text}</div>
                </div>
              ))}
            </>
          ) : (
            <p class="muted">文稿暂不可用</p>
          )}
        </div>
      </div>
    </div>
  );
}
