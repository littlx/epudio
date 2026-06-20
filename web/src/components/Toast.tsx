// 轻提示 Toast
import { toasts, removeToast } from "../store";

export function Toast() {
  const list = toasts.value;
  if (list.length === 0) return null;

  return (
    <div class="toasts-container" style={{ position: "fixed", top: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", gap: 12, pointerEvents: "none" }}>
      {list.map((t) => (
        <div
          key={t.id}
          class={`toast ${t.kind}`}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            minWidth: 260,
            maxWidth: 400,
            padding: "12px 16px",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-md)",
            background: t.kind === "success" ? "linear-gradient(135deg, var(--success) 0%, rgba(16, 185, 129, 0.85) 100%)" : t.kind === "error" ? "linear-gradient(135deg, var(--danger) 0%, rgba(220, 38, 38, 0.85) 100%)" : "rgba(17, 19, 30, 0.95)",
            color: "#fff",
          }}
        >
          <div style={{ fontSize: 13, lineHeight: 1.4, flex: 1 }}>{t.text}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {t.action && (
              <button
                class="btn sm"
                onClick={() => {
                  t.action?.onClick();
                  removeToast(t.id);
                }}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  background: "rgba(255, 255, 255, 0.2)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              onClick={() => removeToast(t.id)}
              style={{
                background: "none",
                border: "none",
                color: "rgba(255, 255, 255, 0.6)",
                cursor: "pointer",
                fontSize: 16,
                fontWeight: "bold",
                padding: "2px 6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="关闭"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
