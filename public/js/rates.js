/* Shared transfer rate constants — used by both server and frontend.
   Edit this file to update taxi/public transport rates in one place. */
(function (root) {
  const TravelRates = {
    TAXI_RATES: {
      'IN': { perKm: 0.30, baseFare: 2.50 },
      'NL': { perKm: 2.20, baseFare: 3.00 },
      'BE': { perKm: 1.80, baseFare: 2.50 },
      'FR': { perKm: 1.50, baseFare: 2.50 },
      'ES': { perKm: 1.10, baseFare: 2.50 },
      'DE': { perKm: 2.00, baseFare: 3.50 },
      'IT': { perKm: 1.30, baseFare: 3.00 },
      'GB': { perKm: 2.50, baseFare: 3.50 },
      'CH': { perKm: 3.50, baseFare: 6.00 },
      'AT': { perKm: 1.50, baseFare: 3.00 },
      'PT': { perKm: 0.90, baseFare: 2.00 },
      'GR': { perKm: 0.80, baseFare: 1.50 },
      'US': { perKm: 2.00, baseFare: 3.00 },
      'AE': { perKm: 0.50, baseFare: 3.00 },
      'JP': { perKm: 3.00, baseFare: 5.00 },
      'AU': { perKm: 1.80, baseFare: 3.50 },
      'TR': { perKm: 0.50, baseFare: 1.50 },
      'TH': { perKm: 0.30, baseFare: 1.00 },
      'DEFAULT': { perKm: 1.50, baseFare: 3.00 },
    },

    PUBLIC_TRANSPORT_RATES: {
      'IN': 0.05, 'NL': 0.15, 'BE': 0.12, 'FR': 0.10, 'ES': 0.08,
      'DE': 0.12, 'IT': 0.08, 'GB': 0.15, 'CH': 0.20, 'AT': 0.10,
      'PT': 0.06, 'GR': 0.05, 'US': 0.10, 'AE': 0.08, 'JP': 0.15,
      'AU': 0.12, 'TR': 0.04, 'TH': 0.03, 'DEFAULT': 0.10,
    },

    getTaxiRate(country) {
      return this.TAXI_RATES[country] || this.TAXI_RATES['DEFAULT'];
    },

    getPublicTransportRate(country) {
      return this.PUBLIC_TRANSPORT_RATES[country] || this.PUBLIC_TRANSPORT_RATES['DEFAULT'];
    },
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TravelRates;
  } else {
    root.TravelRates = TravelRates;
  }
})(typeof window !== 'undefined' ? window : this);
