# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trip Cost Calculator — a full-stack web app that calculates door-to-door travel costs by scraping real-time flight and hotel prices, combining them with Google Maps transfer estimates and static meal cost data.

## Running the Project

Both servers must be running for full functionality:

```bash
# Terminal 1: Node server (port 3000) — serves frontend + proxies APIs
cd server && npm install && npm run dev

# Terminal 2: Python scraping API (port 5000) — headless browser scraping
cd python-api && pip install -r requirements.txt && python main.py
```

Open `http://localhost:3000`. No build step — frontend is vanilla JS served as static files.

The Python service requires Playwright browsers: `playwright install chromium`

## Architecture

Three-tier system with no build tools or bundler:

```
Browser (vanilla JS SPA)
  → Node/Express server (port 3000)
      → Google Maps/Places/Directions APIs (for routing, geocoding, autocomplete)
      → Python FastAPI service (port 5000)
          → Playwright browser pool
          → Google Flights (scrapes flight prices)
          → Booking.com (scrapes hotel prices)
```

### Frontend (`public/`)

No framework. Six JS modules loaded via script tags in `index.html`:

- **app.js** — SPA page router, initializes Google Places library
- **landing.js** — Form input with Google Places Autocomplete, destination chips, stepper controls
- **results.js** (~1400 lines, the core) — Orchestrates the entire trip plan: builds flight legs, fetches all data in parallel, renders the interactive timeline, handles user edits (flight selection, nights, transfer modes), recomputes schedule/costs on every change
- **components.js** — Card builders for flights, transfers, hotels, trains; stepper widget; chip widget
- **cost-engine.js** — Pure calculation: flights + hotels + meals + transfers + layover meals → EUR totals with low/high estimates
- **utils.js** — Currency conversion (36 currencies, EUR base), date/time formatting, debounce, duration parsing
- **api.js** — Thin fetch wrapper for all `/api/*` endpoints

**Key data flow in results.js:**
1. `generateTripPlan()` → resolves IATA codes → `buildFlightLegs()` → parallel fetch (flights, hotels, meals, transfers) → `buildPlan()` → `renderTimeline()`
2. User edits trigger: `onNightsChange()`, `selectFlightOption()`, `selectTransferMode()` → recalculate dates/transfers → re-render → `recalculateAndRenderCost()`
3. `_computeTimelineSchedule()` walks the entire itinerary computing start/end times for every card

**Flight leg types:** `'flight'` (normal), `'train'` (no-airport city), `'skip'` (same airport for both cities — direct ground transfer, no flight needed)

**Transfer indexing:** `transfers[0]` = home→airport, then pairs per city: `transfers[1+i*2]` = arrival, `transfers[1+i*2+1]` = departure, `transfers[last]` = airport→home. Type `'none'` means skip rendering/scheduling.

### Node Server (`server/`)

Express server at `server/server.js`. Key routes:

| Route | Purpose | Data Source |
|-------|---------|-------------|
| `/api/resolve-iata?keyword=&lat=&lng=` | Airport code lookup | Static `iata-data.js` + Google Geocoding |
| `/api/flights?origin=&destination=&date=` | Flight search | Python API → Google Flights |
| `/api/hotels/list-by-geocode?latitude=&longitude=` | Hotel search | Python API → Booking.com |
| `/api/hotels/offers?hotelIds=&checkIn=&checkOut=` | Hotel pricing | Python API → Booking.com |
| `/api/meal-costs?cityCode=&countryCode=` | Meal prices | Static `meal-data.js` |
| `/api/transfer-estimate?originLat=&originLng=&destLat=&destLng=` | Transfer routing + costs | Google Directions API |

`pythonApiGet(endpoint, params)` proxies to `http://localhost:5000`. In-memory cache with TTL (7 days for IATA, transfers).

### Python Scraping API (`python-api/`)

FastAPI + Playwright headless browser pool (2 contexts, recycled every 50 uses). Anti-detection via random user agents/viewports.

Scraper files in `scrapers/`:
- **flights.py** — Navigates Google Flights URL, parses flight cards from DOM (price, times, duration, airline, stops, layovers). Handles overnight flight date correction using duration.
- **hotels_list.py** — Searches Booking.com by geocode, extracts hotel cards
- **hotels_offers.py** — Fetches specific hotel pricing by ID + dates
- **base.py** — Rate limiting (3s Google, 2s Booking) and retry with exponential backoff

Caching via `cachetools.TTLCache`: flights 30min, hotel lists 24h, hotel offers 30min.

Config in `config.py` — all timeouts, rate limits, cache sizes, browser pool settings.

## Key Patterns

**Currency:** All internal prices are EUR. `Utils.formatCurrency(amount, sourceCurrency)` converts to `Utils.displayCurrency` for display. Exchange rates are hardcoded in `utils.js`.

**0-night cities:** When user sets hotel nights to 0, the city becomes "pass through" — hotel card replaced with minimal card, arrival/departure transfers to hotel are hidden, transfers recalculated to point to city center instead of hotel (`_recalcCityTransfers()`).

**Same-airport cities:** When origin and destination share the same nearest airport (e.g. two nearby towns), `buildFlightLegs()` marks the leg as `legType: 'skip'` and `estimateTransfers()` creates direct-drive transfers between the cities instead of routing through the airport.

**Schedule computation:** `_computeTimelineSchedule()` walks events sequentially — transfer durations advance a cursor, flight departure/arrival times act as anchors, hotel check-in is always 3:00 PM (with early/late badge if traveler arrives before/after), check-out is 11:00 AM adjusted earlier if next flight requires it.

## Static Data Files

- `server/iata-data.js` — Airport/city IATA code database (fallback when Google Geocoding unavailable)
- `server/meal-data.js` — Meal costs by city/country (breakfast/lunch/dinner at budget/mid/luxury tiers)
