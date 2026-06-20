"""Edge TTS 合成 + ffmpeg 拼接。

把一章的对谈脚本 turns 逐句用 edge-tts 合成为 mp3（按说话人分配音色），
再用 ffmpeg concat demuxer 无损拼接成单一章节 mp3。
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path

import edge_tts

from .config import settings
from .schemas import Script


def _voice_for(speaker: str) -> str:
    return settings.voice_a if speaker == "甲" else settings.voice_b


async def _synthesize_one(
    text: str, voice: str, out_path: Path, sem: asyncio.Semaphore
) -> None:
    """合成单句。带信号量限流，避免对 Edge 服务并发过高。"""
    async with sem:
        communicate = edge_tts.Communicate(text, voice, rate="+0%", volume="+0%")
        await communicate.save(str(out_path))


async def _probe_duration(path: Path) -> float:
    """用 ffprobe 取音频时长（秒）。"""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    try:
        return float(out.decode().strip())
    except ValueError:
        return 0.0


async def _concat(parts: list[Path], out_path: Path) -> None:
    """用 ffmpeg concat demuxer 无损拼接同格式 mp3。"""
    if not parts:
        raise ValueError("没有可拼接的片段")
    if len(parts) == 1:
        os.replace(parts[0], out_path)
        return
    with tempfile.NamedTemporaryFile(
        "w", suffix=".txt", delete=False, encoding="utf-8"
    ) as f:
        for p in parts:
            # concat demuxer 要求路径转义反斜杠与单引号；这里用绝对路径且无特殊字符
            f.write(f"file '{p.resolve()}'\n")
        list_path = f.name
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", list_path,
            "-c", "copy", str(out_path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode != 0:
            # copy 失败时回退重编码
            await _concat_reencode(parts, out_path, err.decode())
    finally:
        os.unlink(list_path)


async def _concat_reencode(
    parts: list[Path], out_path: Path, reason: str
) -> None:
    """copy 模式失败（参数不一致等）时，重编码拼接。"""
    inputs: list[str] = []
    for p in parts:
        inputs += ["-i", str(p)]
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        *inputs, "-filter_complex",
        f"concat=n={len(parts)}:v=0:a=1[out]",
        "-map", "[out]", str(out_path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg 拼接失败：{reason} | 重编码也失败：{err.decode()}"
        )


async def synthesize_chapter(
    script: Script, out_path: Path
) -> float:
    """合成一章为单一 mp3，返回总时长（秒）。"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmpdir = Path(tempfile.mkdtemp(prefix="tts_"))
    sem = asyncio.Semaphore(4)
    parts: list[Path] = []
    try:
        tasks = []
        for i, turn in enumerate(script.turns):
            part = tmpdir / f"{i:04d}.mp3"
            parts.append(part)
            tasks.append(_synthesize_one(turn.text, _voice_for(turn.speaker), part, sem))
        await asyncio.gather(*tasks)

        # 校验所有片段存在且非空
        valid = [p for p in parts if p.exists() and p.stat().st_size > 0]
        if not valid:
            raise RuntimeError("TTS 未生成任何有效音频片段")
        await _concat(valid, out_path)
        duration = await _probe_duration(out_path)
        return duration
    finally:
        import shutil

        shutil.rmtree(tmpdir, ignore_errors=True)
