"""整书导出：把已完成章节的 mp3 与脚本打包成 zip。"""
from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

from . import store
from .config import settings


def _safe_name(s: str, maxlen: int = 60) -> str:
    """清理文件名中的非法字符。"""
    s = re.sub(r"[\\/:*?\"<>|\n\r\t]", "_", s).strip().strip(".")
    return (s or "untitled")[:maxlen]


async def export_zip(book_id: str) -> tuple[bytes, str]:
    """导出整书为 zip。返回 (zip 字节, 文件名)。

    包含：每个 done 章节的 mp3（带序号标题命名）、一份 scripts.json 汇总、
    一份 manifest.txt。
    """
    meta = store.load_meta(book_id)
    if meta is None:
        raise FileNotFoundError("书不存在")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest_lines: list[str] = [f"《{meta.title}》有声解读", ""]
        for ch in meta.chapters:
            if ch.status != "done":
                continue
            audio = settings.audio_path(book_id, ch.index)
            if not audio.exists():
                continue
            seq = ch.index + 1
            fname = f"{seq:02d}_{_safe_name(ch.title)}.mp3"
            zf.write(audio, arcname=f"audio/{fname}")
            manifest_lines.append(
                f"{seq:02d}. {ch.title}"
                + (f"（{ch.audio_seconds:.0f}s）" if ch.audio_seconds else "")
            )
            # 脚本
            script = store.load_script(book_id, ch.index)
            if script:
                zf.writestr(
                    f"scripts/{seq:02d}_{_safe_name(ch.title)}.json",
                    json.dumps(script, ensure_ascii=False, indent=2),
                )
        zf.writestr("manifest.txt", "\n".join(manifest_lines))

    filename = f"{_safe_name(meta.title)}_有声解读.zip"
    return buf.getvalue(), filename
