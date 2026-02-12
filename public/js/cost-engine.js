const CostEngine = {
  HOTEL_MULTIPLIERS: {
    budget:  { label: 'Budget',    factor: 0.6 },
    mid:     { label: 'Mid-Range', factor: 1.0 },
    comfort: { label: 'Comfort',   factor: 1.5 },
    luxury:  { label: 'Luxury',    factor: 2.5 },
  },

  // Maps hotel tier to meal tier
  MEAL_TIERS: {
    budget: 'budget',
    mid: 'mid',
    comfort: 'mid',
    luxury: 'comfort',
  },

  CHILD_FLIGHT_FACTOR: 0.75,
  CHILD_MEAL_FACTOR: 0.6,

  FALLBACK_HOTEL_PRICES: {
    'AMS': 130, 'BRU': 110, 'PAR': 150, 'CDG': 150,
    'BCN': 100, 'LON': 170, 'LHR': 170, 'ROM': 105, 'FCO': 105,
    'BER': 95, 'FRA': 110, 'MUC': 110, 'VIE': 100, 'ZRH': 160,
    'PRG': 80, 'LIS': 90, 'MAD': 95, 'ATH': 85, 'IST': 70,
    'DUB': 130, 'CPH': 140, 'BUD': 70, 'WAW': 65,
    'BOM': 60, 'DEL': 55, 'BLR': 50, 'MAA': 45,
    'DXB': 120, 'DOH': 130, 'SIN': 140, 'BKK': 50, 'HKG': 130,
    'TYO': 120, 'NRT': 120, 'KUL': 45, 'DPS': 55,
    'JFK': 200, 'NYC': 200, 'LAX': 150, 'SFO': 160,
    'SYD': 140, 'MEL': 120,
    'DEFAULT': 100,
  },

  TRANSFER_RATES: {
    'IN': { taxi: 0.30, baseFare: 2.50, publicTransport: 0.05 },
    'NL': { taxi: 2.20, baseFare: 3.00, publicTransport: 0.15 },
    'BE': { taxi: 1.80, baseFare: 2.50, publicTransport: 0.12 },
    'FR': { taxi: 1.50, baseFare: 2.50, publicTransport: 0.10 },
    'ES': { taxi: 1.10, baseFare: 2.50, publicTransport: 0.08 },
    'DE': { taxi: 2.00, baseFare: 3.50, publicTransport: 0.12 },
    'IT': { taxi: 1.30, baseFare: 3.00, publicTransport: 0.08 },
    'GB': { taxi: 2.50, baseFare: 3.50, publicTransport: 0.15 },
    'US': { taxi: 2.00, baseFare: 3.00, publicTransport: 0.10 },
    'AE': { taxi: 0.50, baseFare: 3.00, publicTransport: 0.08 },
    'DEFAULT': { taxi: 1.50, baseFare: 3.00, publicTransport: 0.10 },
  },

  getHotelBasePrice(cityCode) {
    return this.FALLBACK_HOTEL_PRICES[cityCode] || this.FALLBACK_HOTEL_PRICES['DEFAULT'];
  },

  getTransferRate(country) {
    return this.TRANSFER_RATES[country] || this.TRANSFER_RATES['DEFAULT'];
  },

  estimateTransferCost(distanceKm, country) {
    const rates = this.getTransferRate(country);
    return {
      taxiCost: Math.round(rates.baseFare + (distanceKm * rates.taxi)),
      publicTransportCost: Math.round(distanceKm * rates.publicTransport * 10) / 10,
    };
  },

  calculateRooms(adults) {
    return Math.ceil(adults / 2);
  },

  calculate(plan) {
    const flights = this.calcFlights(plan);
    const layoverMeals = this.calcLayoverMeals(plan);
    const hotels = this.calcHotels(plan);
    const dailyMeals = this.calcDailyMeals(plan);
    const transfers = this.calcTransfers(plan);

    return {
      total: {
        low: flights.low + layoverMeals.low + hotels.low + dailyMeals.low + transfers.low,
        high: flights.high + layoverMeals.high + hotels.high + dailyMeals.high + transfers.high,
        currency: 'EUR'
      },
      flights,
      layoverMeals,
      hotels,
      dailyMeals,
      transfers,
    };
  },

  calcFlights(plan) {
    let low = 0, high = 0;
    for (const leg of plan.flightLegs) {
      // Train/bus legs have fixed cost, not flight offers
      if (leg.legType === 'train' && leg.transitInfo) {
        const trainCost = leg.transitInfo.estimatedCostEur || 15;
        const totalPassengers = plan.adults + plan.children;
        low += trainCost * totalPassengers;
        high += trainCost * 1.3 * totalPassengers; // 30% buffer
        continue;
      }

      if (!leg.offers || leg.offers.length === 0) continue;

      // Use selected offer price if user has chosen one, otherwise show range
      if (leg.selectedOffer) {
        const p = leg.selectedOffer.price;
        const childP = p * this.CHILD_FLIGHT_FACTOR;
        const legCost = (p * plan.adults) + (childP * plan.children);
        low += legCost;
        high += legCost;
      } else {
        const sorted = [...leg.offers].sort((a, b) => a.price - b.price);
        const cheapest = sorted[0].price;
        const comfortable = sorted[Math.min(2, sorted.length - 1)].price;

        const adultLow = cheapest;
        const adultHigh = comfortable;
        const childLow = adultLow * this.CHILD_FLIGHT_FACTOR;
        const childHigh = adultHigh * this.CHILD_FLIGHT_FACTOR;

        low += (adultLow * plan.adults) + (childLow * plan.children);
        high += (adultHigh * plan.adults) + (childHigh * plan.children);
      }
    }
    return { low: Math.round(low), high: Math.round(high) };
  },

  calcLayoverMeals(plan) {
    let low = 0, high = 0;
    for (const leg of plan.flightLegs) {
      if (leg.legType === 'train') continue;
      const offer = leg.selectedOffer || leg.offers?.[0];
      if (!offer || !offer.layovers) continue;
      for (const layover of offer.layovers) {
        if (!layover.mealCost || layover.mealCost.cost === 0) continue;
        const perPerson = layover.mealCost.cost;
        const adultTotal = perPerson * plan.adults;
        const childTotal = perPerson * this.CHILD_MEAL_FACTOR * plan.children;
        low += adultTotal + childTotal; // exact
        high += (adultTotal + childTotal) * 1.3; // +30% buffer for airport price variation
      }
    }
    return { low: Math.round(low), high: Math.round(high) };
  },

  calcHotels(plan) {
    let low = 0, high = 0;
    const rooms = this.calculateRooms(plan.adults);

    for (const city of plan.cities) {
      const nightlyRate = city.hotelBasePrice || this.getHotelBasePrice(city.cityCode);
      const total = nightlyRate * city.nights * rooms;
      low += total;
      high += total;
    }
    return { low: Math.round(low), high: Math.round(high) };
  },

  calcDailyMeals(plan) {
    let low = 0, high = 0;
    for (const city of plan.cities) {
      if (!city.mealCosts) continue;
      const meals = city.mealCosts;
      const mealTier = 'mid';

      const N = city.nights;
      // For N nights: N breakfasts + N lunches + N dinners = 3N meals
      // Arrival day: lunch + dinner (no breakfast)
      // Middle days (N-1): breakfast + lunch + dinner
      // Departure day: breakfast only
      const breakfastCost = meals.breakfast?.[mealTier] || 8;
      const lunchCost = meals.lunch?.[mealTier] || 14;
      const dinnerCost = meals.dinner?.[mealTier] || 20;

      const dailyTotal = breakfastCost + lunchCost + dinnerCost;
      const perPersonTotal = dailyTotal * N;

      const adultTotal = perPersonTotal * plan.adults;
      const childTotal = perPersonTotal * this.CHILD_MEAL_FACTOR * plan.children;
      const cityTotal = adultTotal + childTotal;

      low += cityTotal * 0.85;
      high += cityTotal * 1.15;
    }
    return { low: Math.round(low), high: Math.round(high) };
  },

  calcTransfers(plan) {
    let total = 0;
    for (const t of plan.transfers) {
      if (t.type === 'none') continue;
      switch (t.selectedMode) {
        case 'taxi': total += t.taxiCost || 0; break;
        case 'transit': total += t.publicTransportCost || 0; break;
        case 'bike': case 'walk': break; // free
        default: total += t.publicTransportCost || 5; break;
      }
    }
    return { low: Math.round(total), high: Math.round(total) };
  },
};
