"""应用配置：从环境变量 / .env 读取基础默认值；
运行时可被 data/settings.json 覆盖（由 store 加载后注入）。
"""
from __future__ import annotations

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

    # Edge TTS 音色（默认值，可被 settings.json 覆盖）
    voice_a: str = Field(default="zh-CN-XiaoxiaoNeural", alias="VOICE_A")
    voice_b: str = Field(default="zh-CN-YunxiNeural", alias="VOICE_B")

    # 解读风格与长度（默认值）
    style: str = Field(default="dialogue", alias="STYLE")
    turns_min: int = Field(default=8, alias="TURNS_MIN")
    turns_max: int = Field(default=16, alias="TURNS_MAX")

    # 并发与限流（默认值）
    concurrency: int = Field(default=2, alias="CONCURRENCY")
    deepseek_rpm: int = Field(default=30, alias="DEEPSEEK_RPM")
    edge_concurrency: int = Field(default=8, alias="EDGE_CONCURRENCY")

    # 数据目录（相对于项目根）
    data_dir: str = Field(default="./data", alias="DATA_DIR")

    port: int = Field(default=8000, alias="PORT")

    # ---- 运行时可变设置（不来自 env，由 store.apply_settings 注入）----
    # 这里仅作占位，真正生效的是 runtime_settings
    theme: str = "system"

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

    @property
    def settings_file(self) -> Path:
        return self.data_path / "settings.json"

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
