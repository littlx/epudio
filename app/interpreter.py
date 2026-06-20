"""DeepSeek → 对谈解读脚本。

把一章原文交给 DeepSeek，让它以指定风格解读（非朗读原文），
输出结构化 JSON：{title, summary, turns:[{speaker:"甲"/"乙", text}]}。

支持：
- 风格切换（深度解读/通俗讲解/评书式/对谈式）
- 令牌桶限流（DeepSeek RPM）
- 分阶段进度回调
- 长章节自动分段摘要，避免截断丢内容
- 失败自动重试（指数退避）
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Awaitable, Callable

from openai import AsyncOpenAI

from .config import settings
from .ratelimit import deepseek_limiter
from .schemas import InterpretStyle, Script, Turn

log = logging.getLogger("epubmp3.interpreter")

# 阶段回调：传 (stage, detail, progress)
StageCb = Callable[[str, str, float], Awaitable[None]]


# ---- 风格 prompt 模板 ----

_STYLE_INTRO: dict[InterpretStyle, str] = {
    "dialogue": (
        "你是一档中文读书播客的两位主持人「甲」和「乙」。"
        "你们正在为听众深度解读一本书的某一章，以两人对谈聊天的形式展开。"
    ),
    "deep": (
        "你是一位文学评论学者，以严谨而深入的方式解读一本书的某一章。"
        "虽有两位讲述者「甲」「乙」交替发言，但侧重学理分析、文本细读与理论支撑。"
    ),
    "casual": (
        "你是两位说大白话的读书博主「甲」「乙」，用最通俗的语言把一章讲明白，"
        "像给没读过这本书的朋友讲清楚这章在说什么、为什么重要。"
    ),
    "storytelling": (
        "你是两位说书人「甲」「乙」，用评书/故事化的方式演绎一章，"
        "带戏剧性叙述，生动有悬念，像在茶馆里说书。"
    ),
}

_COMMON_REQ = """
要求：
1. **不要照搬或朗读原文**，要做真正的"解读"：提炼主题立意、分析叙事手法与结构、
   剖析人物心理与动机、解读象征与隐喻、还原历史/文化语境、联系现实与人性。
2. 两位主持人是对话聊天风格，互相呼应、追问、补充、有节奏感，避免一方独白。
3. 语言口语化、生动、有见地，像真在聊天，而不是念稿。
4. 深度优先，但要让普通听众听得懂；可以有金句和类比。
5. 输出必须是 JSON，且只输出 JSON，不要任何多余文字、不要 markdown 代码块标记。

JSON 结构：
{
  "title": "这一期解读的标题（10-20字，吸引人）",
  "summary": "一两句话概括这章你解读的核心要点",
  "turns": [
    {"speaker": "甲", "text": "……"},
    {"speaker": "乙", "text": "……"},
    ...
  ]
}

