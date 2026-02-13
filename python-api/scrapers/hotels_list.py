"""Booking.com hotel list scraper.

Navigates to Booking.com search by coordinates and extracts hotel cards.
"""

import re
import hashlib

from playwright.async_api import BrowserContext, Page

from utils.browser_pool import pool
from utils.anti_detect import random_delay
from scrapers.base import rate_limit, retry_with_backoff
from cache.memory_cache import get_hotels_list, set_hotels_list
from config import PAGE_TIMEOUT


async def scrape_hotels_by_geocode(
    latitude: float, longitude: float, radius: int = 5
) -> dict:
    """Scrape hotel list from Booking.com by coordinates.

    Returns: { hotels: [...], searchRadius: int }
    """
    cache_key = f"hotels-geocode:{latitude}:{longitude}:{radius}"
    cached = get_hotels_list(cache_key)
    if cached is not None:
        return cached

    empty_result = {"hotels": [], "searchRadius": radius}

    async def _do_scrape():
        return await _scrape_booking_hotels(latitude, longitude, radius)

    try:
        result = await retry_with_backoff(
            _do_scrape, description=f"hotels {latitude},{longitude}"
        )
        if result and result.get("hotels"):
            set_hotels_list(cache_key, result)
            return result

        # Auto-retry at 10km if 0 results and initial radius was smaller
        if radius < 10:
            async def _do_wider():
                return await _scrape_booking_hotels(latitude, longitude, 10)

            result = await retry_with_backoff(
                _do_wider, description=f"hotels {latitude},{longitude} (10km)"
            )
            if result and result.get("hotels"):
                set_hotels_list(cache_key, result)
                return result
    except Exception as e:
        print(f"[hotels_list] Scrape failed: {e}")

    return empty_result


async def scrape_hotels_by_city(city_code: str) -> dict:
    """Scrape hotels by city code (via geocoding common city codes).

    Falls back to well-known coordinates for common city codes.
    """
    cache_key = f"hotels-list:{city_code}"
    cached = get_hotels_list(cache_key)
    if cached is not None:
        return cached

    coords = _city_code_to_coords(city_code)
    if not coords:
        return {"hotels": []}

    result = await scrape_hotels_by_geocode(coords[0], coords[1], radius=5)
    if result:
        # Cache under city code key too
        set_hotels_list(cache_key, result)
    return result


def _city_code_to_coords(city_code: str) -> tuple | None:
    """Map common IATA city codes to coordinates."""
    COORDS = {
        "BOM": (19.0760, 72.8777), "DEL": (28.6139, 77.2090),
        "BLR": (12.9716, 77.5946), "MAA": (13.0827, 80.2707),
        "HYD": (17.3850, 78.4867), "CCU": (22.5726, 88.3639),
        "GOI": (15.4909, 73.8278), "JAI": (26.9124, 75.7873),
        "AMS": (52.3676, 4.9041), "PAR": (48.8566, 2.3522),
        "CDG": (48.8566, 2.3522), "LON": (51.5074, -0.1278),
        "LHR": (51.5074, -0.1278), "BCN": (41.3874, 2.1686),
        "ROM": (41.9028, 12.4964), "FCO": (41.9028, 12.4964),
        "BER": (52.5200, 13.4050), "MUC": (48.1351, 11.5820),
        "VIE": (48.2082, 16.3738), "PRG": (50.0755, 14.4378),
        "BUD": (47.4979, 19.0402), "IST": (41.0082, 28.9784),
        "ATH": (37.9838, 23.7275), "LIS": (38.7223, -9.1393),
        "DUB": (53.3498, -6.2603), "ZRH": (47.3769, 8.5417),
        "BKK": (13.7563, 100.5018), "SIN": (1.3521, 103.8198),
        "HKG": (22.3193, 114.1694), "NRT": (35.6762, 139.6503),
        "TYO": (35.6762, 139.6503), "SEL": (37.5665, 126.9780),
        "ICN": (37.5665, 126.9780), "SYD": (-33.8688, 151.2093),
        "DXB": (25.2048, 55.2708), "DOH": (25.2854, 51.5310),
        "SFO": (37.7749, -122.4194), "NYC": (40.7128, -74.0060),
        "JFK": (40.7128, -74.0060), "LAX": (34.0522, -118.2437),
        "YYZ": (43.6532, -79.3832), "MEX": (19.4326, -99.1332),
        "GRU": (-23.5558, -46.6396), "EZE": (-34.6037, -58.3816),
        "CPT": (-33.9249, 18.4241), "NBO": (-1.2921, 36.8219),
        "CAI": (30.0444, 31.2357), "CMB": (6.9271, 79.8612),
        "KTM": (27.7172, 85.3240), "DAC": (23.8103, 90.4125),
        "COK": (9.9312, 76.2673), "AMD": (23.0225, 72.5714),
        "PNQ": (18.5204, 73.8567), "GAU": (26.1445, 91.7362),
        "JTR": (36.3932, 25.4615), "MLE": (4.1755, 73.5093),
    }
    return COORDS.get(city_code.upper())


