// 极简 Service Worker：缓存静态壳，运行时策略
// - /static/assets/*  cache-first（构建产物带 hash，可长期缓存）
// - /api/*            network-first（不缓存，保证数据实时）
// - 其余导航请求     优先网络，失败回退到缓存的 index
const CACHE = "epubmp3-shell-v1";
const ASSET_RE = /^\/static\/assets\//;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"])).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API：始终走网络，不缓存
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(req));
    return;
  }

  // 静态资源：cache-first
  if (ASSET_RE.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => cached)
      )
    );
    return;
  }

  // 导航/其他：网络优先，失败回退缓存
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((c) => c || caches.match("/")))
  );
});
