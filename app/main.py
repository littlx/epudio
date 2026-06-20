"""FastAPI 应用：路由 + 静态托管 + SSE + 设置 + 导出。"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from . import epub_parser, export, jobs, ratelimit, store, tts
from . import sse as sse_mod
from .config import settings
from .schemas import (
    BookSummary,
    GenerateRequest,
    Message,
    Settings as AppSettings,
    VOICE_OPTIONS,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.data_path.mkdir(parents=True, exist_ok=True)
    settings.books_path.mkdir(parents=True, exist_ok=True)
    # 加载持久化设置并应用
    s = store.load_settings()
    store.apply_settings(s)
    # 初始化限流器
    ratelimit.init_limiters(s.deepseek_rpm, s.edge_concurrency)
    # 启动恢复：回退中间态章节
    affected = store.recover_on_startup()
    if affected:
        logging.getLogger("epubmp3").info(
            "启动恢复：回退 %d 个中间态章节", affected
        )
    yield


app = FastAPI(title="EPUB 有声解读", lifespan=lifespan)

# 开发期允许 Vite dev server 跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = settings.project_root / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# ---- 工具 ----

def _summary(meta) -> BookSummary:
    done = sum(1 for c in meta.chapters if c.status == "done")
    return BookSummary(
        book_id=meta.book_id,
        title=meta.title,
        author=meta.author,
        chapter_count=len(meta.chapters),
        done_count=done,
        created_at=meta.created_at,
    )


def _require_book(book_id: str):
    meta = store.load_meta(book_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="书不存在")
    return meta


# ---- 页面 ----

@app.get("/")
async def index():
    idx = STATIC_DIR / "index.html"
    if idx.exists():
        return FileResponse(idx)
    # 开发期前端跑在 5173，给个提示
    return Response(
        "<h1>前端未构建</h1><p>开发请运行 <code>npm run dev</code>（web/ 目录），"
        "或 <code>npm run build</code> 生成到 static/。</p>",
        media_type="text/html",
    )


# ---- 书籍 API ----

@app.get("/api/books")
async def api_list_books():
    return [_summary(m).model_dump() for m in store.list_books()]


@app.post("/api/books")
async def api_upload_book(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".epub"):
        raise HTTPException(status_code=400, detail="请上传 .epub 文件")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="文件为空")
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件过大（>200MB）")
    try:
        parsed = epub_parser.parse_epub(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"EPUB 解析失败：{e}")

    from .schemas import Chapter

    chapters = [
        Chapter(index=i, title=c.title, char_count=c.char_count)
        for i, c in enumerate(parsed.chapters)
    ]
    meta = store.new_book(parsed.title, parsed.author, chapters)
    (settings.book_dir(meta.book_id) / "original.epub").write_bytes(data)
    for i, text in enumerate(parsed.texts):
        store.save_chapter_text(meta.book_id, i, text)
    return meta.model_dump(mode="json")


@app.get("/api/books/{book_id}")
async def api_get_book(book_id: str):
    meta = _require_book(book_id)
    data = meta.model_dump(mode="json")
    data["running"] = jobs.is_running(book_id)
    return data


@app.delete("/api/books/{book_id}")
async def api_delete_book(book_id: str):
    store.delete_book(book_id)
    return Message(message="已删除").model_dump()


@app.post("/api/books/{book_id}/generate")
async def api_generate(book_id: str, req: GenerateRequest):
    meta = _require_book(book_id)
    if jobs.is_running(book_id):
        raise HTTPException(status_code=409, detail="该书正在生成中")

    if req.chapters is not None:
        indexes = req.chapters
        valid = {c.index for c in meta.chapters}
        for i in indexes:
            if i not in valid:
                raise HTTPException(status_code=400, detail=f"章节 {i} 不存在")
    else:
        indexes = [c.index for c in meta.chapters]

    if req.reset:
        for ch in meta.chapters:
            if ch.index in indexes:
                ch.status = "pending"
                ch.stage = "idle"
                ch.stage_detail = ""
                ch.progress = 0.0
                ch.message = ""
                ch.audio_seconds = None
        store.save_meta(meta)
    else:
        # 增量：跳过已 done
        indexes = [i for i in indexes if not _is_done(meta, i)]

    if not indexes:
        return Message(message="没有需要生成的章节").model_dump()

    ok = jobs.start_generation(book_id, indexes)
    if not ok:
        raise HTTPException(status_code=409, detail="启动失败，可能已在运行")
    return Message(message=f"已开始生成 {len(indexes)} 章").model_dump()


def _is_done(meta, index: int) -> bool:
    return any(c.index == index and c.status == "done" for c in meta.chapters)


@app.get("/api/books/{book_id}/progress")
async def api_progress(book_id: str):
    meta = _require_book(book_id)
    total = len(meta.chapters)
    done = sum(1 for c in meta.chapters if c.status == "done")
    errored = sum(1 for c in meta.chapters if c.status == "error")
    running = jobs.is_running(book_id)
    return {
        "total": total,
        "done": done,
        "errored": errored,
        "running": running,
        "chapters": [c.model_dump(mode="json") for c in meta.chapters],
    }


@app.get("/api/books/{book_id}/stream")
async def api_stream(book_id: str):
    """SSE 流：实时推送章节状态/阶段变化。"""
    _require_book(book_id)
    bus = sse_mod.get_bus(book_id)

    async def event_gen():
        q = await bus.subscribe()
        # 先推一次当前完整状态
        meta = store.load_meta(book_id)
        if meta:
            yield {"event": "snapshot", "data": meta.model_dump_json()}
        try:
            while True:
                payload = await q.get()
                yield {"event": "message", "data": payload}
        except asyncio.CancelledError:
            pass
        finally:
            await bus.unsubscribe(q)

    return EventSourceResponse(event_gen())


@app.get("/api/books/{book_id}/chapters/{n}/audio")
async def api_chapter_audio(book_id: str, n: int):
    _require_book(book_id)
    p = settings.audio_path(book_id, n)
    if not p.exists():
        raise HTTPException(status_code=404, detail="音频尚未生成")
    return FileResponse(p, media_type="audio/mpeg", filename=f"chapter-{n}.mp3")


@app.get("/api/books/{book_id}/chapters/{n}/script")
async def api_chapter_script(book_id: str, n: int):
    meta = _require_book(book_id)
    script = store.load_script(book_id, n)
    if script is None:
        raise HTTPException(status_code=404, detail="解读脚本尚未生成")
    ch = next((c for c in meta.chapters if c.index == n), None)
    return {
        "chapter_title": ch.title if ch else f"第 {n + 1} 章",
        "script": script,
    }


@app.post("/api/books/{book_id}/chapters/{n}/regenerate")
async def api_regenerate_chapter(book_id: str, n: int):
    meta = _require_book(book_id)
    if n not in {c.index for c in meta.chapters}:
        raise HTTPException(status_code=400, detail="章节不存在")
    ok = await jobs.regenerate_chapter(book_id, n)
    if not ok:
        raise HTTPException(status_code=409, detail="该章正在处理中")
    return Message(message="已开始重做该章").model_dump()


@app.post("/api/books/{book_id}/export")
async def api_export_book(book_id: str):
    """导出整书为 zip。"""
    _require_book(book_id)
    try:
        data, filename = await export.export_zip(book_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    # 中文文件名用 RFC 5987 filename* 编码，避免 latin-1 报错
    from urllib.parse import quote

    quoted = quote(filename)
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=\"export.zip\"; filename*=UTF-8''{quoted}"
        },
    )


# ---- 设置 API ----

@app.get("/api/settings")
async def api_get_settings():
    s = store.load_settings()
    return {
        "settings": s.model_dump(),
        "voice_options": VOICE_OPTIONS,
        "has_api_key": bool(settings.deepseek_api_key),
        "model": settings.deepseek_model,
    }


@app.put("/api/settings")
async def api_put_settings(payload: dict):
    """更新全局设置。"""
    current = store.load_settings()
    data = current.model_dump()
    for k, v in payload.items():
        if k in data:
            data[k] = v
    try:
        s = AppSettings.model_validate(data)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"设置无效：{e}")
    store.save_settings(s)
    # 同步更新限流器
    ratelimit.update_limiters(s.deepseek_rpm, s.edge_concurrency)
    return s.model_dump()


@app.post("/api/voices/preview")
async def api_voice_preview(payload: dict):
    """试听音色：即时合成 3 秒样本。"""
    voice = payload.get("voice", "")
    valid_ids = {v["id"] for v in VOICE_OPTIONS}
    if voice not in valid_ids:
        raise HTTPException(status_code=400, detail="未知音色")
    import tempfile
    from pathlib import Path

    text = "你好，这是音色试听样本。今天我们一起来读一本书。"
    tmp = Path(tempfile.mktemp(suffix=".mp3"))
    try:
        communicate = __import__("edge_tts").Communicate(text, voice)
        await communicate.save(str(tmp))
        audio = tmp.read_bytes()
    finally:
        tmp.unlink(missing_ok=True)
    return Response(content=audio, media_type="audio/mpeg")


@app.get("/api/config")
async def api_config():
    s = store.load_settings()
    return {
        "has_api_key": bool(settings.deepseek_api_key),
        "voice_a": s.voice_a,
        "voice_b": s.voice_b,
        "model": settings.deepseek_model,
        "style": s.style,
        "turns_min": s.turns_min,
        "turns_max": s.turns_max,
        "concurrency": s.concurrency,
        "deepseek_rpm": s.deepseek_rpm,
        "edge_concurrency": s.edge_concurrency,
        "theme": s.theme,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=False,
    )
