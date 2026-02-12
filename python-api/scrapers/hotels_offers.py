"""Booking.com hotel offers/pricing scraper.

Uses cached hotel list prices as primary source. Falls back to
a new Booking.com search with dates if cached prices aren't available.
"""

import re
import hashlib
from datetime import datetime, timedelta

from playwright.async_api import BrowserContext, Page

from utils.browser_pool import pool
from utils.anti_detect import random_delay
from scrapers.base import rate_limit, retry_with_backoff
from cache.memory_cache import get_hotels_offers, set_hotels_offers, hotels_list_cache
from config import PAGE_TIMEOUT


async def scrape_hotel_offers(
    hotel_ids: list[str],
    check_in: str,
    check_out: str,
    adults: int = 1,
) -> dict:
    """Get hotel pricing for the requested hotel IDs.

    Strategy:
    1. Check offers cache first
    2. Try to build offers from cached hotel list data (already has prices)
    3. Fall back to a new Booking.com scrape with dates

    Returns: { offers: [...] }
    """
    cache_key = f"hotel-offers:{','.join(sorted(hotel_ids[:5]))}-{check_in}-{check_out}-{adults}"
    cached = get_hotels_offers(cache_key)
    if cached is not None:
        return cached

    # Fix same-date check-in/check-out (0-night stay)
    if check_in == check_out:
        try:
            co = datetime.strptime(check_in, "%Y-%m-%d") + timedelta(days=1)
            check_out = co.strftime("%Y-%m-%d")
        except ValueError:
            pass

    # Strategy 1: Build offers from cached hotel list data
    offers = _build_offers_from_cache(hotel_ids, check_in, check_out)
    if offers:
        result = {"offers": offers}
        set_hotels_offers(cache_key, result)
        return result

    # Strategy 2: Scrape Booking.com with dates
    coords = _find_coords_for_hotels(hotel_ids)
    if not coords:
        print(f"[hotel_offers] No coordinates found for hotel IDs, returning empty")
        return {"offers": []}

    async def _do_scrape():
        return await _scrape_booking_offers(
            coords[0], coords[1], hotel_ids, check_in, check_out, adults
        )

    try:
        result = await retry_with_backoff(
            _do_scrape, description=f"hotel-offers {check_in}-{check_out}"
        )
        if result and result.get("offers"):
            set_hotels_offers(cache_key, result)
            return result
    except Exception as e:
        print(f"[hotel_offers] Scrape failed: {e}")

    return {"offers": []}


def _build_offers_from_cache(
    hotel_ids: list[str], check_in: str, check_out: str
) -> list[dict]:
    """Build offers from cached hotel list data that already has prices."""
    offers = []
    hotel_id_set = set(hotel_ids)

    for _key, data in list(hotels_list_cache.items()):
        if not isinstance(data, dict) or not data.get("hotels"):
            continue
        for hotel in data["hotels"]:
            hid = hotel.get("hotelId")
            if hid not in hotel_id_set:
                continue
            price = hotel.get("pricePerNight")
            if price and price > 5:
                offers.append({
                    "hotelId": hid,
                    "hotelName": hotel.get("name", ""),
                    "pricePerNight": round(price, 2),
                    "totalPrice": round(price, 2),
                    "currency": "EUR",
                    "roomType": "Standard Room",
                    "checkIn": check_in,
                    "checkOut": check_out,
                })
                hotel_id_set.discard(hid)

    if offers:
        print(f"[hotel_offers] Built {len(offers)} offers from cached list data")
    return offers


def _find_coords_for_hotels(hotel_ids: list[str]) -> tuple | None:
    """Look up coordinates from cached hotel list data."""
    for _key, data in list(hotels_list_cache.items()):
        if isinstance(data, dict) and data.get("hotels"):
            for hotel in data["hotels"]:
                if hotel.get("hotelId") in hotel_ids:
                    geo = hotel.get("geoCode")
                    if geo:
                        return (geo.get("latitude"), geo.get("longitude"))

    # Parse coordinates from cache key pattern "hotels-geocode:lat:lng:radius"
    for key in list(hotels_list_cache.keys()):
        if key.startswith("hotels-geocode:"):
            parts = key.split(":")
            if len(parts) >= 3:
                try:
                    return (float(parts[1]), float(parts[2]))
                except ValueError:
                    continue

    return None


