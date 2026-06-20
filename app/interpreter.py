"""DeepSeek → 对谈解读脚本。

把一章原文交给 DeepSeek，让它以两位读书播客主持人聊天的形式，
对该章做深度解读（非朗读原文），输出结构化 JSON：
{title, summary, turns:[{speaker:"甲"/"乙", text}]}
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from openai import AsyncOpenAI

from .config import settings
from .schemas import Script, Turn

log = logging.getLogger("epubmp3.interpreter")

SYSTEM_PROMPT = """\
你是一档中文读书播客的两位主持人「甲」和「乙」。你们正在为听众深度解读一本书的某一章。

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
- 总轮数（甲+乙 各算一句，共 N 句）按用户指定的范围。
"""


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
    # 原文过长则截断（保留结尾），DeepSeek 上下文足够，但避免无谓冗长
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


def _strip_code_fence(s: str) -> str:
    """去掉模型偶尔包的 ```json ... ``` 围栏。"""
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s)
    return s.strip()


# 字符串值内不允许出现的裸控制字符（含换行/回车/制表符等）。
# 模型有时会在 text 里塞字面换行/回车，导致 json.loads 失败。
# 由于 _sanitize_json_text 只在双引号字符串内部替换，结构性的
# 行间空白（在字符串外）不受影响，因此可安全覆盖全部控制字符。
_CTRL_RE = re.compile(r"[\x00-\x1f]")


def _sanitize_json_text(raw: str) -> str:
    """清洗可能破坏 JSON 解析的内容：把字符串值内的裸控制字符转义掉。

    采用逐字符状态机扫描，仅在双引号字符串内部替换控制字符，
    避免动到结构性的空白。
    """
    out: list[str] = []
    in_str = False
    escape = False
    for ch in raw:
        if not in_str:
            out.append(ch)
            if ch == '"':
                in_str = True
            continue
        # 在字符串内
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
            # 转义为 \uXXXX，保留可读性
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

    # 策略 1：直接解析
    data = _try_load(content)
    if data is not None:
        return data

    # 策略 2：截取首个 { 到末个 }
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1 and end > start:
        sub = content[start : end + 1]
        data = _try_load(sub)
        if data is not None:
            return data

    # 策略 3：清洗字符串内的裸控制字符后再解析
    cleaned = _sanitize_json_text(sub if start != -1 else content)
    data = _try_load(cleaned)
    if data is not None:
        return data

    # 仍然失败：给出可定位的错误
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
        # 规范化为「甲」「乙」
        if speaker.startswith("甲"):
            speaker = "甲"
        elif speaker.startswith("乙"):
            speaker = "乙"
        else:
            # 未知则与上一句相反
            speaker = "乙" if last == "甲" else "甲"
        # 保证交替
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


async def interpret_chapter(
    book_title: str,
    author: str,
    chapter_title: str,
    chapter_text: str,
    prev_summaries: list[str] | None = None,
) -> Script:
    """调用 DeepSeek 生成一章的对谈解读脚本。

    带重试：偶发的 JSON 解析失败或网络错误会重试最多 3 次。
    """
    import asyncio

    client = _get_client()
    user_prompt = _build_user_prompt(
        book_title, author, chapter_title, chapter_text, prev_summaries or []
    )
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    last_err: Exception | None = None
    for attempt in range(1, 4):
        try:
            resp = await client.chat.completions.create(
                model=settings.deepseek_model,
                messages=messages,
                temperature=0.8,
                response_format={"type": "json_object"},
            )
            content = resp.choices[0].message.content or ""
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
