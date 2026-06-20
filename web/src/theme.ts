// 主题：light / dark / system，持久化到 localStorage，跟随系统
import { signal, effect } from "@preact/signals";
import type { Theme } from "./types";

const STORAGE_KEY = "epubmp3-theme";

function detectSystem(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function readStored(): Theme {
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

export const themeChoice = signal<Theme>(readStored());

export const effectiveTheme = signal<"light" | "dark">("dark");

function applyTheme() {
  const eff = themeChoice.value === "system" ? detectSystem() : themeChoice.value;
  effectiveTheme.value = eff;
  document.documentElement.setAttribute("data-theme", eff);

  // 动态更新 meta theme-color
  let metaThemeColor = document.querySelector('meta[name="theme-color"]');
  const color = eff === "dark" ? "#090a0f" : "#f8fafc";
  if (!metaThemeColor) {
    metaThemeColor = document.createElement("meta");
    metaThemeColor.setAttribute("name", "theme-color");
    document.head.appendChild(metaThemeColor);
  }
  metaThemeColor.setAttribute("content", color);
}

applyTheme();

// 跟随系统变化
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", () => {
    if (themeChoice.value === "system") applyTheme();
  });

// 持久化 + 应用
effect(() => {
  localStorage.setItem(STORAGE_KEY, themeChoice.value);
  applyTheme();
});

export function setTheme(t: Theme) {
  themeChoice.value = t;
}
