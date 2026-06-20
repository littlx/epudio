// 应用外壳：顶栏 + 主题切换 + 全局播放器 + 视图路由 + 抽屉/弹窗
import { useEffect } from "preact/hooks";
import {
  view,
  goShelf,
  loadBooks,
  loadSettings,
  settingsOpen,
  hasApiKey,
} from "../store";
import { themeChoice, setTheme } from "../theme";
import { GlobalPlayer } from "./GlobalPlayer";
import { BookShelf } from "./BookShelf";
import { BookDetail } from "./BookDetail";
import { SettingsPanel } from "./SettingsPanel";
import { ScriptModal } from "./ScriptModal";
import { Toast } from "./Toast";
import { IconSun, IconMoon, IconSettings, IconBack, IconAlert } from "./icons";

export function AppShell() {
  useEffect(() => {
    loadBooks();
    loadSettings();
  }, []);

  const v = view.value;

  return (
    <div class="app-root">
      <header class="topbar">
        <div class="brand" onClick={goShelf}>
          <span class="logo-mark">🎙️</span>
          <h1>EPUB 有声解读</h1>
        </div>
        <div class="topbar-actions">
          {v.name === "book" && (
            <button class="icon-btn" title="返回书架" onClick={goShelf}>
              <IconBack size={18} />
            </button>
          )}
          <button
            class="icon-btn"
            title={themeChoice.value === "dark" ? "切换浅色" : "切换深色"}
            onClick={() =>
              setTheme(themeChoice.value === "dark" ? "light" : "dark")
            }
          >
            {themeChoice.value === "dark" ? (
              <IconSun size={18} />
            ) : (
              <IconMoon size={18} />
            )}
          </button>
          <button
            class="icon-btn"
            title="设置"
            onClick={() => (settingsOpen.value = true)}
          >
            <IconSettings size={18} />
          </button>
        </div>
      </header>

      {!hasApiKey.value && (
        <div class="api-warn">
          <IconAlert size={16} />
          <span>未配置 DEEPSEEK_API_KEY，无法生成解读。请在 .env 中配置后重启服务。</span>
        </div>
      )}

      <GlobalPlayer />

      <main class="app-main">
        {v.name === "shelf" ? <BookShelf /> : <BookDetail bookId={v.bookId} />}
      </main>

      {settingsOpen.value && <SettingsPanel />}
      <ScriptModal />
      <Toast />
    </div>
  );
}
