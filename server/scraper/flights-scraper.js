'use strict';

const crypto = require('crypto');
const { acquirePage, releasePage } = require('./browser-pool');
const {
  parsePrice, parseDurationToMinutes, minutesToPTDuration,
  randomDelay, dismissConsent, detectCaptcha,
} = require('./parser-utils');

const MAX_RETRIES = 2;
const NAV_TIMEOUT = 45000;

async function scrapeFlights(origin, destination, date, currency = 'EUR') {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let page = null;
    try {
      if (attempt > 0) {
        const delay = 2000 * Math.pow(2, attempt - 1);
        console.log(`[flights-scraper] Retry ${attempt}/${MAX_RETRIES} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }

      page = await acquirePage();
      page.setDefaultNavigationTimeout(NAV_TIMEOUT);
      page.setDefaultTimeout(15000);

      const result = await _scrapeFlightsOnPage(page, origin, destination, date, currency);
      await releasePage(page);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[flights-scraper] Attempt ${attempt} failed: ${err.message}`);
      if (page) {
        // Check for CAPTCHA
        const captcha = await detectCaptcha(page).catch(() => false);
        await releasePage(page);
        if (captcha) {
          console.warn('[flights-scraper] CAPTCHA detected, waiting 30s...');
          await new Promise(r => setTimeout(r, 30000));
        }
      }
    }
  }

  console.error(`[flights-scraper] All attempts failed: ${lastError?.message}`);
  throw lastError || new Error('Flight scraping failed');
}

