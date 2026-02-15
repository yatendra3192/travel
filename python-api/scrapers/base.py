"""Base scraping utilities: rate limiting, retry with backoff."""

import asyncio
import logging
import time
from config import MAX_RETRIES, RETRY_BACKOFF, RATE_LIMIT_SKYSCANNER, RATE_LIMIT_BOOKING

# Structured logger for all scrapers
logger = logging.getLogger("scrapers")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(asctime)s [%(name)s] %(levelname)s: %(message)s'))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


# Per-domain rate limiting
_domain_locks: dict[str, asyncio.Lock] = {}
_domain_last_call: dict[str, float] = {}

DOMAIN_RATE_LIMITS = {
    "google.com": RATE_LIMIT_SKYSCANNER,  # Reuse Skyscanner's 3s gap for Google Flights
    "booking.com": RATE_LIMIT_BOOKING,
}


def _get_domain(url: str) -> str:
    """Extract domain key for rate limiting."""
    if "google.com" in url:
        return "google.com"
    if "booking" in url:
        return "booking.com"
    return "default"


async def rate_limit(url: str):
    """Enforce per-domain rate limiting."""
    domain = _get_domain(url)
    if domain not in _domain_locks:
        _domain_locks[domain] = asyncio.Lock()

    async with _domain_locks[domain]:
        min_gap = DOMAIN_RATE_LIMITS.get(domain, 1.0)
        now = time.monotonic()
        last = _domain_last_call.get(domain, 0)
        elapsed = now - last
        if elapsed < min_gap:
            await asyncio.sleep(min_gap - elapsed)
        _domain_last_call[domain] = time.monotonic()


async def retry_with_backoff(coro_factory, description: str = "scrape"):
    """Retry an async operation with exponential backoff.

    coro_factory: a callable that returns a new coroutine each call.
    """
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            return await coro_factory()
        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                wait = RETRY_BACKOFF[attempt]
                print(f"[{description}] Attempt {attempt + 1} failed: {e}. Retrying in {wait}s...")
                await asyncio.sleep(wait)
            else:
                print(f"[{description}] All {MAX_RETRIES} attempts failed. Last error: {e}")
    raise last_error