async def _scrape_booking_offers(
    latitude: float,
    longitude: float,
    hotel_ids: list[str],
    check_in: str,
    check_out: str,
    adults: int,
) -> dict:
    """Navigate to Booking.com with dates and extract pricing."""
    url = (
        f"https://www.booking.com/searchresults.html"
        f"?latitude={latitude}&longitude={longitude}"
        f"&checkin={check_in}&checkout={check_out}"
        f"&group_adults={adults}&no_rooms=1"
        f"&selected_currency=EUR&lang=en-us"
    )

    await rate_limit(url)
    ctx: BrowserContext = await pool.get_context()
    page: Page = await ctx.new_page()

    offers = []

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
        await random_delay(2.0, 4.0)

        try:
            await page.wait_for_selector(
                'div[data-testid="property-card"]',
                timeout=15000,
            )
        except Exception:
            try:
                await page.wait_for_selector(
                    '.sr_property_block, [data-hotelid]',
                    timeout=10000,
                )
            except Exception:
                pass

        await random_delay(1.0, 2.0)

        # Calculate nights
        try:
            ci = datetime.strptime(check_in, "%Y-%m-%d")
            co = datetime.strptime(check_out, "%Y-%m-%d")
            nights = max(1, (co - ci).days)
        except Exception:
            nights = 1

        # Parse ALL hotel cards with pricing (don't filter by ID -
        # the dated search returns different hotels than the undated list search,
        # so ID matching is unreliable; the frontend just averages all prices)
        cards = await page.query_selector_all('div[data-testid="property-card"]')
        if not cards:
            cards = await page.query_selector_all('.sr_property_block, [data-hotelid]')

        for card in cards[:25]:
            offer = await _parse_offer_card(card, check_in, check_out, nights)
            if offer:
                offers.append(offer)

        print(f"[hotel_offers] Extracted {len(offers)} hotel prices from Booking.com")

    except Exception as e:
        print(f"[hotel_offers] Navigation error: {e}")
    finally:
        await page.close()

    return {"offers": offers}


async def _parse_offer_card(
    card, check_in: str, check_out: str, nights: int
) -> dict | None:
    """Parse a Booking.com card for pricing info."""
    try:
        # Hotel name
        name_el = await card.query_selector(
            'div[data-testid="title"], .sr-hotel__name, [data-testid="header-title"]'
        )
        name = await name_el.inner_text() if name_el else None
        if not name:
            return None
        name = name.strip()

        # Generate hotel ID from name
        hotel_id = "BK" + hashlib.md5(name.encode()).hexdigest()[:8].upper()

        # Price - primary selector
        price = None
        price_el = await card.query_selector(
            'span[data-testid="price-and-discounted-price"], .bui-price-display__value'
        )
        if price_el:
            price_text = (await price_el.inner_text()).strip()
            # Remove currency symbols and extract number
            cleaned = re.sub(r'[^\d,.]', '', price_text.replace(",", ""))
            price_nums = re.findall(r"\d+", cleaned)
            if price_nums:
                price = float(price_nums[0])

        # Fallback: broader price selectors
        if price is None:
            all_price_els = await card.query_selector_all('[class*="price"]')
            for pel in all_price_els[:5]:
                try:
                    ptxt = (await pel.inner_text()).strip()
                    nums = [int(n) for n in re.findall(r'\d+', ptxt) if int(n) > 20]
                    if nums:
                        price = float(max(nums))
                        break
                except Exception:
                    continue

        if not price or price < 10:
            return None

        price_per_night = round(price / nights, 2)

        # Room type
        room_el = await card.query_selector(
            '[data-testid="recommended-units"], .room_link, [class*="roomType"]'
        )
        room_type = "Standard Room"
        if room_el:
            room_text = (await room_el.inner_text()).strip()
            if room_text:
                room_type = room_text[:50]

        return {
            "hotelId": hotel_id,
            "hotelName": name,
            "pricePerNight": price_per_night,
            "totalPrice": round(price, 2),
            "currency": "EUR",
            "roomType": room_type,
            "checkIn": check_in,
            "checkOut": check_out,
        }

    except Exception:
        return None
