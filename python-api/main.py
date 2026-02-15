"""FastAPI scraping service - replaces Amadeus with Skyscanner + Booking.com."""

import asyncio
import sys
import os
import time as _time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

# Scraper health tracking
_scraper_stats = {
    "flights": {"success": 0, "failure": 0, "empty": 0, "last_success": 0},
    "hotels_list": {"success": 0, "failure": 0, "empty": 0, "last_success": 0},
    "hotels_offers": {"success": 0, "failure": 0, "empty": 0, "last_success": 0},
}

# Active request counter for graceful shutdown
_active_requests = 0

# Ensure project root is on path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import PORT, HOST
from utils.browser_pool import pool
from scrapers.flights import scrape_flights
from scrapers.hotels_list import scrape_hotels_by_geocode, scrape_hotels_by_city
from scrapers.hotels_offers import scrape_hotel_offers


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start/stop browser pool with the app."""
    print("Starting browser pool...")
    try:
        await pool.start()
        print("Browser pool ready.")
    except Exception as e:
        print(f"WARNING: Browser pool failed to start: {e}")
        print("Endpoints will return empty results until browser is available.")
    yield
    print("Shutting down: draining active requests...")
    for _ in range(20):  # 20 * 0.5s = 10s max wait
        if _active_requests == 0:
            break
        await asyncio.sleep(0.5)
    if _active_requests > 0:
        print(f"WARNING: Shutting down with {_active_requests} active requests still in progress")
    print("Shutting down browser pool...")
    await pool.stop()


app = FastAPI(title="Trip Scraper API", lifespan=lifespan)

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,https://plan.aiezzy.com").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ── Health check ──
@app.get("/health")
async def health():
    now = _time.time()
    scraper_health = {}
    for name, stats in _scraper_stats.items():
        total = stats["success"] + stats["failure"] + stats["empty"]
        success_rate = round(stats["success"] / total * 100, 1) if total > 0 else None
        last_success_ago = round(now - stats["last_success"]) if stats["last_success"] > 0 else None
        scraper_health[name] = {
            "total_requests": total,
            "success_rate": success_rate,
            "last_success_seconds_ago": last_success_ago,
        }
    return {
        "status": "ok",
        "browser_ready": pool.is_ready,
        "scrapers": scraper_health,
    }


# ── Flight search (Skyscanner) ──
@app.get("/api/scrape/flights")
async def api_flights(
    request: Request,
    origin: str = Query(..., description="Origin IATA code"),
    destination: str = Query(..., description="Destination IATA code"),
    date: str = Query(..., description="Departure date YYYY-MM-DD"),
    adults: int = Query(1, ge=1, le=9),
    children: int = Query(0, ge=0, le=6),
):
    global _active_requests
    request_id = request.headers.get("x-request-id", "no-id")
    _active_requests += 1
    try:
        print(f"[api] [{request_id}] flights {origin}->{destination} on {date}")
        result = await scrape_flights(
            origin=origin.upper(),
            destination=destination.upper(),
            date=date,
            adults=adults,
            children=children,
        )
        if result.get("flights"):
            _scraper_stats["flights"]["success"] += 1
            _scraper_stats["flights"]["last_success"] = _time.time()
        else:
            _scraper_stats["flights"]["empty"] += 1
        return result
    except Exception as e:
        _scraper_stats["flights"]["failure"] += 1
        print(f"[api] [{request_id}] flights error: {e}")
        return {"flights": [], "carriers": {}, "error": f"Flight search failed: {type(e).__name__}"}
    finally:
        _active_requests -= 1


# ── Hotel list by geocode (Booking.com) ──
@app.get("/api/scrape/hotels/list-by-geocode")
async def api_hotels_by_geocode(
    request: Request,
    latitude: float = Query(...),
    longitude: float = Query(...),
    radius: int = Query(5, ge=1, le=50),
):
    global _active_requests
    request_id = request.headers.get("x-request-id", "no-id")
    _active_requests += 1
    try:
        print(f"[api] [{request_id}] hotels/list-by-geocode {latitude},{longitude}")
        result = await scrape_hotels_by_geocode(
            latitude=latitude,
            longitude=longitude,
            radius=radius,
        )
        if result.get("hotels"):
            _scraper_stats["hotels_list"]["success"] += 1
            _scraper_stats["hotels_list"]["last_success"] = _time.time()
        else:
            _scraper_stats["hotels_list"]["empty"] += 1
        return result
    except Exception as e:
        _scraper_stats["hotels_list"]["failure"] += 1
        print(f"[api] [{request_id}] hotels/list-by-geocode error: {e}")
        return {"hotels": [], "searchRadius": radius, "error": f"Hotel search failed: {type(e).__name__}"}
    finally:
        _active_requests -= 1


# ── Hotel list by city code (Booking.com via geocode) ──
@app.get("/api/scrape/hotels/list")
async def api_hotels_by_city(
    request: Request,
    cityCode: str = Query(..., description="IATA city code"),
):
    global _active_requests
    request_id = request.headers.get("x-request-id", "no-id")
    _active_requests += 1
    try:
        print(f"[api] [{request_id}] hotels/list {cityCode}")
        result = await scrape_hotels_by_city(cityCode.upper())
        if result.get("hotels"):
            _scraper_stats["hotels_list"]["success"] += 1
            _scraper_stats["hotels_list"]["last_success"] = _time.time()
        else:
            _scraper_stats["hotels_list"]["empty"] += 1
        return result
    except Exception as e:
        _scraper_stats["hotels_list"]["failure"] += 1
        print(f"[api] [{request_id}] hotels/list error: {e}")
        return {"hotels": [], "error": f"Hotel search failed: {type(e).__name__}"}
    finally:
        _active_requests -= 1


# ── Hotel offers/pricing (Booking.com) ──
@app.get("/api/scrape/hotels/offers")
async def api_hotel_offers(
    request: Request,
    hotelIds: str = Query(..., description="Comma-separated hotel IDs"),
    checkIn: str = Query(..., description="Check-in date YYYY-MM-DD"),
    checkOut: str = Query(..., description="Check-out date YYYY-MM-DD"),
    adults: int = Query(1, ge=1, le=9),
):
    global _active_requests
    request_id = request.headers.get("x-request-id", "no-id")
    _active_requests += 1
    try:
        print(f"[api] [{request_id}] hotels/offers {checkIn}-{checkOut}")
        ids = [h.strip() for h in hotelIds.split(",") if h.strip()]
        if not ids:
            raise HTTPException(400, "hotelIds is required")

        result = await scrape_hotel_offers(
            hotel_ids=ids,
            check_in=checkIn,
            check_out=checkOut,
            adults=adults,
        )
        if result.get("offers"):
            _scraper_stats["hotels_offers"]["success"] += 1
            _scraper_stats["hotels_offers"]["last_success"] = _time.time()
        else:
            _scraper_stats["hotels_offers"]["empty"] += 1
        return result
    except HTTPException:
        raise
    except Exception as e:
        _scraper_stats["hotels_offers"]["failure"] += 1
        print(f"[api] [{request_id}] hotels/offers error: {e}")
        return {"offers": [], "error": f"Hotel pricing failed: {type(e).__name__}"}
    finally:
        _active_requests -= 1


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
