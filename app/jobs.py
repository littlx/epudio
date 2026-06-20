"""后台任务：并发为多章生成解读 + 音频。

状态机：pending → interpreting → synthesizing → done / error
  （retrying 为重试期间的展示态）

每个阶段翻转都通过 SSE 推送给前端，并写入 meta.json。
解读与合成各有重试，对 429/网络错误指数退避。
"""
from __future__ import annotations

import asyncio
import logging
import traceback

from . import interpreter, store, tts
from . import sse
from .config import settings
from .schemas import BookMeta, Chapter, Script

log = logging.getLogger("epubmp3.jobs")

# book_id → 运行中的任务句柄
_running: dict[str, asyncio.Task] = {}
# 单章重做任务：f"{book_id}:{index}" → Task
_running_chapter: dict[str, asyncio.Task] = {}


def is_running(book_id: str) -> bool:
    t = _running.get(book_id)
    return t is not None and not t.done()


def is_any_running(book_id: str) -> bool:
    """该书是否有任何任务在跑：全书生成 或 任一单章重做/重新合成。"""
    if is_running(book_id):
        return True
    prefix = f"{book_id}:"
    for key, t in _running_chapter.items():
        if key.startswith(prefix) and t is not None and not t.done():
            return True
    return False


def _chapter_dict(ch: Chapter) -> dict:
    return ch.model_dump(mode="json")


async def _update_chapter(
    meta: BookMeta, index: int, publish: bool = True, **kwargs
) -> None:
    """更新某章字段，落盘，并可选推送 SSE。"""
    # 重新从磁盘读取最新元数据，防止后台写入时覆盖用户并发修改的书名/作者等属性
    fresh = store.load_meta(meta.book_id)
    if fresh is not None:
        meta.title = fresh.title
        meta.author = fresh.author
        meta.cover = fresh.cover
        for ch in fresh.chapters:
            if ch.index == index:
                for k, v in kwargs.items():
                    setattr(ch, k, v)
                break
        for ch in meta.chapters:
            if ch.index == index:
                for k, v in kwargs.items():
                    setattr(ch, k, v)
                break
        store.save_meta(fresh)
    else:
        for ch in meta.chapters:
            if ch.index == index:
                for k, v in kwargs.items():
                    setattr(ch, k, v)
                break
        store.save_meta(meta)

    if publish:
        ch_obj = next((c for c in meta.chapters if c.index == index), None)
        if ch_obj:
            await sse.publish_chapter(meta.book_id, _chapter_dict(ch_obj))


async def _book_state(meta: BookMeta) -> None:
    done = sum(1 for c in meta.chapters if c.status == "done")
    err = sum(1 for c in meta.chapters if c.status == "error")
    await sse.publish_book_state(
        meta.book_id, True, done, len(meta.chapters), err
    )


async def _publish_book_state_once(meta: BookMeta, running: bool) -> None:
    """单章任务开始/结束时推送一次 book 状态，让前端（含书架）刷新计数与 running。"""
    done = sum(1 for c in meta.chapters if c.status == "done")
    err = sum(1 for c in meta.chapters if c.status == "error")
    await sse.publish_book_state(
        meta.book_id, running, done, len(meta.chapters), err
    )


def _collect_prev_summaries(meta: BookMeta, index: int, limit: int = 3) -> list[str]:
    out: list[str] = []
    for ch in meta.chapters:
        if ch.index >= index:
            break
        if ch.status == "done":
            s = store.load_script(meta.book_id, ch.index)
            if s and s.get("summary"):
                out.append(s["summary"])
    return out[-limit:]


def _chapter_title(meta: BookMeta, index: int) -> str:
    for ch in meta.chapters:
        if ch.index == index:
            return ch.title
    return f"第 {index + 1} 章"


