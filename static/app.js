const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

const STATUS_LABEL = {
  pending: "待生成",
  interpreting: "解读中",
  synthesizing: "合成中",
  done: "完成",
  error: "失败",
};

let currentBookId = null;
let pollTimer = null;
let selectedIndexes = new Set(); // 当前书选中的章节 index
// 全局播放：独立于当前浏览的书，切视图/切书时持续播放
let playingBookId = null; // 正在播放的书 id
let playingIndex = null; // 正在播放的章节 index
let playingDoneIndexesList = []; // 播放来源书的可播章节 index 列表（续播/上下章用）

// ---- 视图切换 ----
function showShelf() {
  $("#shelfView").classList.remove("hidden");
  $("#bookView").classList.add("hidden");
  $("#backBtn").classList.add("hidden");
  currentBookId = null;
  selectedIndexes.clear();
  // 不停止播放：全局播放器常驻，返回书架也继续发声
  stopPolling();
  loadBooks();
}

function showBook(id) {
  currentBookId = id;
  selectedIndexes.clear();
  $("#shelfView").classList.add("hidden");
  $("#bookView").classList.remove("hidden");
  $("#backBtn").classList.remove("hidden");
  loadBook();
  startPolling();
}

// ---- 配置横幅 ----
async function loadConfig() {
  try {
    const cfg = await fetch("/api/config").then((r) => r.json());
    if (!cfg.has_api_key) {
      const b = $("#configBanner");
      b.classList.remove("hidden");
      b.textContent =
        "⚠️ 未检测到 DEEPSEEK_API_KEY。请在项目根目录 .env 中配置后重启服务，否则无法生成解读。";
    }
  } catch {}
}

// ---- 书架 ----
async function loadBooks() {
  const list = await fetch("/api/books").then((r) => r.json());
  const wrap = $("#bookList");
  wrap.innerHTML = "";
  if (!list.length) {
    wrap.appendChild(el("p", "muted", "还没有书，上传一本开始吧。"));
    return;
  }
  for (const b of list) {
    const card = el("div", "book-card");
    const left = el("div", "meta");
    left.appendChild(el("div", "title", escapeHtml(b.title)));
    left.appendChild(
      el("div", "sub", `${b.author || "未知作者"} · ${b.chapter_count} 章`)
    );
    card.appendChild(left);
    card.appendChild(
      el("div", "done-pill", `${b.done_count}/${b.chapter_count} 已完成`)
    );
    card.onclick = () => showBook(b.book_id);
    wrap.appendChild(card);
  }
}

// ---- 上传 ----
$("#uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const file = $("#fileInput").files[0];
  if (!file) return;
  const msg = $("#uploadMsg");
  msg.textContent = "解析中…";
  const fd = new FormData();
  fd.append("file", file);
  try {
    const res = await fetch("/api/books", { method: "POST", body: fd });
    if (!res.ok) {
      msg.textContent = (await res.json()).detail || "上传失败";
      return;
    }
    const book = await res.json();
    msg.textContent = `解析成功：${book.chapters.length} 章`;
    showBook(book.book_id);
  } catch (err) {
    msg.textContent = "上传失败：" + err;
  }
});

// ---- 书详情 ----
async function loadBook() {
  const meta = await fetch(`/api/books/${currentBookId}`).then((r) => r.json());
  $("#bookTitle").textContent = meta.title;
  $("#bookAuthor").textContent = `${meta.author || "未知作者"} · 共 ${meta.chapters.length} 章`;
  renderChapters(meta);
  updateProgress(meta);
}

function renderChapters(meta) {
  const wrap = $("#chapterList");
  wrap.innerHTML = "";
  const prevChecked = selectedIndexes;
  for (const ch of meta.chapters) {
    const row = el("div", "chapter-row");

    // 复选框
    const cbWrap = el("div", "checkbox");
    const cb = el("input");
    cb.type = "checkbox";
    cb.value = ch.index;
    cb.checked = prevChecked.has(ch.index);
    cb.dataset.index = ch.index;
    cb.addEventListener("change", onSelectionChange);
    cbWrap.appendChild(cb);
    row.appendChild(cbWrap);

    row.appendChild(el("div", "idx", ch.index + 1));

    const main = el("div", "ch-main");
    main.appendChild(el("div", "ch-title", escapeHtml(ch.title)));
    const metaTxt = [`${ch.char_count} 字`];
    if (ch.audio_seconds != null)
      metaTxt.push(`音频 ${formatDuration(ch.audio_seconds)}`);
    if (ch.message && ch.status === "error") metaTxt.push(ch.message);
    main.appendChild(el("div", "ch-meta", metaTxt.join(" · ")));
    row.appendChild(main);

    const actions = el("div", "ch-actions");
    actions.appendChild(
      el("span", `status-badge status-${ch.status}`, STATUS_LABEL[ch.status])
    );
    if (ch.status === "done") {
      // 用全局播放器：点击切换播放/暂停，互斥
      const playBtn = el("button", "small play-btn", "▶");
      playBtn.title = "播放";
      playBtn.dataset.index = ch.index;
      playBtn.onclick = () => togglePlay(ch.index);
      actions.appendChild(playBtn);

      const scriptBtn = el("button", "small ghost", "文稿");
      scriptBtn.onclick = () => openScript(ch.index);
      actions.appendChild(scriptBtn);

      const redoBtn = el("button", "small ghost", "重做");
      redoBtn.onclick = () => regenerate(ch.index);
      actions.appendChild(redoBtn);
    } else if (ch.status === "error") {
      const redoBtn = el("button", "small", "重做");
      redoBtn.onclick = () => regenerate(ch.index);
      actions.appendChild(redoBtn);
    }
    row.appendChild(actions);
    wrap.appendChild(row);
  }
  // 同步播放按钮的视觉状态
  refreshPlayButtons();
  // 切换书后同步全选框与按钮状态
  syncSelectAll();
  updateSelectionUI();
}

