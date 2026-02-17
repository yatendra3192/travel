const Api = {
  async resolveIata(cityName, lat, lng) {
    const params = new URLSearchParams({ keyword: cityName });
    if (lat != null && lng != null) {
      params.set('lat', String(lat));
      params.set('lng', String(lng));
    }
    const resp = await fetch(`/api/resolve-iata?${params}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || `Failed to resolve IATA for "${cityName}"`);
    }
    return resp.json();
  },

  async searchFlights(origin, destination, date, adults, children, fromCity, toCity) {
    const params = new URLSearchParams({
      origin, destination, date,
      adults: String(adults || 1),
      children: String(children || 0)
    });
    if (fromCity) params.set('fromCity', fromCity);
    if (toCity) params.set('toCity', toCity);
    const resp = await fetch(`/api/flights?${params}`);
    const data = await resp.json().catch(() => ({ flights: [], carriers: {} }));
    if (data.error) console.warn('Flights API:', data.error);
    return data;
  },

  async listHotels(cityCode) {
    const params = new URLSearchParams({ cityCode });
    const resp = await fetch(`/api/hotels/list?${params}`);
    const data = await resp.json().catch(() => ({ hotels: [] }));
    if (data.error) console.warn('Hotels list API:', data.error);
    return data;
  },

  async getHotelOffers(hotelIds, checkIn, checkOut, adults) {
    const params = new URLSearchParams({
      hotelIds: hotelIds.join(','),
      checkIn, checkOut,
      adults: String(adults || 1)
    });
    const resp = await fetch(`/api/hotels/offers?${params}`);
    const data = await resp.json().catch(() => ({ offers: [] }));
    if (data.error) console.warn('Hotel offers API:', data.error);
    return data;
  },

  async listHotelsByGeocode(latitude, longitude, radius) {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      radius: String(radius || 5),
    });
    const resp = await fetch(`/api/hotels/list-by-geocode?${params}`);
    const data = await resp.json().catch(() => ({ hotels: [] }));
    if (data.error) console.warn('Hotels geocode API:', data.error);
    return data;
  },

  async getMealCosts(cityCode, countryCode, layovers) {
    const params = new URLSearchParams();
    if (cityCode) params.set('cityCode', cityCode);
    if (countryCode) params.set('countryCode', countryCode);
    if (layovers && layovers.length > 0) params.set('layovers', JSON.stringify(layovers));
    const resp = await fetch(`/api/meal-costs?${params}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Meal costs failed');
    }
    return resp.json();
  },

  async getTransferEstimate(originLat, originLng, destLat, destLng, country, originText, destText, departureDate) {
    const params = new URLSearchParams({
      originLat: String(originLat),
      originLng: String(originLng),
      destLat: String(destLat),
      destLng: String(destLng),
      country: country || '',
    });
    if (originText) params.set('originText', originText);
    if (destText) params.set('destText', destText);
    if (departureDate) params.set('departureDate', departureDate);
    const resp = await fetch(`/api/transfer-estimate?${params}`);
    if (!resp.ok) return null;
    return resp.json();
  },

  async getNearbyAirports(lat, lng) {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    const resp = await fetch(`/api/nearby-airports?${params}`);
    const data = await resp.json().catch(() => ({ airports: [] }));
    return data.airports || [];
  },

  async searchAirports(query) {
    const params = new URLSearchParams({ q: query });
    const resp = await fetch(`/api/search-airports?${params}`);
    const data = await resp.json().catch(() => ({ airports: [] }));
    return data.airports || [];
  }
};
