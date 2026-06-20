"""Pydantic 数据模型：贯穿解析、解读、合成与 API。"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# 章节状态机：pending → interpreting → synthesizing → done / error
#              （retrying 为 interpreting/synthesizing 期间的中间态展示）
ChapterStatus = Literal[
    "pending", "interpreting", "synthesizing", "retrying", "done", "error"
]

# 单章处理阶段（细粒度进度，供前端展示）
Stage = Literal[
    "idle",                # 等待
    "reading",             # 读取原文
    "calling_model",       # 调用 DeepSeek 解读
    "parsing",             # 解析解读脚本
    "synthesizing_turns",  # 合成各句音频
    "concatenating",       # 拼接 mp3
    "done",
    "error",
]

# 解读风格
InterpretStyle = Literal["deep", "casual", "storytelling", "dialogue"]

# 主题
Theme = Literal["light", "dark", "system"]


class Chapter(BaseModel):
    """一本书中的一个章节。"""
    index: int  # 0-based
    title: str
    char_count: int = 0  # 原文字符数
    status: ChapterStatus = "pending"
    message: str = ""  # 进度/错误文案
    stage: Stage = "idle"  # 细粒度阶段
    stage_detail: str = ""  # 阶段补充文案，如"合成 3/12 句"
    progress: float = 0.0  # 0-1，当前阶段进度
    audio_seconds: float | None = None  # 合成后音频时长
    attempts: int = 0  # 已尝试次数（含首次）


class BookMeta(BaseModel):
    """持久化到 data/books/{id}/meta.json 的书元信息。"""
    book_id: str
    title: str
    author: str = ""
    cover: str | None = None  # base64 data url（可省略）
    created_at: float = 0.0
    chapters: list[Chapter] = Field(default_factory=list)
    running: bool = False  # 全书生成任务运行中标志（展示用）


class Turn(BaseModel):
    """对谈脚本中的一句。"""
    speaker: Literal["甲", "乙"]
    text: str


class Script(BaseModel):
    """一章的对谈解读脚本，由 DeepSeek 生成。"""
    title: str
    summary: str  # 一两句话概述本章解读要点
    turns: list[Turn]


# ---- 全局设置 ----

class Settings(BaseModel):
    """全局设置，持久化到 data/settings.json，覆盖 .env 默认值。"""
    # 解读
    style: InterpretStyle = "dialogue"
    turns_min: int = 8
    turns_max: int = 16
    # 音色（Edge TTS）
    voice_a: str = "zh-CN-XiaoxiaoNeural"
    voice_b: str = "zh-CN-YunxiNeural"
    # 性能 / 限流
    concurrency: int = 2  # 章节并发
    deepseek_rpm: int = 30  # DeepSeek 每分钟请求数上限
    edge_concurrency: int = 8  # Edge TTS 全局并发上限
    # 外观
    theme: Theme = "system"


# 可选音色清单（供设置页选择与试听）
VOICE_OPTIONS: list[dict] = [
    {"id": "zh-CN-XiaoxiaoNeural", "name": "晓晓（女·温柔）"},
    {"id": "zh-CN-XiaoyiNeural", "name": "晓伊（女·活泼）"},
    {"id": "zh-CN-XiaochenNeural", "name": "晓辰（女·稳重）"},
    {"id": "zh-CN-XiaohanNeural", "name": "晓涵（女·知性）"},
    {"id": "zh-CN-XiaomengNeural", "name": "晓梦（女·亲切）"},
    {"id": "zh-CN-XiaomoNeural", "name": "晓墨（女·清冷）"},
    {"id": "zh-CN-XiaoqiuNeural", "name": "晓秋（女·成熟）"},
    {"id": "zh-CN-XiaoruiNeural", "name": "晓睿（女·干练）"},
    {"id": "zh-CN-YunxiNeural", "name": "云希（男·阳光）"},
    {"id": "zh-CN-YunyangNeural", "name": "云扬（男·专业）"},
    {"id": "zh-CN-YunjianNeural", "name": "云健（男·沉稳）"},
    {"id": "zh-CN-YunxiaNeural", "name": "云夏（男·少年）"},
    {"id": "zh-CN-YunfengNeural", "name": "云枫（男·磁性）"},
]


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