async function _scrapeFlightsOnPage(page, origin, destination, date, currency) {
  // Build Google Flights URL for one-way search
  // tfs parameter encodes origin/dest/date; alternatively use the search form
  // Using URL approach with query params for reliability
  const url = `https://www.google.com/travel/flights?hl=en&curr=${currency}`;
  console.log(`[flights-scraper] Navigating to Google Flights`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
  await dismissConsent(page);
  await randomDelay(500, 1000);

  // Switch to one-way
  await _setOneWay(page);
  await randomDelay(300, 600);

  // Set origin
  await _fillAirportField(page, 'origin', origin);
  await randomDelay(300, 600);

  // Set destination
  await _fillAirportField(page, 'destination', destination);
  await randomDelay(300, 600);

  // Set date
  await _setDate(page, date);
  await randomDelay(300, 600);

  // Click search / wait for results
  await _clickSearch(page);

  // Wait for flight results to load
  console.log('[flights-scraper] Waiting for flight results...');
  await page.waitForFunction(() => {
    // Wait until either results appear or "no flights" message shows
    const lists = document.querySelectorAll('li');
    const noResults = document.body?.innerText?.includes('No flights found') ||
      document.body?.innerText?.includes('no results');
    return lists.length > 10 || noResults;
  }, { timeout: 20000 }).catch(() => null);

  await randomDelay(1000, 2000);

  // Try to click "More flights" / "View more" button to get all results
  await _expandMoreFlights(page);
  await randomDelay(500, 1000);

  // Extract flight data from DOM
  const extracted = await _extractFlights(page, origin, destination, date, currency);
  console.log(`[flights-scraper] Extracted ${extracted.flights.length} flights`);
  return extracted;
}

async function _setOneWay(page) {
  try {
    // Click the trip type dropdown (Round trip / One way)
    const tripTypeBtn = await page.$('[aria-label*="trip" i], [aria-label*="Round" i], [data-value="1"]');
    if (tripTypeBtn) {
      await tripTypeBtn.click();
      await randomDelay(300, 500);
      // Select "One way" from dropdown
      await page.evaluate(() => {
        const items = document.querySelectorAll('li, [role="option"], [data-value="2"]');
        for (const item of items) {
          const text = item.textContent.trim().toLowerCase();
          if (text.includes('one way') || text.includes('one-way')) {
            item.click();
            return;
          }
        }
      });
      await randomDelay(200, 400);
    }
  } catch (e) {
    console.warn('[flights-scraper] Could not set one-way:', e.message);
  }
}

async function _fillAirportField(page, type, code) {
  // type is 'origin' or 'destination'
  const isOrigin = type === 'origin';

  // Find the input fields — Google Flights has "Where from?" and "Where to?" inputs
  const selectors = isOrigin
    ? ['input[aria-label*="Where from" i]', 'input[aria-label*="from" i]', 'input[placeholder*="from" i]']
    : ['input[aria-label*="Where to" i]', 'input[aria-label*="to" i]', 'input[placeholder*="to" i]'];

  let input = null;
  for (const sel of selectors) {
    input = await page.$(sel);
    if (input) break;
  }

  if (!input) {
    // Fallback: click on the origin/destination area by index
    const allInputs = await page.$$('input[type="text"], input:not([type])');
    input = isOrigin ? allInputs[0] : allInputs[1];
  }

  if (!input) {
    console.warn(`[flights-scraper] Could not find ${type} input`);
    return;
  }

  // Clear existing value and type the airport code
  await input.click({ clickCount: 3 });
  await randomDelay(100, 200);
  await input.press('Backspace');
  await randomDelay(100, 200);
  await input.type(code, { delay: 50 + Math.random() * 50 });
  await randomDelay(500, 1000);

  // Wait for autocomplete dropdown and select first match
  await page.waitForSelector('ul[role="listbox"] li, [role="option"]', { timeout: 5000 }).catch(() => null);
  await randomDelay(200, 400);

  // Click first suggestion
  const suggestion = await page.$('ul[role="listbox"] li:first-child, [role="option"]:first-child');
  if (suggestion) {
    await suggestion.click();
  } else {
    await input.press('Enter');
  }
  await randomDelay(200, 400);
}

async function _setDate(page, dateStr) {
  try {
    // Click the departure date field
    const dateInput = await page.$('input[aria-label*="Departure" i], input[placeholder*="Departure" i], [data-type="date"]');
    if (dateInput) {
      await dateInput.click();
      await randomDelay(300, 500);
      await dateInput.click({ clickCount: 3 });
      await dateInput.type(dateStr, { delay: 30 });
      await randomDelay(200, 400);
    } else {
      // Try clicking the date area in the search bar
      await page.evaluate((d) => {
        const els = document.querySelectorAll('[data-type], [jsaction*="date"]');
        for (const el of els) {
          if (el.textContent?.includes('Depart') || el.getAttribute('aria-label')?.includes('Depart')) {
            el.click();
            return;
          }
        }
      }, dateStr);
      await randomDelay(500, 800);
    }

    // Try to find and fill date in calendar/date picker
    await page.evaluate((dateStr) => {
      // Look for date input that appeared
      const inputs = document.querySelectorAll('input[type="text"], input[type="date"], input[aria-label*="date" i]');
      for (const inp of inputs) {
        const label = (inp.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('depart') || label.includes('date')) {
          inp.value = '';
          inp.focus();
          document.execCommand('selectAll');
          document.execCommand('insertText', false, dateStr);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
      }
    }, dateStr);
    await randomDelay(300, 600);

    // Press Enter or click Done to confirm date
    await page.keyboard.press('Enter');
    await randomDelay(200, 400);

    // Click "Done" button if present (date picker confirmation)
    const doneBtn = await page.$('button[aria-label="Done" i], button:has-text("Done")');
    if (doneBtn) {
      await doneBtn.click();
      await randomDelay(200, 400);
    }
  } catch (e) {
    console.warn('[flights-scraper] Date setting error:', e.message);
  }
}

async function _clickSearch(page) {
  try {
    // Find the search button
    const searchSelectors = [
      'button[aria-label*="Search" i]',
      'button[aria-label*="Explore" i]',
      'button[jsaction*="search" i]',
    ];

    for (const sel of searchSelectors) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await randomDelay(500, 1000);
        return;
      }
    }

    // Fallback: find button with "Search" text
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const b of buttons) {
        if (b.textContent.trim().toLowerCase().includes('search')) {
          b.click();
          return;
        }
      }
    });
  } catch (e) {
    console.warn('[flights-scraper] Search click error:', e.message);
  }
}

async function _expandMoreFlights(page) {
  try {
    const expanded = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const b of buttons) {
        const text = b.textContent.trim().toLowerCase();
        if (text.includes('more flight') || text.includes('show more') || text.includes('view more')) {
          b.click();
          return true;
        }
      }
      return false;
    });
    if (expanded) {
      await randomDelay(1000, 2000);
    }
  } catch {}
}

