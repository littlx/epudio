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
import { IconPrev, IconNext, IconPlay, IconPause } from "./icons";
import { formatDuration } from "../utils";

export function GlobalPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cur = player.value;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // src 变化时加载并播放
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !cur.bookId || cur.index == null) return;
    const url = audioUrlFor(cur.bookId, cur.index);
    if (a.src !== location.origin + url) {
      a.src = url;
      a.load();
    }
    // 重新应用当前的播放语速
    a.playbackRate = playbackRate;
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

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e: Event) => {
    const val = Number((e.target as HTMLInputElement).value);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setCurrentTime(val);
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
          max={duration || 100}
          value={currentTime}
          onInput={handleSeek}
          aria-label="播放进度"
        />
      </div>

      <div class="player-time-display">
        {formatDuration(currentTime)} / {formatDuration(duration)}
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
