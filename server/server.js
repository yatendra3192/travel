require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const crypto = require('crypto');
const path = require('path');
const { getCached, setCache } = require('./cache');
// iata-data.js no longer used — AirLabs API handles airport resolution dynamically
const { getLayoverMealCost, getCityMealCosts } = require('./meal-data');
const rateLimit = require('express-rate-limit');
const { scrapeFlights } = require('./scraper/flights-scraper');
const { scrapeHotels } = require('./scraper/hotels-scraper');
const { shutdown: shutdownBrowserPool } = require('./scraper/browser-pool');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error('FATAL: GOOGLE_API_KEY environment variable is not set.');
  process.exit(1);
}
const AIRLABS_API_KEY = process.env.AIRLABS_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const app = express();
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'https://plan.aiezzy.com'];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, curl, etc.)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  }
}));
// Gzip compression
app.use(compression());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
});

// Request ID tracing
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    // Cache fonts and images longer; CSS/JS use no-cache with etag for instant updates
    if (/\.(woff2?|ttf|eot|svg|png|jpg|ico)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800'); // 7 days
    } else {
      res.setHeader('Cache-Control', 'no-cache'); // revalidate via etag every request
    }
  },
}));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
const scrapeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many scraping requests, please try again later' },
});
app.use('/api/', generalLimiter);
app.use('/api/flights', scrapeLimiter);
app.use('/api/hotels', scrapeLimiter);
app.use('/api/itinerary', scrapeLimiter);

const TTL = {
  IATA: 7 * 24 * 60 * 60 * 1000,
  TRANSFER: 24 * 60 * 60 * 1000,
};

// ── Retry with exponential backoff for Google API calls ──
async function withRetry(fn, { retries = 2, baseDelay = 1000, description = 'API call' } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = err.name === 'AbortError' ||
        (err.cause && err.cause.code === 'ECONNRESET') ||
        (err.status && (err.status === 429 || err.status >= 500));
      if (attempt === retries || !isRetryable) throw err;
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(`[${description}] Attempt ${attempt + 1} failed: ${err.message}. Retrying in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ── Helper: Find nearest major airport via AirLabs API ──
// Uses the "popularity" field to skip heliports, air bases, and tiny strips.
// Picks the most popular airport within 100km, or the nearest major one within 200km.
async function findNearestAirportAirlabs(lat, lng) {
  if (!AIRLABS_API_KEY) return null;
  try {
    const url = `https://airlabs.co/api/v9/nearby?lat=${lat}&lng=${lng}&distance=200&api_key=${AIRLABS_API_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      console.warn(`[AirLabs] HTTP ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    if (!data.response || !data.response.airports || data.response.airports.length === 0) {
      return null;
    }

    // Filter to airports with IATA codes and real commercial traffic (popularity >= 10000)
    const candidates = data.response.airports.filter(a => a.iata_code && (a.popularity || 0) >= 10000);

    // Score airports for international trip suitability.
    // Problem: domestic-heavy airports (Osaka ITM, Seoul GMP, São Paulo CGH) can have
    // higher popularity than the international gateway (KIX, ICN, GRU) because of
    // massive domestic traffic. For international trip planning, we need to prefer
    // the airport with better international connectivity.
    //
    // Scoring heuristic (no external data needed):
    //   1. Popularity is the base score (higher = more flights = better connectivity)
    //   2. Bonus for "International" in name (strong signal for international gateway)
    //   3. Penalty for being very close to city center (<15km) when alternatives exist
    //      (international airports are typically further out — KIX 38km vs ITM 12km,
    //       ICN 48km vs GMP 16km, PVG 33km vs SHA 14km, TPE 34km vs TSA 4km)
    //   4. Penalty for known domestic-only airports (hardcoded safety net)
    const DOMESTIC_ONLY = new Set(['ITM', 'CGH', 'SDU', 'TSA', 'MDW', 'DAL']);

    function airportScore(a, hasMultipleNearby) {
      let score = a.popularity || 0;
      const name = (a.name || '').toLowerCase();
      // Bonus for "international" in name (but only real international, not domestic
      // airports with misleading names — ITM is "Osaka International Airport")
      if (name.includes('international') && !DOMESTIC_ONLY.has(a.iata_code)) {
        score *= 1.3;
      }
      // When multiple airports serve the same metro, airports very close to city center
      // (<15km) are more likely domestic-focused. International airports are typically
      // built further out (30-60km) due to land/noise requirements.
      if (hasMultipleNearby && (a.distance || 999) < 15) {
        score *= 0.7;
      }
      // Hard penalty for known domestic-only airports
      if (DOMESTIC_ONLY.has(a.iata_code)) {
        score *= 0.3;
      }
      return score;
    }

    let airport = null;
    if (candidates.length > 0) {
      const nearby = candidates.filter(a => (a.distance || 999) < 100);
      if (nearby.length > 0) {
        const hasMultiple = nearby.length > 1;
        airport = nearby.reduce((best, a) =>
          airportScore(a, hasMultiple) > airportScore(best, hasMultiple) ? a : best
        );
      } else {
        // All major airports are far — pick the closest one
        airport = candidates[0];
      }
    }

    // If no major airport found, take the nearest with IATA code and popularity >= 1000
    // (covers smaller regional airports that still have scheduled flights)
    if (!airport) {
      airport = data.response.airports.find(a => a.iata_code && (a.popularity || 0) >= 1000);
    }

    if (!airport) return null;

    const distanceKm = airport.distance || haversineKm(lat, lng, airport.lat, airport.lng);
    console.log(`[AirLabs] Found ${airport.iata_code} (${airport.name}) pop=${airport.popularity} at ${Math.round(distanceKm)}km`);

    // Collect alternate airports (other major airports within 100km, excluding the primary)
    const alternateAirports = candidates
      .filter(a => a.iata_code !== airport.iata_code && (a.distance || 999) < 100)
      .slice(0, 3)
      .map(a => ({
        code: a.iata_code,
        name: a.name,
        lat: a.lat,
        lng: a.lng,
        distanceKm: a.distance || haversineKm(lat, lng, a.lat, a.lng),
      }));

    return {
      airportCode: airport.iata_code,
      cityCode: airport.city_code || airport.iata_code,
      airportName: airport.name,
      country: airport.country_code,
      lat: airport.lat,
      lng: airport.lng,
      distanceKm,
      hasAirport: distanceKm < 80,
      alternateAirports,
    };
  } catch (e) {
    console.warn('[AirLabs] Error:', e.message);
    return null;
  }
}