// ---- 全局播放器 ----
// 播放独立于当前浏览的书：返回书架或切到别的书时继续发声。
const player = $("#globalPlayer");
const playerBar = $("#playerBar");

// 播放来源书的元数据缓存：bookId → meta
const bookMetaCache = {};

async function ensureBookMeta(bookId) {
  if (bookMetaCache[bookId]) return bookMetaCache[bookId];
  const meta = await fetch(`/api/books/${bookId}`).then((r) => r.json());
  bookMetaCache[bookId] = meta;
  return meta;
}

// 当前播放来源书的可播章节 index 列表
function playingDoneIndexes() {
  return playingDoneIndexesList.slice();
}

function playingChapterTitle(idx) {
  const meta = bookMetaCache[playingBookId];
  if (!meta) return `第 ${idx + 1} 章`;
  const ch = (meta.chapters || []).find((c) => c.index === idx);
  const title = ch ? ch.title : `第 ${idx + 1} 章`;
  const book = meta.title || "";
  return `${book} · ${title}`;
}

async function togglePlay(idx) {
  // 同一本书同一章：播放/暂停切换
  if (playingBookId === currentBookId && playingIndex === idx) {
    if (player.paused) await player.play().catch(() => {});
    else player.pause();
    return;
  }
  await playChapter(currentBookId, idx);
}

async function playChapter(bookId, idx) {
  const meta = await ensureBookMeta(bookId);
  // 该书可播（已完成）章节列表，用于续播与上下章
  playingDoneIndexesList = (meta.chapters || [])
    .filter((c) => c.status === "done")
    .map((c) => c.index)
    .sort((a, b) => a - b);

  playerBar.classList.remove("hidden");
  player.src = `/api/books/${bookId}/chapters/${idx}/audio`;
  playingBookId = bookId;
  playingIndex = idx;
  $("#playerNow").textContent = `▶ 正在播放：${playingChapterTitle(idx)}`;
  refreshPlayButtons();
  try {
    await player.play();
  } catch {
    // 自动播放被拦截时，至少已加载好，用户可手动点播放
  }
}

function refreshPlayButtons() {
  document.querySelectorAll("#chapterList .play-btn").forEach((b) => {
    const idx = Number(b.dataset.index);
    // 仅当当前浏览的书正是播放来源书、且是该章时，显示为播放中
    const isPlaying =
      playingBookId === currentBookId && idx === playingIndex;
    b.classList.toggle("playing", isPlaying && !player.paused);
    b.textContent = isPlaying ? (player.paused ? "▶" : "⏸") : "▶";
  });
}

// 播完自动续下一章（基于播放来源书，不受当前浏览页影响）
player.addEventListener("ended", () => {
  const done = playingDoneIndexesList;
  const pos = done.indexOf(playingIndex);
  if (pos !== -1 && pos + 1 < done.length) {
    playChapter(playingBookId, done[pos + 1]);
  } else {
    $("#playerNow").textContent = "播放完毕";
    playingIndex = null;
    refreshPlayButtons();
  }
});
// 播放/暂停状态变化时刷新按钮
player.addEventListener("play", refreshPlayButtons);
player.addEventListener("pause", refreshPlayButtons);

$("#playerPrev").addEventListener("click", () => {
  const done = playingDoneIndexesList;
  const pos = done.indexOf(playingIndex);
  if (pos > 0) playChapter(playingBookId, done[pos - 1]);
});
$("#playerNext").addEventListener("click", () => {
  const done = playingDoneIndexesList;
  const pos = done.indexOf(playingIndex);
  if (pos !== -1 && pos + 1 < done.length) playChapter(playingBookId, done[pos + 1]);
});

// ---- 选择管理 ----
function onSelectionChange(e) {
  const idx = Number(e.target.dataset.index);
  if (e.target.checked) selectedIndexes.add(idx);
  else selectedIndexes.delete(idx);
  syncSelectAll();
  updateSelectionUI();
}

