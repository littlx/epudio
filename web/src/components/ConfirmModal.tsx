import { useEffect, useState, useRef } from "preact/hooks";
import { confirmModal } from "../store";
import { IconClose } from "./icons";

export function ConfirmModal() {
  const config = confirmModal.value;
  const [render, setRender] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (config) {
      triggerRef.current = document.activeElement as HTMLElement;
      setRender(true);
      const timer = setTimeout(() => setAnimOpen(true), 10);

      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") confirmModal.value = null;
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
  }, [config]);

  useEffect(() => {
    if (render && cancelBtnRef.current) {
      cancelBtnRef.current.focus();
    }
  }, [render]);

  if (!render || !config) return null;

  const handleConfirm = async () => {
    confirmModal.value = null;
    await config.onConfirm();
  };

  const handleCancel = () => {
    confirmModal.value = null;
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Tab") {
      const focusable = [cancelBtnRef.current, confirmBtnRef.current].filter(Boolean);
      if (focusable.length < 2) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
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

  return (
    <div
      class={`modal-backdrop ${animOpen ? "open" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <div class={`modal confirm-modal ${animOpen ? "open" : ""}`} style={{ maxWidth: 400 }}>
        <div class="modal-head">
          <h3 id="confirm-title">{config.title}</h3>
          <button class="icon-btn" onClick={handleCancel} aria-label="关闭">
            <IconClose size={18} />
          </button>
        </div>
        <div class="modal-body" style={{ padding: "16px 20px" }}>
          <p class="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            {config.message}
          </p>
        </div>
        <div class="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
          <button
            ref={cancelBtnRef}
            class="btn sm ghost"
            onClick={handleCancel}
          >
            {config.cancelText || "取消"}
          </button>
          <button
            ref={confirmBtnRef}
            class={`btn sm ${config.isDangerous ? "danger" : "primary"}`}
            onClick={handleConfirm}
          >
            {config.confirmText || "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}
