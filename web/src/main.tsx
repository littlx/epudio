// 应用入口
import { render } from "preact";
import { AppShell } from "./components/AppShell";
import "./styles/global.css";

render(<AppShell />, document.getElementById("app")!);

// 生产环境注册 Service Worker（开发期跳过，避免缓存干扰热重载）
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败不影响使用
    });
  });
}
