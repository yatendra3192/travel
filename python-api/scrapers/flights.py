"""Google Flights scraper.

Navigates to Google Flights and parses flight results from the DOM.
Skyscanner blocks headless browsers with PerimeterX CAPTCHA,
so we use Google Flights which is accessible and rich in data.
"""

import asyncio
import re
import hashlib
from datetime import datetime, timedelta

from playwright.async_api import BrowserContext, Page

from utils.browser_pool import pool
from utils.anti_detect import random_delay
from scrapers.base import rate_limit, retry_with_backoff
from cache.memory_cache import get_flights, set_flights
from config import PAGE_TIMEOUT


async def scrape_flights(
    origin: str, destination: str, date: str, adults: int = 1, children: int = 0
) -> dict:
    """Scrape flight data from Google Flights.

    Returns: { flights: [...], carriers: {...} }
    """
    cache_key = f"flights:{origin}-{destination}-{date}-{adults}-{children}"
    cached = get_flights(cache_key)
    if cached is not None:
        return cached

    empty_result = {"flights": [], "carriers": {}}

    async def _do_scrape():
        return await _scrape_google_flights(origin, destination, date, adults, children)

    try:
        result = await retry_with_backoff(
            _do_scrape, description=f"flights {origin}->{destination}"
        )
        if result and result.get("flights"):
            set_flights(cache_key, result)
            return result
    except Exception as e:
        print(f"[flights] Scrape failed for {origin}->{destination}: {e}")

    return empty_result


async def _scrape_google_flights(
    origin: str, destination: str, date: str, adults: int, children: int
) -> dict:
    """Navigate to Google Flights and parse flight results from DOM."""
    # Build Google Flights URL with natural language query (one-way)
    passengers = adults + children
    url = (
        f"https://www.google.com/travel/flights?q=one+way+flight+from+{origin}+to+{destination}"
        f"+on+{date}+{passengers}+passengers&curr=EUR&hl=en"
    )

    await rate_limit(url)
    ctx, ctx_idx = await pool.get_context()
    page: Page = await ctx.new_page()

    flights = []
    carriers = {}

    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)

        # Wait for flight results to load
        try:
            await page.wait_for_selector(
                'li[class*="pIav2d"]',
                timeout=15000,
            )
        except Exception:
            # Try waiting a bit more
            await random_delay(3.0, 5.0)

        await random_delay(1.0, 2.0)

        # Parse flight result items
        flight_items = await page.query_selector_all('li[class*="pIav2d"]')
        print(f"[flights] Found {len(flight_items)} flight items for {origin}->{destination}")

        for idx, item in enumerate(flight_items[:10]):
            flight = await _parse_flight_item(item, origin, destination, date, idx)
            if flight:
                flights.append(flight)
                airline = flight["airline"]
                if airline and flight["airlineName"]:
                    carriers[airline] = flight["airlineName"]

    except Exception as e:
        print(f"[flights] Navigation error for {origin}->{destination}: {e}")
    finally:
        await page.close()
        await pool.release_context(ctx_idx)

    return {"flights": sorted(flights, key=lambda f: f["price"]), "carriers": carriers}


