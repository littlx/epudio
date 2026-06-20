"""令牌桶限流器：用于 DeepSeek RPM 与 Edge TTS 全局并发控制。

- TokenBucketRateLimiter：按时间补充令牌，限制每秒/每分钟请求数。
- ConcurrencyLimiter：基于信号量，限制同时在途的请求数。
两者都是 async 友好的。
"""
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

T = TypeVar("T")


class TokenBucketRateLimiter:
    """令牌桶：容量 = capacity，每 interval 秒补充 1 个令牌。

    用于 RPM 限流：capacity = rpm, interval = 60/rpm（即每 60/rpm 秒补一个）。
    """

    def __init__(self, rpm: int):
        self.rpm = max(1, rpm)
        self.capacity = self.rpm
        # 每个令牌的补充间隔（秒）
        self._interval = 60.0 / self.rpm
        self._tokens: float = float(self.capacity)
        self._last = time.monotonic()
        self._lock = asyncio.Lock()

    def update_rpm(self, rpm: int) -> None:
        rpm = max(1, rpm)
        if rpm == self.rpm:
            return
        self.rpm = rpm
        self.capacity = rpm
        self._interval = 60.0 / rpm
        self._tokens = float(rpm)
        self._last = time.monotonic()

    async def acquire(self) -> None:
        async with self._lock:
            self._refill()
            if self._tokens < 1:
                # 等到下一个令牌可用
                wait = (1 - self._tokens) * self._interval
                await asyncio.sleep(wait)
                self._refill()
            self._tokens -= 1.0

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last
        if elapsed > 0:
            self._tokens = min(
                float(self.capacity), self._tokens + elapsed / self._interval
            )
            self._last = now


class ConcurrencyLimiter:
    """全局并发上限：基于信号量。"""

    def __init__(self, limit: int):
        self._limit = max(1, limit)
        self._sem = asyncio.Semaphore(self._limit)

    def update_limit(self, limit: int) -> None:
        limit = max(1, limit)
        if limit == self._limit:
            return
        # 重建信号量（已获取的旧许可会在原任务释放时归还旧信号量，
        # 这里仅影响后续新建任务；对本地工具足够）
        self._limit = limit
        self._sem = asyncio.Semaphore(limit)

    async def acquire(self) -> None:
        await self._sem.acquire()

    def release(self) -> None:
        self._sem.release()

    async def run(self, fn: Callable[[], Awaitable[T]]) -> T:
        await self.acquire()
        try:
            return await fn()
        finally:
            self.release()


# ---- 全局单例（启动时按 settings 初始化，运行时可更新）----

deepseek_limiter: TokenBucketRateLimiter | None = None
edge_limiter: ConcurrencyLimiter | None = None


def init_limiters(deepseek_rpm: int, edge_concurrency: int) -> None:
    global deepseek_limiter, edge_limiter
    deepseek_limiter = TokenBucketRateLimiter(deepseek_rpm)
    edge_limiter = ConcurrencyLimiter(edge_concurrency)


def update_limiters(deepseek_rpm: int, edge_concurrency: int) -> None:
    if deepseek_limiter:
        deepseek_limiter.update_rpm(deepseek_rpm)
    else:
        init_limiters(deepseek_rpm, edge_concurrency)
        return
    if edge_limiter:
        edge_limiter.update_limit(edge_concurrency)
