'use strict';

// Parse price string like "$123", "€45", "1,234 EUR", "Rs. 5,000" → number
function parsePrice(text) {
  if (!text) return 0;
  const cleaned = text.replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// Parse duration string like "2h 30m", "1 hr 15 min", "3h", "45m" → total minutes
function parseDurationToMinutes(text) {
  if (!text) return 0;
  let total = 0;
  const hourMatch = text.match(/(\d+)\s*(?:h|hr|hour)/i);
  const minMatch = text.match(/(\d+)\s*(?:m|min)/i);
  if (hourMatch) total += parseInt(hourMatch[1]) * 60;
  if (minMatch) total += parseInt(minMatch[1]);
  // If only a bare number, assume minutes
  if (!hourMatch && !minMatch) {
    const bare = parseInt(text);
    if (!isNaN(bare)) total = bare;
  }
  return total;
}

// Convert minutes to ISO 8601 duration: 150 → "PT2H30M"
function minutesToPTDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h}H${m}M`;
}

// Random delay between min and max ms
function randomDelay(min = 200, max = 800) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(r => setTimeout(r, ms));
}

// Dismiss Google cookie consent popup (GDPR banner)
async function dismissConsent(page) {
  try {
    // Wait briefly for consent dialog
    await page.waitForSelector(
      'button[aria-label="Accept all"], button[aria-label="Reject all"], form[action*="consent"] button, [aria-label="Before you continue"]',
      { timeout: 3000 }
    ).catch(() => null);

    // Try multiple consent button selectors
    const selectors = [
      'button[aria-label="Accept all"]',
      'button[aria-label="Reject all"]',
      // Google consent form buttons — "Accept all" or "Reject all"
      'form[action*="consent"] button:first-of-type',
      // Fallback: any button containing "Accept" or "Agree" text
    ];

    for (const sel of selectors) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await randomDelay(500, 1000);
        return true;
      }
    }

    // Text-based fallback: find button with Accept/Agree/Consent text
    const dismissed = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const b of buttons) {
        const text = b.textContent.trim().toLowerCase();
        if (text.includes('accept') || text.includes('agree') || text.includes('consent')) {
          b.click();
          return true;
        }
      }
      return false;
    });
    return dismissed;
  } catch {
    return false;
  }
}

// Check if page hit a CAPTCHA
async function detectCaptcha(page) {
  try {
    const hasCaptcha = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      return body.includes('unusual traffic') ||
        body.includes('CAPTCHA') ||
        body.includes('are not a robot') ||
        !!document.querySelector('iframe[src*="recaptcha"]') ||
        !!document.querySelector('#captcha-form');
    });
    return hasCaptcha;
  } catch {
    return false;
  }
}

// Apply stealth patches to a page
async function applyStealthToPage(page) {
  await page.evaluateOnNewDocument(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // Fake plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    // Fake languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });
    // Chrome runtime
    window.chrome = { runtime: {} };
  });
}

module.exports = {
  parsePrice,
  parseDurationToMinutes,
  minutesToPTDuration,
  randomDelay,
  dismissConsent,
  detectCaptcha,
  applyStealthToPage,
};
