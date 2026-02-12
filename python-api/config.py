"""Configuration for the Python scraping API."""

# Server
PORT = 5000
HOST = "0.0.0.0"

# Browser
BROWSER_HEADLESS = True
BROWSER_POOL_SIZE = 2
CONTEXT_RECYCLE_AFTER = 50  # Recycle browser context every N requests

# Rate limits (seconds between requests per domain)
RATE_LIMIT_SKYSCANNER = 3.0
RATE_LIMIT_BOOKING = 2.0

# Cache TTLs (seconds)
CACHE_TTL_FLIGHTS = 30 * 60        # 30 minutes
CACHE_TTL_HOTELS_LIST = 24 * 60 * 60  # 24 hours
CACHE_TTL_HOTELS_OFFERS = 30 * 60  # 30 minutes

# Cache max sizes
CACHE_MAX_FLIGHTS = 200
CACHE_MAX_HOTELS_LIST = 500
CACHE_MAX_HOTELS_OFFERS = 200

# Retry
MAX_RETRIES = 3
RETRY_BACKOFF = [2, 4, 8]  # seconds

# Scraping timeouts (ms)
PAGE_TIMEOUT = 30000
NAVIGATION_TIMEOUT = 30000