async def _process_chapter(meta: BookMeta, index: int) -> None:
    """处理单章：解读 → 合成，带分阶段进度与重试。"""
    text = store.load_chapter_text(meta.book_id, index)
    if not text:
        await _update_chapter(
            meta, index, status="error", stage="error",
            stage_detail="", progress=0.0,
            message="章节原文为空",
            error_detail="store.load_chapter_text 返回空字符串，章节文本文件缺失或为空。",
        )
        return

    max_attempts = 3
    await _update_chapter(
        meta, index, attempts=0, status="interpreting",
        stage="reading", stage_detail="准备原文…", progress=0.05,
        message="解读中",
    )

    # ---- 解读阶段（带重试）----
    script: Script | None = None
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        await _update_chapter(
            meta, index, attempts=attempt,
            status="retrying" if attempt > 1 else "interpreting",
            stage="calling_model", stage_detail=f"解读中（第 {attempt} 次）…",
            progress=0.1 + attempt * 0.05,
            message=f"解读中" + (f"·重试 {attempt-1}" if attempt > 1 else ""),
        )

        async def stage_cb(st, detail, prog):
            # 把阶段进度映射到整体进度（解读占 0.05-0.8）
            mapped = 0.05 + prog * 0.75
            await _update_chapter(
                meta, index, stage=st, stage_detail=detail, progress=mapped,
            )

        try:
            script = await interpreter.interpret_chapter(
                book_title=meta.title,
                author=meta.author,
                chapter_title=_chapter_title(meta, index),
                chapter_text=text,
                prev_summaries=_collect_prev_summaries(meta, index),
                cb=stage_cb,
            )
            break
        except Exception as e:
            last_err = e
            log.warning(
                "解读失败 book=%s ch=%d attempt=%d: %s",
                meta.book_id, index, attempt, str(e)[:160],
            )
            if attempt < max_attempts:
                await asyncio.sleep(1.5 * attempt)

    if script is None:
        detail = _truncate_trace(traceback.format_exc())
        await _update_chapter(
            meta, index, status="error", stage="error",
            stage_detail="", progress=0.0,
            message=f"解读失败：{last_err}",
            error_detail=detail,
        )
        return

    store.save_script(meta.book_id, index, script.model_dump(mode="json"))

    # ---- 合成阶段 ----
    await _synthesize_only(meta, index, script)


def _truncate_trace(tb: str, limit: int = 2000) -> str:
    """截断堆栈文本，避免 meta.json 过大。"""
    tb = tb.strip()
    return tb[:limit] if len(tb) > limit else tb


async def _synthesize_only(meta: BookMeta, index: int, script: Script) -> None:
    """仅合成阶段（带重试）。供 _process_chapter 与脚本编辑后重新合成复用。"""
    max_attempts = 3
    await _update_chapter(
        meta, index, status="synthesizing", stage="synthesizing_turns",
        stage_detail="开始合成…", progress=0.8, message="合成中",
    )

    audio_path = settings.audio_path(meta.book_id, index)
    duration: float | None = None
    last_err = None
    for attempt in range(1, max_attempts + 1):
        await _update_chapter(
            meta, index, attempts=attempt,
            status="retrying" if attempt > 1 else "synthesizing",
            stage_detail=f"合成中（第 {attempt} 次）…", progress=0.8,
            message=f"合成中" + (f"·重试 {attempt-1}" if attempt > 1 else ""),
        )

        async def tts_cb(st, detail, prog):
            # 合成占 0.8-1.0
            mapped = 0.8 + prog * 0.2
            await _update_chapter(
                meta, index, stage=st, stage_detail=detail, progress=mapped,
            )

        try:
            duration = await tts.synthesize_chapter(script, audio_path, cb=tts_cb)
            break
        except Exception as e:
            last_err = e
            log.warning(
                "合成失败 book=%s ch=%d attempt=%d: %s",
                meta.book_id, index, attempt, str(e)[:160],
            )
            if attempt < max_attempts:
                await asyncio.sleep(1.5 * attempt)

    if duration is None:
        detail = _truncate_trace(traceback.format_exc())
        await _update_chapter(
            meta, index, status="error", stage="error",
            stage_detail="", progress=0.0,
            message=f"合成失败：{last_err}",
            error_detail=detail,
        )
        return

    await _update_chapter(
        meta, index, status="done", stage="done", stage_detail="完成",
        progress=1.0, message="完成", audio_seconds=duration,
    )


