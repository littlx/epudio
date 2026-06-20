// 全局常驻播放器：返回书架或切换书籍时也不中断
import { useEffect, useRef } from "preact/hooks";
import {
  player,
  playingTitle,
  onTrackEnded,
  playPrev,
  playNext,
  audioUrlFor,
} from "../store";
import { IconPrev, IconNext } from "./icons";

export function GlobalPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cur = player.value;

  // src 变化时加载并播放
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !cur.bookId || cur.index == null) return;
    const url = audioUrlFor(cur.bookId, cur.index);
    if (a.src !== location.origin + url) {
      a.src = url;
      a.load();
    }
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

  if (!cur.bookId || cur.index == null) return null;

  const title = playingTitle();

  return (
    <div class="player-bar">
      <div class="player-info">
        <div class="player-now">
          {cur.paused ? "⏸ 已暂停" : "▶ 正在播放"}
        </div>
        <div class="player-title" title={title}>
          {title}
        </div>
      </div>
      <button
        class="icon-btn"
        title="上一章"
        onClick={playPrev}
      >
        <IconPrev size={18} />
      </button>
      <audio
        ref={audioRef}
        controls
        preload="none"
        onEnded={onTrackEnded}
      />
      <button
        class="icon-btn"
        title="下一章"
        onClick={playNext}
      >
        <IconNext size={18} />
      </button>
    </div>
  );
}
