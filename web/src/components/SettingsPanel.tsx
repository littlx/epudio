// 设置抽屉：解读风格/长度、音色选择与试听、限流、主题
import { useState, useEffect, useRef } from "preact/hooks";
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
  { value: "monologue", label: "单人独白", desc: "一位解读者娓娓道来，进行系统而透彻的深度剖析" },
];

export function SettingsPanel() {
  const s = settings.value;
  const isOpen = settingsOpen.value;
  const [render, setRender] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState<string | null>(null);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeVoiceRef = useRef<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRender(true);
      const timer = setTimeout(() => setAnimOpen(true), 10);

      const handleEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") settingsOpen.value = false;
      };
      window.addEventListener("keydown", handleEsc);

      return () => {
        clearTimeout(timer);
        window.removeEventListener("keydown", handleEsc);
      };
    } else {
      setAnimOpen(false);
      const timer = setTimeout(() => setRender(false), 200);

      // Drawer 关闭时，停止并清理正在播放的音频
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPreviewing(null);
      activeVoiceRef.current = null;

      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // 组件销毁时的清理
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

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
    // 如果点击的是正在播放/加载的音色，则暂停并取消
    if (activeVoiceRef.current === voice) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setPreviewing(null);
      activeVoiceRef.current = null;
      return;
    }

    // 停止并清理前一个音频
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // 标记当前正在加载此音色
    setPreviewing(voice);
    activeVoiceRef.current = voice;

    try {
      const blob = await api.previewVoice(voice);
      
      // 在异步请求结束后，检查在此期间是否已切换或取消
      if (activeVoiceRef.current !== voice) {
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      audioRef.current = a;
      
      a.onended = () => {
        if (activeVoiceRef.current === voice) {
          setPreviewing(null);
          activeVoiceRef.current = null;
        }
        URL.revokeObjectURL(url);
      };

      a.play();
    } catch (e: any) {
      if (activeVoiceRef.current === voice) {
        showToast(e.message || "试听失败", "error");
        setPreviewing(null);
        activeVoiceRef.current = null;
      }
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
            <p class="muted" style={{ fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
              现已由章节内容的复杂度与信息密度自动决定（一般在 10–38 句之间），以确保硬核知识能被层层剖析透彻，且无冗余废话。
            </p>
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
