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
    "linear-gradient(135deg, #6366f1 0%, #312e81 50%, #1e1b4b 100%)",
    "linear-gradient(135deg, #0ea5e9 0%, #0369a1 50%, #0c4a6e 100%)",
    "linear-gradient(135deg, #10b981 0%, #047857 50%, #064e3b 100%)",
    "linear-gradient(135deg, #f43f5e 0%, #be123c 50%, #58081b 100%)",
    "linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #78350f 100%)",
    "linear-gradient(135deg, #a855f7 0%, #7c3aed 50%, #4c1d95 100%)",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}