async function _extractFlights(page, origin, destination, date, currency) {
  const data = await page.evaluate((origin, destination, date) => {
    const results = [];
    const carriers = {};

    // Google Flights renders flight cards in <li> elements within lists
    // Each card contains: airline, times, duration, stops, price
    const cards = document.querySelectorAll('li');

    for (const card of cards) {
      const text = card.innerText || '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

      // A valid flight card typically has a price (contains currency symbol or number with comma)
      const priceMatch = text.match(/(?:€|£|\$|₹|¥|kr|R\$|CHF|USD|EUR|INR|GBP)\s*[\d,.]+|[\d,.]+\s*(?:€|£|\$|₹|¥|kr|R\$|CHF|USD|EUR|INR|GBP)/);
      if (!priceMatch) continue;

      // Must have time pattern (e.g., "6:30 AM", "14:20", "6:30 PM")
      const timePattern = /\d{1,2}:\d{2}\s*(?:AM|PM)?/gi;
      const times = text.match(timePattern);
      if (!times || times.length < 2) continue;

      // Extract airline name — usually the first meaningful line
      let airlineName = '';
      let airlineLogo = null;
      for (const line of lines) {
        // Skip lines that are just times, prices, or duration
        if (/^\d{1,2}:\d{2}/.test(line)) continue;
        if (/^[€$£₹¥]/.test(line) || /^\d+[,.]?\d*\s*[€$£]/.test(line)) continue;
        if (/^\d+h/.test(line) || /^hr|^min/i.test(line)) continue;
        if (/^Nonstop|^\d+ stop/i.test(line)) continue;
        if (line.length > 3 && line.length < 50 && /^[A-Z]/.test(line)) {
          airlineName = line;
          break;
        }
      }

      // Extract logo from img element
      const img = card.querySelector('img[alt], img[src*="airline"], img[src*="logo"]');
      if (img) {
        airlineLogo = img.src || null;
        if (!airlineName && img.alt) airlineName = img.alt;
      }

      // Extract departure and arrival times
      const depTime = times[0].trim();
      const arrTime = times[1].trim();

      // Extract duration (e.g., "2 hr 30 min", "2h 30m", "1 hr 15 min")
      const durationMatch = text.match(/(\d+)\s*(?:hr?|hour)[\s,]*(?:(\d+)\s*(?:min?|m))?/i) ||
        text.match(/(\d+)h\s*(\d+)?m?/i);
      let durationMinutes = 0;
      if (durationMatch) {
        durationMinutes = parseInt(durationMatch[1]) * 60 + (parseInt(durationMatch[2]) || 0);
      }

      // Extract stops
      const stopsMatch = text.match(/Nonstop|(\d+)\s*stop/i);
      let stops = 0;
      if (stopsMatch && stopsMatch[1]) {
        stops = parseInt(stopsMatch[1]);
      }

      // Extract stop airport codes (if any)
      const layoverAirports = [];
      if (stops > 0) {
        const codeMatches = text.match(/\b([A-Z]{3})\b/g);
        if (codeMatches) {
          for (const c of codeMatches) {
            if (c !== origin.toUpperCase() && c !== destination.toUpperCase() && layoverAirports.length < stops) {
              layoverAirports.push(c);
            }
          }
        }
      }

      // Extract price as raw number
      const rawPrice = priceMatch[0].replace(/[^0-9.,]/g, '').replace(/,/g, '');
      const price = parseFloat(rawPrice);
      if (isNaN(price) || price <= 0) continue;

      // Extract departure/arrival airport codes from text
      const airportCodes = text.match(/\b[A-Z]{3}\b/g) || [];
      const depAirport = airportCodes[0] || origin;
      const arrAirport = airportCodes.find((c, i) => i > 0 && c !== depAirport) || destination;

      results.push({
        airlineName: airlineName || 'Unknown',
        airlineLogo,
        depTime,
        arrTime,
        durationMinutes,
        stops,
        layoverAirports,
        price,
        depAirport,
        arrAirport,
      });
    }

    // Detect actual currency symbol on page
    let detectedSymbol = null;
    const bodyText = document.body?.innerText || '';
    const symMatch = bodyText.match(/(€|₹|£|\$|¥|kr|R\$|CHF|zł|₺)\s*[\d,.]+/);
    if (symMatch) detectedSymbol = symMatch[1];
    if (!detectedSymbol) {
      const suffMatch = bodyText.match(/[\d,.]+\s*(€|₹|£|\$|¥|kr|R\$|CHF|zł|₺)/);
      if (suffMatch) detectedSymbol = suffMatch[1];
    }

    return { results, carriers, detectedSymbol };
  }, origin, destination, date);

  // Post-process extracted data into the expected format
  const flights = [];
  const carriers = {};
  const totalResults = data.results || [];

  for (const r of totalResults) {
    const airlineCode = (r.airlineName || 'XX').slice(0, 2).toUpperCase();
    if (airlineCode && r.airlineName) carriers[airlineCode] = r.airlineName;

    // Convert times to ISO format with the date
    const depIso = _timeToIso(date, r.depTime);
    const arrIso = _timeToIso(date, r.arrTime, r.durationMinutes);
    const durationStr = minutesToPTDuration(r.durationMinutes || 120);

    const layovers = (r.layoverAirports || []).map(code => ({
      airportCode: code,
      durationMinutes: 0,
      durationText: '',
    }));

    // Build a single segment (simplified — we don't have per-segment data from DOM)
    const segments = [{
      from: r.depAirport || origin,
      to: r.arrAirport || destination,
      departure: depIso,
      arrival: arrIso,
      airline: airlineCode,
      flightNumber: `${airlineCode}${1000 + flights.length}`,
      duration: durationStr,
    }];

    const idStr = `scrape-${r.depAirport}${r.arrAirport}${date}${depIso}${arrIso}${r.stops}`;
    const id = crypto.createHash('md5').update(idStr).digest('hex').slice(0, 12);

    flights.push({
      id,
      price: Math.round(r.price * 100) / 100,
      currency: 'EUR', // Already converted or will be converted by caller
      airline: airlineCode,
      airlineName: r.airlineName || 'Unknown',
      airlineLogo: r.airlineLogo || null,
      departure: depIso,
      arrival: arrIso,
      departureTerminal: '',
      arrivalTerminal: '',
      duration: durationStr,
      stops: r.stops || 0,
      layovers,
      segments,
    });
  }

  // Detect actual page currency
  const SYMBOL_TO_CODE = {
    '€': 'EUR', '$': 'USD', '£': 'GBP', '₹': 'INR', '¥': 'JPY',
    'kr': 'SEK', 'R$': 'BRL', 'CHF': 'CHF', 'zł': 'PLN', '₺': 'TRY',
  };
  let detectedCurrency = currency;
  if (data.detectedSymbol && SYMBOL_TO_CODE[data.detectedSymbol]) {
    detectedCurrency = SYMBOL_TO_CODE[data.detectedSymbol];
    if (detectedCurrency !== currency) {
      console.log(`[flights-scraper] Page shows ${data.detectedSymbol} (${detectedCurrency}), requested ${currency}`);
    }
  }

  // Sort by price
  flights.sort((a, b) => a.price - b.price);

  return { flights, carriers, detectedCurrency };
}

// Convert "6:30 AM" or "14:20" + date to ISO string
function _timeToIso(dateStr, timeStr, durationMinutes) {
  if (!timeStr) return '';

  let hours, minutes;
  const match12 = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  const match24 = timeStr.match(/(\d{1,2}):(\d{2})/);

  if (match12) {
    hours = parseInt(match12[1]);
    minutes = parseInt(match12[2]);
    const period = match12[3].toUpperCase();
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
  } else if (match24) {
    hours = parseInt(match24[1]);
    minutes = parseInt(match24[2]);
  } else {
    return '';
  }

  // For arrival time, if duration is given and would push past midnight, advance the date
  let d = new Date(`${dateStr}T00:00:00`);
  if (durationMinutes) {
    // This is an arrival — calculate from departure context
    // Just set the time on the same date; the client handles overnight detection
  }

  const h = String(hours).padStart(2, '0');
  const m = String(minutes).padStart(2, '0');
  return `${dateStr}T${h}:${m}:00`;
}

module.exports = { scrapeFlights };
