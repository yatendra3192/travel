'use strict';

const crypto = require('crypto');
const { acquirePage, releasePage } = require('./browser-pool');
const {
  parsePrice, randomDelay, dismissConsent, detectCaptcha,
} = require('./parser-utils');

const MAX_RETRIES = 2;
const NAV_TIMEOUT = 45000;

// Map currency symbols to ISO codes
const SYMBOL_TO_CODE = {
  '€': 'EUR', '$': 'USD', '£': 'GBP', '₹': 'INR', '¥': 'JPY',
  'kr': 'SEK', 'R$': 'BRL', 'CHF': 'CHF', 'zł': 'PLN', '₺': 'TRY',
  'Kč': 'CZK', 'Ft': 'HUF', '₩': 'KRW', '฿': 'THB', '₫': 'VND',
  'RM': 'MYR', 'R': 'ZAR', '₱': 'PHP', 'lei': 'RON', 'лв': 'BGN',
};

async function scrapeHotels(query, checkIn, checkOut, currency = 'EUR') {
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let page = null;
    try {
      if (attempt > 0) {
        const delay = 2000 * Math.pow(2, attempt - 1);
        console.log(`[hotels-scraper] Retry ${attempt}/${MAX_RETRIES} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }

      page = await acquirePage();
      page.setDefaultNavigationTimeout(NAV_TIMEOUT);
      page.setDefaultTimeout(15000);

      const result = await _scrapeHotelsOnPage(page, query, checkIn, checkOut, currency);
      await releasePage(page);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[hotels-scraper] Attempt ${attempt} failed: ${err.message}`);
      if (page) {
        const captcha = await detectCaptcha(page).catch(() => false);
        await releasePage(page);
        if (captcha) {
          console.warn('[hotels-scraper] CAPTCHA detected, waiting 30s...');
          await new Promise(r => setTimeout(r, 30000));
        }
      }
    }
  }

  console.error(`[hotels-scraper] All attempts failed: ${lastError?.message}`);
  throw lastError || new Error('Hotel scraping failed');
}

