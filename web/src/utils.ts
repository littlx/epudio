// 通用工具函数

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return "";
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatChars(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万字`;
  return `${n}字`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function pct(done: number, total: number): number {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

export function getBookGradient(id: string): string {
  const gradients = [
    "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", // 烟黛蓝 (Slate Blue)
    "linear-gradient(135deg, #0a2f1d 0%, #04160e 100%)", // 墨松绿 (Pine Green)
    "linear-gradient(135deg, #3b0712 0%, #1c0005 100%)", // 暗檀红 (Burgundy)
    "linear-gradient(135deg, #2d1808 0%, #150a02 100%)", // 古铜褐 (Bronze Brown)
    "linear-gradient(135deg, #1e113a 0%, #0d061c 100%)", // 幽堇紫 (Amethyst Purple)
    "linear-gradient(135deg, #18181b 0%, #09090b 100%)", // 曜石黑 (Obsidian Black)
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}