// ── Helper: Geocode an airport name to get its coordinates ──
async function geocodeAirport(airportName) {
  return withRetry(async () => {
    const query = encodeURIComponent(airportName + ' airport');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${GOOGLE_API_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`Geocode HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      return data.results[0].geometry.location;
    }
    return null;
  }, { description: `geocode-airport:${airportName}` }).catch(e => {
    console.warn('Geocode airport error:', e.message);
    return null;
  });
}

// ── Helper: Geocode a city name to get city center coordinates ──
async function geocodeCity(cityName) {
  return withRetry(async () => {
    const query = encodeURIComponent(cityName + ' city center');
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${GOOGLE_API_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`Geocode HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      return data.results[0].geometry.location;
    }
    return null;
  }, { description: `geocode-city:${cityName}` }).catch(e => {
    console.warn('Geocode city error:', e.message);
    return null;
  });
}

// ── Helper: Get transit route from Google Directions API ──
async function getGoogleTransitRoute(originLat, originLng, destLat, destLng) {
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&mode=transit&key=${GOOGLE_API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== 'OK' || !data.routes?.[0]) {
      // Fallback to driving if no transit available
      const drivingUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&mode=driving&key=${GOOGLE_API_KEY}`;
      const dResp = await fetch(drivingUrl);
      if (!dResp.ok) return null;
      const dData = await dResp.json();
      if (dData.status !== 'OK' || !dData.routes?.[0]) return null;
      const leg = dData.routes[0].legs[0];
      return {
        distanceKm: Math.round(leg.distance.value / 1000),
        duration: leg.duration.text,
        mode: 'driving',
      };
    }
    const leg = data.routes[0].legs[0];
    return {
      distanceKm: Math.round(leg.distance.value / 1000),
      duration: leg.duration.text,
      mode: 'transit',
    };
  } catch (e) {
    console.warn('Google Directions error:', e.message);
    return null;
  }
}

// ── Helper: Estimate transit cost from distance + country ──
function estimateTransitCost(distanceKm, country) {
  // Rough per-km train/bus cost by region
  const rates = {
    'IN': 0.02, 'TH': 0.03, 'ID': 0.03, 'MY': 0.03, 'VN': 0.02,
    'FR': 0.12, 'DE': 0.15, 'IT': 0.10, 'ES': 0.08, 'BE': 0.12,
    'NL': 0.15, 'GB': 0.18, 'CH': 0.25, 'AT': 0.12, 'CZ': 0.06,
    'PT': 0.08, 'GR': 0.06, 'PL': 0.05, 'HU': 0.05, 'SE': 0.15,
    'NO': 0.20, 'DK': 0.15, 'IE': 0.12, 'US': 0.10, 'AU': 0.12,
    'JP': 0.20, 'KR': 0.08, 'AE': 0.08, 'TR': 0.04, 'EG': 0.02,
  };
  const ratePerKm = rates[country] || 0.10;
  return Math.max(3, Math.round(distanceKm * ratePerKm));
}

// ── Route: Resolve IATA code from city name ──
// Uses AirLabs API + Google geocoding for dynamic airport resolution
app.get('/api/resolve-iata', async (req, res) => {
  try {
    const keyword = (req.query.keyword || '').trim();
    const lat = req.query.lat ? parseFloat(req.query.lat) : null;
    const lng = req.query.lng ? parseFloat(req.query.lng) : null;
    if (!keyword) return res.status(400).json({ error: 'keyword is required' });

    const cacheKey = `iata:${keyword.toLowerCase()}:${lat || ''}:${lng || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    // AirLabs API: dynamic nearest airport lookup
    if (lat && lng) {
      const airlabs = await findNearestAirportAirlabs(lat, lng);
      if (airlabs) {
        const result = {
          airportCode: airlabs.airportCode,
          cityCode: airlabs.cityCode,
          airportName: airlabs.airportName,
          cityName: keyword,
          country: airlabs.country,
          hasAirport: airlabs.hasAirport,
          airportLat: airlabs.lat,
          airportLng: airlabs.lng,
          alternateAirports: airlabs.alternateAirports || [],
        };

        if (!airlabs.hasAirport) {
          result.nearestCity = airlabs.airportName;
          result.transitFromAirport = {
            distanceKm: airlabs.distanceKm,
            duration: `~${Math.round(airlabs.distanceKm / 60)}h by road`,
            estimatedCostEur: estimateTransitCost(airlabs.distanceKm, airlabs.country),
          };
        }

        const cityCoords = await geocodeCity(keyword);
        if (cityCoords) {
          // Validate: geocoded city center must be within 100km of input coords
          // (prevents geocoding "Tokyo" to a village in Sri Lanka instead of Tokyo, Japan)
          const gcDist = haversineKm(lat, lng, cityCoords.lat, cityCoords.lng);
          if (gcDist < 100) {
            result.cityCenterLat = cityCoords.lat;
            result.cityCenterLng = cityCoords.lng;
          } else {
            console.warn(`[resolve-iata] geocodeCity("${keyword}") returned coords ${gcDist.toFixed(0)}km from input — using input coords instead`);
            result.cityCenterLat = lat;
            result.cityCenterLng = lng;
          }
        } else {
          result.cityCenterLat = lat;
          result.cityCenterLng = lng;
        }

        setCache(cacheKey, result, TTL.IATA);
        return res.json(result);
      }
    }

    // Nothing found
    res.json({
      airportCode: null,
      cityCode: null,
      airportName: null,
      cityName: keyword,
      country: null,
      hasAirport: false,
      error: 'No airport data found. Using estimates.'
    });
  } catch (err) {
    console.error('resolve-iata error:', err);
    res.status(500).json({ error: 'Internal server error resolving IATA code' });
  }
});