// 全选框与所有行复选框同步
function syncSelectAll() {
  const boxes = document.querySelectorAll(
    '#chapterList input[type=checkbox]'
  );
  const sel = $("#selectAll");
  if (!boxes.length) {
    sel.checked = false;
    sel.indeterminate = false;
    return;
  }
  const checked = Array.from(boxes).filter((b) => b.checked).length;
  sel.checked = checked === boxes.length;
  sel.indeterminate = checked > 0 && checked < boxes.length;
}

function updateSelectionUI() {
  const n = selectedIndexes.size;
  $("#selectCount").textContent = `已选 ${n} 章`;
  $("#generateSelectedBtn").disabled = n === 0;
}

// 全选 / 反选
$("#selectAll").addEventListener("change", (e) => {
  const checked = e.target.checked;
  selectedIndexes.clear();
  document
    .querySelectorAll('#chapterList input[type=checkbox]')
    .forEach((cb) => {
      cb.checked = checked;
      if (checked) selectedIndexes.add(Number(cb.dataset.index));
    });
  updateSelectionUI();
});

// 选中所有未完成章节
$("#selectPendingBtn").addEventListener("click", async () => {
  const meta = await fetch(`/api/books/${currentBookId}`).then((r) =>
    r.json()
  );
  selectedIndexes.clear();
  document
    .querySelectorAll('#chapterList input[type=checkbox]')
    .forEach((cb) => {
      const idx = Number(cb.dataset.index);
      const ch = meta.chapters.find((c) => c.index === idx);
      const pending = ch && ch.status !== "done";
      cb.checked = pending;
      if (pending) selectedIndexes.add(idx);
    });
  syncSelectAll();
  updateSelectionUI();
});

// 生成选中章节
$("#generateSelectedBtn").addEventListener("click", async () => {
  const indexes = Array.from(selectedIndexes).sort((a, b) => a - b);
  if (!indexes.length) return;
  const res = await fetch(`/api/books/${currentBookId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chapters: indexes, reset: false }),
  });
  if (!res.ok) {
    alert((await res.json()).detail || "启动失败");
    return;
  }
  startPolling();
  loadBook();
});

function updateProgress(meta) {
  const total = meta.chapters.length;
  const done = meta.chapters.filter((c) => c.status === "done").length;
  const pct = total ? (done / total) * 100 : 0;
  $("#progressFill").style.width = pct + "%";
  const err = meta.chapters.filter((c) => c.status === "error").length;
  let txt = `已完成 ${done}/${total}`;
  if (err) txt += ` · 失败 ${err}`;
  if (meta.running) txt += " · 生成中…";
  $("#progressText").textContent = txt;
}

// ---- 轮询 ----
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const p = await fetch(
        `/api/books/${currentBookId}/progress`
      ).then((r) => r.json());
      const meta = await fetch(`/api/books/${currentBookId}`).then((r) =>
        r.json()
      );
      renderChapters(meta);
      updateProgress(meta);
      if (!meta.running && !p.running) stopPolling();
    } catch {}
  }, 2500);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ---- 操作 ----
$("#generateAllBtn").addEventListener("click", async () => {
  const res = await fetch(`/api/books/${currentBookId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reset: false }),
  });
  if (!res.ok) {
    alert((await res.json()).detail || "启动失败");
    return;
  }
  startPolling();
  loadBook();
});

$("#deleteBtn").addEventListener("click", async () => {
  if (!confirm("确定删除这本书及其所有音频？")) return;
  await fetch(`/api/books/${currentBookId}`, { method: "DELETE" });
  showShelf();
});

async function regenerate(index) {
  const res = await fetch(
    `/api/books/${currentBookId}/chapters/${index}/regenerate`,
    { method: "POST" }
  );
  if (!res.ok) {
    alert((await res.json()).detail || "重做失败");
    return;
  }
  startPolling();
  loadBook();
}

// ---- 文稿弹窗 ----
async function openScript(index) {
  const res = await fetch(
    `/api/books/${currentBookId}/chapters/${index}/script`
  );
  if (!res.ok) {
    alert("文稿暂不可用");
    return;
  }
  const data = await res.json();
  const s = data.script;
  const body = $("#scriptBody");
  body.innerHTML = "";
  if (s.summary)
    body.appendChild(el("div", "script-summary", escapeHtml(s.summary)));
  for (const t of s.turns || []) {
    const turn = el("div", `turn ${t.speaker}`);
    turn.appendChild(
      el("div", "speaker", `${t.speaker}：`)
    );
    turn.appendChild(el("div", "text", escapeHtml(t.text)));
    body.appendChild(turn);
  }
  $("#scriptModal").classList.remove("hidden");
}
$("#closeScript").addEventListener("click", () =>
  $("#scriptModal").classList.add("hidden")
);
$("#scriptModal").addEventListener("click", (e) => {
  if (e.target.id === "scriptModal")
    $("#scriptModal").classList.add("hidden");
});

$("#backBtn").addEventListener("click", showShelf);

// ---- 工具 ----
function formatDuration(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---- 初始化 ----
loadConfig();
loadBooks();