async function _scrapeHotelsOnPage(page, query, checkIn, checkOut, currency) {
  const params = new URLSearchParams({
    q: query,
    dates: `${checkIn},${checkOut}`,
    curr: currency,
    hl: 'en',
  });
  const url = `https://www.google.com/travel/hotels?${params.toString()}`;

  console.log(`[hotels-scraper] Navigating: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
  await dismissConsent(page);
  await randomDelay(1000, 2000);

  console.log('[hotels-scraper] Waiting for hotel results...');
  await page.waitForFunction(() => {
    const links = document.querySelectorAll('a[href*="hotel"]');
    const text = document.body?.innerText || '';
    return links.length > 2 || text.includes('No results') || text.includes('no hotels');
  }, { timeout: 15000 }).catch(() => null);

  await randomDelay(1000, 2000);

  const extracted = await _extractHotels(page, currency);
  console.log(`[hotels-scraper] Extracted ${extracted.hotels.length} hotels (detectedCurrency: ${extracted.detectedCurrency})`);
  return extracted;
}

// Names that are clearly UI elements, not hotels
const UI_JUNK_PATTERNS = [
  /^all\s*filters?$/i,
  /^\d\+\s*(?:rating|star)/i,
  /^sort\s*by/i,
  /^price/i,
  /^guest\s*rating/i,
  /^hotel\s*class/i,
  /^amenities/i,
  /^brands?$/i,
  /^free\s*cancellation$/i,
  /^view\s*(?:more|all|map|list|deal)/i,
  /^show\s*(?:more|all)/i,
  /^clear\s*all$/i,
  /^sponsored$/i,
  /^ad$/i,
  /^map\s*area$/i,
  /^check.in|check.out/i,
  /^nearby|popular/i,
  /^under\s*[€$£₹¥₺]/i,
  /^over\s*[€$£₹¥₺]/i,
  /^[€$£₹¥₺]\s*\d/i,
  /^\d[\d,.]*\s*[-–]\s*[€$£₹¥₺]?\d/i,
];

function isJunkName(name) {
  if (!name || name.length < 4 || name.length > 120) return true;
  return UI_JUNK_PATTERNS.some(p => p.test(name));
}

async function _extractHotels(page, requestedCurrency) {
  const data = await page.evaluate(() => {
    const results = [];
    const processedNames = new Set();
    let detectedSymbol = null;

    // Detect the currency symbol used on this page by scanning price patterns
    const bodyText = document.body?.innerText || '';
    const symbolMatch = bodyText.match(/(€|₹|£|\$|¥|kr|R\$|CHF|zł|₺|Kč|Ft|₩|฿|₫|RM|lei|лв)\s*[\d,.]+/);
    if (symbolMatch) detectedSymbol = symbolMatch[1];
    // Also check suffix pattern: "1,234 €"
    if (!detectedSymbol) {
      const suffixMatch = bodyText.match(/[\d,.]+\s*(€|₹|£|\$|¥|kr|R\$|CHF|zł|₺)/);
      if (suffixMatch) detectedSymbol = suffixMatch[1];
    }

    // Strategy: find anchor links to individual hotel pages — these are the actual hotel cards
    const hotelAnchors = document.querySelectorAll('a[href*="/travel/hotels/entity"]');

    for (const anchor of hotelAnchors) {
      // Walk up to the card container (usually 2-4 levels up)
      let card = anchor;
      for (let i = 0; i < 6; i++) {
        if (!card.parentElement) break;
        card = card.parentElement;
        const text = card.innerText || '';
        // Stop when we find a container with enough content (name + price)
        if (text.length > 30 && text.length < 1200) break;
      }

      const text = card.innerText || '';
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

      // Must have a price
      const priceMatch = text.match(/(?:€|£|\$|₹|¥|kr|R\$|CHF|zł|₺)\s*[\d,.]+|[\d,.]+\s*(?:€|£|\$|₹|¥|kr|R\$|CHF|zł|₺)/);
      if (!priceMatch) continue;

      // Extract hotel name — first substantive line
      let name = '';
      for (const line of lines) {
        // Skip prices, ratings, review counts, and short labels
        if (/^[€$£₹¥₺]/.test(line)) continue;
        if (/^\d+\.?\d*$/.test(line)) continue;
        if (/^★/.test(line)) continue;
        if (line.length < 4) continue;
        if (/per night|total|nightly/i.test(line)) continue;
        if (/^[\d,.]+ reviews?/i.test(line)) continue;
        if (/^\(\d/.test(line)) continue;
        if (/^Prices? (from|start)/i.test(line)) continue;
        name = line;
        break;
      }

      if (!name || processedNames.has(name)) continue;
      processedNames.add(name);

      // Parse price
      const rawPrice = priceMatch[0].replace(/[^0-9.,]/g, '').replace(/,/g, '');
      const price = parseFloat(rawPrice);
      if (isNaN(price) || price <= 0) continue;

      // Parse rating (e.g., "4.3" near star or review count)
      let rating = null;
      const ratingMatch = text.match(/(\d\.\d)\s*(?:★|\(|\/)/i) || text.match(/(\d\.\d)\s/);
      if (ratingMatch) {
        const r = parseFloat(ratingMatch[1]);
        if (r >= 1.0 && r <= 5.0) rating = r;
      }

      // Parse review count
      let reviewCount = null;
      const reviewMatch = text.match(/\(?([\d,]+)\)?\s*review/i) || text.match(/\(([\d,]+)\)/);
      if (reviewMatch) {
        reviewCount = parseInt(reviewMatch[1].replace(/,/g, ''));
        if (reviewCount > 100000) reviewCount = null; // sanity check
      }

      // Hotel class (star rating)
      const classMatch = text.match(/(\d)-star/i);
      const hotelClass = classMatch ? parseInt(classMatch[1]) : null;

      // Photo URL
      let photoUrl = null;
      const img = card.querySelector('img[src*="http"]');
      if (img && !img.src.includes('gstatic.com/images/travel/tips')) photoUrl = img.src;

      // Listing URL
      const listingUrl = anchor.href || null;

      results.push({ name, price, rating, reviewCount, hotelClass, photoUrl, listingUrl });
    }

    // Fallback: if no entity links found, try generic div scanning
    if (results.length === 0) {
      const allDivs = document.querySelectorAll('div');
      for (const div of allDivs) {
        const text = div.innerText || '';
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

        if (text.length < 30 || text.length > 800) continue;

        const priceMatch = text.match(/(?:€|£|\$|₹|¥|kr|R\$|CHF|zł|₺)\s*[\d,.]+|[\d,.]+\s*(?:€|£|\$|₹|¥|kr|R\$|CHF|zł|₺)/);
        if (!priceMatch) continue;

        // Require a rating or review pattern to distinguish from random divs
        if (!/\d\.\d/.test(text) && !/review/i.test(text) && !/star/i.test(text)) continue;

        let name = '';
        for (const line of lines) {
          if (/^[€$£₹¥₺]/.test(line)) continue;
          if (/^\d+\.?\d*$/.test(line)) continue;
          if (line.length < 4 || line.length > 100) continue;
          if (/per night|total|nightly/i.test(line)) continue;
          if (/^[\d,.]+ reviews?/i.test(line)) continue;
          if (/^\(\d/.test(line)) continue;
          name = line;
          break;
        }

        if (!name || processedNames.has(name)) continue;
        processedNames.add(name);

        const rawPrice = priceMatch[0].replace(/[^0-9.,]/g, '').replace(/,/g, '');
        const price = parseFloat(rawPrice);
        if (isNaN(price) || price <= 0) continue;

        let rating = null;
        const rm = text.match(/(\d\.\d)/);
        if (rm) {
          const r = parseFloat(rm[1]);
          if (r >= 1.0 && r <= 5.0) rating = r;
        }

        let reviewCount = null;
        const revm = text.match(/\(?([\d,]+)\)?\s*review/i);
        if (revm) reviewCount = parseInt(revm[1].replace(/,/g, ''));

        const classMatch = text.match(/(\d)-star/i);
        const hotelClass = classMatch ? parseInt(classMatch[1]) : null;

        let photoUrl = null;
        const img = div.querySelector('img[src*="http"]');
        if (img && !img.src.includes('gstatic.com/images/travel/tips')) photoUrl = img.src;

        results.push({ name, price, rating, reviewCount, hotelClass, photoUrl, listingUrl: null });
      }
    }

    return { results, detectedSymbol };
  });

  // Determine the actual currency displayed on the page
  let detectedCurrency = requestedCurrency;
  if (data.detectedSymbol && SYMBOL_TO_CODE[data.detectedSymbol]) {
    detectedCurrency = SYMBOL_TO_CODE[data.detectedSymbol];
    if (detectedCurrency !== requestedCurrency) {
      console.log(`[hotels-scraper] Page shows ${data.detectedSymbol} (${detectedCurrency}), requested ${requestedCurrency}`);
    }
  }

  // Post-process into expected format, filtering junk names
  const hotels = [];
  const seen = new Set();

  for (const h of (data.results || [])) {
    if (seen.has(h.name)) continue;
    if (isJunkName(h.name)) continue;
    seen.add(h.name);

    const hotelId = 'SH' + crypto.createHash('md5').update(h.name).digest('hex').slice(0, 8);

    hotels.push({
      hotelId,
      name: h.name,
      pricePerNight: Math.round(h.price * 100) / 100,
      rating: h.rating || null,
      reviewCount: h.reviewCount || null,
      photoUrl: h.photoUrl || null,
      distance: null,
      listingUrl: h.listingUrl || null,
      hotelClass: h.hotelClass || null,
      source: 'live',
    });
  }

  // Filter unreasonable prices
  const filtered = hotels.filter(h => h.pricePerNight > 0 && h.pricePerNight < 500000);

  return { hotels: filtered.slice(0, 10), detectedCurrency };
}

module.exports = { scrapeHotels };
