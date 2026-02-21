'use strict';

const puppeteer = require('puppeteer-core');
const { applyStealthToPage, dismissConsent } = require('./parser-utils');

const MAX_PAGES = 3;
const BROWSER_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

let browser = null;
let browserCreatedAt = 0;
let activePages = 0;
const waitQueue = [];

function getChromiumPath() {
  // Railway / Docker: set via env
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // Common local paths
  const platform = process.platform;
  if (platform === 'win32') {
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    ];
    const fs = require('fs');
    for (const p of paths) {
      if (p && fs.existsSync(p)) return p;
    }
  } else if (platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  } else {
    // Linux — chromium or google-chrome
    const fs = require('fs');
    for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

async function ensureBrowser() {
  const now = Date.now();
  // Retire old browser
  if (browser && (now - browserCreatedAt > BROWSER_MAX_AGE_MS)) {
    console.log('[browser-pool] Retiring browser (age exceeded 30min)');
    const old = browser;
    browser = null;
    activePages = 0;
    // Drain wait queue
    while (waitQueue.length) waitQueue.shift().reject(new Error('Browser retired'));
    try { await old.close(); } catch {}
  }

  if (browser) {
    // Check if still connected
    if (!browser.connected) {
      console.warn('[browser-pool] Browser disconnected, will relaunch');
      browser = null;
      activePages = 0;
    }
  }

  if (!browser) {
    const execPath = getChromiumPath();
    if (!execPath) {
      throw new Error('No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH env var.');
    }
    console.log(`[browser-pool] Launching browser: ${execPath}`);
    browser = await puppeteer.launch({
      executablePath: execPath,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--no-first-run',
        '--disable-sync',
        '--disable-translate',
      ],
      defaultViewport: { width: 1366, height: 768 },
    });
    browserCreatedAt = now;
    activePages = 0;
    console.log('[browser-pool] Browser launched');

    browser.on('disconnected', () => {
      console.warn('[browser-pool] Browser process disconnected');
      browser = null;
      activePages = 0;
      while (waitQueue.length) waitQueue.shift().reject(new Error('Browser crashed'));
    });
  }

  return browser;
}

// Acquire a new page (tab). Waits if MAX_PAGES reached.
async function acquirePage() {
  await ensureBrowser();

  if (activePages >= MAX_PAGES) {
    // Wait for a slot
    await new Promise((resolve, reject) => {
      waitQueue.push({ resolve, reject });
    });
  }

  activePages++;
  const page = await browser.newPage();

  // Stealth
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  await page.setUserAgent(ua);
  await applyStealthToPage(page);

  // Block images/fonts/media to speed up loading
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
      req.abort();
    } else {
      req.continue();
    }
  });

  return page;
}

// Release a page back to the pool
async function releasePage(page) {
  activePages = Math.max(0, activePages - 1);
  try { await page.close(); } catch {}
  // Wake up next waiter
  if (waitQueue.length > 0) {
    waitQueue.shift().resolve();
  }
}

// Graceful shutdown
async function shutdown() {
  console.log('[browser-pool] Shutting down...');
  while (waitQueue.length) waitQueue.shift().reject(new Error('Shutting down'));
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
  }
  activePages = 0;
}

module.exports = { acquirePage, releasePage, shutdown };
