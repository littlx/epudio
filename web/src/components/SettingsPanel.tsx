// 设置抽屉：解读风格/长度、音色选择与试听、限流、主题
import { useState, useEffect } from "preact/hooks";
import {
  settings,
  voiceOptions,
  settingsOpen,
  showToast,
  loadSettings,
} from "../store";
import { api } from "../api";
import { themeChoice, setTheme } from "../theme";
import type { InterpretStyle, Theme } from "../types";
import { IconClose, IconPlay, IconPause } from "./icons";

const STYLE_OPTIONS: { value: InterpretStyle; label: string; desc: string }[] = [
  { value: "dialogue", label: "对谈式", desc: "两位主持人聊天，互相呼应追问" },
  { value: "deep", label: "深度解读", desc: "学理分析、文本细读，偏严谨" },
  { value: "casual", label: "通俗讲解", desc: "大白话讲明白，门槛低" },
  { value: "storytelling", label: "评书式", desc: "戏剧化叙述，生动有悬念" },
];

export function SettingsPanel() {
  const s = settings.value;
  const isOpen = settingsOpen.value;
  const [render, setRender] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(
    null
  );

  useEffect(() => {
    if (isOpen) {
      setRender(true);
      const timer = setTimeout(() => setAnimOpen(true), 10);
      return () => clearTimeout(timer);
    } else {
      setAnimOpen(false);
      const timer = setTimeout(() => setRender(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!render || !s) return null;

  const update = async (patch: Partial<typeof s>) => {
    setSaving(true);
    try {
      await api.updateSettings(patch);
      await loadSettings();
    } catch (e: any) {
      showToast(e.message || "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const previewVoice = async (voice: string) => {
    // 停止上一个
    if (previewAudio) {
      previewAudio.pause();
      setPreviewAudio(null);
    }
    setPreviewing(voice);
    try {
      const blob = await api.previewVoice(voice);
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => {
        setPreviewing(null);
        URL.revokeObjectURL(url);
      };
      setPreviewAudio(a);
      a.play();
    } catch (e: any) {
      showToast(e.message || "试听失败", "error");
      setPreviewing(null);
    }
  };

  return (
    <>
      <div
        class={`drawer-backdrop ${animOpen ? "open" : ""}`}
        onClick={() => (settingsOpen.value = false)}
      />
      <div class={`drawer ${animOpen ? "open" : ""}`}>
        <div class="drawer-head">
          <h3>设置</h3>
          <button
            class="icon-btn"
            onClick={() => (settingsOpen.value = false)}
          >
            <IconClose size={18} />
          </button>
        </div>
        <div class="drawer-body">
          {/* 解读风格 */}
          <div class="drawer-section">
            <h4>解读风格</h4>
            {STYLE_OPTIONS.map((opt) => (
              <div
                class={`voice-card ${
                  s.style === opt.value ? "selected" : ""
                }`}
                style={{ marginBottom: 8 }}
                onClick={() => update({ style: opt.value })}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {opt.label}
                  </div>
                  <div class="muted" style={{ fontSize: 11 }}>
                    {opt.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 对谈长度 */}
          <div class="drawer-section">
            <h4>对谈长度</h4>
            <div class="field">
              <label>
                轮数：{s.turns_min} – {s.turns_max} 轮
              </label>
              <input
                type="range"
                min={3}
                max={30}
                value={s.turns_min}
                onChange={(e) =>
                  update({ turns_min: Number((e.target as HTMLInputElement).value) })
                }
              />
              <input
                type="range"
                min={3}
                max={30}
                value={s.turns_max}
                onChange={(e) =>
                  update({ turns_max: Number((e.target as HTMLInputElement).value) })
                }
              />
            </div>
          </div>

          {/* 音色 */}
          <div class="drawer-section">
            <h4>主持人音色</h4>
            <p class="muted" style={{ marginBottom: 8 }}>
              甲（默认女声）
            </p>
            <div class="voice-grid" style={{ marginBottom: 12 }}>
              {voiceOptions.value.map((v) => (
                <div
                  class={`voice-card ${s.voice_a === v.id ? "selected" : ""}`}
                  onClick={() => update({ voice_a: v.id })}
                >
                  <span class="name">{v.name}</span>
                  <button
                    class="preview-btn"
                    title="试听"
                    onClick={(e) => {
                      e.stopPropagation();
                      previewVoice(v.id);
                    }}
                  >
                    {previewing === v.id ? <IconPause size={12} /> : <IconPlay size={12} />}
                  </button>
                </div>
              ))}
            </div>
            <p class="muted" style={{ marginBottom: 8 }}>
              乙（默认男声）
            </p>
            <div class="voice-grid">
              {voiceOptions.value.map((v) => (
                <div
                  class={`voice-card ${s.voice_b === v.id ? "selected" : ""}`}
                  onClick={() => update({ voice_b: v.id })}
                >
                  <span class="name">{v.name}</span>
                  <button
                    class="preview-btn"
                    title="试听"
                    onClick={(e) => {
                      e.stopPropagation();
                      previewVoice(v.id);
                    }}
                  >
                    {previewing === v.id ? <IconPause size={12} /> : <IconPlay size={12} />}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 性能 */}
          <div class="drawer-section">
            <h4>性能与限流</h4>
            <div class="field">
              <label>章节并发数：{s.concurrency}</label>
              <input
                type="range"
                min={1}
                max={8}
                value={s.concurrency}
                onChange={(e) =>
                  update({ concurrency: Number((e.target as HTMLInputElement).value) })
                }
              />
            </div>
            <div class="field">
              <label>DeepSeek 每分钟请求数：{s.deepseek_rpm}</label>
              <input
                type="range"
                min={5}
                max={120}
                value={s.deepseek_rpm}
                onChange={(e) =>
                  update({ deepseek_rpm: Number((e.target as HTMLInputElement).value) })
                }
              />
            </div>
            <div class="field">
              <label>Edge TTS 并发上限：{s.edge_concurrency}</label>
              <input
                type="range"
                min={1}
                max={20}
                value={s.edge_concurrency}
                onChange={(e) =>
                  update({
                    edge_concurrency: Number((e.target as HTMLInputElement).value),
                  })
                }
              />
            </div>
          </div>

          {/* 主题 */}
          <div class="drawer-section">
            <h4>外观主题</h4>
            <div style={{ display: "flex", gap: 8 }}>
              {(["light", "dark", "system"] as Theme[]).map((t) => (
                <button
                  class={`btn sm ${themeChoice.value === t ? "" : "ghost"}`}
                  onClick={() => setTheme(t)}
                >
                  {t === "light" ? "浅色" : t === "dark" ? "深色" : "跟随系统"}
                </button>
              ))}
            </div>
          </div>

          {saving && <p class="muted">保存中…</p>}
        </div>
      </div>
    </>
  );
}