约束：
- speaker 只能是 "甲" 或 "乙"，两者交替出现。
- 甲、乙都应有实质内容，不能只是捧哏。
- 每句 text 控制在 30-150 字，自然口语，适合朗读。
- 总句数（甲+乙）按用户指定的范围。
"""


def _system_prompt(style: InterpretStyle) -> str:
    return _STYLE_INTRO.get(style, _STYLE_INTRO["dialogue"]) + _COMMON_REQ


def _build_user_prompt(
    book_title: str,
    author: str,
    chapter_title: str,
    chapter_text: str,
    prev_summaries: list[str],
) -> str:
    parts = [f"【书名】{book_title}"]
    if author:
        parts.append(f"【作者】{author}")
    parts.append(f"【本章】{chapter_title}")
    if prev_summaries:
        parts.append("【前文解读要点（保持连贯，但勿重复）】")
        parts.extend(f"- {s}" for s in prev_summaries)
    parts.append("【本章原文】")
    # 原文过长则截断（保留首尾），DeepSeek 上下文足够
    max_chars = 18000
    text = chapter_text
    if len(text) > max_chars:
        text = text[: max_chars // 2] + "\n……（中略）……\n" + text[-max_chars // 2 :]
    parts.append(text)
    parts.append(
        f"\n请按系统提示输出 JSON。本轮对话总句数请在 "
        f"{settings.turns_min * 2}-{settings.turns_max * 2} 句之间，甲乙交替。"
    )
    return "\n".join(parts)


# ---- JSON 解析（含控制字符清洗）----

def _strip_code_fence(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s)
    return s.strip()


_CTRL_RE = re.compile(r"[\x00-\x1f]")


def _sanitize_json_text(raw: str) -> str:
    out: list[str] = []
    in_str = False
    escape = False
    for ch in raw:
        if not in_str:
            out.append(ch)
            if ch == '"':
                in_str = True
            continue
        if escape:
            out.append(ch)
            escape = False
            continue
        if ch == "\\":
            out.append(ch)
            escape = True
            continue
        if ch == '"':
            out.append(ch)
            in_str = False
            continue
        if _CTRL_RE.match(ch):
            out.append(f"\\u{ord(ch):04x}")
        else:
            out.append(ch)
    return "".join(out)


def _try_load(content: str) -> dict[str, Any] | None:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return None


def _extract_json(content: str) -> dict[str, Any]:
    content = _strip_code_fence(content)
    data = _try_load(content)
    if data is not None:
        return data
    start = content.find("{")
    end = content.rfind("}")
    sub = ""
    if start != -1 and end != -1 and end > start:
        sub = content[start : end + 1]
        data = _try_load(sub)
        if data is not None:
            return data
    cleaned = _sanitize_json_text(sub if start != -1 else content)
    data = _try_load(cleaned)
    if data is not None:
        return data
    snippet = content[:200].replace("\n", "\\n")
    raise ValueError(
        f"无法从模型输出中解析 JSON（可能含非法控制字符）。开头：{snippet}"
    )


def _normalize_script(data: dict[str, Any]) -> Script:
    turns_raw = data.get("turns") or []
    turns: list[Turn] = []
    last = ""
    for t in turns_raw:
        speaker = str(t.get("speaker", "")).strip()
        text = str(t.get("text", "")).strip()
        if not text:
            continue
        if speaker.startswith("甲"):
            speaker = "甲"
        elif speaker.startswith("乙"):
            speaker = "乙"
        else:
            speaker = "乙" if last == "甲" else "甲"
        if speaker == last:
            speaker = "乙" if last == "甲" else "甲"
        turns.append(Turn(speaker=speaker, text=text))
        last = speaker
    if not turns:
        raise ValueError("解读脚本没有任何有效句子")
    return Script(
        title=str(data.get("title", "")).strip() or "本期解读",
        summary=str(data.get("summary", "")).strip(),
        turns=turns,
    )


def _get_client() -> AsyncOpenAI:
    if not settings.deepseek_api_key:
        raise RuntimeError(
            "未配置 DEEPSEEK_API_KEY，请在 .env 中设置（参考 .env.example）。"
        )
    return AsyncOpenAI(
        api_key=settings.deepseek_api_key,
        base_url=settings.deepseek_base_url,
    )


# ---- 长章节分段摘要 ----

async def _summarize_for_context(
    client: AsyncOpenAI, chapter_text: str, cb: StageCb | None
) -> str:
    """超长章节：先让模型生成一份浓缩摘要，作为解读的上下文，
    避免直接截断丢失中段内容。返回摘要文本。
    """
    if len(chapter_text) <= 18000:
        return chapter_text
    if cb:
        await cb("reading", "原文较长，先生成摘要…", 0.1)
    resp = await client.chat.completions.create(
        model=settings.deepseek_model,
        messages=[
            {
                "role": "system",
                "content": "用中文把下面这章原文压缩成一份 1500-2500 字的详细摘要，"
                "保留关键情节、人物、转折、意象，不要评价，只忠实浓缩。",
            },
            {"role": "user", "content": chapter_text},
        ],
        temperature=0.3,
    )
    summary = (resp.choices[0].message.content or "").strip()
    # 摘要 + 原文首尾，兼顾浓缩与首尾细节
    head = chapter_text[:4000]
    tail = chapter_text[-4000:]
    return f"（以下为本章浓缩摘要，供解读参考）\n{summary}\n\n（本章开头）\n{head}\n……\n（本章结尾）\n{tail}"


async def interpret_chapter(
    book_title: str,
    author: str,
    chapter_title: str,
    chapter_text: str,
    prev_summaries: list[str] | None = None,
    style: InterpretStyle | None = None,
    cb: StageCb | None = None,
) -> Script:
    """调用 DeepSeek 生成一章的对谈解读脚本。

    - style：解读风格，默认读 settings.style
    - cb：分阶段进度回调
    - 带重试：解析失败或网络错误重试最多 3 次，指数退避
    """
    import asyncio

    client = _get_client()
    style = style or settings.style  # type: ignore[assignment]
    if cb:
        await cb("reading", "准备原文…", 0.05)

    # 长文先摘要
    context_text = await _summarize_for_context(client, chapter_text, cb)

    user_prompt = _build_user_prompt(
        book_title, author, chapter_title, context_text, prev_summaries or []
    )
    messages = [
        {"role": "system", "content": _system_prompt(style)},
        {"role": "user", "content": user_prompt},
    ]

    last_err: Exception | None = None
    for attempt in range(1, 4):
        if cb:
            await cb("calling_model", f"解读中（第 {attempt} 次）…", 0.1 + attempt * 0.05)
        try:
            # 限流
            if deepseek_limiter:
                await deepseek_limiter.acquire()
            resp = await client.chat.completions.create(
                model=settings.deepseek_model,
                messages=messages,
                temperature=0.8,
                response_format={"type": "json_object"},
            )
            content = resp.choices[0].message.content or ""
            if cb:
                await cb("parsing", "解析解读脚本…", 0.85)
            data = _extract_json(content)
            return _normalize_script(data)
        except Exception as e:
            last_err = e
            log.warning(
                "解读第 %d 次尝试失败（%s：%s）",
                attempt, type(e).__name__, str(e)[:160],
            )
            if attempt < 3:
                await asyncio.sleep(1.5 * attempt)
    raise RuntimeError(f"解读失败，已重试 3 次：{last_err}")