// ── Haversine distance in km ──
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Route: Nearby airports (AirLabs) ──
app.get('/api/nearby-airports', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

    const cacheKey = `nearby-airports:${parseFloat(lat).toFixed(2)}:${parseFloat(lng).toFixed(2)}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://airlabs.co/api/v9/nearby?lat=${lat}&lng=${lng}&distance=300&api_key=${AIRLABS_API_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return res.json({ airports: [] });
    const data = await resp.json();
    if (!data.response?.airports) return res.json({ airports: [] });

    const airports = data.response.airports
      .filter(a => a.iata_code && (a.popularity || 0) >= 5000)
      .slice(0, 10)
      .map(a => ({
        code: a.iata_code,
        name: a.name,
        city: a.city_code,
        distance: Math.round(a.distance || haversineKm(parseFloat(lat), parseFloat(lng), a.lat, a.lng)),
        popularity: a.popularity || 0,
      }));

    const result = { airports };
    setCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.warn('[nearby-airports]', e.message);
    res.json({ airports: [] });
  }
});

// ── Route: Search airports by name/keyword ──
app.get('/api/search-airports', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ airports: [] });

    const cacheKey = `search-airports:${q.toLowerCase().trim()}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://airlabs.co/api/v9/suggest?q=${encodeURIComponent(q)}&api_key=${AIRLABS_API_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return res.json({ airports: [] });
    const data = await resp.json();

    // Suggest API returns { response: { airports: [...], cities: [...], ... } }
    const rawAirports = data.response?.airports || [];
    const airports = rawAirports
      .filter(a => a.iata_code)
      .slice(0, 10)
      .map(a => ({
        code: a.iata_code,
        name: a.name,
        city: a.city || a.city_code || '',
        country: a.country_code || '',
      }));

    const result = { airports };
    setCache(cacheKey, result);
    res.json(result);
  } catch (e) {
    console.warn('[search-airports]', e.message);
    res.json({ airports: [] });
  }
});

// ── SerpApi Google Flights search ──

// Convert SerpApi time "2025-03-15 06:30" to ISO "2025-03-15T06:30:00"
function toIsoTime(t) {
  if (!t) return '';
  // Already ISO with T
  if (t.includes('T')) return t;
  // "2025-03-15 06:30" → "2025-03-15T06:30:00"
  return t.replace(' ', 'T') + (t.length <= 16 ? ':00' : '');
}

// Rates matching frontend's Utils.EXCHANGE_RATES (1 EUR = X units)
// Used to convert SerpApi prices from user's currency to EUR
const FRONTEND_EUR_RATES = {
  EUR: 1, INR: 91, USD: 1.09, GBP: 0.86, JPY: 163, AED: 4.0,
  CHF: 0.96, CAD: 1.48, AUD: 1.65, SGD: 1.46, THB: 37.5,
  MYR: 4.75, CNY: 7.85, KRW: 1420, SAR: 4.09, BRL: 5.3,
  SEK: 11.2, NOK: 11.5, DKK: 7.46, PLN: 4.35, CZK: 25.2,
  HUF: 395, TRY: 35, ZAR: 19.5, NZD: 1.78, HKD: 8.5,
  TWD: 34.5, PHP: 61, IDR: 17200, VND: 27000, EGP: 53,
  QAR: 3.97, BHD: 0.41, KWD: 0.33, OMR: 0.42,
};

function convertToEurFrontend(amount, fromCurrency) {
  if (fromCurrency === 'EUR') return amount;
  const rate = FRONTEND_EUR_RATES[fromCurrency];
  if (!rate) return amount; // unknown currency, assume EUR
  return amount / rate;
}

