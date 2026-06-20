"""EPUB → 章节文本。

策略：优先用 NCX/Nav TOC 提取章节标题与对应 spine 项；
按 spine 顺序合并同一 toc 锚点下的多个内容文档；
HTML → 纯文本（保留段落），过滤明显非正文的短项。
"""
from __future__ import annotations

import re
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import IO

import ebooklib
from bs4 import BeautifulSoup
from ebooklib import epub

# ebooklib 用 lxml HTML 解析器解析 XHTML 时会触发该警告，可安全忽略
try:
    from bs4 import XMLParsedAsHTMLWarning

    warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
except Exception:
    pass

from .schemas import Chapter


@dataclass
class ParsedBook:
    title: str
    author: str
    cover: str | None  # base64 data url
    chapters: list[Chapter]
    texts: list[str]  # 与 chapters 一一对应的纯文本


# ---- 文本清洗 ----

_BR_RE = re.compile(r"<\s*br\s*/?>", re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\u00a0]+")
_MULTI_BLANK = re.compile(r"\n{3,}")


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    # <br> → 换行，<p> → 换行
    for br in soup.find_all("br"):
        br.replace_with("\n")
    # 用换行分隔块级元素
    for tag in soup.find_all(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li"]):
        tag.append("\n")
    text = soup.get_text()
    # 折叠多余空白
    text = _WS_RE.sub(" ", text)
    text = _MULTI_BLANK.sub("\n\n", text)
    return text.strip()


# ---- 章节切分 ----

def _read_item_content(book: epub.EpubBook, item: epub.EpubItem) -> str:
    content = item.get_content()
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return content.decode("utf-8", errors="ignore")


def _href_to_id(href: str) -> str:
    """toc href 形如 'text/ch1.xhtml' 或 'text/ch1.xhtml#sec1'，取文件 id 部分。"""
    href = href.split("#")[0]
    return href.rsplit("/", 1)[-1]


def parse_epub(file_or_path: str | Path | IO[bytes]) -> ParsedBook:
    if isinstance(file_or_path, (str, Path)):
        book = epub.read_epub(str(file_or_path), options={"ignore_ncx": False})
    else:
        # ebooklib 的 read_epub 会调用 .seek()，必须传可寻址对象
        if isinstance(file_or_path, (bytes, bytearray)):
            import io as _io

            file_or_path = _io.BytesIO(file_or_path)
        book = epub.read_epub(file_or_path, options={"ignore_ncx": False})

    title = (book.get_metadata("DC", "title") or [("", "")])[0][0] or "未命名"
    author_meta = book.get_metadata("DC", "creator") or [("", "")]
    author = author_meta[0][0] if author_meta else ""

    # 封面
    cover: str | None = None
    try:
        cover_item = book.get_cover()
        if cover_item:
            import base64

            cover_data, mime = cover_item
            cover = f"data:{mime};base64,{base64.b64encode(cover_data).decode()}"
    except Exception:
        cover = None

    # spine 中按出现顺序的内容项
    spine_ids = [item[0] for item in book.spine] if book.spine else []
    spine_items: list[epub.EpubHtml] = []
    seen = set()
    for sid in spine_ids:
        item = book.get_item_with_id(sid)
        if item and item.get_type() == ebooklib.ITEM_DOCUMENT and sid not in seen:
            spine_items.append(item)  # type: ignore[arg-type]
            seen.add(sid)
    # 兜底：spine 为空时取全部文档项
    if not spine_items:
        for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
            if item.get_id() not in seen:
                spine_items.append(item)  # type: ignore[arg-type]
                seen.add(item.get_id())

    # TOC → 每章对应的起始 spine 文件名
    # ebooklib 的 toc 元素可能是：
    #   - Link        叶子
    #   - Section     带标题的层级头（含 href）
    #   - (Section, [Link/Section, ...])  带子项的嵌套结构
    toc_entries: list[tuple[str, str]] = []  # (title, filename)

    def _add_toc_item(title: str, href: str) -> None:
        fname = _href_to_id(href)
        if fname:
            toc_entries.append((title or "", fname))

    def _walk(node: object) -> None:
        if isinstance(node, tuple) and len(node) == 2:
            head, children = node
            # 嵌套结构 (Section/Link, [子项...])
            if isinstance(children, list):
                _walk(head)
                for child in children:
                    _walk(child)
                return
            # 否则可能是 (title, href) 这种非标准形式
            _add_toc_item(str(head), str(children))
            return
        if isinstance(node, epub.Section):
            _add_toc_item(node.title or "", node.href)
            return
        if isinstance(node, epub.Link):
            _add_toc_item(node.title or "", node.href)
            return
        if hasattr(node, "title") and hasattr(node, "href"):
            _add_toc_item(
                getattr(node, "title", "") or "", getattr(node, "href", "")
            )

    for toc in book.toc:
        _walk(toc)

    # 构建 filename → spine 索引
    fname_to_idx: dict[str, int] = {}
    for i, it in enumerate(spine_items):
        fname_to_idx[it.get_name().rsplit("/", 1)[-1]] = i

    # 合并：把 toc 锚点之间的 spine 项归到对应章节
    chapters_raw: list[tuple[str, list[epub.EpubHtml]]] = []
    if toc_entries:
        # 仅保留 spine 中存在且按顺序去重的锚点
        anchors: list[tuple[str, int]] = []
        for ttitle, fname in toc_entries:
            if fname in fname_to_idx:
                idx = fname_to_idx[fname]
                if not anchors or anchors[-1][1] != idx:
                    anchors.append((ttitle or f"第 {len(anchors) + 1} 节", idx))
        if anchors:
            for i, (ctitle, start) in enumerate(anchors):
                end = anchors[i + 1][1] if i + 1 < len(anchors) else len(spine_items)
                chapters_raw.append((ctitle, spine_items[start:end]))

    # 无可用 TOC：每个 spine 文档视为一章
    if not chapters_raw:
        for it in spine_items:
            chapters_raw.append((it.get_name().rsplit("/", 1)[-1], [it]))

    # 生成文本，过滤掉过短的非正文项
    chapters: list[Chapter] = []
    texts: list[str] = []
    for idx, (ctitle, items) in enumerate(chapters_raw):
        html_parts = [_read_item_content(book, it) for it in items]
        text = html_to_text("\n".join(html_parts))
        if len(text) < 120:
            # 太短，多半是封面/版权/目录页，跳过
            continue
        chapters.append(
            Chapter(index=len(chapters), title=_clean_title(ctitle), char_count=len(text))
        )
        texts.append(text)

    # 重新编号 index 为连续
    for i, ch in enumerate(chapters):
        ch.index = i

    if not chapters and spine_items:
        # 极端兜底：合并全部
        text = html_to_text("\n".join(_read_item_content(book, it) for it in spine_items))
        chapters.append(Chapter(index=0, title=title, char_count=len(text)))
        texts.append(text)

    return ParsedBook(
        title=title, author=author, cover=cover, chapters=chapters, texts=texts
    )


def _clean_title(s: str) -> str:
    s = s.strip()
    s = re.sub(r"\s+", " ", s)
    return s or "未命名章节"
