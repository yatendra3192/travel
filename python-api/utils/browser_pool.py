"""Persistent Playwright browser pool with context recycling."""

import asyncio
from playwright.async_api import async_playwright, Browser, BrowserContext

from config import BROWSER_HEADLESS, BROWSER_POOL_SIZE, CONTEXT_RECYCLE_AFTER
from utils.anti_detect import (
    get_random_user_agent,
    get_random_viewport,
    should_block_resource,
)


class BrowserPool:
    """Manages a pool of Playwright browser contexts."""

    def __init__(self):
        self._playwright = None
        self._browser: Browser | None = None
        self._contexts: list[BrowserContext] = []
        self._request_counts: list[int] = []
        self._lock = asyncio.Lock()
        self._index = 0
        self._ready = False

    async def start(self):
        """Launch browser and create initial contexts."""
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=BROWSER_HEADLESS,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        for _ in range(BROWSER_POOL_SIZE):
            ctx = await self._create_context()
            self._contexts.append(ctx)
            self._request_counts.append(0)
        self._ready = True

    async def _create_context(self) -> BrowserContext:
        """Create a new browser context with anti-detection settings."""
        viewport = get_random_viewport()
        ctx = await self._browser.new_context(
            user_agent=get_random_user_agent(),
            viewport=viewport,
            locale="en-US",
            timezone_id="America/New_York",
            java_script_enabled=True,
            ignore_https_errors=True,
        )

        # Block unnecessary resources (only on booking.com to save bandwidth)
        # Google Flights needs full page rendering so we don't block there
        await ctx.route(
            "**/*booking.com**",
            lambda route: (
                route.abort()
                if should_block_resource(route.request.url, route.request.resource_type)
                else route.continue_()
            ),
        )

        return ctx

    async def get_context(self) -> BrowserContext:
        """Get a browser context from the pool, recycling if needed."""
        async with self._lock:
            if not self._ready:
                raise RuntimeError("Browser pool not started")

            idx = self._index % BROWSER_POOL_SIZE
            self._index += 1

            # Recycle context if it's been used too many times
            self._request_counts[idx] += 1
            if self._request_counts[idx] >= CONTEXT_RECYCLE_AFTER:
                old_ctx = self._contexts[idx]
                await old_ctx.close()
                self._contexts[idx] = await self._create_context()
                self._request_counts[idx] = 0

            return self._contexts[idx]

    @property
    def is_ready(self) -> bool:
        return self._ready

    async def stop(self):
        """Close all contexts and browser."""
        self._ready = False
        for ctx in self._contexts:
            try:
                await ctx.close()
            except Exception:
                pass
        self._contexts.clear()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()


# Singleton instance
pool = BrowserPool()
