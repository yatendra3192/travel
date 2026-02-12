"""Anti-detection utilities for web scraping."""

import random
from fake_useragent import UserAgent

_ua = UserAgent(browsers=["chrome", "edge"], os=["windows", "macos"])

# Realistic viewport sizes
VIEWPORTS = [
    {"width": 1920, "height": 1080},
    {"width": 1366, "height": 768},
    {"width": 1536, "height": 864},
    {"width": 1440, "height": 900},
    {"width": 1680, "height": 1050},
]

# Resource types to block (reduces bandwidth + fingerprinting)
BLOCKED_RESOURCE_TYPES = {"image", "font", "media"}

# URL patterns to block (tracking, analytics, ads)
BLOCKED_URL_PATTERNS = [
    "google-analytics", "googletagmanager", "facebook.net",
    "doubleclick.net", "adservice", "analytics", "tracker",
    "hotjar", "mouseflow", "clarity.ms", "sentry.io",
]


def get_random_user_agent() -> str:
    """Return a random realistic user agent string."""
    return _ua.random


def get_random_viewport() -> dict:
    """Return a random realistic viewport size."""
    return random.choice(VIEWPORTS)


async def random_delay(min_sec: float = 0.5, max_sec: float = 2.0):
    """Sleep for a random duration to simulate human behavior."""
    import asyncio
    await asyncio.sleep(random.uniform(min_sec, max_sec))


def should_block_resource(url: str, resource_type: str) -> bool:
    """Check if a resource should be blocked."""
    if resource_type in BLOCKED_RESOURCE_TYPES:
        return True
    url_lower = url.lower()
    return any(pattern in url_lower for pattern in BLOCKED_URL_PATTERNS)
