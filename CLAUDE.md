# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trip Cost Calculator — a full-stack web app that calculates door-to-door travel costs by scraping real-time flight and hotel prices, combining them with Google Maps transfer estimates and static meal cost data.

**Live at:** https://plan.aiezzy.com

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

## Deployment (Railway)

Two services from the same GitHub repo, auto-deploy on push to `main`:

| Service | Root Directory | Dockerfile | Public |
|---------|---------------|------------|--------|
| **travel** (Node) | `/` (repo root) | `Dockerfile.node` | Yes — serves frontend |
| **satisfied-liberation** (Python) | `/python-api` | `Dockerfile` | No — internal only |

**Environment variables:**
- Node service: `GOOGLE_API_KEY`, `PYTHON_API_URL` (points to Python service's private Railway URL)
- Python service: `PORT`

Railway configs: `railway.json` (Node) and `python-api/railway.json` (Python) — healthchecks, restart policies.

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

No framework, no bundler. Seven JS modules loaded via script tags in `index.html`. Five CSS files in `public/css/` (no preprocessor):

- **variables.css** — Design tokens (`:root` custom properties): colors, spacing, radii, shadows, font, type-specific accent colors (`--color-flight-accent`, `--color-city-accent`, `--color-transfer-accent`, `--color-train-accent`). Also contains reset and base styles.
- **landing.css** — Landing page form card and inputs
- **components.css** — All reusable UI: buttons, steppers, autocomplete dropdown, timeline cards/connectors, flight option cards, transport mode selectors, transfer sections, loading overlay/spinner. Card type styling uses `data-type` attribute on `.timeline-card` elements (`flight`, `city`, `transfer`, `train`) for colored left borders and icon backgrounds.
- **results.css** — Results page layout: sticky header (two-row: route/schedule on top, travelers/actions on bottom), timeline column, cost sidebar, mobile cost bar, confirm popup. Header classes: `.header-row-top` (`.header-route-group` + `.header-schedule-group`), `.header-row-bottom` (`.header-bottom-left` travelers + `.header-bottom-right` currency/recalculate).
- **responsive.css** — Mobile breakpoints at 768px and 480px

JS modules:

- **app.js** — SPA page router, initializes Google Places library
- **landing.js** — Form input with Google Places Autocomplete (any place type for destinations), destination chips, stepper controls
- **results.js** (~1700 lines, the core) — Orchestrates the entire trip plan: builds flight legs, fetches all data in parallel (flights, hotels, ground routes), renders the interactive timeline, handles user edits (flight selection, transport mode, nights, transfer modes), recomputes schedule/costs on every change
- **components.js** — Card builders for flights (Google Flights-style with airline logos, duration bars), ground transport modes (transit/drive/walk/bike), transfers, hotels, trains; transport mode selector; stepper widget; chip widget
- **cost-engine.js** — Pure calculation: flights/ground transport + hotels + meals + transfers + layover meals → EUR totals with low/high estimates
- **utils.js** — Currency conversion (36 currencies, EUR base), date/time formatting, debounce, duration parsing
- **api.js** — Thin fetch wrapper for all `/api/*` endpoints

**Key data flow in results.js:**
1. `generateTripPlan()` → resolves IATA codes → `buildFlightLegs()` → parallel fetch (flights, hotels, ground routes, train routes, meals, transfers) → `buildPlan()` → `_computeArrivalDates()` → re-fetch flights if dates shifted → `renderTimeline()`
2. User edits trigger: `onNightsChange()`, `selectFlightOption()`, `Components.selectTransportMode()`, `selectTransferMode()` → `recalculateFlightDates()` → `refetchFlights()` → re-render → `recalculateAndRenderCost()`
3. `_computeTimelineSchedule()` walks the entire itinerary computing start/end times for every card

**Flight leg types:** `'flight'` (normal), `'train'` (no-airport city), `'skip'` (same airport for both cities — direct ground transfer, no flight needed)

**Train legs with live transit data:** Train legs fetch Google Maps transit routes via `/api/transfer-estimate` (same endpoint as flight leg ground routes). Results are stored on `leg.trainRoutes` (parallel to `leg.groundRoutes` on flight legs). When transit data exists, the train card shows selectable transit options (reusing `_buildTransitOptionRow()` and `toggleMoreOptions()` from flight cards). `selectTransitOption()` handles both flight and train legs — for trains it updates `leg.transitInfo.estimatedCostEur`/`duration`/`fareSource` from the selected route. The cost engine reads `transitInfo.estimatedCostEur` automatically. Schedule computation in `_computeTimelineSchedule()` prefers `trainRoutes.transitRoutes[0].durationSec` over the static `transitInfo.duration`.

**Multi-modal transport:** Each flight leg carries `groundRoutes` (fetched from `/api/transfer-estimate` city-to-city) and `selectedMode` (`'flight'` | `'transit'` | `'drive'` | `'walk'` | `'bike'`). When user selects a non-flight mode, the card switches to show ground transport info, schedule uses `durationSec` from the ground route, costs use transit fare or taxi estimate (walk/bike are free), and arrival dates use same-day (no overnight). Mode pills appear in the flight card header when `groundRoutes` data exists. `Components.selectTransportMode(legIndex, mode)` handles the switch, re-renders the card in-place, and triggers schedule/cost recalculation.

**Transfer indexing:** `transfers[0]` = home→airport, then pairs per city: `transfers[1+i*2]` = arrival, `transfers[1+i*2+1]` = departure, `transfers[last]` = airport→home. Type `'none'` means skip rendering/scheduling.

**Flight date computation:** `buildFlightLegs()` spaces initial search dates by `1 + nights` per city. After searching, `_computeArrivalDates()` corrects dates using actual flight arrival times + hotel nights. If corrected dates differ from searched dates, flights are re-fetched for the correct dates.

**Skip cities after real flights:** When a skip leg is preceded by a real flight (e.g., fly AMS→IDR, then IDR is shared airport for nearby city), the city gets normal airport-to-hotel transfers, not direct drive from the previous city. Controlled by `skipCity` array in `estimateTransfers()`.

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

`pythonApiGet(endpoint, params)` proxies to Python API (configured via `PYTHON_API_URL` env var, defaults to `http://localhost:5000`). `cache.js` provides a simple in-memory Map-based TTL cache (7 days for IATA/transfers).

**Dead code:** `amadeus-auth.js` is a legacy module from when the project used the Amadeus API — no longer imported or used. Contains hardcoded credentials that should be removed.

### Python Scraping API (`python-api/`)

FastAPI + Playwright headless browser pool (2 contexts, recycled every 50 uses). Anti-detection via random user agents/viewports. Health endpoint at `/health`.

Scraper files in `scrapers/`:
- **flights.py** — Navigates Google Flights URL, parses flight cards from DOM (price, times, duration, airline, stops, layovers). Handles overnight flight date correction using departure + duration.
- **hotels_list.py** — Searches Booking.com by geocode, extracts hotel cards
- **hotels_offers.py** — Fetches specific hotel pricing by ID + dates
- **base.py** — Rate limiting (3s Google, 2s Booking) and retry with exponential backoff

Caching via `cachetools.TTLCache`: flights 30min, hotel lists 24h, hotel offers 30min.

Config in `config.py` — all timeouts, rate limits, cache sizes, browser pool settings. `PORT` configurable via env var.

## Key Patterns

**Currency:** All internal prices are EUR. `Utils.formatCurrency(amount, sourceCurrency)` converts to `Utils.displayCurrency` for display. Exchange rates are hardcoded in `utils.js`.

**0-night cities:** When user sets hotel nights to 0, the city becomes "pass through" — hotel card replaced with minimal card, transfers recalculated to point to city center instead of hotel (`_recalcCityTransfers()`). Confirmation popup via `_showConfirmPopup()`.

**Same-airport cities:** When origin and destination share the same nearest airport (e.g. two nearby towns), `buildFlightLegs()` marks the leg as `legType: 'skip'` and `estimateTransfers()` creates direct-drive transfers between the cities instead of routing through the airport. If a real flight preceded the skip (flew to shared airport from far away), normal airport-to-hotel transfers are used instead.

**Schedule computation:** `_computeTimelineSchedule()` walks events sequentially — transfer durations advance a cursor, flight departure/arrival times act as anchors, hotel check-in is always 3:00 PM (with early/late badge if traveler arrives before/after), check-out is 11:00 AM adjusted earlier if next flight requires it.

**Overnight flights:** Both Python scraper and client-side enrichment use `departure + duration` to calculate correct arrival date (not just comparing arrival vs departure times).

## Static Data Files

- `server/iata-data.js` — Airport/city IATA code database (fallback when Google Geocoding unavailable)
- `server/meal-data.js` — Meal costs by city/country (breakfast/lunch/dinner at budget/mid/luxury tiers)

## CSS Conventions

- All colors, spacing, radii, and shadows use CSS custom properties from `variables.css` — never hardcode values.
- Timeline cards use `data-type` HTML attribute (`flight`, `city`, `transfer`, `train`) — CSS in `components.css` applies type-specific accent colors via `[data-type="..."]` selectors.
- The results header is sticky (`position: sticky; top: 0`) at ~130px height. The cost sidebar is also sticky with `top: 140px` to clear the header.
- Animations use `@keyframes` defined in `components.css` (e.g., `dropdownFadeIn`, `stepPulse`, `popupSlideUp`).

## Other

**No tests or linter** — there is no test framework or linting configured. The only npm scripts are `start` and `dev` (uses `node --watch`).

**`trip/` subfolder** — A separate standalone Trip Planner/Tour Guide app (3 static files: `index.html`, `app.js`, `style.css`). Unrelated to the main trip cost calculator. Has its own `CLAUDE.md`.

**Known issues:** Frontend uses `innerHTML` with template literals extensively — no sanitization of user/API data before DOM insertion. The Google Maps API key is hardcoded in `index.html`.
