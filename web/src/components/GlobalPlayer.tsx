// 全局常驻播放器：返回书架或切换书籍时也不中断
import { useEffect, useRef, useState } from "preact/hooks";
import {
  player,
  playingTitle,
  onTrackEnded,
  playPrev,
  playNext,
  audioUrlFor,
} from "../store";
import { loadPosition, savePosition } from "../playback";
import { IconPrev, IconNext, IconPlay, IconPause, IconVolume, IconMute } from "./icons";
import { formatDuration } from "../utils";

export function GlobalPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cur = player.value;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // 音量与静音状态，从本地缓存加载初始值
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("player-volume") || "0.8"));
  const [muted, setMuted] = useState(() => localStorage.getItem("player-muted") === "true");

  // src 变化时加载并播放
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !cur.bookId || cur.index == null) return;
    const url = audioUrlFor(cur.bookId, cur.index);
    if (a.src !== location.origin + url) {
      a.src = url;
      a.load();
    }
    // 重新应用当前的播放语速与音量
    a.playbackRate = playbackRate;
    a.volume = muted ? 0 : volume;
    if (!cur.paused) {
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  }, [cur.bookId, cur.index]);

  // 播放/暂停变化
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (cur.paused) {
      a.pause();
    } else {
      a.play().catch(() => {});
    }
  }, [cur.paused]);

  // 语速变化
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // 同步音量设置到 audio 节点并持久化
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = muted ? 0 : volume;
    }
    localStorage.setItem("player-volume", volume.toString());
    localStorage.setItem("player-muted", muted ? "true" : "false");
  }, [volume, muted]);

  // 键盘快捷键监听：空格播放/暂停、←/→ 上下章、Shift+←/→ 进退 15s
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        player.value = { ...player.value, paused: !player.value.paused };
      } else if (e.key === "ArrowLeft" && !e.shiftKey) {
        e.preventDefault();
        playPrev();
      } else if (e.key === "ArrowRight" && !e.shiftKey) {
        e.preventDefault();
        playNext();
      } else if (e.key === "ArrowLeft" && e.shiftKey) {
        e.preventDefault();
        if (audioRef.current) {
          const t = Math.max(0, audioRef.current.currentTime - 15);
          audioRef.current.currentTime = t;
          setCurrentTime(t);
        }
      } else if (e.key === "ArrowRight" && e.shiftKey) {
        e.preventDefault();
        if (audioRef.current) {
          const t = Math.min(duration, audioRef.current.currentTime + 15);
          audioRef.current.currentTime = t;
          setCurrentTime(t);
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [duration]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const t = audioRef.current.currentTime;
      setCurrentTime(t);
      if (cur.bookId && cur.index != null) {
        savePosition(cur.bookId, cur.index, t);
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      // 恢复上次播放位置
      if (cur.bookId && cur.index != null) {
        const pos = loadPosition(cur.bookId, cur.index);
        if (pos != null && pos < audioRef.current.duration - 2) {
          audioRef.current.currentTime = pos;
          setCurrentTime(pos);
        }
      }
    }
  };

  const handleSeek = (e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setCurrentTime(val);
      if (cur.bookId && cur.index != null) {
        savePosition(cur.bookId, cur.index, val);
      }
    }
  };

  const handleTogglePlay = () => {
    player.value = { ...cur, paused: !cur.paused };
  };

  const handleSpeedChange = (e: Event) => {
    const rate = Number((e.target as HTMLSelectElement).value);
    setPlaybackRate(rate);
  };

  if (!cur.bookId || cur.index == null) return null;

  const title = playingTitle();

  return (
    <div class="player-bar">
      <div class="player-info">
        <div class="player-now">
          {cur.paused ? "已暂停" : "正在播放"}
        </div>
        <div class="player-title" title={title}>
          {title}
        </div>
      </div>

      <div class="player-controls">
        <button
          class="icon-btn"
          title="上一章"
          aria-label="上一章"
          onClick={playPrev}
        >
          <IconPrev size={18} />
        </button>
        <button
          class="play-trigger"
          title={cur.paused ? "播放" : "暂停"}
          aria-label={cur.paused ? "播放" : "暂停"}
          onClick={handleTogglePlay}
        >
          {cur.paused ? <IconPlay size={16} /> : <IconPause size={16} />}
        </button>
        <button
          class="icon-btn"
          title="下一章"
          aria-label="下一章"
          onClick={playNext}
        >
          <IconNext size={18} />
        </button>
      </div>

      <div class="player-slider-container">
        <input
          type="range"
          class="player-slider"
          min={0}
          max={duration || 0}
          value={currentTime}
          onInput={handleSeek}
          disabled={!duration}
          aria-label="播放进度"
        />
      </div>

      <div class="player-time-display">
        {formatDuration(currentTime)} / {formatDuration(duration)}
      </div>

      <div class="player-volume-control" style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 16 }}>
        <button
          class="icon-btn"
          title={muted ? "取消静音" : "静音"}
          aria-label={muted ? "取消静音" : "静音"}
          onClick={() => setMuted(!muted)}
          style={{ padding: 4 }}
        >
          {muted ? <IconMute size={18} /> : <IconVolume size={18} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onInput={(e) => {
            const v = Number((e.target as HTMLInputElement).value);
            setVolume(v);
            if (v > 0) setMuted(false);
          }}
          style={{ width: 60, height: 4, borderRadius: 2, cursor: "pointer" }}
          aria-label="播放音量"
        />
      </div>

      <div class="player-speed-control">
        <select
          value={playbackRate}
          onChange={handleSpeedChange}
          aria-label="播放语速"
        >
          <option value={0.8}>0.8x</option>
          <option value={1.0}>1.0x</option>
          <option value={1.25}>1.25x</option>
          <option value={1.5}>1.5x</option>
          <option value={1.75}>1.75x</option>
          <option value={2.0}>2.0x</option>
        </select>
      </div>

      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={onTrackEnded}
      />
    </div>
  );
}