async function searchFlightsSerpApi(origin, destination, date, adults = 1, children = 0, currency = 'EUR') {
  // Check cache first (30 min TTL) — includes currency since prices differ by market
  const cacheKey = `serpapi:${origin}-${destination}-${date}-${adults}-${children}-${currency}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = new URL('https://serpapi.com/search');
  url.searchParams.set('engine', 'google_flights');
  url.searchParams.set('departure_id', origin);   // can be comma-separated: "DEL,BOM"
  url.searchParams.set('arrival_id', destination); // can be comma-separated: "KIX,ITM"
  url.searchParams.set('outbound_date', date);
  url.searchParams.set('type', '2'); // one-way
  url.searchParams.set('currency', currency); // user's local currency for accurate pricing
  url.searchParams.set('adults', String(adults));
  if (children > 0) url.searchParams.set('children', String(children));
  url.searchParams.set('api_key', SERPAPI_KEY);

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SerpApi HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();

  if (data.error) {
    throw new Error(`SerpApi error: ${data.error}`);
  }

  const allFlights = [...(data.best_flights || []), ...(data.other_flights || [])];
  const carriers = {};
  const flights = [];
  const totalPax = (adults || 1) + (children || 0);

  for (const entry of allFlights) {
    if (!entry.flights || entry.flights.length === 0) continue;
    const price = entry.price;
    if (!price) continue;

    const firstSeg = entry.flights[0];
    const lastSeg = entry.flights[entry.flights.length - 1];

    // Primary airline — SerpApi gives full name in "airline", code is in flight_number prefix
    const airlineName = firstSeg.airline || 'Unknown';
    const flightNumMatch = (firstSeg.flight_number || '').match(/^([A-Z0-9]{2})\s/);
    const airlineCode = flightNumMatch ? flightNumMatch[1] : (airlineName.slice(0, 2).toUpperCase());
    if (airlineCode) carriers[airlineCode] = airlineName;

    // Departure/arrival from first/last segment (convert "2025-03-15 06:30" → ISO)
    const depTime = toIsoTime(firstSeg.departure_airport?.time);
    const arrTime = toIsoTime(lastSeg.arrival_airport?.time);
    const depAirport = firstSeg.departure_airport?.id || origin;
    const arrAirport = lastSeg.arrival_airport?.id || destination;

    // Total duration in PT format
    const totalMin = entry.total_duration || 0;
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    const durationStr = `PT${hours}H${mins}M`;

    // Stops count
    const stops = entry.flights.length - 1;

    // Build layovers from the layovers array
    const layovers = (entry.layovers || []).map(l => ({
      airportCode: l.id || 'XXX',
      durationMinutes: l.duration || 0,
      durationText: l.duration ? `${Math.floor(l.duration / 60)}h ${l.duration % 60}m` : '',
    }));

    // Build segments
    const segments = entry.flights.map((seg, si) => {
      const segDurMin = seg.duration || 0;
      const segH = Math.floor(segDurMin / 60);
      const segM = segDurMin % 60;
      return {
        from: seg.departure_airport?.id || '',
        to: seg.arrival_airport?.id || '',
        departure: toIsoTime(seg.departure_airport?.time),
        arrival: toIsoTime(seg.arrival_airport?.time),
        airline: ((seg.flight_number || '').match(/^([A-Z0-9]{2})\s/) || [])[1] || airlineCode,
        flightNumber: (seg.flight_number || `${airlineCode}${1000 + si}`).replace(/\s+/g, ''),
        duration: `PT${segH}H${segM}M`,
      };
    });

    // Generate a stable ID
    const idStr = `serp-${depAirport}${arrAirport}${date}${depTime}${arrTime}${stops}`;
    const id = crypto.createHash('md5').update(idStr).digest('hex').slice(0, 12);

    flights.push({
      id,
      price: round2(convertToEurFrontend(price / totalPax, currency)),
      currency: 'EUR',
      airline: airlineCode,
      airlineName: airlineName,
      airlineLogo: entry.airline_logo || firstSeg.airline_logo || null,
      departure: depTime,
      arrival: arrTime,
      departureTerminal: '',
      arrivalTerminal: '',
      duration: durationStr,
      stops,
      layovers,
      segments,
    });
  }

  // Sort by price
  flights.sort((a, b) => a.price - b.price);

  const result = { flights, carriers };
  setCache(cacheKey, result, 30 * 60 * 1000); // 30 min
  return result;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ── Route: Flight search (SerpApi) ──
// Accepts altOrigins/altDestinations (comma-separated) for multi-airport search in one call.
app.get('/api/flights', async (req, res) => {
  try {
    const { origin, destination, date, adults, children, fromCity, toCity, currency,
            altOrigins, altDestinations } = req.query;
    if (!origin || !destination || !date) {
      return res.status(400).json({ error: 'origin, destination, and date are required' });
    }

    // Validate primary codes
    if (!/^[A-Z]{3}$/i.test(origin) || !/^[A-Z]{3}$/i.test(destination)) {
      return res.status(400).json({ error: 'Invalid airport codes. Expected 3-letter IATA codes.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }

    const numAdults = parseInt(adults) || 1;
    const numChildren = parseInt(children) || 0;
    const userCurrency = (currency && /^[A-Z]{3}$/i.test(currency)) ? currency.toUpperCase() : 'EUR';

    // Build comma-separated airport lists for SerpApi multi-airport search
    // e.g. origin=DEL + altOrigins=BOM → "DEL,BOM" (max 5 alternates)
    const allOrigins = [origin.toUpperCase()];
    const allDests = [destination.toUpperCase()];
    if (altOrigins) {
      for (const code of altOrigins.split(',').slice(0, 5)) {
        const c = code.trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(c) && !allOrigins.includes(c)) allOrigins.push(c);
      }
    }
    if (altDestinations) {
      for (const code of altDestinations.split(',').slice(0, 5)) {
        const c = code.trim().toUpperCase();
        if (/^[A-Z]{3}$/.test(c) && !allDests.includes(c)) allDests.push(c);
      }
    }

    const depId = allOrigins.join(',');
    const arrId = allDests.join(',');
    const primaryOnly = origin.toUpperCase();
    const primaryDest = destination.toUpperCase();

    // Check cache first (shared key format so scraper and SerpApi don't duplicate)
    const flightCacheKey = `flights:${depId}-${arrId}-${date}-${numAdults}-${numChildren}-${userCurrency}`;
    const cachedFlights = getCached(flightCacheKey);
    if (cachedFlights) {
      console.log(`[flights] [${req.id}] Cache hit: ${cachedFlights.flights.length} flights`);
      return res.json(cachedFlights);
    }

    // 1. Try Puppeteer scraper first
    try {
      console.log(`[flights] [${req.id}] Scraper: ${primaryOnly}->${primaryDest} on ${date} (${userCurrency})`);
      const data = await scrapeFlights(primaryOnly, primaryDest, date, userCurrency);
      if (data.flights.length > 0) {
        // Convert prices from detected page currency to EUR
        const pageCurrency = data.detectedCurrency || userCurrency;
        for (const f of data.flights) {
          f.price = round2(convertToEurFrontend(f.price, pageCurrency));
          f.currency = 'EUR';
        }
        delete data.detectedCurrency;
        data.flights.sort((a, b) => a.price - b.price);
        console.log(`[flights] [${req.id}] Scraper returned ${data.flights.length} flights (page currency: ${pageCurrency})`);
        setCache(flightCacheKey, data, 30 * 60 * 1000);
        return res.json(data);
      }
      console.log(`[flights] [${req.id}] Scraper returned 0 flights`);
    } catch (scrapeErr) {
      console.warn(`[flights] [${req.id}] Scraper failed: ${scrapeErr.message}`);
    }

    // 2. Fallback to SerpApi if key is configured
    if (SERPAPI_KEY) {
      try {
        console.log(`[flights] [${req.id}] SerpApi fallback: ${depId}->${arrId} on ${date} (${userCurrency})`);
        const data = await searchFlightsSerpApi(depId, arrId, date, numAdults, numChildren, userCurrency);
        if (data.flights.length > 0) {
          console.log(`[flights] [${req.id}] SerpApi returned ${data.flights.length} flights`);
          setCache(flightCacheKey, data, 30 * 60 * 1000);
          return res.json(data);
        }
        console.log(`[flights] [${req.id}] SerpApi returned 0 flights`);
      } catch (serpErr) {
        console.warn(`[flights] [${req.id}] SerpApi failed: ${serpErr.message}`);
      }

      // Retry with primary airports only if multi-airport search failed
      if (depId !== primaryOnly || arrId !== primaryDest) {
        try {
          console.log(`[flights] [${req.id}] SerpApi retry (primary only): ${primaryOnly}->${primaryDest} on ${date}`);
          const data = await searchFlightsSerpApi(primaryOnly, primaryDest, date, numAdults, numChildren, userCurrency);
          if (data.flights.length > 0) {
            console.log(`[flights] [${req.id}] SerpApi retry returned ${data.flights.length} flights`);
            setCache(flightCacheKey, data, 30 * 60 * 1000);
            return res.json(data);
          }
        } catch (retryErr) {
          console.warn(`[flights] [${req.id}] SerpApi retry failed: ${retryErr.message}`);
        }
      }
    }

    // No results — return empty
    res.json({ flights: [], carriers: {}, warning: 'No flights found for this route/date.' });
  } catch (err) {
    console.error('flights error:', err.message);
    res.status(502).json({ flights: [], carriers: {}, error: 'Flight search temporarily unavailable. Using estimates.' });
  }
});

// ── SerpApi Google Hotels search ──
async function searchHotelsSerpApi(query, checkIn, checkOut, adults = 1, currency = 'EUR') {
  const cacheKey = `serpapi-hotels:${query}-${checkIn}-${checkOut}-${adults}-${currency}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const url = new URL('https://serpapi.com/search');
  url.searchParams.set('engine', 'google_hotels');
  url.searchParams.set('q', query);
  url.searchParams.set('check_in_date', checkIn);
  url.searchParams.set('check_out_date', checkOut);
  url.searchParams.set('adults', String(adults));
  url.searchParams.set('currency', currency);
  url.searchParams.set('api_key', SERPAPI_KEY);

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SerpApi Hotels HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = await resp.json();

  if (data.error) {
    throw new Error(`SerpApi Hotels error: ${data.error}`);
  }

  // SerpApi returns two response formats:
  // 1. Exact hotel match → single hotel detail at top level (name, rate_per_night, etc.)
  // 2. Generic search → properties[] array with multiple hotels
  let hotels = [];

  if (data.name && !data.properties) {
    // Single hotel detail page (exact name match)
    const rawPrice = data.rate_per_night?.extracted_lowest || data.total_rate?.extracted_lowest || 0;
    const hotelId = 'SH' + crypto.createHash('md5').update(data.name).digest('hex').slice(0, 8);
    if (rawPrice > 0) {
      hotels.push({
        hotelId,
        name: data.name,
        pricePerNight: round2(convertToEurFrontend(rawPrice, currency)),
        rating: data.overall_rating || null,
        reviewCount: data.reviews || null,
        photoUrl: data.images?.[0]?.thumbnail || null,
        distance: null,
        listingUrl: data.link || null,
        hotelClass: data.extracted_hotel_class || null,
        source: 'live',
      });
    }
  } else {
    // Multiple hotel results
    const properties = data.properties || [];
    hotels = properties.slice(0, 10).map(p => {
      const rawPrice = p.rate_per_night?.extracted_lowest || p.total_rate?.extracted_lowest || 0;
      const idStr = p.name || `hotel-${Math.random()}`;
      const hotelId = 'SH' + crypto.createHash('md5').update(idStr).digest('hex').slice(0, 8);
      return {
        hotelId,
        name: p.name || 'Hotel',
        pricePerNight: rawPrice ? round2(convertToEurFrontend(rawPrice, currency)) : 0,
        rating: p.overall_rating || null,
        reviewCount: p.reviews || null,
        photoUrl: p.images?.[0]?.thumbnail || null,
        distance: null,
        listingUrl: p.link || null,
        hotelClass: p.extracted_hotel_class || null,
        source: 'live',
      };
    }).filter(h => h.pricePerNight > 0);
  }

  const result = { hotels };
  setCache(cacheKey, result, 30 * 60 * 1000); // 30 min
  return result;
}

