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
  INFANT_FLIGHT_FACTOR: 0.10,
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
    const activities = this.calcActivities(plan);

    return {
      total: {
        low: flights.low + layoverMeals.low + hotels.low + dailyMeals.low + transfers.low + activities.low,
        high: flights.high + layoverMeals.high + hotels.high + dailyMeals.high + transfers.high + activities.high,
        currency: 'EUR'
      },
      flights,
      layoverMeals,
      hotels,
      dailyMeals,
      transfers,
      activities,
    };
  },

  calcFlights(plan) {
    let low = 0, high = 0;
    const infants = plan.infants || 0;
    for (const leg of plan.flightLegs) {
      // Ground transport mode (user switched from flight)
      if (leg.selectedMode && leg.selectedMode !== 'flight' && leg.groundRoutes) {
        const totalPassengers = plan.adults + plan.children;
        // Infants ride free on ground transport (on lap / no seat)
        if (leg.selectedMode === 'transit') {
          const cost = leg.groundRoutes.transitRoutes?.[0]?.publicTransportCost || 0;
          low += cost * totalPassengers;
          high += cost * 1.3 * totalPassengers;
        } else if (leg.selectedMode === 'drive') {
          const cost = leg.groundRoutes.driving?.taxiCost || 0;
          low += cost; // taxi cost is total, not per person
          high += cost * 1.2;
        }
        // walk/bike = free
        continue;
      }

      // Train/bus legs have fixed cost, not flight offers
      if (leg.legType === 'train' && leg.transitInfo) {
        const trainCost = leg.transitInfo.estimatedCostEur || 15;
        const totalPassengers = plan.adults + plan.children;
        low += trainCost * totalPassengers;
        high += trainCost * 1.3 * totalPassengers; // 30% buffer
        // Infants free on trains/buses
        continue;
      }

      if (!leg.offers || leg.offers.length === 0) continue;

      // Use selected offer price if user has chosen one, otherwise show range
      if (leg.selectedOffer) {
        const p = leg.selectedOffer.price;
        const childP = p * this.CHILD_FLIGHT_FACTOR;
        const infantP = p * this.INFANT_FLIGHT_FACTOR;
        const legCost = (p * plan.adults) + (childP * plan.children) + (infantP * infants);
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
        const infantLow = adultLow * this.INFANT_FLIGHT_FACTOR;
        const infantHigh = adultHigh * this.INFANT_FLIGHT_FACTOR;

        low += (adultLow * plan.adults) + (childLow * plan.children) + (infantLow * infants);
        high += (adultHigh * plan.adults) + (childHigh * plan.children) + (infantHigh * infants);
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
    const fallbackRooms = this.calculateRooms(plan.adults);

    for (const city of plan.cities) {
      const nightlyRate = city.hotelBasePrice || this.getHotelBasePrice(city.cityCode);
      // Live SerpApi prices already account for group size (searched with actual adults),
      // so don't multiply by rooms. Only multiply for fallback estimates.
      const rooms = city.hotelPriceSource === 'live' ? 1 : fallbackRooms;
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
    const passengers = (plan.adults || 1) + (plan.children || 0);
    for (const t of plan.transfers) {
      if (t.type === 'none') continue;
      switch (t.selectedMode) {
        case 'taxi': total += t.taxiCost || 0; break; // shared fare
        case 'transit': total += (t.publicTransportCost || 0) * passengers; break; // per person
        case 'bike': case 'walk': break; // free
        default: total += (t.publicTransportCost || 5) * passengers; break;
      }
    }
    return { low: Math.round(total), high: Math.round(total) };
  },

  calcActivities(plan) {
    let total = 0;
    if (!plan.itinerary) return { low: 0, high: 0 };
    const passengers = (plan.adults || 1) + (plan.children || 0);
    for (const day of plan.itinerary) {
      if (!day.segments) continue;
      for (const seg of day.segments) {
        if (seg.to && seg.to.isActivity && seg.to.entryFee) {
          total += seg.to.entryFee * passengers;
        }
      }
    }
    return { low: Math.round(total), high: Math.round(total * 1.15) };
  },

  calculateDay(day, plan) {
    if (!day || !day.segments) return { low: 0, high: 0, breakdown: { transport: 0, hotel: 0, meals: 0, activities: 0 } };
    let transport = 0, activities = 0;
    const passengers = (plan.adults || 1) + (plan.children || 0);

    for (const seg of day.segments) {
      // Sum transport costs from via chains
      if (seg.via) {
        for (const v of seg.via) {
          transport += v.cost || 0;
        }
      }
      // Sum entry fees for activity destinations
      if (seg.to && seg.to.isActivity && seg.to.entryFee) {
        activities += seg.to.entryFee * passengers;
      }
    }

    // Per-day hotel share
    let hotel = 0;
    if (day.cityIndex !== undefined && plan.cities[day.cityIndex]) {
      const city = plan.cities[day.cityIndex];
      const nightlyRate = city.hotelBasePrice || this.getHotelBasePrice(city.cityCode);
      const fallbackRooms = this.calculateRooms(plan.adults);
      const rooms = city.hotelPriceSource === 'live' ? 1 : fallbackRooms;
      hotel = nightlyRate * rooms;
    }

    // Per-day meal cost
    let meals = 0;
    if (day.type === 'activity' && day.cityIndex !== undefined && plan.cities[day.cityIndex]) {
      const city = plan.cities[day.cityIndex];
      if (city.mealCosts) {
        const mealTier = 'mid';
        const breakfastCost = city.mealCosts.breakfast?.[mealTier] || 8;
        const lunchCost = city.mealCosts.lunch?.[mealTier] || 14;
        const dinnerCost = city.mealCosts.dinner?.[mealTier] || 20;
        const dailyPerPerson = breakfastCost + lunchCost + dinnerCost;
        const adultMeals = dailyPerPerson * plan.adults;
        const childMeals = dailyPerPerson * this.CHILD_MEAL_FACTOR * plan.children;
        meals = adultMeals + childMeals;
      }
    }

    const total = transport + hotel + meals + activities;
    return {
      low: Math.round(total * 0.9),
      high: Math.round(total * 1.1),
      breakdown: {
        transport: Math.round(transport),
        hotel: Math.round(hotel),
        meals: Math.round(meals),
        activities: Math.round(activities),
      },
    };
  },
};