async def _scrape_booking_hotels(
    latitude: float, longitude: float, radius: int
) -> dict:
    """Navigate to Booking.com and extract hotel list."""
    url = (
        f"https://www.booking.com/searchresults.html"
        f"?latitude={latitude}&longitude={longitude}"
        f"&radius={radius}"
        f"&selected_currency=EUR"
        f"&lang=en-us"
    )

    await rate_limit(url)
    ctx, ctx_idx = await pool.get_context()
    page: Page = await ctx.new_page()

    hotels = []

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
        await random_delay(2.0, 4.0)

        # Wait for hotel cards to appear
        try:
            await page.wait_for_selector(
                'div[data-testid="property-card"]',
                timeout=15000,
            )
        except Exception:
            # Try alternative selector
            try:
                await page.wait_for_selector(
                    '.sr_property_block, [data-hotelid]',
                    timeout=10000,
                )
            except Exception:
                pass

        await random_delay(1.0, 2.0)

        # Parse hotel cards
        cards = await page.query_selector_all(
            'div[data-testid="property-card"]'
        )

        if not cards:
            # Try legacy selectors
            cards = await page.query_selector_all('.sr_property_block, [data-hotelid]')

        for card in cards[:50]:
            hotel = await _parse_hotel_card(card, latitude, longitude)
            if hotel:
                hotels.append(hotel)

    except Exception as e:
        print(f"[hotels_list] Navigation error: {e}")
    finally:
        await page.close()
        await pool.release_context(ctx_idx)

    return {"hotels": hotels, "searchRadius": radius}


async def _parse_hotel_card(card, center_lat: float, center_lng: float) -> dict | None:
    """Parse a single Booking.com hotel card element."""
    try:
        # Hotel name
        name_el = await card.query_selector(
            'div[data-testid="title"], .sr-hotel__name, [data-testid="header-title"]'
        )
        name = await name_el.inner_text() if name_el else None
        if not name:
            return None
        name = name.strip()

        # Generate stable hotel ID from name
        hotel_id = "BK" + hashlib.md5(name.encode()).hexdigest()[:8].upper()

        # Distance from center
        dist_el = await card.query_selector(
            '[data-testid="distance"], .distance_text, [class*="distance"]'
        )
        distance_text = ""
        distance_value = None
        if dist_el:
            distance_text = (await dist_el.inner_text()).strip()
            dist_match = re.search(r"([\d.]+)\s*(km|mi|m\b)", distance_text.lower())
            if dist_match:
                val = float(dist_match.group(1))
                unit = dist_match.group(2)
                if unit == "mi":
                    val *= 1.609
                elif unit == "m":
                    val /= 1000
                distance_value = round(val, 1)

        # Price - extract from card for use by offers endpoint
        price = None
        price_el = await card.query_selector(
            'span[data-testid="price-and-discounted-price"], .bui-price-display__value'
        )
        if price_el:
            price_text = (await price_el.inner_text()).strip()
            price_nums = re.findall(r"[\d,]+\.?\d*", price_text.replace(",", ""))
            if price_nums:
                try:
                    price = float(price_nums[0])
                except ValueError:
                    pass

        # Fallback: try broader price selectors
        if price is None:
            all_price_els = await card.query_selector_all('[class*="price"]')
            for pel in all_price_els[:5]:
                try:
                    ptxt = (await pel.inner_text()).strip()
                    # Look for currency symbol + number pattern
                    m = re.search(r'[\u20ac$\xa3\xa5]\s*([\d,]+)', ptxt)
                    if m:
                        price = float(m.group(1).replace(",", ""))
                        break
                    # Or just a number > 20 (likely a price, not a rating)
                    nums = [int(n) for n in re.findall(r'\d+', ptxt) if int(n) > 20]
                    if nums:
                        price = float(max(nums))
                        break
                except Exception:
                    continue

        return {
            "hotelId": hotel_id,
            "name": name,
            "chainCode": None,
            "geoCode": {
                "latitude": center_lat,
                "longitude": center_lng,
            },
            "distance": {
                "value": distance_value or 2.0,
                "unit": "KM",
            },
            "pricePerNight": price,
        }

    except Exception:
        return None