// ── Route: Hotel search by name (SerpApi Google Hotels) ──
app.get('/api/hotels/search-by-name', async (req, res) => {
  try {
    const { query, checkIn, checkOut, adults, currency } = req.query;
    if (!query || !checkIn || !checkOut) {
      return res.status(400).json({ error: 'query, checkIn, and checkOut are required' });
    }
    if (query.length > 255) {
      return res.status(400).json({ error: 'Query too long (max 255 chars).' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }
    // Validate date range
    const ciDate = new Date(checkIn + 'T00:00:00Z');
    const coDate = new Date(checkOut + 'T00:00:00Z');
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    if (isNaN(ciDate) || isNaN(coDate)) {
      return res.status(400).json({ error: 'Invalid date values.' });
    }
    if (coDate <= ciDate) {
      return res.status(400).json({ error: 'checkOut must be after checkIn.' });
    }
    if ((coDate - ciDate) / (1000 * 60 * 60 * 24) > 30) {
      return res.status(400).json({ error: 'Maximum stay is 30 nights.' });
    }

    const numAdults = parseInt(adults) || 1;
    const userCurrency = (currency && /^[A-Z]{3}$/i.test(currency)) ? currency.toUpperCase() : 'EUR';

    // Check cache first
    const hotelCacheKey = `hotels:${query.toLowerCase()}-${checkIn}-${checkOut}-${numAdults}-${userCurrency}`;
    const cachedHotels = getCached(hotelCacheKey);
    if (cachedHotels) {
      console.log(`[hotels/search] Cache hit: ${cachedHotels.hotels.length} hotels`);
      return res.json(cachedHotels);
    }

    // 1. Try Puppeteer scraper first
    let scraperResult = null;
    try {
      console.log(`[hotels/search] Scraper: "${query}" ${checkIn}-${checkOut} (${userCurrency})`);
      scraperResult = await scrapeHotels(query, checkIn, checkOut, userCurrency);
      if (scraperResult.hotels.length > 0) {
        // Convert prices from detected page currency to EUR
        const pageCurrency = scraperResult.detectedCurrency || userCurrency;
        for (const h of scraperResult.hotels) {
          h.pricePerNight = round2(convertToEurFrontend(h.pricePerNight, pageCurrency));
        }
        delete scraperResult.detectedCurrency;
        console.log(`[hotels/search] Scraper returned ${scraperResult.hotels.length} hotels (page currency: ${pageCurrency})`);
        setCache(hotelCacheKey, scraperResult, 30 * 60 * 1000);
        return res.json(scraperResult);
      }
      console.log('[hotels/search] Scraper returned 0 hotels');
    } catch (scrapeErr) {
      console.warn(`[hotels/search] Scraper failed: ${scrapeErr.message}`);
    }

    // 2. Fallback to SerpApi if key is configured
    if (SERPAPI_KEY) {
      console.log(`[hotels/search] SerpApi fallback: "${query}" ${checkIn}-${checkOut} (${userCurrency})`);
      const data = await searchHotelsSerpApi(query, checkIn, checkOut, numAdults, userCurrency);
      console.log(`[hotels/search] SerpApi returned ${data.hotels.length} hotels`);
      if (data.hotels.length > 0) {
        setCache(hotelCacheKey, data, 30 * 60 * 1000);
      }
      return res.json(data);
    }

    // Both failed — return empty
    res.json({ hotels: [] });
  } catch (err) {
    console.error('hotels/search-by-name error:', err.message);
    res.status(502).json({ hotels: [], error: 'Hotel search temporarily unavailable.' });
  }
});

// ── Route: Meal costs (city + layover) ──
app.get('/api/meal-costs', async (req, res) => {
  try {
    const { cityCode, countryCode, layovers } = req.query;

    const result = {};

    // City meal costs
    if (cityCode || countryCode) {
      result.cityMeals = getCityMealCosts(cityCode, countryCode);
    }

    // Layover meal costs
    if (layovers) {
      try {
        const layoverArr = JSON.parse(layovers);
        result.layoverMeals = layoverArr.map(l => ({
          airportCode: l.airportCode,
          durationMinutes: l.durationMinutes,
          ...getLayoverMealCost(l.airportCode, l.durationMinutes),
        }));
      } catch (e) {
        result.layoverMeals = [];
      }
    }

    res.json(result);
  } catch (err) {
    console.error('meal-costs error:', err);
    res.status(500).json({ error: 'Internal server error fetching meal costs' });
  }
});

// ── Currency conversion (approximate, for transit fare conversion to EUR) ──
const EUR_RATES = {
  'EUR': 1, 'USD': 0.92, 'GBP': 1.17, 'CHF': 1.05, 'JPY': 0.0061,
  'INR': 0.011, 'AED': 0.25, 'THB': 0.026, 'IDR': 0.000058, 'MYR': 0.21,
  'SGD': 0.69, 'HKD': 0.12, 'AUD': 0.60, 'CAD': 0.68, 'KRW': 0.00067,
  'TRY': 0.028, 'EGP': 0.019, 'BRL': 0.18, 'MXN': 0.054, 'PLN': 0.23,
  'CZK': 0.040, 'HUF': 0.0025, 'SEK': 0.088, 'NOK': 0.087, 'DKK': 0.13,
  'NZD': 0.56, 'ZAR': 0.051, 'PHP': 0.017, 'VND': 0.000038, 'TWD': 0.029,
  'PKR': 0.0033, 'BDT': 0.0078, 'LKR': 0.003, 'NPR': 0.0069,
};

function convertToEur(amount, currency) {
  const rate = EUR_RATES[currency];
  if (rate) return amount * rate;
  // Unknown currency, return as-is (assume EUR)
  return amount;
}

// ── Route: Transfer cost estimate using Google Directions API ──
// Shared rate constants (single source of truth for server + frontend)
const TravelRates = require('../public/js/rates.js');
const TAXI_RATES = TravelRates.TAXI_RATES;
const PUBLIC_TRANSPORT_RATES = TravelRates.PUBLIC_TRANSPORT_RATES;

app.get('/api/transfer-estimate', async (req, res) => {
  try {
    const { originLat, originLng, destLat, destLng, country, originText, destText, departureDate } = req.query;
    if ((!originLat || !originLng || !destLat || !destLng) && !originText && !destText) {
      return res.status(400).json({ error: 'coordinates or text addresses required' });
    }

    // Validate coordinates
    const oLat = parseFloat(originLat), oLng = parseFloat(originLng);
    const dLat = parseFloat(destLat), dLng = parseFloat(destLng);
    if (!originText && !destText) {
      if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
        return res.status(400).json({ error: 'Invalid coordinates' });
      }
      if (Math.abs(oLat) > 90 || Math.abs(dLat) > 90 || Math.abs(oLng) > 180 || Math.abs(dLng) > 180) {
        return res.status(400).json({ error: 'Coordinates out of range' });
      }
    }

    const cacheKey = `transfer:${originText || originLat + ',' + originLng}-${destText || destLat + ',' + destLng}-${departureDate || ''}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const countryCode = country || 'DEFAULT';
    const straightDist = (oLat && dLat) ? haversineKm(oLat, oLng, dLat, dLng) : 30;

    const taxiRates = TAXI_RATES[countryCode] || TAXI_RATES['DEFAULT'];
    const ptRate = PUBLIC_TRANSPORT_RATES[countryCode] || PUBLIC_TRANSPORT_RATES['DEFAULT'];

    // Use text addresses when available (e.g. airport name) for accurate routing
    // Fall back to coordinates when no text is provided
    const origin = originText || `${oLat},${oLng}`;
    const dest = destText || `${dLat},${dLng}`;

    // Convert departure date (YYYY-MM-DD) to Unix timestamp (morning 8AM local-ish)
    let departureTimestamp = null;
    if (departureDate && /^\d{4}-\d{2}-\d{2}$/.test(departureDate)) {
      // Use 8AM UTC on the departure date for transit scheduling
      departureTimestamp = Math.floor(new Date(departureDate + 'T08:00:00Z').getTime() / 1000);
    }

    // Parallel: Google Directions for all 4 modes
    const [drivingData, transitData, walkingData, bicyclingData] = await Promise.all([
      fetchGoogleRaw(origin, dest, 'driving', false),
      fetchGoogleRaw(origin, dest, 'transit', true, departureTimestamp),
      fetchGoogleRaw(origin, dest, 'walking', false),
      fetchGoogleRaw(origin, dest, 'bicycling', false),
    ]);

    // ── Helper: parse basic route info ──
    function parseBasicRoute(data, label) {
      if (!data?.routes?.[0]?.legs?.[0]) return null;
      const route = data.routes[0];
      const leg = route.legs[0];
      return {
        distanceKm: Math.round(leg.distance.value / 1000),
        distanceText: leg.distance.text,
        duration: leg.duration.text,
        durationSec: leg.duration.value,
        summary: route.summary || '',
      };
    }

    // ── Driving ──
    let drivingInfo = parseBasicRoute(drivingData, 'driving');
    // Sanity check: if Google returns absurd distance vs straight-line, discard
    if (drivingInfo && drivingInfo.distanceKm > Math.max(straightDist * 4, 500)) {
      console.warn(`[transfer] Google driving ${drivingInfo.distanceKm}km vs straight-line ${Math.round(straightDist)}km — discarding bad route`);
      drivingInfo = null;
    }
    const driving = drivingInfo ? {
      ...drivingInfo,
      taxiCost: Math.round(taxiRates.baseFare + drivingInfo.distanceKm * taxiRates.perKm),
    } : {
      distanceKm: Math.round(straightDist),
      distanceText: `~${Math.round(straightDist)} km`,
      duration: `~${Math.round(straightDist / 50 * 60)} min`,
      durationSec: Math.round(straightDist / 50 * 3600),
      summary: '',
      taxiCost: Math.round(taxiRates.baseFare + Math.round(straightDist) * taxiRates.perKm),
    };

    // ── Walking ──
    const walking = parseBasicRoute(walkingData, 'walking');

    // ── Bicycling ──
    const bicycling = parseBasicRoute(bicyclingData, 'bicycling');

    // ── Transit routes (multiple alternatives) ──
    const maxTransitKm = Math.max(straightDist * 4, 500);
    const transitRoutes = [];
    if (transitData?.routes) {
      for (const route of transitData.routes.slice(0, 3)) {
        const leg = route.legs?.[0];
        if (!leg) continue;
        const distKm = Math.round(leg.distance.value / 1000);
        // Skip absurd transit routes
        if (distKm > maxTransitKm) {
          console.warn(`[transfer] Skipping transit route: ${distKm}km vs straight-line ${Math.round(straightDist)}km`);
          continue;
        }

        // Fare
        let publicTransportCost, fareSource = 'estimated';
        if (route.fare) {
          publicTransportCost = Math.round(convertToEur(route.fare.value, route.fare.currency) * 100) / 100;
          fareSource = 'google';
        } else {
          publicTransportCost = Math.max(1, Math.round(distKm * ptRate));
        }

        // Build step-by-step details
        const steps = (leg.steps || []).map(step => {
          const base = {
            mode: step.travel_mode,
            duration: step.duration?.text || '',
            durationSec: step.duration?.value || 0,
            distance: step.distance?.text || '',
          };
          if (step.travel_mode === 'TRANSIT' && step.transit_details) {
            const td = step.transit_details;
            base.vehicleType = td.line?.vehicle?.type || 'BUS';
            base.vehicleIcon = td.line?.vehicle?.icon || '';
            base.lineName = td.line?.short_name || td.line?.name || '';
            base.lineColor = td.line?.color || '#4285F4';
            base.lineTextColor = td.line?.text_color || '#FFFFFF';
            base.headsign = td.headsign || td.line?.name || '';
            base.departureStop = td.departure_stop?.name || '';
            base.arrivalStop = td.arrival_stop?.name || '';
            base.departureTime = td.departure_time?.text || '';
            base.arrivalTime = td.arrival_time?.text || '';
            base.numStops = td.num_stops || 0;
          }
          return base;
        });

        // Build a summary like "Bus 64 → Train CSMT → Metro Line 3"
        const transitSteps = steps.filter(s => s.mode === 'TRANSIT');
        const summary = transitSteps.map(s => {
          const type = { BUS: 'Bus', HEAVY_RAIL: 'Train', SUBWAY: 'Metro', COMMUTER_TRAIN: 'Train', TRAM: 'Tram', LIGHT_RAIL: 'Light Rail', FERRY: 'Ferry' }[s.vehicleType] || 'Transit';
          return s.lineName ? `${type} ${s.lineName}` : type;
        }).join(' → ');

        transitRoutes.push({
          distanceKm: distKm,
          duration: leg.duration?.text || '',
          durationSec: leg.duration?.value || 0,
          departureTime: leg.departure_time?.text || '',
          arrivalTime: leg.arrival_time?.text || '',
          publicTransportCost,
          fareSource,
          summary,
          steps,
        });
      }
    }

    // Sort transit routes: penalize routes with long final walks, then by total duration
    transitRoutes.sort((a, b) => {
      const lastWalkA = a.steps.length > 0 && a.steps[a.steps.length - 1].mode === 'WALKING'
        ? a.steps[a.steps.length - 1].durationSec : 0;
      const lastWalkB = b.steps.length > 0 && b.steps[b.steps.length - 1].mode === 'WALKING'
        ? b.steps[b.steps.length - 1].durationSec : 0;
      // Penalize routes with >15 min final walk by adding their walk time to effective duration
      const threshold = 15 * 60;
      const effA = a.durationSec + (lastWalkA > threshold ? lastWalkA : 0);
      const effB = b.durationSec + (lastWalkB > threshold ? lastWalkB : 0);
      return effA - effB;
    });

    // If no transit routes, add fallback
    if (transitRoutes.length === 0) {
      transitRoutes.push({
        distanceKm: driving.distanceKm,
        duration: driving.duration,
        durationSec: driving.durationSec || 0,
        publicTransportCost: Math.max(1, Math.round(driving.distanceKm * ptRate)),
        fareSource: 'estimated',
        summary: 'No transit routes found',
        steps: [],
      });
    }

    const result = {
      driving,
      walking,
      bicycling,
      transitRoutes,
      straightLineKm: Math.round(straightDist),
    };

    setCache(cacheKey, result, TTL.TRANSFER);
    res.json(result);
  } catch (err) {
    console.error('transfer-estimate error:', err);
    res.status(500).json({ error: 'Transfer estimation failed', code: 'TRANSFER_ERROR' });
  }
});

async function fetchGoogleRaw(origin, destination, mode, alternatives, departureTime) {
  try {
    const o = encodeURIComponent(origin);
    const d = encodeURIComponent(destination);
    let url = `https://maps.googleapis.com/maps/api/directions/json?origin=${o}&destination=${d}&mode=${mode}&key=${GOOGLE_API_KEY}`;
    if (alternatives) url += '&alternatives=true';
    if (departureTime) url += `&departure_time=${departureTime}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== 'OK') return null;
    return data;
  } catch (e) {
    console.warn(`Google Directions (${mode}) error:`, e.message);
    return null;
  }
}

// ── Maps API key endpoint (so key isn't hardcoded in HTML) ──
app.get('/api/maps-config', (req, res) => {
  res.json({ key: GOOGLE_API_KEY });
});

// ── Exchange rates endpoint (server-controlled, can be updated without frontend deploy) ──
app.get('/api/exchange-rates', (req, res) => {
  res.json({ base: 'EUR', rates: EUR_RATES, updatedAt: '2025-01-15' });
});

// ── Route: Generate AI itinerary via OpenAI ──
app.post('/api/itinerary/generate', async (req, res) => {
  try {
    const { destinations, tripMode } = req.body;
    if (!destinations || !Array.isArray(destinations) || destinations.length === 0) {
      return res.status(400).json({ error: 'destinations array is required' });
    }

    // Cache key from sorted destination names + tripMode
    const destKey = destinations.map(d => d.name).sort().join(',').toLowerCase();
    const cacheKey = `itinerary:${destKey}:${tripMode || 'roundtrip'}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    if (!OPENAI_API_KEY) {
      console.warn('[itinerary] No OPENAI_API_KEY set — returning empty itinerary');
      return res.json({ itinerary: { days: [] } });
    }

    const destDescription = destinations.map(d => `${d.name} (${d.nights} nights)`).join(', ');
    const userMessage = `Plan activities for a ${tripMode || 'roundtrip'} trip visiting: ${destDescription}`;

    const openaiResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a travel itinerary planner. For each city, suggest activities organized by day. Return JSON: { "days": [{ "city": "CityName", "dayNumber": 1, "activities": [{ "name": "...", "duration": "1.5 hours", "entryFee": 16, "category": "museum", "description": "..." }]}]}. IMPORTANT: The "city" field in each day MUST use the EXACT city name as provided in the user message — do not correct spelling or use alternate names. Include a mix: museum, landmark, food, park, shopping, cultural. Keep realistic for one day (4-6 hours total).',
          },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!openaiResp.ok) {
      const body = await openaiResp.text();
      console.warn(`[itinerary] OpenAI HTTP ${openaiResp.status}: ${body.slice(0, 200)}`);
      return res.json({ itinerary: { days: [] } });
    }

    const openaiData = await openaiResp.json();
    const content = openaiData.choices?.[0]?.message?.content;
    if (!content) {
      console.warn('[itinerary] OpenAI returned no content');
      return res.json({ itinerary: { days: [] } });
    }

    const itinerary = JSON.parse(content);
    const result = { itinerary };
    setCache(cacheKey, result, 24 * 60 * 60 * 1000); // 24 hours
    res.json(result);
  } catch (err) {
    console.error('itinerary/generate error:', err.message);
    res.json({ itinerary: { days: [] } });
  }
});

