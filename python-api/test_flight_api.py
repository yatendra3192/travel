"""Test direct HTTP approaches for flight data."""

import asyncio
import httpx
import json

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


async def test_skyscanner_create_search():
    """Test Skyscanner's internal search API directly."""
    print("=" * 60)
    print("Test 1: Skyscanner conductor/fps3 search API")
    print("=" * 60)

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        # First get cookies from homepage
        print("Getting session cookies...")
        try:
            home = await client.get("https://www.skyscanner.com/", headers=HEADERS)
            print(f"  Homepage status: {home.status_code}")
            cookies = dict(client.cookies)
            print(f"  Cookies: {list(cookies.keys())[:5]}")
        except Exception as e:
            print(f"  Homepage failed: {e}")

        # Try the search API
        search_url = "https://www.skyscanner.com/g/conductor/v1/fps3/search/"
        body = {
            "query": {
                "market": "UK",
                "locale": "en-GB",
                "currency": "EUR",
                "adults": 2,
                "cabinClass": "CABIN_CLASS_ECONOMY",
                "queryLegs": [{
                    "originPlaceId": {"iata": "BOM"},
                    "destinationPlaceId": {"iata": "AMS"},
                    "date": {"year": 2026, "month": 2, "day": 25}
                }]
            }
        }
        try:
            resp = await client.post(search_url, json=body, headers={
                **HEADERS,
                "Content-Type": "application/json",
                "Origin": "https://www.skyscanner.com",
                "Referer": "https://www.skyscanner.com/transport/flights/bom/ams/260225/",
            })
            print(f"  Search status: {resp.status_code}")
            print(f"  Response length: {len(resp.text)}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"  Keys: {list(data.keys())[:10]}")
                if "itineraries" in data:
                    print(f"  Itineraries: {len(data['itineraries'])}")
            else:
                print(f"  Body: {resp.text[:300]}")
        except Exception as e:
            print(f"  Search failed: {e}")


async def test_skyscanner_indicative():
    """Test Skyscanner's indicative/browse prices API."""
    print("\n" + "=" * 60)
    print("Test 2: Skyscanner indicative prices API")
    print("=" * 60)

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        # Try indicative prices endpoint
        url = "https://www.skyscanner.com/g/browse-view-bff/dataservices/browse/v3/bvf/UK/EUR/en-GB/destinations/BOM/AMS/2026-02-25"
        try:
            resp = await client.get(url, headers=HEADERS)
            print(f"  Status: {resp.status_code}")
            print(f"  Response length: {len(resp.text)}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"  Keys: {list(data.keys())[:10]}")
            else:
                print(f"  Body: {resp.text[:300]}")
        except Exception as e:
            print(f"  Failed: {e}")


async def test_skyscanner_explore_api():
    """Test Skyscanner's explore/search suggest API."""
    print("\n" + "=" * 60)
    print("Test 3: Skyscanner g/chiron-search API")
    print("=" * 60)

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        url = "https://www.skyscanner.com/g/chiron-search/v1/flights/search/"
        body = {
            "market": "UK",
            "locale": "en-GB",
            "currency": "EUR",
            "adults": 2,
            "originPlace": "BOM",
            "destinationPlace": "AMS",
            "outboundDate": "2026-02-25",
            "cabinClass": "economy",
        }
        try:
            resp = await client.post(url, json=body, headers={
                **HEADERS,
                "Content-Type": "application/json",
            })
            print(f"  Status: {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"  Keys: {list(data.keys())[:10]}")
            else:
                print(f"  Body: {resp.text[:300]}")
        except Exception as e:
            print(f"  Failed: {e}")


async def test_google_flights_api():
    """Test Google Flights internal API."""
    print("\n" + "=" * 60)
    print("Test 4: Google Flights API (via search params)")
    print("=" * 60)

    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        # Google Flights uses a specific URL pattern
        url = "https://www.google.com/travel/flights/search?tfs=CBwQAhopEgoyMDI2LTAyLTI1agwIAhIIL20vMDR2bXByDAoCEggvbS8wazNwOBgBcAGCAQsI____________AUABSAGYAQGyAQwIBBIIL20vMGszMDg&hl=en&gl=us&curr=EUR"
        try:
            resp = await client.get(url, headers=HEADERS)
            print(f"  Status: {resp.status_code}")
            print(f"  Response length: {len(resp.text)}")
            # Check if it returns useful data
            if "price" in resp.text.lower()[:5000]:
                print("  Contains 'price' keyword - may have flight data")
            if resp.status_code == 200:
                print(f"  First 200 chars: {resp.text[:200]}")
        except Exception as e:
            print(f"  Failed: {e}")


async def test_aviationstack():
    """Test if AviationStack free tier works (no key)."""
    print("\n" + "=" * 60)
    print("Test 5: Simple flight price estimation approach")
    print("=" * 60)

    # Instead of scraping, calculate estimates based on route data
    # Use known average prices per km for different route types
    from math import radians, cos, sin, asin, sqrt

    def haversine(lat1, lon1, lat2, lon2):
        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        return 6371 * 2 * asin(sqrt(a))

    # BOM to AMS
    dist_km = haversine(19.09, 72.87, 52.31, 4.77)
    print(f"  BOM → AMS distance: {dist_km:.0f} km")

    # Average cost per km for different route types (EUR)
    # Long-haul (>3000km): ~0.05-0.08 EUR/km
    # Medium-haul (1000-3000km): ~0.08-0.15 EUR/km
    # Short-haul (<1000km): ~0.10-0.25 EUR/km
    if dist_km > 3000:
        low_per_km, high_per_km = 0.04, 0.09
    elif dist_km > 1000:
        low_per_km, high_per_km = 0.08, 0.18
    else:
        low_per_km, high_per_km = 0.10, 0.30

    low_price = round(dist_km * low_per_km)
    high_price = round(dist_km * high_per_km)
    mid_price = round((low_price + high_price) / 2)

    print(f"  Estimated price range: €{low_price} - €{high_price} (mid: €{mid_price})")
    print(f"  Skyscanner shows: ₹23,262 cheapest = ~€255 (at ₹91/EUR)")
    print(f"  So mid estimate €{mid_price} vs actual €255 for BOM→AMS")


async def main():
    await test_skyscanner_create_search()
    await test_skyscanner_indicative()
    await test_skyscanner_explore_api()
    await test_google_flights_api()
    await test_aviationstack()


asyncio.run(main())
