"""data/ 目录与 meta.json / settings.json 的读写管理。"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

from .config import settings
from .schemas import BookMeta, Chapter, Settings as AppSettings, VOICE_OPTIONS


def ensure_dirs(book_id: str) -> None:
    """为某本书创建所需的全部子目录。"""
    for d in (
        settings.chapters_dir(book_id),
        settings.scripts_dir(book_id),
        settings.audio_dir(book_id),
    ):
        d.mkdir(parents=True, exist_ok=True)


def gen_book_id() -> str:
    return uuid.uuid4().hex[:12]


def load_meta(book_id: str) -> BookMeta | None:
    p = settings.book_meta_path(book_id)
    if not p.exists():
        return None
    return BookMeta.model_validate_json(p.read_text(encoding="utf-8"))


def save_meta(meta: BookMeta) -> None:
    p = settings.book_meta_path(meta.book_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(meta.model_dump_json(indent=2), encoding="utf-8")


def list_books() -> list[BookMeta]:
    root = settings.books_path
    if not root.exists():
        return []
    books: list[BookMeta] = []
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        meta = load_meta(d.name)
        if meta is not None:
            books.append(meta)
    books.sort(key=lambda m: m.created_at, reverse=True)
    return books


def save_chapter_text(book_id: str, index: int, text: str) -> None:
    settings.chapter_text_path(book_id, index).write_text(text, encoding="utf-8")


def load_chapter_text(book_id: str, index: int) -> str:
    p = settings.chapter_text_path(book_id, index)
    return p.read_text(encoding="utf-8") if p.exists() else ""


def save_script(book_id: str, index: int, data: dict) -> None:
    p = settings.script_path(book_id, index)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_script(book_id: str, index: int) -> dict | None:
    p = settings.script_path(book_id, index)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def delete_book(book_id: str) -> None:
    import shutil

    d = settings.book_dir(book_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


def new_book(title: str, author: str, chapters: list[Chapter]) -> BookMeta:
    book_id = gen_book_id()
    ensure_dirs(book_id)
    meta = BookMeta(
        book_id=book_id,
        title=title,
        author=author,
        created_at=time.time(),
        chapters=chapters,
    )
    save_meta(meta)
    return meta


# ---- 全局设置 ----

def _default_settings() -> AppSettings:
    """从 .env/环境变量派生默认设置。"""
    return AppSettings(
        style=settings.style,
        turns_min=settings.turns_min,
        turns_max=settings.turns_max,
        voice_a=settings.voice_a,
        voice_b=settings.voice_b,
        concurrency=settings.concurrency,
        deepseek_rpm=settings.deepseek_rpm,
        edge_concurrency=settings.edge_concurrency,
        theme=settings.theme,
    )


def load_settings() -> AppSettings:
    """加载 settings.json，缺失字段用默认值补全。"""
    p = settings.settings_file
    if not p.exists():
        return _default_settings()
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return _default_settings()
    # 用默认值打底，再覆盖已存字段
    base = _default_settings().model_dump()
    base.update({k: v for k, v in data.items() if k in base})
    return AppSettings.model_validate(base)


def save_settings(s: AppSettings) -> None:
    p = settings.settings_file
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s.model_dump_json(indent=2), encoding="utf-8")
    apply_settings(s)


def apply_settings(s: AppSettings) -> None:
    """把运行时设置同步到全局 settings，供 interpreter/tts 直接读取。"""
    settings.style = s.style
    settings.turns_min = s.turns_min
    settings.turns_max = s.turns_max
    
    valid_ids = {v["id"] for v in VOICE_OPTIONS}
    settings.voice_a = s.voice_a if s.voice_a in valid_ids else "zh-CN-XiaoxiaoNeural"
    settings.voice_b = s.voice_b if s.voice_b in valid_ids else "zh-CN-YunxiNeural"
    
    settings.concurrency = s.concurrency
    settings.deepseek_rpm = s.deepseek_rpm
    settings.edge_concurrency = s.edge_concurrency
    settings.theme = s.theme


# ---- 启动恢复 ----

def recover_on_startup() -> int:
    """把所有书中处于中间态（interpreting/synthesizing/retrying）的章节
    回退为 pending，避免服务重启后永久卡住。返回受影响章节数。
    """
    affected = 0
    for meta in list_books():
        changed = False
        for ch in meta.chapters:
            if ch.status in ("interpreting", "synthesizing", "retrying"):
                ch.status = "pending"
                ch.stage = "idle"
                ch.stage_detail = ""
                ch.progress = 0.0
                ch.message = "服务重启，待恢复"
                ch.error_detail = ""
                changed = True
                affected += 1
        if changed or meta.running:
            meta.running = False
            save_meta(meta)
    return affected