// ── Route: Resolve a place via Google Places Text Search ──
app.get('/api/places/resolve', async (req, res) => {
  try {
    const { name, city, lat, lng } = req.query;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const cacheKey = `place-resolve:${(name + ':' + (city || '')).toLowerCase()}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const query = encodeURIComponent(`${name} ${city || ''}`);
    let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_API_KEY}`;
    if (lat && lng) url += `&location=${lat},${lng}&radius=5000`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      return res.status(502).json({ error: 'Google Places API error' });
    }
    const data = await resp.json();

    if (data.status !== 'OK' || !data.results?.[0]) {
      return res.json({ placeId: null, name, lat: null, lng: null, rating: null, photoUrl: null, types: [] });
    }

    const place = data.results[0];
    const photoRef = place.photos?.[0]?.photo_reference;
    const photoUrl = photoRef
      ? `/api/place-photo?ref=${encodeURIComponent(photoRef)}`
      : null;

    const result = {
      placeId: place.place_id,
      name: place.name,
      lat: place.geometry.location.lat,
      lng: place.geometry.location.lng,
      rating: place.rating || null,
      photoUrl,
      types: place.types || [],
    };

    setCache(cacheKey, result, TTL.IATA); // 7 days
    res.json(result);
  } catch (err) {
    console.error('places/resolve error:', err.message);
    res.status(500).json({ error: 'Internal server error resolving place' });
  }
});

