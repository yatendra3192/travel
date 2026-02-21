const Utils = {
  displayCurrency: 'INR',
  _formatters: {},

  // Rates relative to EUR (1 EUR = X units)
  EXCHANGE_RATES: {
    EUR: 1, INR: 91, USD: 1.09, GBP: 0.86, JPY: 163, AED: 4.0,
    CHF: 0.96, CAD: 1.48, AUD: 1.65, SGD: 1.46, THB: 37.5,
    MYR: 4.75, CNY: 7.85, KRW: 1420, SAR: 4.09, BRL: 5.3,
    SEK: 11.2, NOK: 11.5, DKK: 7.46, PLN: 4.35, CZK: 25.2,
    HUF: 395, TRY: 35, ZAR: 19.5, NZD: 1.78, HKD: 8.5,
    TWD: 34.5, PHP: 61, IDR: 17200, VND: 27000, EGP: 53,
    QAR: 3.97, BHD: 0.41, KWD: 0.33, OMR: 0.42,
  },

  convertFromEur(amount, toCurrency) {
    if (!this.EXCHANGE_RATES[toCurrency]) console.warn('Unknown currency code:', toCurrency);
    return amount * (this.EXCHANGE_RATES[toCurrency] || 1);
  },

  formatCurrency(amount, sourceCurrency = 'EUR') {
    if (amount == null || isNaN(amount)) return '--';
    const display = this.displayCurrency;
    const fromRate = this.EXCHANGE_RATES[sourceCurrency] || 1;
    const toRate = this.EXCHANGE_RATES[display] || 1;
    const converted = amount * (toRate / fromRate);
    // Cache Intl.NumberFormat instances for performance
    const locale = display === 'INR' ? 'en-IN' : 'en-US';
    const key = `${locale}:${display}`;
    if (!this._formatters[key]) {
      this._formatters[key] = new Intl.NumberFormat(locale, { style: 'currency', currency: display, maximumFractionDigits: 0 });
    }
    return this._formatters[key].format(converted);
  },

  formatCurrencyRange(low, high, sourceCurrency = 'EUR') {
    if (low === high) return Utils.formatCurrency(low, sourceCurrency);
    return `${Utils.formatCurrency(low, sourceCurrency)} - ${Utils.formatCurrency(high, sourceCurrency)}`;
  },

  formatDuration(isoDuration) {
    if (!isoDuration) return '--';
    const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    if (!match) return isoDuration;
    const h = match[1] || '0';
    const m = match[2] || '0';
    return `${h}h ${m}m`;
  },

  formatTime(isoDatetime) {
    if (!isoDatetime) return '--';
    const d = new Date(isoDatetime);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  },

  formatDate(isoDate) {
    if (!isoDate) return '--';
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  },

  formatDateShort(isoDate) {
    if (!isoDate) return '--';
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  },

  addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  },

  clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  },

  formatTimeFromDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date)) return '';
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  },

  formatDateTimeFromDate(date) {
    if (!date || !(date instanceof Date) || isNaN(date)) return '';
    return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
      + ', ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  },

  parseDurationMins(text) {
    if (!text) return 30;
    let mins = 0;
    const h = text.match(/(\d+)\s*h(?:our)?s?/i);
    const m = text.match(/(\d+)\s*m/i);
    if (h) mins += parseInt(h[1]) * 60;
    if (m) mins += parseInt(m[1]);
    return mins || 30;
  },

  formatDurationShort(text) {
    if (!text) return '';
    const mins = this.parseDurationMins(text);
    if (!mins) return text;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
  },

  addMinutesToDate(date, mins) {
    return new Date(date.getTime() + mins * 60000);
  },

  extractCityName(fullPlaceName) {
    if (!fullPlaceName) return '';
    return fullPlaceName.split(',')[0].trim();
  },

  escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  },

  sanitizeColor(c) {
    if (typeof c !== 'string') return 'inherit';
    return /^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$|^rgba?\([\d\s,.]+\)$/.test(c) ? c : 'inherit';
  },

  // Fuzzy city name match — handles transliteration variants (Ahmedabad vs Ahamdabad)
  fuzzyMatchCity(a, b) {
    if (!a || !b) return false;
    const na = a.toLowerCase().replace(/[^a-z]/g, '');
    const nb = b.toLowerCase().replace(/[^a-z]/g, '');
    if (na === nb) return true;
    if (na.includes(nb) || nb.includes(na)) return true;
    // Levenshtein distance ≤ 2 for similar-length names
    if (Math.abs(na.length - nb.length) > 2) return false;
    const len = Math.max(na.length, nb.length);
    if (len < 3) return false;
    let dist = 0;
    const matrix = Array.from({ length: na.length + 1 }, (_, i) => {
      const row = new Array(nb.length + 1);
      row[0] = i;
      return row;
    });
    for (let j = 0; j <= nb.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= na.length; i++) {
      for (let j = 1; j <= nb.length; j++) {
        const cost = na[i - 1] === nb[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
      }
    }
    dist = matrix[na.length][nb.length];
    return dist <= 2;
  },

  haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },

  // Extract arrival date (YYYY-MM-DD) from a flight offer's arrival ISO datetime
  getArrivalDate(offer) {
    if (!offer?.arrival) return null;
    const d = new Date(offer.arrival);
    if (isNaN(d)) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },
};
