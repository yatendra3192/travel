const Utils = {
  displayCurrency: 'INR',

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
    return amount * (this.EXCHANGE_RATES[toCurrency] || 1);
  },

  formatCurrency(amount, sourceCurrency = 'EUR') {
    if (amount == null || isNaN(amount)) return '--';
    const display = this.displayCurrency;
    // Convert from source to display currency
    const fromRate = this.EXCHANGE_RATES[sourceCurrency] || 1;
    const toRate = this.EXCHANGE_RATES[display] || 1;
    const converted = amount * (toRate / fromRate);
    const opts = { style: 'currency', currency: display, maximumFractionDigits: 0 };
    if (display === 'INR') {
      return new Intl.NumberFormat('en-IN', opts).format(converted);
    }
    return new Intl.NumberFormat('en-US', opts).format(converted);
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
    return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  },

  formatDateShort(isoDate) {
    if (!isoDate) return '--';
    const d = new Date(isoDate + 'T00:00:00');
    return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
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
    const h = text.match(/(\d+)\s*h/i);
    const m = text.match(/(\d+)\s*m/i);
    if (h) mins += parseInt(h[1]) * 60;
    if (m) mins += parseInt(m[1]);
    return mins || 30;
  },

  addMinutesToDate(date, mins) {
    return new Date(date.getTime() + mins * 60000);
  },

  extractCityName(fullPlaceName) {
    if (!fullPlaceName) return '';
    return fullPlaceName.split(',')[0].trim();
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