// ── Route: Proxy Google Places photos (avoids exposing API key to browser) ──
app.get('/api/place-photo', async (req, res) => {
  const { ref } = req.query;
  if (!ref) return res.status(400).send('ref is required');

  const cacheKey = `place-photo:${ref}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=604800');
    return res.send(cached.buffer);
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${encodeURIComponent(ref)}&key=${GOOGLE_API_KEY}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return res.status(resp.status).send('Photo fetch failed');

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await resp.arrayBuffer());

    setCache(cacheKey, { contentType, buffer }, TTL.IATA); // 7 days
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=604800');
    res.send(buffer);
  } catch (err) {
    console.error('place-photo proxy error:', err.message);
    res.status(502).send('Photo proxy error');
  }
});

// ── Route: Search places via Google Places Text Search ──
app.get('/api/places/search', async (req, res) => {
  try {
    const { query: q, lat, lng, radius } = req.query;
    if (!q) return res.status(400).json({ error: 'query is required' });
    if (q.length > 255) return res.status(400).json({ error: 'Query too long (max 255 chars).' });

    const searchRadius = parseInt(radius) || 10000;
    const query = encodeURIComponent(q);
    let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_API_KEY}`;
    if (lat && lng) url += `&location=${lat},${lng}&radius=${searchRadius}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      return res.status(502).json({ error: 'Google Places API error' });
    }
    const data = await resp.json();

    if (data.status !== 'OK' || !data.results) {
      console.warn(`[places/search] Google status: ${data.status}, error: ${data.error_message || 'none'}, query: ${q}`);
      return res.json({ places: [] });
    }

    const places = data.results.slice(0, 10).map(place => ({
      placeId: place.place_id,
      name: place.name,
      lat: place.geometry?.location?.lat,
      lng: place.geometry?.location?.lng,
      rating: place.rating || null,
      types: place.types || [],
    }));

    res.json({ places });
  } catch (err) {
    console.error('places/search error:', err.message);
    res.status(500).json({ error: 'Internal server error searching places' });
  }
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Trip Cost Calculator running at http://localhost:${PORT}`);
});

// Graceful shutdown — close browser pool
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await shutdownBrowserPool();
  process.exit(0);
});
process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down...');
  await shutdownBrowserPool();
  process.exit(0);
});