async def _worker(meta: BookMeta, indexes: list[int]) -> None:
    """并发执行所有目标章节。"""
    sem = asyncio.Semaphore(max(1, settings.concurrency))
    await _book_state(meta)

    async def run_one(idx: int) -> None:
        async with sem:
            try:
                await _process_chapter(meta, idx)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("章节处理异常 book=%s ch=%d", meta.book_id, idx)
                await _update_chapter(
                    meta, idx, status="error", stage="error",
                    stage_detail="", progress=0.0,
                    message="处理异常",
                    error_detail=_truncate_trace(traceback.format_exc()),
                )

    try:
        await asyncio.gather(*[run_one(i) for i in indexes])
    finally:
        fresh = store.load_meta(meta.book_id)
        if fresh is not None:
            fresh.running = False
            fresh.chapters = meta.chapters
            store.save_meta(fresh)
            # 同步回内存对象
            meta.title = fresh.title
            meta.author = fresh.author
            meta.cover = fresh.cover
            meta.running = False
        else:
            meta.running = False
            store.save_meta(meta)

        done = sum(1 for c in meta.chapters if c.status == "done")
        err = sum(1 for c in meta.chapters if c.status == "error")
        await sse.publish_book_state(
            meta.book_id, False, done, len(meta.chapters), err
        )
        await sse.publish_done(meta.book_id)
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
    task = asyncio.create_task(_worker(meta, list(indexes)))
    _running[book_id] = task
    return True


async def regenerate_chapter(book_id: str, index: int) -> bool:
    """单章重做。"""
    if is_running(book_id):
        return False
    meta = store.load_meta(book_id)
    if meta is None:
        return False
    key = f"{book_id}:{index}"
    # 已有重做任务在跑则跳过
    old = _running_chapter.get(key)
    if old and not old.done():
        return False
    await _update_chapter(
        meta, index, status="pending", stage="idle",
        stage_detail="", progress=0.0, message="等待重做", audio_seconds=None,
    )

    async def _wrap():
        try:
            await _publish_book_state_once(meta, True)
            await _process_chapter(meta, index)
        finally:
            # 单章任务结束：重新加载最新 meta 再推送，确保计数准确
            m = store.load_meta(book_id)
            if m is not None:
                await _publish_book_state_once(m, False)
            await sse.publish_done(book_id)

    task = asyncio.create_task(_wrap())
    _running_chapter[key] = task
    task.add_done_callback(lambda t: _running_chapter.pop(key, None))
    return True


async def resynthesize_chapter(book_id: str, index: int, script: Script) -> bool:
    """用编辑后的脚本重新合成音频（跳过解读阶段）。

    与 regenerate_chapter 共用 _running_chapter key 防并发；
    返回 False 表示该书或该章已有任务在跑。
    """
    if is_running(book_id):
        return False
    meta = store.load_meta(book_id)
    if meta is None:
        return False
    key = f"{book_id}:{index}"
    old = _running_chapter.get(key)
    if old and not old.done():
        return False
    # 先持久化编辑后的脚本
    store.save_script(book_id, index, script.model_dump(mode="json"))
    await _update_chapter(
        meta, index, status="pending", stage="idle",
        stage_detail="", progress=0.0, message="等待重新合成", audio_seconds=None,
    )

    async def _wrap():
        try:
            await _publish_book_state_once(meta, True)
            await _synthesize_only(meta, index, script)
        finally:
            m = store.load_meta(book_id)
            if m is not None:
                await _publish_book_state_once(m, False)
            await sse.publish_done(book_id)

    task = asyncio.create_task(_wrap())
    _running_chapter[key] = task
    task.add_done_callback(lambda t: _running_chapter.pop(key, None))
    return True
