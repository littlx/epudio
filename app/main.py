"""FastAPI 应用：路由 + 静态托管。"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import (
    FastAPI,
    File,
    HTTPException,
    UploadFile,
)
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import epub_parser, jobs, store
from .config import settings
from .schemas import BookSummary, GenerateRequest, Message

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.data_path.mkdir(parents=True, exist_ok=True)
    settings.books_path.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="EPUB 有声解读", lifespan=lifespan)

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
    return FileResponse(STATIC_DIR / "index.html")


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

    # 存原文与原始 epub
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
        # 校验
        valid = {c.index for c in meta.chapters}
        for i in indexes:
            if i not in valid:
                raise HTTPException(status_code=400, detail=f"章节 {i} 不存在")
    else:
        indexes = [c.index for c in meta.chapters]

    if req.reset:
        from .schemas import Chapter

        for ch in meta.chapters:
            if ch.index in indexes:
                ch.status = "pending"
                ch.message = ""
                ch.audio_seconds = None
        store.save_meta(meta)

    ok = jobs.start_generation(book_id, indexes)
    if not ok:
        raise HTTPException(status_code=409, detail="启动失败，可能已在运行")
    return Message(message=f"已开始生成 {len(indexes)} 章").model_dump()


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
        "chapters": [
            {
                "index": c.index,
                "status": c.status,
                "message": c.message,
            }
            for c in meta.chapters
        ],
    }


@app.get("/api/books/{book_id}/chapters/{n}/audio")
async def api_chapter_audio(book_id: str, n: int):
    _require_book(book_id)
    p = settings.audio_path(book_id, n)
    if not p.exists():
        raise HTTPException(status_code=404, detail="音频尚未生成")
    return FileResponse(
        p, media_type="audio/mpeg", filename=f"chapter-{n}.mp3"
    )


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
        raise HTTPException(status_code=500, detail="启动失败")
    return Message(message="已开始重做该章").model_dump()


@app.get("/api/config")
async def api_config():
    """前端用来判断是否配置了 API key 与音色。"""
    return {
        "has_api_key": bool(settings.deepseek_api_key),
        "voice_a": settings.voice_a,
        "voice_b": settings.voice_b,
        "model": settings.deepseek_model,
        "turns_min": settings.turns_min,
        "turns_max": settings.turns_max,
        "concurrency": settings.concurrency,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=False,
    )
