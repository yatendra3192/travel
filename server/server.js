const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { getCached, setCache } = require('./cache');
// iata-data.js no longer used — AirLabs API handles airport resolution dynamically
const { getLayoverMealCost, getCityMealCosts } = require('./meal-data');
const rateLimit = require('express-rate-limit');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error('FATAL: GOOGLE_API_KEY environment variable is not set.');
  process.exit(1);
}
const PYTHON_API_BASE = process.env.PYTHON_API_URL || 'http://localhost:5000';
const AIRLABS_API_KEY = process.env.AIRLABS_API_KEY || 'afa16b56-229a-4936-955e-53ab521c4bf0';

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
// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Request ID tracing
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

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

const TTL = {
  IATA: 7 * 24 * 60 * 60 * 1000,
  TRANSFER: 24 * 60 * 60 * 1000,
};

// ── Helper: call Python scraping API ──
async function pythonApiGet(endpoint, params = {}) {
  const url = new URL(endpoint, PYTHON_API_BASE);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Python API error ${resp.status} on ${endpoint}: ${body}`);
    throw new Error(`Python API error: ${resp.status}`);
  }
  return resp.json();
}

// ── Startup health check for Python service ──
async function checkPythonService() {
  try {
    const resp = await fetch(`${PYTHON_API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json();
      console.log(`Python scraping service: status=${data.status}, browser_ready=${data.browser_ready}`);
      return true;
    }
  } catch (e) {
    // ignore
  }
  console.warn('WARNING: Python scraping service not reachable at ' + PYTHON_API_BASE);
  console.warn('Start it with: cd python-api && python main.py');
  return false;
}

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

    let airport = null;
    if (candidates.length > 0) {
      // Among nearby airports (<100km), pick the most popular (= busiest hub)
      const nearby = candidates.filter(a => (a.distance || 999) < 100);
      if (nearby.length > 0) {
        airport = nearby.reduce((best, a) => (a.popularity || 0) > (best.popularity || 0) ? a : best);
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

    return {
      airportCode: airport.iata_code,
      cityCode: airport.city_code || airport.iata_code,
      airportName: airport.name,
      country: airport.country_code,
      lat: airport.lat,
      lng: airport.lng,
      distanceKm,
      hasAirport: distanceKm < 80,
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
          result.cityCenterLat = cityCoords.lat;
          result.cityCenterLng = cityCoords.lng;
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

// ── Route: Flight search (via Python scraping service → Skyscanner) ──
app.get('/api/flights', async (req, res) => {
  try {
    const { origin, destination, date, adults, children } = req.query;
    if (!origin || !destination || !date) {
      return res.status(400).json({ error: 'origin, destination, and date are required' });
    }

    // Validate inputs
    if (!/^[A-Z]{3}$/i.test(origin) || !/^[A-Z]{3}$/i.test(destination)) {
      return res.status(400).json({ error: 'Invalid airport codes. Expected 3-letter IATA codes.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }

    const data = await pythonApiGet('/api/scrape/flights', {
      origin, destination, date,
      adults: adults || 1,
      children: children || 0,
    });

    res.json(data);
  } catch (err) {
    console.error('flights error:', err.message);
    res.status(502).json({ flights: [], carriers: {}, error: 'Flight search temporarily unavailable. Using estimates.' });
  }
});

// ── Route: Hotel list by city (via Python scraping service → Booking.com) ──
app.get('/api/hotels/list', async (req, res) => {
  try {
    const { cityCode } = req.query;
    if (!cityCode) return res.status(400).json({ error: 'cityCode is required' });

    const data = await pythonApiGet('/api/scrape/hotels/list', { cityCode });
    res.json(data);
  } catch (err) {
    console.error('hotels/list error:', err.message);
    res.status(502).json({ hotels: [], error: 'Hotel search temporarily unavailable.' });
  }
});

// ── Route: Hotel offers/pricing (via Python scraping service → Booking.com) ──
app.get('/api/hotels/offers', async (req, res) => {
  try {
    const { hotelIds, checkIn, checkOut, adults } = req.query;
    if (!hotelIds || !checkIn || !checkOut) {
      return res.status(400).json({ error: 'hotelIds, checkIn, checkOut are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
    }
    if (new Date(checkIn) >= new Date(checkOut)) {
      return res.status(400).json({ error: 'Check-in date must be before check-out date' });
    }

    const data = await pythonApiGet('/api/scrape/hotels/offers', {
      hotelIds, checkIn, checkOut,
      adults: adults || 1,
    });
    res.json(data);
  } catch (err) {
    console.error('hotels/offers error:', err.message);
    res.status(502).json({ offers: [], error: 'Hotel pricing temporarily unavailable.' });
  }
});

// ── Route: Hotel list by geocode (via Python scraping service → Booking.com) ──
app.get('/api/hotels/list-by-geocode', async (req, res) => {
  try {
    const { latitude, longitude, radius } = req.query;
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }
    const lat = parseFloat(latitude), lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const data = await pythonApiGet('/api/scrape/hotels/list-by-geocode', {
      latitude, longitude,
      radius: radius || 5,
    });
    res.json(data);
  } catch (err) {
    console.error('hotels/list-by-geocode error:', err.message);
    res.status(502).json({ hotels: [], searchRadius: parseInt(req.query.radius) || 5, error: 'Hotel search temporarily unavailable.' });
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
const TAXI_RATES = {
  'IN': { perKm: 0.30, baseFare: 2.50, currency: 'EUR' },
  'NL': { perKm: 2.20, baseFare: 3.00, currency: 'EUR' },
  'BE': { perKm: 1.80, baseFare: 2.50, currency: 'EUR' },
  'FR': { perKm: 1.50, baseFare: 2.50, currency: 'EUR' },
  'ES': { perKm: 1.10, baseFare: 2.50, currency: 'EUR' },
  'DE': { perKm: 2.00, baseFare: 3.50, currency: 'EUR' },
  'IT': { perKm: 1.30, baseFare: 3.00, currency: 'EUR' },
  'GB': { perKm: 2.50, baseFare: 3.50, currency: 'EUR' },
  'CH': { perKm: 3.50, baseFare: 6.00, currency: 'EUR' },
  'AT': { perKm: 1.50, baseFare: 3.00, currency: 'EUR' },
  'PT': { perKm: 0.90, baseFare: 2.00, currency: 'EUR' },
  'GR': { perKm: 0.80, baseFare: 1.50, currency: 'EUR' },
  'US': { perKm: 2.00, baseFare: 3.00, currency: 'EUR' },
  'AE': { perKm: 0.50, baseFare: 3.00, currency: 'EUR' },
  'JP': { perKm: 3.00, baseFare: 5.00, currency: 'EUR' },
  'AU': { perKm: 1.80, baseFare: 3.50, currency: 'EUR' },
  'TR': { perKm: 0.50, baseFare: 1.50, currency: 'EUR' },
  'TH': { perKm: 0.30, baseFare: 1.00, currency: 'EUR' },
  'DEFAULT': { perKm: 1.50, baseFare: 3.00, currency: 'EUR' },
};

const PUBLIC_TRANSPORT_RATES = {
  'IN': 0.05, 'NL': 0.15, 'BE': 0.12, 'FR': 0.10, 'ES': 0.08,
  'DE': 0.12, 'IT': 0.08, 'GB': 0.15, 'CH': 0.20, 'AT': 0.10,
  'PT': 0.06, 'GR': 0.05, 'US': 0.10, 'AE': 0.08, 'JP': 0.15,
  'AU': 0.12, 'TR': 0.04, 'TH': 0.03, 'DEFAULT': 0.10,
};

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
    const drivingInfo = parseBasicRoute(drivingData, 'driving');
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
    const transitRoutes = [];
    if (transitData?.routes) {
      for (const route of transitData.routes.slice(0, 3)) {
        const leg = route.legs?.[0];
        if (!leg) continue;
        const distKm = Math.round(leg.distance.value / 1000);

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
    res.status(500).json({ error: 'Internal server error estimating transfer' });
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

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Trip Cost Calculator running at http://localhost:${PORT}`);
  await checkPythonService();
});
