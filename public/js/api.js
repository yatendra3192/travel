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

  async searchFlights(origin, destination, date, adults, children) {
    const params = new URLSearchParams({
      origin, destination, date,
      adults: String(adults || 1),
      children: String(children || 0)
    });
    const resp = await fetch(`/api/flights?${params}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Flight search failed');
    }
    return resp.json();
  },

  async listHotels(cityCode) {
    const params = new URLSearchParams({ cityCode });
    const resp = await fetch(`/api/hotels/list?${params}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Hotel list failed');
    }
    return resp.json();
  },

  async getHotelOffers(hotelIds, checkIn, checkOut, adults) {
    const params = new URLSearchParams({
      hotelIds: hotelIds.join(','),
      checkIn, checkOut,
      adults: String(adults || 1)
    });
    const resp = await fetch(`/api/hotels/offers?${params}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Hotel offers failed');
    }
    return resp.json();
  },

  async listHotelsByGeocode(latitude, longitude, radius) {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      radius: String(radius || 5),
    });
    const resp = await fetch(`/api/hotels/list-by-geocode?${params}`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(err.error || 'Hotel geocode search failed');
    }
    return resp.json();
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

  async getTransferEstimate(originLat, originLng, destLat, destLng, country, originText, destText) {
    const params = new URLSearchParams({
      originLat: String(originLat),
      originLng: String(originLng),
      destLat: String(destLat),
      destLng: String(destLng),
      country: country || '',
    });
    if (originText) params.set('originText', originText);
    if (destText) params.set('destText', destText);
    const resp = await fetch(`/api/transfer-estimate?${params}`);
    if (!resp.ok) return null;
    return resp.json();
  }
};
