"""SSE 事件总线：每书一个 bus，章节状态/阶段变化时推送事件。

前端通过 GET /api/books/{id}/stream 订阅，实时获得进度更新，
替代轮询。事件结构：
  {"type": "chapter", "chapter": {index, status, stage, stage_detail, progress, ...}}
  {"type": "book", "running": bool, "done": n, "total": n, "errored": n}
  {"type": "done"}  # 全书生成结束
"""
from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

log = logging.getLogger("epubmp3.sse")


class EventBus:
    """单本书的事件总线：维护订阅者队列，publish 时向所有订阅者推送。"""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=256)
        async with self._lock:
            self._subscribers.add(q)
        return q

    async def unsubscribe(self, q: asyncio.Queue) -> None:
        async with self._lock:
            self._subscribers.discard(q)

    async def publish(self, data: dict[str, Any]) -> None:
        """向所有订阅者推送一个事件。队列满则丢弃（避免阻塞 worker）。"""
        async with self._lock:
            subs = list(self._subscribers)
        payload = json.dumps(data, ensure_ascii=False)
        for q in subs:
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                # 丢弃最旧的一条，保证最新进度能送达
                try:
                    q.get_nowait()
                    q.put_nowait(payload)
                except Exception:
                    pass


# 全局：book_id → EventBus
_buses: dict[str, EventBus] = defaultdict(EventBus)


def get_bus(book_id: str) -> EventBus:
    return _buses[book_id]


async def publish_chapter(book_id: str, chapter: dict[str, Any]) -> None:
    await get_bus(book_id).publish({"type": "chapter", "chapter": chapter})


async def publish_book_state(
    book_id: str, running: bool, done: int, total: int, errored: int
) -> None:
    await get_bus(book_id).publish(
        {
            "type": "book",
            "running": running,
            "done": done,
            "total": total,
            "errored": errored,
        }
    )


async def publish_done(book_id: str) -> None:
    await get_bus(book_id).publish({"type": "done"})
