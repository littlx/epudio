"""Edge TTS 合成 + ffmpeg 拼接。

把一章的对谈脚本 turns 逐句用 edge-tts 合成为 mp3（按说话人分配音色），
再用 ffmpeg concat demuxer 无损拼接成单一章节 mp3。

支持：
- 全局并发限流（edge_limiter，避免 CONCURRENCY×N 叠加超限）
- 分阶段进度回调
- 单句合成失败重试
"""
from __future__ import annotations

import asyncio
import os
import shutil
import tempfile
from pathlib import Path

import edge_tts

from .config import settings
from .ratelimit import edge_limiter
from .schemas import Script


def _voice_for(speaker: str) -> str:
    return settings.voice_a if speaker == "甲" else settings.voice_b


async def _synthesize_one(
    text: str, voice: str, out_path: Path
) -> None:
    """合成单句（带简单重试）。"""
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            communicate = edge_tts.Communicate(text, voice)
            await communicate.save(str(out_path))
            if out_path.exists() and out_path.stat().st_size > 0:
                return
            raise RuntimeError("合成为空文件")
        except Exception as e:
            last_err = e
            if out_path.exists():
                out_path.unlink(missing_ok=True)
            await asyncio.sleep(0.8 * (attempt + 1))
    raise RuntimeError(f"单句合成失败：{last_err}")


async def _synthesize_one_limited(
    text: str, voice: str, out_path: Path
) -> None:
    """经全局并发限流器合成单句。"""
    if edge_limiter:
        await edge_limiter.run(lambda: _synthesize_one(text, voice, out_path))
    else:
        await _synthesize_one(text, voice, out_path)


async def _probe_duration(path: Path) -> float:
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
    if not parts:
        raise ValueError("没有可拼接的片段")
    if len(parts) == 1:
        os.replace(parts[0], out_path)
        return
    with tempfile.NamedTemporaryFile(
        "w", suffix=".txt", delete=False, encoding="utf-8"
    ) as f:
        for p in parts:
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
            await _concat_reencode(parts, out_path, err.decode())
    finally:
        os.unlink(list_path)


async def _concat_reencode(parts: list[Path], out_path: Path, reason: str) -> None:
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
    script: Script, out_path: Path, cb=None
) -> float:
    """合成一章为单一 mp3，返回总时长（秒）。

    cb: 可选的异步阶段回调 (stage, detail, progress)。
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmpdir = Path(tempfile.mkdtemp(prefix="tts_"))
    parts: list[Path] = []
    total = len(script.turns)
    try:
        if cb:
            await cb("synthesizing_turns", f"合成 0/{total} 句…", 0.0)

        done_count = 0
        sem = asyncio.Semaphore(4)  # 章内额外细粒度限流

        async def run_one(i: int, turn):
            nonlocal done_count
            async with sem:
                part = tmpdir / f"{i:04d}.mp3"
                await _synthesize_one_limited(
                    turn.text, _voice_for(turn.speaker), part
                )
                parts.append(part)
                done_count += 1
                if cb:
                    await cb(
                        "synthesizing_turns",
                        f"合成 {done_count}/{total} 句…",
                        done_count / total if total else 1.0,
                    )

        await asyncio.gather(*[run_one(i, t) for i, t in enumerate(script.turns)])

        # 校验
        valid = [p for p in parts if p.exists() and p.stat().st_size > 0]
        if not valid:
            raise RuntimeError("TTS 未生成任何有效音频片段")

        if cb:
            await cb("concatenating", "拼接音频…", 0.95)
        # 按序号排序保证顺序
        valid.sort(key=lambda p: p.name)
        await _concat(valid, out_path)
        duration = await _probe_duration(out_path)
        if cb:
            await cb("concatenating", "完成", 1.0)
        return duration
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
