"""FastAPI scraping service - replaces Amadeus with Skyscanner + Booking.com."""

import sys
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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
    print("Shutting down browser pool...")
    await pool.stop()


app = FastAPI(title="Trip Scraper API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health check ──
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "browser_ready": pool.is_ready,
    }


# ── Flight search (Skyscanner) ──
@app.get("/api/scrape/flights")
async def api_flights(
    origin: str = Query(..., description="Origin IATA code"),
    destination: str = Query(..., description="Destination IATA code"),
    date: str = Query(..., description="Departure date YYYY-MM-DD"),
    adults: int = Query(1, ge=1, le=9),
    children: int = Query(0, ge=0, le=6),
):
    try:
        result = await scrape_flights(
            origin=origin.upper(),
            destination=destination.upper(),
            date=date,
            adults=adults,
            children=children,
        )
        return result
    except Exception as e:
        print(f"[api] flights error: {e}")
        return {"flights": [], "carriers": {}}


# ── Hotel list by geocode (Booking.com) ──
@app.get("/api/scrape/hotels/list-by-geocode")
async def api_hotels_by_geocode(
    latitude: float = Query(...),
    longitude: float = Query(...),
    radius: int = Query(5, ge=1, le=50),
):
    try:
        result = await scrape_hotels_by_geocode(
            latitude=latitude,
            longitude=longitude,
            radius=radius,
        )
        return result
    except Exception as e:
        print(f"[api] hotels/list-by-geocode error: {e}")
        return {"hotels": [], "searchRadius": radius}


# ── Hotel list by city code (Booking.com via geocode) ──
@app.get("/api/scrape/hotels/list")
async def api_hotels_by_city(
    cityCode: str = Query(..., description="IATA city code"),
):
    try:
        result = await scrape_hotels_by_city(cityCode.upper())
        return result
    except Exception as e:
        print(f"[api] hotels/list error: {e}")
        return {"hotels": []}


# ── Hotel offers/pricing (Booking.com) ──
@app.get("/api/scrape/hotels/offers")
async def api_hotel_offers(
    hotelIds: str = Query(..., description="Comma-separated hotel IDs"),
    checkIn: str = Query(..., description="Check-in date YYYY-MM-DD"),
    checkOut: str = Query(..., description="Check-out date YYYY-MM-DD"),
    adults: int = Query(1, ge=1, le=9),
):
    try:
        ids = [h.strip() for h in hotelIds.split(",") if h.strip()]
        if not ids:
            raise HTTPException(400, "hotelIds is required")

        result = await scrape_hotel_offers(
            hotel_ids=ids,
            check_in=checkIn,
            check_out=checkOut,
            adults=adults,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        print(f"[api] hotels/offers error: {e}")
        return {"offers": []}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False)
