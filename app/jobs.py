"""后台任务：并发为多章生成解读 + 音频。

状态机：pending → interpreting → synthesizing → done / error
内存中记录每本书的运行任务，meta.json 落盘进度。
"""
from __future__ import annotations

import asyncio
import logging
import traceback

from .config import settings
from . import interpreter, store, tts
from .schemas import BookMeta, Chapter, Script

log = logging.getLogger("epubmp3.jobs")

# book_id → 运行中的任务句柄
_running: dict[str, asyncio.Task] = {}


def is_running(book_id: str) -> bool:
    t = _running.get(book_id)
    return t is not None and not t.done()


def _set_chapter(meta: BookMeta, index: int, **kwargs) -> None:
    for ch in meta.chapters:
        if ch.index == index:
            for k, v in kwargs.items():
                setattr(ch, k, v)
            break
    store.save_meta(meta)


async def _process_chapter(meta: BookMeta, index: int) -> None:
    """处理单章：解读 → 合成。"""
    text = store.load_chapter_text(meta.book_id, index)
    if not text:
        _set_chapter(meta, index, status="error", message="章节原文为空")
        return

    # 1. 解读
    _set_chapter(meta, index, status="interpreting", message="正在深度解读…")
    prev_summaries = _collect_prev_summaries(meta, index)
    try:
        script: Script = await interpreter.interpret_chapter(
            book_title=meta.title,
            author=meta.author,
            chapter_title=_chapter_title(meta, index),
            chapter_text=text,
            prev_summaries=prev_summaries,
        )
    except Exception as e:
        log.exception("解读失败 book=%s ch=%d", meta.book_id, index)
        _set_chapter(meta, index, status="error", message=f"解读失败：{e}")
        return
    store.save_script(
        meta.book_id, index, script.model_dump(mode="json")
    )

    # 2. 合成
    _set_chapter(meta, index, status="synthesizing", message="正在合成音频…")
    try:
        duration = await tts.synthesize_chapter(
            script, settings.audio_path(meta.book_id, index)
        )
    except Exception as e:
        log.exception("合成失败 book=%s ch=%d", meta.book_id, index)
        _set_chapter(
            meta, index, status="error", message=f"合成失败：{e}"
        )
        return

    _set_chapter(
        meta, index,
        status="done", message="完成", audio_seconds=duration,
    )


def _chapter_title(meta: BookMeta, index: int) -> str:
    for ch in meta.chapters:
        if ch.index == index:
            return ch.title
    return f"第 {index + 1} 章"


def _collect_prev_summaries(meta: BookMeta, index: int, limit: int = 3) -> list[str]:
    """取前若干已完成章节的 summary 作为上下文，保持解读连贯。"""
    out: list[str] = []
    for ch in meta.chapters:
        if ch.index >= index:
            break
        if ch.status == "done":
            s = store.load_script(meta.book_id, ch.index)
            if s and s.get("summary"):
                out.append(s["summary"])
    return out[-limit:]


async def _worker(meta: BookMeta, indexes: list[int]) -> None:
    """并发执行所有目标章节。"""
    sem = asyncio.Semaphore(max(1, settings.concurrency))

    async def run_one(idx: int) -> None:
        async with sem:
            try:
                await _process_chapter(meta, idx)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("章节处理异常 book=%s ch=%d", meta.book_id, idx)
                _set_chapter(meta, idx, status="error", message="处理异常")

    try:
        await asyncio.gather(*[run_one(i) for i in indexes])
    finally:
        meta.running = False
        store.save_meta(meta)
        _running.pop(meta.book_id, None)


def start_generation(book_id: str, indexes: list[int]) -> bool:
    """启动后台生成任务。返回 False 表示已在运行。"""
    if is_running(book_id):
        return False
    meta = store.load_meta(book_id)
    if meta is None:
        return False
    meta.running = True
    store.save_meta(meta)
    # 复制一份 indexes 防止外部修改
    task = asyncio.create_task(_worker(meta, list(indexes)))
    _running[book_id] = task
    return True


async def regenerate_chapter(book_id: str, index: int) -> bool:
    """单章重做。"""
    meta = store.load_meta(book_id)
    if meta is None:
        return False
    _set_chapter(meta, index, status="pending", message="等待重做", audio_seconds=None)
    task = asyncio.create_task(_process_chapter(meta, index))
    _running[f"{book_id}:{index}"] = task
    # 后台执行，不等
    task.add_done_callback(lambda t: _running.pop(f"{book_id}:{index}", None))
    return True