async def _parse_flight_item(item, origin: str, dest: str, date: str, idx: int) -> dict | None:
    """Parse a single Google Flights result item."""
    try:
        full_text = await item.inner_text()
        lines = [l.strip() for l in full_text.split("\n") if l.strip()]

        # --- Price ---
        price = None

        # Method 1: aria-label with "price" (most reliable)
        price_labels = await item.query_selector_all('[aria-label*="price" i]')
        for pl in price_labels:
            label = await pl.get_attribute("aria-label") or ""
            nums = re.findall(r'[\d,]+', label.replace(",", ""))
            for n in nums:
                val = float(n)
                if val > 10:
                    price = val
                    break
            if price:
                break

        # Method 2: Price container div (yR1fYc class or BVAVmf)
        if price is None:
            price_el = await item.query_selector('div[class*="yR1fYc"], div[class*="BVAVmf"], span[class*="YMlKec"]')
            if price_el:
                price_text = await price_el.inner_text()
                # Look for currency symbol followed by number (€, $, £, ₹, ¤)
                m = re.search(r'[\u20ac$\xa4\u20b9£]\s*([\d,]+)', price_text)
                if m:
                    price = float(m.group(1).replace(",", ""))
                else:
                    # Just find the largest number (likely the price)
                    nums = [int(n) for n in re.findall(r'\d+', price_text) if int(n) > 10]
                    if nums:
                        price = float(max(nums))

        # Method 3: Scan full text for currency pattern (€, ₹, £, $)
        if price is None:
            for m in re.finditer(r'[\u20ac\xa4€\u20b9£$]\s*([\d,.]+)', full_text):
                raw = m.group(1).replace(",", "")
                # Handle European decimals: "1.234" -> 1234, but "12.50" -> 12.50
                if '.' in raw and len(raw.split('.')[-1]) == 3:
                    raw = raw.replace(".", "")
                val = float(raw)
                if val > 10:
                    price = val
                    break

        # Method 4: Look for "round trip" or "one way" near a number
        if price is None:
            m = re.search(r'([\d,]+)\s*(?:round trip|one way)', full_text, re.IGNORECASE)
            if m:
                val = float(m.group(1).replace(",", ""))
                if val > 10:
                    price = val

        if price is None or price < 10:
            return None

        # --- Times ---
        dep_time_str = ""
        arr_time_str = ""

        # Normalize unicode spaces for matching
        norm_text = full_text.replace('\u202f', ' ').replace('\u00a0', ' ')

        # Method 1: Time range "3:40 PM – 5:50 PM" (case-insensitive, various dashes)
        time_match = re.search(
            r'(\d{1,2}:\d{2}\s*[APap]\.?\s*[Mm]\.?)\s*[-\u2013\u2014\u2212]\s*(\d{1,2}:\d{2}\s*[APap]\.?\s*[Mm]\.?)',
            norm_text
        )
        if time_match:
            dep_time_str = time_match.group(1).strip()
            arr_time_str = time_match.group(2).strip()

        # Method 2: Individual AM/PM times across text (handles times on separate lines)
        if not dep_time_str:
            all_times = re.findall(r'\d{1,2}:\d{2}\s*[APap]\.?\s*[Mm]\.?', norm_text)
            if len(all_times) >= 2:
                dep_time_str = all_times[0].strip()
                arr_time_str = all_times[1].strip()

        # Method 3: Try aria-label on the list item itself
        if not dep_time_str:
            item_label = await item.get_attribute("aria-label") or ""
            if item_label:
                t = re.search(
                    r'(\d{1,2}:\d{2}\s*[APap]\.?\s*[Mm]\.?)\s*[-\u2013\u2014\u2212]\s*(\d{1,2}:\d{2}\s*[APap]\.?\s*[Mm]\.?)',
                    item_label.replace('\u202f', ' ')
                )
                if t:
                    dep_time_str = t.group(1).strip()
                    arr_time_str = t.group(2).strip()
                else:
                    times_in_label = re.findall(r'\d{1,2}:\d{2}\s*[APap]\.?\s*[Mm]\.?', item_label)
                    if len(times_in_label) >= 2:
                        dep_time_str = times_in_label[0].strip()
                        arr_time_str = times_in_label[1].strip()

        # Method 4: Look for time spans in DOM with specific selectors
        if not dep_time_str:
            time_spans = await item.query_selector_all('span[aria-label*="epart"], span[aria-label*="rriv"], span[aria-label*="eave"], span[aria-label*="Arrive"]')
            dom_times = []
            for ts in time_spans[:4]:
                txt = (await ts.inner_text()).strip().replace('\u202f', ' ')
                if re.match(r'\d{1,2}:\d{2}', txt):
                    dom_times.append(txt)
            if len(dom_times) >= 2:
                dep_time_str = dom_times[0]
                arr_time_str = dom_times[1]

        # Method 5: 24h format "14:30 – 17:50"
        if not dep_time_str:
            time_24h = re.search(
                r'(?<!\d)(\d{1,2}:\d{2})\s*[-\u2013\u2014]\s*(\d{1,2}:\d{2})(?!\d)',
                norm_text
            )
            if time_24h:
                dep_time_str = time_24h.group(1)
                arr_time_str = time_24h.group(2)

        if not dep_time_str:
            print(f"[flights] WARNING: Could not parse times for flight {idx}. First lines: {lines[:5]}")

        departure_dt = _parse_time_to_iso(date, dep_time_str)
        arrival_dt = _parse_time_to_iso(date, arr_time_str)

        # Skip flights with unparseable departure time
        if not departure_dt:
            print(f"[flights] Skipping flight {idx}: could not parse departure time")
            return None

        # --- Duration ---
        dur_match = re.search(r'(\d+)\s*hr(?:\s*(\d+)\s*min)?', full_text)
        duration_str = "PT12H0M"
        dur_total_min = 0
        if dur_match:
            h = int(dur_match.group(1))
            m = int(dur_match.group(2) or 0)
            duration_str = f"PT{h}H{m}M"
            dur_total_min = h * 60 + m

        # Fix overnight/multi-day flights:
        # Google Flights shows arrival time but not arrival date,
        # so _parse_time_to_iso uses the departure date for both.
        # We use the flight duration to figure out the correct arrival date.
        if departure_dt and arrival_dt and dur_total_min > 0:
            dep_dt_obj = datetime.fromisoformat(departure_dt)
            arr_dt_obj = datetime.fromisoformat(arrival_dt)
            # Calculate expected arrival from departure + duration
            expected_arr = dep_dt_obj + timedelta(minutes=dur_total_min)
            days_ahead = (expected_arr.date() - dep_dt_obj.date()).days
            if days_ahead > 0:
                arr_dt_obj = arr_dt_obj + timedelta(days=days_ahead)
                arrival_dt = arr_dt_obj.strftime("%Y-%m-%dT%H:%M:%S")

        # --- Stops ---
        stops = 0
        if "Nonstop" in full_text or "nonstop" in full_text:
            stops = 0
        else:
            stop_match = re.search(r'(\d+)\s*stop', full_text, re.IGNORECASE)
            if stop_match:
                stops = int(stop_match.group(1))

        # --- Layover info ---
        layovers = []
        # Pattern 1: "2 hr 40 min MUC" or "1 hr 15 min FRA" (1-stop with duration)
        layover_matches = re.findall(
            r'(?:(\d+)\s*hr\s*)?(\d+)\s*min\s+([A-Z]{3})',
            full_text
        )
        for lm in layover_matches:
            hours = int(lm[0]) if lm[0] else 0
            mins = int(lm[1])
            airport = lm[2]
            total_min = hours * 60 + mins
            # Filter: must be reasonable layover time, not origin/dest, not total duration
            if 15 < total_min < 600 and airport != origin and airport != dest:
                layovers.append({
                    "airportCode": airport,
                    "durationMinutes": total_min,
                    "durationText": f"{hours}h {mins}m" if hours > 0 else f"{mins}m",
                })

        # Pattern 2: "2 stops FRA, MUC" or "1 stop DXB" (airports listed after stops)
        if not layovers and stops > 0:
            stop_airports_match = re.search(
                r'\d+\s*stops?\s+([A-Z]{3}(?:\s*,\s*[A-Z]{3})*)',
                full_text
            )
            if stop_airports_match:
                airports = re.findall(r'[A-Z]{3}', stop_airports_match.group(1))
                for ap in airports:
                    if ap != origin and ap != dest:
                        layovers.append({
                            "airportCode": ap,
                            "durationMinutes": 90,  # estimate
                            "durationText": "~1h 30m",
                        })

        # --- Airline ---
        airline_name = ""
        airline_code = ""
        # Common airline names to codes
        airline_map = {
            "Lufthansa": "LH", "Air Dolomiti": "EN", "SWISS": "LX",
            "KLM": "KL", "Emirates": "EK", "IndiGo": "6E",
            "Qatar Airways": "QR", "Etihad": "EY", "Air India": "AI",
            "Turkish Airlines": "TK", "British Airways": "BA",
            "Air France": "AF", "Vistara": "UK", "SpiceJet": "SG",
            "Vueling": "VY", "Ryanair": "FR", "EasyJet": "U2",
            "Norwegian": "DY", "Iberia": "IB", "Transavia": "HV",
            "Wizz Air": "W6", "Pegasus": "PC", "SAS": "SK",
            "Finnair": "AY", "TAP Portugal": "TP", "Aegean": "A3",
            "Aer Lingus": "EI", "LOT Polish": "LO", "Austrian": "OS",
            "Brussels Airlines": "SN", "Eurowings": "EW",
            "Air Europa": "UX", "Norse": "N0", "ITA Airways": "AZ",
            "Singapore Airlines": "SQ", "Cathay Pacific": "CX",
            "ANA": "NH", "Japan Airlines": "JL", "Korean Air": "KE",
            "Asiana": "OZ", "Thai Airways": "TG", "Malaysia Airlines": "MH",
            "Garuda Indonesia": "GA", "Philippine Airlines": "PR",
            "Vietnam Airlines": "VN", "China Airlines": "CI",
            "Eva Air": "BR", "Qantas": "QF", "Virgin Atlantic": "VS",
            "Delta": "DL", "United": "UA", "American Airlines": "AA",
            "JetBlue": "B6", "Southwest": "WN", "Alaska Airlines": "AS",
            "Air Canada": "AC", "WestJet": "WS",
            "South African": "SA", "Kenya Airways": "KQ",
            "EgyptAir": "MS", "Royal Air Maroc": "AT",
            "Saudia": "SV", "Oman Air": "WY", "Gulf Air": "GF",
            "SriLankan": "UL", "Biman": "BG", "Nepal Airlines": "RA",
            "Air Malta": "KM", "Condor": "DE", "Air Serbia": "JU",
            "Croatia Airlines": "OU", "TAROM": "RO", "Air Baltic": "BT",
            "Volotea": "V7", "Flyr": "FS", "Play": "OG",
            "Sun Express": "XQ", "Corendon": "XC", "TUI": "TB",
            "Jet2": "LS", "Luxair": "LG", "Air Corsica": "XK",
            "Nouvelair": "BJ", "Tunisair": "TU", "Flynas": "XY",
            "Jazeera": "J9", "flydubai": "FZ", "Air Arabia": "G9",
            "Bamboo Airways": "QH", "Batik Air": "ID",
            "Scoot": "TR", "AirAsia": "AK", "Cebu Pacific": "5J",
            "SpiceJet": "SG", "GoFirst": "G8", "Akasa Air": "QP",
        }

        for name, code in airline_map.items():
            if name.lower() in full_text.lower():
                airline_name = name
                airline_code = code
                break

        if not airline_name:
            # Try aria-label on airline logo/image elements
            logo_els = await item.query_selector_all('img[alt], [aria-label]')
            for el in logo_els[:5]:
                alt = await el.get_attribute("alt") or await el.get_attribute("aria-label") or ""
                alt = alt.strip()
                if alt and len(alt) < 40 and alt not in ("", "Airline logo"):
                    for name, code in airline_map.items():
                        if name.lower() in alt.lower():
                            airline_name = name
                            airline_code = code
                            break
                    if airline_name:
                        break

        if not airline_name:
            # Try to extract from the first few lines (non-numeric, non-time text)
            for line in lines[:5]:
                line = line.strip()
                if (any(c.isalpha() for c in line)
                    and len(line) < 40
                    and not re.search(r'stop|hr|min|nonstop|\d{1,2}:\d{2}|round trip|one way', line, re.IGNORECASE)
                    and not re.match(r'^[\d€$\u20ac]', line)):
                    airline_name = line
                    # Try matching partial airline names
                    for mname, mcode in airline_map.items():
                        if mname.lower() in line.lower() or line.lower() in mname.lower():
                            airline_name = mname
                            airline_code = mcode
                            break
                    if not airline_code:
                        airline_code = line[:2].upper()
                    break

        if not airline_code:
            airline_code = "XX"

        # --- Route info ---
        route_match = re.search(r'([A-Z]{3})\s*[-\u2013]\s*([A-Z]{3})', full_text)
        actual_origin = route_match.group(1) if route_match else origin
        actual_dest = route_match.group(2) if route_match else dest

        # --- Build segments ---
        segments = []
        if stops == 0:
            segments.append({
                "from": actual_origin,
                "to": actual_dest,
                "departure": departure_dt,
                "arrival": arrival_dt,
                "airline": airline_code,
                "flightNumber": f"{airline_code}{1000 + idx}",
                "duration": duration_str,
            })
        else:
            # For multi-segment, create origin->layover and layover->dest segments
            segments.append({
                "from": actual_origin,
                "to": layovers[0]["airportCode"] if layovers else "XXX",
                "departure": departure_dt,
                "arrival": departure_dt,  # approximate
                "airline": airline_code,
                "flightNumber": f"{airline_code}{1000 + idx}",
                "duration": duration_str,
            })
            last_airport = layovers[0]["airportCode"] if layovers else "XXX"
            for li, layover in enumerate(layovers[1:], 1):
                segments.append({
                    "from": last_airport,
                    "to": layover["airportCode"],
                    "departure": departure_dt,
                    "arrival": arrival_dt,
                    "airline": airline_code,
                    "flightNumber": f"{airline_code}{1001 + idx + li}",
                    "duration": duration_str,
                })
                last_airport = layover["airportCode"]
            segments.append({
                "from": last_airport,
                "to": actual_dest,
                "departure": departure_dt,
                "arrival": arrival_dt,
                "airline": airline_code,
                "flightNumber": f"{airline_code}{1010 + idx}",
                "duration": duration_str,
            })

        flight_id = hashlib.md5(
            f"gf-{actual_origin}{actual_dest}{date}{price}{idx}".encode()
        ).hexdigest()[:12]

        return {
            "id": flight_id,
            "price": round(price, 2),
            "currency": "EUR",
            "airline": airline_code,
            "airlineName": airline_name or airline_code,
            "departure": departure_dt,
            "arrival": arrival_dt,
            "departureTerminal": "",
            "arrivalTerminal": "",
            "duration": duration_str,
            "stops": stops,
            "layovers": layovers,
            "segments": segments,
        }

    except Exception as e:
        print(f"[flights] Error parsing flight item {idx}: {e}")
        return None


def _parse_time_to_iso(date: str, time_str: str) -> str | None:
    """Convert '1:35 AM', '1:35 pm', '1:35 P.M.', or '13:35' + date to ISO datetime string.
    Returns None if the time cannot be parsed."""
    if not time_str:
        return None

    ts = time_str.strip()
    # Remove periods (P.M. -> PM) and normalize spaces
    ts = re.sub(r'\.', '', ts)
    ts = re.sub(r'\s+', ' ', ts).strip()

    # Try 12h formats (uppercase for strptime)
    for fmt in ["%I:%M %p", "%I:%M%p"]:
        try:
            t = datetime.strptime(ts.upper(), fmt)
            return f"{date}T{t.strftime('%H:%M')}:00"
        except ValueError:
            continue

    # Try 24h format "14:30"
    m = re.match(r'^(\d{1,2}):(\d{2})$', ts)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mi <= 59:
            return f"{date}T{h:02d}:{mi:02d}:00"

    print(f"[flights] WARNING: Could not parse time '{time_str}' for date {date}")
    return None
