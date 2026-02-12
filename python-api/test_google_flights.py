"""Test Google Flights scraping with Playwright."""

import asyncio
import re
import os
from playwright.async_api import async_playwright


async def test_google_flights():
    print("Testing Google Flights scraping...")

    pw = await async_playwright().start()
    browser = await pw.chromium.launch(
        headless=True,
        args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    )
    ctx = await browser.new_context(
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        viewport={"width": 1920, "height": 1080},
        locale="en-US",
    )
    page = await ctx.new_page()

    # Google Flights URL format
    url = "https://www.google.com/travel/flights?q=Flights+from+BOM+to+AMS+on+2026-02-25&curr=EUR&hl=en"
    print(f"Navigating to: {url}")

    xhr_data = []
    async def on_response(response):
        u = response.url
        ct = response.headers.get("content-type", "")
        if response.status == 200 and ("json" in ct or "proto" in ct or "grpc" in ct):
            try:
                body = await response.body()
                if len(body) > 500:
                    xhr_data.append((u[:100], len(body)))
            except:
                pass

    page.on("response", on_response)

    try:
        await page.goto(url, wait_until="networkidle", timeout=30000)
        print(f"Title: {await page.title()}")
        print(f"URL: {page.url}")
    except Exception as e:
        print(f"Navigation: {e}")
        print(f"URL: {page.url}")

    await asyncio.sleep(5)

    print(f"\nCaptured {len(xhr_data)} large XHR responses")
    for u, size in xhr_data[:10]:
        print(f"  {u} ({size} bytes)")

    # Check for flight results in DOM
    selectors = [
        'li[class*="pIav2d"]',           # flight result items
        'div[class*="yR1fYc"]',           # price elements
        '[data-price]',                    # price data attributes
        'ul[class*="Rk10dc"]',            # results list
        '[jscontroller="IbEGYd"]',         # flight card controller
        'span[data-gs]',                   # price spans
        '[aria-label*="price"]',           # accessible price labels
        'div[class*="FpEdX"]',            # flight info
        'span[role="text"]',               # text spans (prices)
        'div[class*="OgQvJf"]',           # departure info
        '[class*="nQgyaf"]',              # price class
    ]
    print("\n--- Selector check ---")
    for sel in selectors:
        count = len(await page.query_selector_all(sel))
        if count > 0:
            print(f"  FOUND {count}: {sel}")

    # Try to find prices in the page text
    body_text = await page.inner_text("body")

    # Look for EUR price patterns
    eur_prices = re.findall(r'EUR\s*[\d,]+|[\d,]+\s*EUR|\x80\s*[\d,]+|[\d,]+\s*\x80', body_text)
    price_patterns = re.findall(r'(?:EUR|€)\s*(\d[\d,]*)', body_text)
    if not price_patterns:
        price_patterns = re.findall(r'(\d[\d,]*)\s*(?:EUR|€)', body_text)

    print(f"\nEUR price matches: {eur_prices[:10]}")
    print(f"Price numbers: {price_patterns[:10]}")

    # Look for any prices with currency symbols
    all_prices = re.findall(r'[€$£₹]\s*[\d,.]+|[\d,.]+\s*[€$£₹]', body_text)
    print(f"All currency prices: {all_prices[:15]}")

    # Screenshot
    screenshot_path = os.path.join(os.path.dirname(__file__), "debug_google_flights.png")
    await page.screenshot(path=screenshot_path, full_page=False)
    print(f"\nScreenshot: {screenshot_path}")

    # Print some page text around prices
    for match in re.finditer(r'[€₹$]\s*[\d,.]+', body_text):
        start = max(0, match.start() - 30)
        end = min(len(body_text), match.end() + 30)
        context = body_text[start:end].replace('\n', ' ').strip()
        print(f"  Context: ...{context}...")
        if len([m for m in re.finditer(r'[€₹$]\s*[\d,.]+', body_text[:match.end()])]) > 5:
            break

    await browser.close()
    await pw.stop()


asyncio.run(test_google_flights())
