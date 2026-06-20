"""应用配置：从环境变量 / .env 读取，集中管理可调参数。"""
from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # DeepSeek（OpenAI 兼容）
    deepseek_api_key: str = Field(default="", alias="DEEPSEEK_API_KEY")
    deepseek_base_url: str = Field(
        default="https://api.deepseek.com", alias="DEEPSEEK_BASE_URL"
    )
    deepseek_model: str = Field(default="deepseek-chat", alias="DEEPSEEK_MODEL")

    # Edge TTS 音色
    voice_a: str = Field(default="zh-CN-XiaoxiaoNeural", alias="VOICE_A")
    voice_b: str = Field(default="zh-CN-YunxiNeural", alias="VOICE_B")

    # 对谈长度
    turns_min: int = Field(default=8, alias="TURNS_MIN")
    turns_max: int = Field(default=16, alias="TURNS_MAX")

    # 并发
    concurrency: int = Field(default=2, alias="CONCURRENCY")

    # 数据目录（相对于项目根）
    data_dir: str = Field(default="./data", alias="DATA_DIR")

    port: int = Field(default=8000, alias="PORT")

    @property
    def project_root(self) -> Path:
        return Path(__file__).resolve().parent.parent

    @property
    def data_path(self) -> Path:
        p = Path(self.data_dir)
        if not p.is_absolute():
            p = self.project_root / p
        return p

    @property
    def books_path(self) -> Path:
        return self.data_path / "books"

    def book_dir(self, book_id: str) -> Path:
        return self.books_path / book_id

    def chapters_dir(self, book_id: str) -> Path:
        return self.book_dir(book_id) / "chapters"

    def scripts_dir(self, book_id: str) -> Path:
        return self.book_dir(book_id) / "scripts"

    def audio_dir(self, book_id: str) -> Path:
        return self.book_dir(book_id) / "audio"

    def book_meta_path(self, book_id: str) -> Path:
        return self.book_dir(book_id) / "meta.json"

    def chapter_text_path(self, book_id: str, n: int) -> Path:
        return self.chapters_dir(book_id) / f"{n}.txt"

    def script_path(self, book_id: str, n: int) -> Path:
        return self.scripts_dir(book_id) / f"{n}.json"

    def audio_path(self, book_id: str, n: int) -> Path:
        return self.audio_dir(book_id) / f"{n}.mp3"


settings = Settings()
