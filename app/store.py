"""data/ 目录与 meta.json 的读写管理。"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

from .config import settings
from .schemas import BookMeta, Chapter


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
