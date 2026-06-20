// 对谈文稿弹窗
import { useEffect, useState } from "preact/hooks";
import { scriptModal } from "../store";
import { api } from "../api";
import type { Script } from "../types";
import { IconClose } from "./icons";

export function ScriptModal() {
  const modal = scriptModal.value;
  const [script, setScript] = useState<Script | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!modal) {
      setScript(null);
      return;
    }
    setLoading(true);
    api
      .getScript(modal.bookId, modal.index)
      .then((res) => {
        setScript(res.script);
        setTitle(res.chapter_title);
      })
      .catch(() => setScript(null))
      .finally(() => setLoading(false));
  }, [modal?.bookId, modal?.index]);

  if (!modal) return null;

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) scriptModal.value = null;
      }}
    >
      <div class="modal">
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
                  <div class="speaker">{t.speaker}：</div>
                  <div>{t.text}</div>
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
