"""Pydantic 数据模型：贯穿解析、解读、合成与 API。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# 章节状态机：pending → interpreting → synthesizing → done / error
ChapterStatus = Literal["pending", "interpreting", "synthesizing", "done", "error"]


class Chapter(BaseModel):
    """一本书中的一个章节。"""
    index: int  # 0-based
    title: str
    char_count: int = 0  # 原文字符数
    status: ChapterStatus = "pending"
    message: str = ""  # 进度/错误文案
    audio_seconds: float | None = None  # 合成后音频时长


class BookMeta(BaseModel):
    """持久化到 data/books/{id}/meta.json 的书元信息。"""
    book_id: str
    title: str
    author: str = ""
    cover: str | None = None  # base64 data url（可省略）
    created_at: float = 0.0
    chapters: list[Chapter] = Field(default_factory=list)
    # 全书生成任务运行中标志（仅内存中真正驱动；此处仅作展示）
    running: bool = False


class Turn(BaseModel):
    """对谈脚本中的一句。"""
    speaker: Literal["甲", "乙"]
    text: str


class Script(BaseModel):
    """一章的对谈解读脚本，由 DeepSeek 生成。"""
    title: str
    summary: str  # 一两句话概述本章解读要点
    turns: list[Turn]


# ---- API 响应 ----

class BookSummary(BaseModel):
    book_id: str
    title: str
    author: str
    chapter_count: int
    done_count: int
    created_at: float


class GenerateRequest(BaseModel):
    chapters: list[int] | None = None  # 指定章节 index；None=全部
    reset: bool = False  # 是否重做已完成章节


class Message(BaseModel):
    message: str
