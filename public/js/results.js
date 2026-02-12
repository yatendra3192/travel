// Client-side haversine for fallback distance estimation
function haversineKmClient(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const Results = {
  plan: null,
  tripData: null,
  _sessionToken: null,

  init() {
    document.getElementById('back-btn').addEventListener('click', () => App.goBack());

    document.getElementById('mobile-details-btn')?.addEventListener('click', () => {
      const sidebar = document.getElementById('cost-sidebar');
      sidebar.style.display = sidebar.style.display === 'block' ? 'none' : 'block';
      sidebar.style.position = 'fixed';
      sidebar.style.inset = '0';
      sidebar.style.zIndex = '200';
      sidebar.style.overflow = 'auto';
      sidebar.style.background = 'var(--color-bg-page)';
      sidebar.style.padding = '24px';
    });

    // Date/time changes just update tripData (recalculate on button click)
    document.getElementById('search-bar-date')?.addEventListener('change', (e) => {
      if (this.tripData) this.tripData.departureDate = e.target.value;
    });

    document.getElementById('search-bar-time')?.addEventListener('change', (e) => {
      if (this.plan) this.plan.startTime = e.target.value;
    });

    // Recalculate button
    document.getElementById('header-recalc-btn')?.addEventListener('click', async () => {
      if (!this.tripData || this.tripData.destinations.length === 0) return;
      await this.generateTripPlan(this.tripData);
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#header-from-input') && !e.target.closest('#header-from-dropdown')) {
        document.getElementById('header-from-dropdown')?.classList.remove('show');
      }
      if (!e.target.closest('#header-to-input') && !e.target.closest('#header-to-dropdown')) {
        document.getElementById('header-to-dropdown')?.classList.remove('show');
      }
    });

    // Setup autocomplete on header From input
    const fromInput = document.getElementById('header-from-input');
    const toInput = document.getElementById('header-to-input');

    const debouncedFrom = Utils.debounce((q) => this._headerFetchSuggestions(q, 'from'), 300);
    const debouncedTo = Utils.debounce((q) => this._headerFetchSuggestions(q, 'to'), 300);

    fromInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val.length >= 2) debouncedFrom(val);
      else document.getElementById('header-from-dropdown').classList.remove('show');
    });

    toInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val.length >= 2) debouncedTo(val);
      else document.getElementById('header-to-dropdown').classList.remove('show');
    });

    // Focus the to-input when clicking the chips wrap area
    document.querySelector('.header-chips-wrap')?.addEventListener('click', () => toInput.focus());

    // Currency change re-renders all displayed costs
    document.getElementById('header-currency')?.addEventListener('change', (e) => {
      Utils.displayCurrency = e.target.value;
      if (this.plan) {
        this.renderTimeline();
        this.renderCostSidebar();
      }
    });
  },

  async _headerFetchSuggestions(query, target) {
    try {
      if (!this._sessionToken) {
        this._sessionToken = new google.maps.places.AutocompleteSessionToken();
      }
      const options = { input: query, sessionToken: this._sessionToken };
      if (target === 'to') options.includedPrimaryTypes = ['(cities)'];

      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(options);
      const dropdown = document.getElementById(target === 'from' ? 'header-from-dropdown' : 'header-to-dropdown');
      this._renderHeaderDropdown(suggestions || [], dropdown, target);
    } catch (err) {
      console.warn('Header autocomplete error:', err);
    }
  },

  _renderHeaderDropdown(suggestions, dropdown, target) {
    dropdown.innerHTML = '';
    if (suggestions.length === 0) { dropdown.classList.remove('show'); return; }

    suggestions.forEach(suggestion => {
      const pred = suggestion.placePrediction;
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      const mainText = pred.mainText?.text || pred.text?.text || '';
      const secondaryText = pred.secondaryText?.text || '';
      item.innerHTML = `
        <div class="autocomplete-item-main">${mainText}</div>
        ${secondaryText ? `<div class="autocomplete-item-sub">${secondaryText}</div>` : ''}
      `;
      item.addEventListener('click', () => {
        this._headerSelectPlace(pred, target);
        dropdown.classList.remove('show');
        this._sessionToken = null;
      });
      dropdown.appendChild(item);
    });
    dropdown.classList.add('show');
  },

  async _headerSelectPlace(prediction, target) {  // async for place.fetchFields
    const placeData = {
      name: prediction.mainText?.text || prediction.text?.text || '',
      fullName: prediction.text?.text || '',
      placeId: prediction.placeId,
    };
    try {
      const place = await prediction.toPlace();
      await place.fetchFields({ fields: ['location', 'displayName'] });
      if (place.location) {
        placeData.lat = place.location.lat();
        placeData.lng = place.location.lng();
      }
    } catch (e) {
      console.warn('Could not fetch place details:', e);
    }

    if (target === 'from') {
      this.tripData.from = placeData;
      document.getElementById('header-from-input').value = placeData.fullName || placeData.name;
    } else {
      // Add destination (avoid duplicates)
      const alreadyAdded = this.tripData.destinations.some(
        d => d.name.toLowerCase() === placeData.name.toLowerCase()
      );
      if (!alreadyAdded) {
        this.tripData.destinations.push(placeData);
        this._renderHeaderChips();
      }
      document.getElementById('header-to-input').value = '';
    }
  },

  _renderHeaderChips() {
    const container = document.getElementById('header-dest-chips');
    container.innerHTML = '';
    this.tripData.destinations.forEach((dest, i) => {
      const chip = Components.createChip(dest.name, () => {
        this.tripData.destinations.splice(i, 1);
        this._renderHeaderChips();
      });
      container.appendChild(chip);
    });
  },

  populateSearchBar(tripData) {
    const fromInput = document.getElementById('header-from-input');
    const dateEl = document.getElementById('search-bar-date');
    const timeEl = document.getElementById('search-bar-time');

    if (fromInput) fromInput.value = tripData.from.fullName || tripData.from.name;
    this._renderHeaderChips();
    if (dateEl) {
      dateEl.value = tripData.departureDate;
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      dateEl.min = `${y}-${m}-${d}`;
    }
    if (timeEl) timeEl.value = tripData.startTime || '00:00';

    // Populate header travelers steppers
    this._renderHeaderTravelers(tripData.adults, tripData.children);
  },

  _renderHeaderTravelers(adults, children) {
    const adultsContainer = document.getElementById('header-adults-stepper');
    const childrenContainer = document.getElementById('header-children-stepper');
    if (!adultsContainer || !childrenContainer) return;
    adultsContainer.innerHTML = '';
    childrenContainer.innerHTML = '';
    adultsContainer.appendChild(
      Components.createStepper(adults, 1, 9, (val) => this.onTravelersChange(val, this.plan?.children || 0))
    );
    childrenContainer.appendChild(
      Components.createStepper(children, 0, 6, (val) => this.onTravelersChange(this.plan?.adults || 2, val))
    );
  },

  async generateTripPlan(tripData) {
    this.tripData = tripData;
    this.populateSearchBar(tripData);

    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';

    const steps = [
      'Resolving airports...',
      'Finding best flights...',
      'Searching nearby hotels...',
      'Fetching meal costs...',
      'Getting hotel offers...',
      'Calculating transfer costs...',
      'Building your itinerary...'
    ];
    Components.renderLoadingSteps(steps);

    try {
      // Step 1: Resolve IATA codes with lat/lng for dynamic airport detection
      Components.updateLoadingStep(0, 'active');
      const fromCity = Utils.extractCityName(tripData.from.name);
      const iataPromises = [
        Api.resolveIata(fromCity, tripData.from.lat, tripData.from.lng),
        ...tripData.destinations.map(d =>
          Api.resolveIata(Utils.extractCityName(d.name), d.lat, d.lng).catch(() => ({
            airportCode: null, cityCode: null, cityName: d.name,
            hasAirport: false, country: null
          }))
        )
      ];
      const iataResults = await Promise.all(iataPromises);
      Components.updateLoadingStep(0, 'done');

      // Step 2: Build flight legs and search flights + hotel listings (parallel)
      Components.updateLoadingStep(1, 'active');
      const flightLegs = this.buildFlightLegs(tripData, iataResults);

      // Start flights and hotel listings in parallel (both only need IATA)
      const flightSearchPromise = Promise.all(
        flightLegs.map(leg => {
          if (leg.legType === 'train' || leg.legType === 'skip') return Promise.resolve({ flights: [] });
          if (!leg.from || !leg.to || leg.from === leg.to) return Promise.resolve({ flights: [] });
          return Api.searchFlights(leg.from, leg.to, leg.date, tripData.adults, tripData.children)
            .catch(err => {
              console.warn(`Flight search failed for ${leg.from}-${leg.to}:`, err);
              return { flights: [] };
            });
        })
      );

      Components.updateLoadingStep(2, 'active');
      // Hotel search: prefer geocode-based, fallback to city code
      const hotelSearchPromise = Promise.all(
        tripData.destinations.map((dest, i) => {
          const iata = iataResults[i + 1];
          const cityCode = iata.cityCode;
          // Prefer city center coords for geocode search
          const searchLat = iata.cityCenterLat || dest.lat;
          const searchLng = iata.cityCenterLng || dest.lng;
          if (searchLat && searchLng) {
            return Api.listHotelsByGeocode(searchLat, searchLng, 5).catch(err => {
              console.warn(`Hotel geocode search failed for ${cityCode}, falling back to city code:`, err);
              return Api.listHotels(cityCode).catch(() => ({ hotels: [] }));
            });
          }
          return Api.listHotels(cityCode).catch(err => {
            console.warn(`Hotel list failed for ${cityCode}:`, err);
            return { hotels: [] };
          });
        })
      );

      // Wait for both
      const [flightResults, hotelResults] = await Promise.all([flightSearchPromise, hotelSearchPromise]);
      Components.updateLoadingStep(1, 'done');
      Components.updateLoadingStep(2, 'done');

      // Step 3: Fetch meal costs for all cities + layovers (parallel)
      Components.updateLoadingStep(3, 'active');

      // Collect all layovers from cheapest flight offers for meal cost calculation
      const allLayovers = [];
      flightLegs.forEach((leg, i) => {
        if (leg.legType === 'train' || leg.legType === 'skip') return;
        const flights = flightResults[i]?.flights || [];
        if (flights.length > 0 && flights[0].layovers) {
          allLayovers.push(...flights[0].layovers);
        }
      });

      const mealCostPromises = tripData.destinations.map((dest, i) => {
        const iata = iataResults[i + 1];
        return Api.getMealCosts(iata.cityCode, iata.country).catch(err => {
          console.warn(`Meal costs failed for ${iata.cityCode}:`, err);
          return { cityMeals: null };
        });
      });

      // Also fetch layover meal costs
      const layoverMealPromise = allLayovers.length > 0
        ? Api.getMealCosts(null, null, allLayovers).catch(() => ({ layoverMeals: [] }))
        : Promise.resolve({ layoverMeals: [] });

      const [mealCostResults, layoverMealResult] = await Promise.all([
        Promise.all(mealCostPromises),
        layoverMealPromise,
      ]);
      Components.updateLoadingStep(3, 'done');

      // Step 4: Hotel offers for pricing
      Components.updateLoadingStep(4, 'active');
      const hotelOffers = await Promise.all(
        tripData.destinations.map((dest, i) => {
          const hotels = hotelResults[i]?.hotels || [];
          if (hotels.length === 0) return Promise.resolve({ offers: [] });
          const sampleIds = hotels.slice(0, 20).map(h => h.hotelId);
          const checkIn = this.getCityCheckIn(tripData, iataResults, i);
          const checkOut = Utils.addDays(checkIn, 1);
          return Api.getHotelOffers(sampleIds, checkIn, checkOut, tripData.adults)
            .catch(() => ({ offers: [] }));
        })
      );
      Components.updateLoadingStep(4, 'done');

      // Step 5: Transfer costs via Google Directions (now with actual hotel coords + bidirectional)
      Components.updateLoadingStep(5, 'active');
      this.plan = this.buildPlan(tripData, iataResults, flightLegs, flightResults, hotelResults, hotelOffers, mealCostResults, layoverMealResult);
      this.plan.transfers = await this.estimateTransfers(this.plan, iataResults);
      Components.updateLoadingStep(5, 'done');

      // Step 6: Build itinerary
      Components.updateLoadingStep(6, 'active');
      this.renderTimeline();
      this.renderCostSidebar();
      Components.updateLoadingStep(6, 'done');

      await new Promise(r => setTimeout(r, 400));
      overlay.style.display = 'none';

      // Trip plan ready

    } catch (err) {
      console.error('Trip generation failed:', err);
      overlay.style.display = 'none';
      const timeline = document.getElementById('results-timeline');
      timeline.innerHTML = `<div class="error-banner">Something went wrong: ${err.message}. Please try again.</div>`;
    }
  },

  buildFlightLegs(tripData, iataResults) {
    const legs = [];
    const originAirport = iataResults[0].airportCode;
    let currentDate = tripData.departureDate;

    // Track the last airport we were at (for routing through no-airport cities)
    let lastAirportCode = originAirport;
    // Use airport name for flight card display (not city/home name)
    let lastAirportName = iataResults[0].airportName || iataResults[0].airportCode;

    for (let i = 0; i < tripData.destinations.length; i++) {
      const destIata = iataResults[i + 1];
      const toName = tripData.destinations[i].name;
      const hasAirport = destIata.hasAirport !== false && destIata.airportCode;

      if (hasAirport) {
        const destAirportName = destIata.airportName || destIata.airportCode;
        if (lastAirportCode === destIata.airportCode) {
          // Same airport — skip flight, add direct ground transfer instead
          legs.push({
            from: lastAirportCode,
            to: null,
            fromName: lastAirportName,
            toName: toName,
            toCityName: toName,
            date: currentDate,
            type: i === 0 ? 'outbound' : 'inter-city',
            legType: 'skip',
          });
        } else {
          // Normal flight leg
          legs.push({
            from: lastAirportCode,
            to: destIata.airportCode,
            fromName: lastAirportName,
            toName: destAirportName,
            toCityName: toName,
            date: currentDate,
            type: i === 0 ? 'outbound' : 'inter-city',
            legType: 'flight'
          });
        }
        lastAirportCode = destIata.airportCode;
        lastAirportName = destAirportName;
      } else if (destIata.transitFromAirport) {
        // City without airport: fly to nearest airport, then train/bus
        const nearestAirport = destIata.airportCode;
        const nearestAirportName = destIata.airportName || destIata.airportCode;
        if (lastAirportCode !== nearestAirport) {
          // Need a flight to the nearest airport first
          legs.push({
            from: lastAirportCode,
            to: nearestAirport,
            fromName: lastAirportName,
            toName: nearestAirportName,
            toCityName: destIata.nearestCity || toName,
            date: currentDate,
            type: 'inter-city',
            legType: 'flight'
          });
        }
        // Then train/bus from airport city to the actual destination
        legs.push({
          from: nearestAirport,
          to: null,
          fromName: destIata.nearestCity || nearestAirportName,
          toName,
          toCityName: toName,
          date: currentDate,
          type: 'inter-city',
          legType: 'train',
          transitInfo: destIata.transitFromAirport,
        });
        lastAirportCode = nearestAirport;
        lastAirportName = nearestAirportName;
      } else {
        // Unknown city with no airport data at all - try flight anyway
        legs.push({
          from: lastAirportCode,
          to: destIata.airportCode || lastAirportCode,
          fromName: lastAirportName,
          toName: destIata.airportName || toName,
          toCityName: toName,
          date: currentDate,
          type: 'inter-city',
          legType: 'flight'
        });
      }

      currentDate = Utils.addDays(currentDate, 1);
    }

    // Return leg: from last airport to origin
    if (lastAirportCode === originAirport) {
      // Same airport — skip flight, direct ground transfer home
      legs.push({
        from: lastAirportCode,
        to: null,
        fromName: lastAirportName,
        toName: iataResults[0].cityName || iataResults[0].airportName || originAirport,
        date: currentDate,
        type: 'return',
        legType: 'skip',
      });
    } else {
      legs.push({
        from: lastAirportCode,
        to: originAirport,
        fromName: lastAirportName,
        toName: iataResults[0].airportName || iataResults[0].airportCode,
        date: currentDate,
        type: 'return',
        legType: 'flight'
      });
    }

    return legs;
  },

  getCityCheckIn(tripData, iataResults, cityIndex) {
    // If plan is already built with arrival dates, use those
    if (this.plan?.cities?.[cityIndex]?.checkInDate) {
      return this.plan.cities[cityIndex].checkInDate;
    }
    // Fallback: departure date + 1 day per preceding city
    let date = tripData.departureDate;
    for (let i = 0; i <= cityIndex; i++) {
      if (i > 0) date = Utils.addDays(date, 1);
    }
    return date;
  },

  buildPlan(tripData, iataResults, flightLegs, flightResults, hotelResults, hotelOffers, mealCostResults, layoverMealResult) {
    const cities = tripData.destinations.map((dest, i) => {
      const iata = iataResults[i + 1];
      let hotelBasePrice = CostEngine.getHotelBasePrice(iata.cityCode);
      let hotelPriceSource = 'estimate';

      if (hotelOffers[i]?.offers?.length > 0) {
        const avgPrice = hotelOffers[i].offers.reduce((sum, o) => sum + o.pricePerNight, 0)
          / hotelOffers[i].offers.length;
        hotelBasePrice = Math.round(avgPrice);
        hotelPriceSource = 'live';
      }

      // Find first hotel with geoCode for transfer routing
      const hotelsWithGeo = (hotelResults[i]?.hotels || []).filter(h => h.geoCode?.latitude && h.geoCode?.longitude);
      const firstHotel = hotelsWithGeo[0] || null;

      // Get meal costs for this city
      const mealCosts = mealCostResults[i]?.cityMeals || null;

      return {
        name: dest.name,
        airportCode: iata.airportCode,
        cityCode: iata.cityCode,
        airportName: iata.airportName,
        country: iata.country,
        hasAirport: iata.hasAirport !== false,
        nights: 1,
        hotelType: 'comfort',
        hotelBasePrice,
        hotelPriceSource,
        adults: tripData.adults,
        hotels: hotelResults[i]?.hotels || [],
        lat: dest.lat,
        lng: dest.lng,
        airportLat: iata.airportLat || null,
        airportLng: iata.airportLng || null,
        hotelLat: firstHotel?.geoCode?.latitude || iata.cityCenterLat || dest.lat,
        hotelLng: firstHotel?.geoCode?.longitude || iata.cityCenterLng || dest.lng,
        hotelName: firstHotel?.name || null,
        mealCosts,
      };
    });

    // Build layover meal cost lookup by airport code + duration
    const layoverMeals = layoverMealResult?.layoverMeals || [];

    const enrichedFlightLegs = flightLegs.map((leg, i) => {
      const flights = flightResults[i]?.flights || [];
      const enrichedFlights = flights.map(flight => {
        // Fix overnight/multi-day flights: use duration to correct arrival date
        if (flight.departure && flight.arrival && flight.duration) {
          const dep = new Date(flight.departure);
          const arr = new Date(flight.arrival);
          const durMatch = flight.duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
          if (!isNaN(dep) && !isNaN(arr) && durMatch) {
            const durMins = (parseInt(durMatch[1] || '0') * 60) + parseInt(durMatch[2] || '0');
            const expectedArr = new Date(dep.getTime() + durMins * 60000);
            const daysAhead = Math.floor((expectedArr - dep) / 86400000);
            if (daysAhead > 0) {
              arr.setDate(arr.getDate() + daysAhead);
              flight = { ...flight, arrival: arr.toISOString().replace('Z', '').split('.')[0] };
            }
          }
        }
        if (!flight.layovers) return flight;
        // Enrich each layover with meal cost data
        const enrichedLayovers = flight.layovers.map(layover => {
          const match = layoverMeals.find(lm =>
            lm.airportCode === layover.airportCode &&
            lm.durationMinutes === layover.durationMinutes
          );
          return {
            ...layover,
            mealCost: match ? { cost: match.cost, description: match.description, items: match.items, source: match.source } : null,
          };
        });
        return { ...flight, layovers: enrichedLayovers };
      });

      return {
        ...leg,
        offers: enrichedFlights,
        selectedOffer: enrichedFlights[0] || null,
      };
    });

    // Compute arrival-based dates: walk through legs and set checkInDate on cities
    this._computeArrivalDates(enrichedFlightLegs, cities);

    return {
      from: {
        ...tripData.from,
        ...iataResults[0],
        cityLat: tripData.from.lat,
        cityLng: tripData.from.lng,
      },
      cities,
      flightLegs: enrichedFlightLegs,
      transfers: [],
      adults: tripData.adults,
      children: tripData.children,
      departureDate: tripData.departureDate,
      currency: 'EUR',
    };
  },

  // Walk flight legs, use selected offer arrival to compute each city's check-in date
  // and each subsequent leg's departure date
  _computeArrivalDates(flightLegs, cities) {
    let legIdx = 0;
    for (let i = 0; i < cities.length; i++) {
      // Find the leg that arrives at this city
      while (legIdx < flightLegs.length - 1) {
        const leg = flightLegs[legIdx];
        const matchName = leg.toCityName || leg.toName;
        const isForThisCity = matchName === cities[i].name;

        // Use selected offer's arrival date if available
        const offer = leg.selectedOffer;
        const arrivalDate = Utils.getArrivalDate(offer);
        if (arrivalDate) {
          leg.arrivalDate = arrivalDate;
        } else {
          leg.arrivalDate = leg.date; // fallback: same day
        }

        legIdx++;
        if (isForThisCity) {
          // Set this city's check-in to the flight arrival date + time
          cities[i].checkInDate = leg.arrivalDate;
          cities[i].arrivalTime = offer?.arrival || null;
          break;
        }
      }

      // Next leg departs after city stay: checkIn + nights
      const checkIn = cities[i].checkInDate || cities[i].date;
      const checkOut = Utils.addDays(checkIn, cities[i].nights);

      // Update subsequent legs' dates
      if (legIdx < flightLegs.length) {
        // Find next flight leg(s) and update their departure date
        let nextLegIdx = legIdx;
        while (nextLegIdx < flightLegs.length - 1) {
          const nextLeg = flightLegs[nextLegIdx];
          const nextMatch = nextLeg.toCityName || nextLeg.toName;
          const isNextCity = (i + 1 < cities.length) && nextMatch === cities[i + 1].name;
          nextLeg.date = checkOut;
          if (isNextCity) break;
          nextLegIdx++;
        }
        // Also update return leg if this is the last city
        if (i === cities.length - 1) {
          flightLegs[flightLegs.length - 1].date = checkOut;
        }
      }
    }
  },

  // Walk the timeline and compute scheduleStart/scheduleEnd on every transfer and city
  _computeTimelineSchedule() {
    const plan = this.plan;
    if (!plan || !plan.transfers.length) return;

    const startTimeStr = this.plan?.startTime || this.tripData?.startTime || '00:00';
    let cursor = new Date(`${plan.departureDate}T${startTimeStr}:00`);

    // Transfer 0: home → airport (skip if type 'none')
    const t0 = plan.transfers[0];
    if (t0 && t0.type !== 'none') {
      t0.scheduleStart = new Date(cursor);
      cursor = Utils.addMinutesToDate(cursor, Utils.parseDurationMins(t0.durationText));
      t0.scheduleEnd = new Date(cursor);
    }

    // Walk through cities
    let legIdx = 0;
    for (let i = 0; i < plan.cities.length; i++) {
      // Flights/trains leading to this city — use actual times as anchor
      while (legIdx < plan.flightLegs.length - 1) {
        const leg = plan.flightLegs[legIdx];
        const matchName = leg.toCityName || leg.toName;
        const isForThisCity = matchName === plan.cities[i].name;

        if (leg.legType === 'skip') {
          // Same-airport: no flight, cursor stays as-is
          legIdx++;
          if (isForThisCity) break;
          continue;
        } else if (leg.legType === 'train') {
          // Train: starts at cursor, duration from transitInfo
          leg.scheduleStart = new Date(cursor);
          const trainDur = Utils.parseDurationMins(leg.transitInfo?.duration);
          cursor = Utils.addMinutesToDate(cursor, trainDur);
          leg.scheduleEnd = new Date(cursor);
        } else if (leg.selectedOffer?.departure) {
          // Flight: use actual departure/arrival times
          leg.scheduleStart = new Date(leg.selectedOffer.departure);
          cursor = new Date(leg.selectedOffer.arrival);
          leg.scheduleEnd = new Date(cursor);
        }
        legIdx++;
        if (isForThisCity) break;
      }

      // Arrival transfer: always compute schedule (traveler still travels there)
      const arrIdx = 1 + i * 2;
      const arrTransfer = plan.transfers[arrIdx];
      if (arrTransfer && arrTransfer.type !== 'none') {
        arrTransfer.scheduleStart = new Date(cursor);
        cursor = Utils.addMinutesToDate(cursor, Utils.parseDurationMins(arrTransfer.durationText));
        arrTransfer.scheduleEnd = new Date(cursor);
      }

      if (plan.cities[i].nights === 0) {
        // 0 nights: passing through — no hotel check-in/out
        plan.cities[i].travelerArrival = new Date(cursor);
        plan.cities[i].hotelCheckIn = null;
        plan.cities[i].hotelCheckOut = null;
        // cursor continues from arrival (traveler heads out immediately)
      } else {
        // Traveler arrival at hotel (after transit from airport)
        plan.cities[i].travelerArrival = new Date(cursor);

        // Standard hotel check-in: 3:00 PM on arrival day
        const arrivalDateStr = plan.cities[i].checkInDate || plan.departureDate;
        plan.cities[i].hotelCheckIn = new Date(`${arrivalDateStr}T15:00:00`);

        // Check-out date + time (standard 11:00 AM)
        const checkOutDate = Utils.addDays(arrivalDateStr, plan.cities[i].nights);
        let checkOutCursor = new Date(`${checkOutDate}T11:00:00`);

        const depIdx = 1 + i * 2 + 1;
        const depTransfer = plan.transfers[depIdx];

        // Find next flight departure to ensure enough travel time
        let tempLegIdx = legIdx;
        while (tempLegIdx < plan.flightLegs.length) {
          const nl = plan.flightLegs[tempLegIdx];
          if (nl.selectedOffer?.departure) {
            const flightDep = new Date(nl.selectedOffer.departure);
            const transferMins = depTransfer ? Utils.parseDurationMins(depTransfer.durationText) : 30;
            const needLeaveBy = Utils.addMinutesToDate(flightDep, -(transferMins + 120));
            if (needLeaveBy.getTime() < checkOutCursor.getTime()) {
              checkOutCursor = needLeaveBy;
            }
            break;
          }
          tempLegIdx++;
        }

        plan.cities[i].hotelCheckOut = new Date(checkOutCursor);
        cursor = checkOutCursor;

        // Departure transfer: hotel → airport/station (skip if type 'none')
        if (depTransfer && depTransfer.type !== 'none') {
          depTransfer.scheduleStart = new Date(cursor);
          cursor = Utils.addMinutesToDate(cursor, Utils.parseDurationMins(depTransfer.durationText));
          depTransfer.scheduleEnd = new Date(cursor);
        }
      }
    }

    // Return flight/train
    const returnLeg = plan.flightLegs[plan.flightLegs.length - 1];
    if (returnLeg && returnLeg.legType !== 'skip') {
      if (returnLeg.legType === 'train') {
        returnLeg.scheduleStart = new Date(cursor);
        const trainDur = Utils.parseDurationMins(returnLeg.transitInfo?.duration);
        cursor = Utils.addMinutesToDate(cursor, trainDur);
        returnLeg.scheduleEnd = new Date(cursor);
      } else if (returnLeg.selectedOffer?.departure) {
        returnLeg.scheduleStart = new Date(returnLeg.selectedOffer.departure);
        cursor = new Date(returnLeg.selectedOffer.arrival);
        returnLeg.scheduleEnd = new Date(cursor);
      }
    }

    // Last transfer: airport → home (or direct drive home)
    const lastIdx = plan.transfers.length - 1;
    const lastTr = plan.transfers[lastIdx];
    if (lastTr && lastTr.type !== 'none') {
      lastTr.scheduleStart = new Date(cursor);
      cursor = Utils.addMinutesToDate(cursor, Utils.parseDurationMins(lastTr.durationText));
      lastTr.scheduleEnd = new Date(cursor);
    }
  },

  async estimateTransfers(plan, iataResults) {
    const transfers = [];
    const originCountry = iataResults[0].country;

    // Helper: fetch live transfer data or fallback
    async function liveTransfer(fromLabel, toLabel, type, oLat, oLng, dLat, dLng, country, originText, destText) {
      if (oLat && oLng && dLat && dLng) {
        try {
          const est = await Api.getTransferEstimate(oLat, oLng, dLat, dLng, country, originText, destText);
          if (est) {
            const bestTransit = est.transitRoutes?.[0] || {};
            return {
              from: fromLabel,
              to: toLabel,
              type,
              distanceKm: est.driving.distanceKm,
              durationText: est.driving.duration,
              drivingSummary: est.driving.summary,
              taxiCost: est.driving.taxiCost,
              publicTransportCost: bestTransit.publicTransportCost || 1,
              transitDuration: bestTransit.duration || est.driving.duration,
              fareSource: bestTransit.fareSource || 'estimated',
              transitRoutes: est.transitRoutes || [],
              walking: est.walking || null,
              bicycling: est.bicycling || null,
            };
          }
        } catch (e) {
          console.warn('Transfer estimate failed:', e);
        }
      }
      // Fallback: rough estimate
      const distKm = (oLat && oLng && dLat && dLng)
        ? Math.round(haversineKmClient(oLat, oLng, dLat, dLng))
        : 30;
      return {
        from: fromLabel,
        to: toLabel,
        type,
        distanceKm: distKm,
        durationText: `~${Math.max(15, Math.round(distKm * 1.2))} min`,
        ...CostEngine.estimateTransferCost(distKm, country),
      };
    }

    // Determine which legs are 'skip' (same-airport, direct drive)
    const flightLegs = plan.flightLegs || [];
    const firstLeg = flightLegs[0];
    const lastLeg = flightLegs[flightLegs.length - 1];
    const firstLegIsSkip = firstLeg?.legType === 'skip';
    const lastLegIsSkip = lastLeg?.legType === 'skip';

    const originAirportName = plan.from.airportName || null;
    const homeName = plan.from.name || plan.from.cityName;

    // Home → Airport (only if first leg is a real flight)
    if (!firstLegIsSkip) {
      transfers.push(await liveTransfer(
        homeName,
        originAirportName || 'Airport',
        'home-to-airport',
        plan.from.cityLat, plan.from.cityLng,
        plan.from.airportLat, plan.from.airportLng,
        originCountry, null, originAirportName
      ));
    } else {
      // Placeholder — will be replaced by direct drive below
      transfers.push(null);
    }

    // Build a map: which leg index leads to which city
    // legType 'skip' for a city means direct drive (no airport needed)
    const skipCity = [];
    let legIdx = 0;
    for (let i = 0; i < plan.cities.length; i++) {
      let cityIsSkip = false;
      while (legIdx < flightLegs.length - 1) {
        const leg = flightLegs[legIdx];
        const matchName = leg.toCityName || leg.toName;
        if (leg.legType === 'skip') cityIsSkip = true;
        legIdx++;
        if (matchName === plan.cities[i].name) break;
      }
      skipCity.push(cityIsSkip);
    }

    // For each destination city: build arrival + departure transfers
    const cityTransferPromises = [];
    for (let i = 0; i < plan.cities.length; i++) {
      const city = plan.cities[i];
      const hotelLabel = city.hotelName ? `${city.hotelName}, ${city.name}` : `${city.name} Hotel`;

      if (skipCity[i]) {
        // Direct drive: previous location → hotel (no airport)
        // Previous location = home (if first city) or previous city's hotel
        let prevName, prevLat, prevLng;
        if (i === 0) {
          prevName = homeName;
          prevLat = plan.from.cityLat;
          prevLng = plan.from.cityLng;
        } else {
          const prev = plan.cities[i - 1];
          prevName = prev.hotelName ? `${prev.hotelName}, ${prev.name}` : `${prev.name} Hotel`;
          prevLat = prev.hotelLat;
          prevLng = prev.hotelLng;
        }

        // Arrival: previous location → hotel (direct drive)
        cityTransferPromises.push(
          liveTransfer(prevName, hotelLabel, 'direct-drive',
            prevLat, prevLng, city.hotelLat, city.hotelLng,
            city.country, null, null)
        );
        // Departure: placeholder (null) — will be set by next city or return leg
        cityTransferPromises.push(Promise.resolve(null));
      } else {
        // Normal: airport/station → hotel and hotel → airport/station
        const isNoAirport = !city.hasAirport;
        const stationOrAirportName = isNoAirport
          ? `${city.name} Station`
          : (city.airportName || `${city.name} Airport`);
        const stationOrAirportLat = isNoAirport ? (city.lat || city.hotelLat) : city.airportLat;
        const stationOrAirportLng = isNoAirport ? (city.lng || city.hotelLng) : city.airportLng;
        const transferType = isNoAirport ? 'station' : 'airport';

        cityTransferPromises.push(
          liveTransfer(stationOrAirportName, hotelLabel, `${transferType}-to-hotel`,
            stationOrAirportLat, stationOrAirportLng,
            city.hotelLat, city.hotelLng,
            city.country, stationOrAirportName, null)
        );
        cityTransferPromises.push(
          liveTransfer(hotelLabel, stationOrAirportName, `hotel-to-${transferType}`,
            city.hotelLat, city.hotelLng,
            stationOrAirportLat, stationOrAirportLng,
            city.country, null, stationOrAirportName)
        );
      }
    }
    const cityTransfers = await Promise.all(cityTransferPromises);
    transfers.push(...cityTransfers);

    // Return: Airport → Home (only if last leg is a real flight)
    if (!lastLegIsSkip) {
      transfers.push(await liveTransfer(
        originAirportName || 'Airport', homeName,
        'airport-to-home',
        plan.from.airportLat, plan.from.airportLng,
        plan.from.cityLat, plan.from.cityLng,
        originCountry, originAirportName, null
      ));
    } else {
      // Direct drive home from last city's hotel
      const lastCity = plan.cities[plan.cities.length - 1];
      const lastHotelLabel = lastCity.hotelName ? `${lastCity.hotelName}, ${lastCity.name}` : `${lastCity.name} Hotel`;
      transfers.push(await liveTransfer(
        lastHotelLabel, homeName, 'direct-drive',
        lastCity.hotelLat, lastCity.hotelLng,
        plan.from.cityLat, plan.from.cityLng,
        originCountry, null, null
      ));
    }

    // Replace first transfer placeholder if first leg is skip
    if (firstLegIsSkip && transfers[0] === null) {
      // No home→airport needed; the arrival transfer for city 0 handles it
      // Create a no-op empty transfer so indexing stays consistent
      transfers[0] = { from: '', to: '', type: 'none', distanceKm: 0, durationText: '0 min', taxiCost: 0, publicTransportCost: 0, transitRoutes: [] };
    }

    // Clean up null departure transfers for skip cities
    // (departure transfer not needed when next leg is also skip/direct)
    for (let i = 0; i < transfers.length; i++) {
      if (transfers[i] === null) {
        transfers[i] = { from: '', to: '', type: 'none', distanceKm: 0, durationText: '0 min', taxiCost: 0, publicTransportCost: 0, transitRoutes: [] };
      }
    }

    return transfers;
  },

  renderTimeline() {
    const container = document.getElementById('results-timeline');
    container.innerHTML = '';

    // Compute schedule times for all cards before rendering
    this._computeTimelineSchedule();

    const plan = this.plan;

    // Home to airport transfer (skip if type 'none' — direct drive cases)
    if (plan.transfers[0] && plan.transfers[0].type !== 'none') {
      container.appendChild(Components.createTransferCard(plan.transfers[0], 0));
      container.appendChild(Components.createConnector());
    }

    // Render all legs (flights, trains, transfers, city stays) in order
    let legIdx = 0;
    for (let i = 0; i < plan.cities.length; i++) {
      // Render all legs that lead to this city
      while (legIdx < plan.flightLegs.length - 1) {
        const leg = plan.flightLegs[legIdx];
        const matchName = leg.toCityName || leg.toName;
        const isForThisCity = matchName === plan.cities[i].name;
        const isTrainToCity = leg.legType === 'train' && matchName === plan.cities[i].name;

        if (leg.legType === 'skip') {
          // Same-airport: no flight card needed, just advance
          legIdx++;
        } else if (leg.legType === 'train') {
          container.appendChild(Components.createTrainCard(leg, legIdx));
          container.appendChild(Components.createConnector());
          legIdx++;
        } else {
          container.appendChild(Components.createFlightCard(leg, legIdx));
          container.appendChild(Components.createConnector());
          legIdx++;
        }

        if (isForThisCity || isTrainToCity) break;
      }

      // Arrival transfer — always show (traveler still travels there)
      {
        const arrivalTransferIdx = 1 + i * 2;
        const arrTransfer = plan.transfers[arrivalTransferIdx];
        if (arrTransfer && arrTransfer.type !== 'none') {
          container.appendChild(Components.createTransferCard(arrTransfer, arrivalTransferIdx));
          container.appendChild(Components.createConnector());
        }
      }

      if (plan.cities[i].nights === 0) {
        // 0 nights: pass-through card with stepper to restore nights
        const passCard = document.createElement('div');
        passCard.className = 'timeline-card pass-through-card';
        passCard.dataset.type = 'city';
        passCard.dataset.index = i;
        passCard.innerHTML = `
          <div class="card-header">
            <div class="card-icon">&#128205;</div>
            <div class="card-title">
              <h4>${plan.cities[i].name}</h4>
              <span class="card-subtitle">Passing through &middot; no overnight stay</span>
            </div>
            <div id="nights-stepper-pass-${i}" style="margin-left:auto"></div>
          </div>
        `;
        const stepperSlot = passCard.querySelector(`#nights-stepper-pass-${i}`);
        stepperSlot.appendChild(
          Components.createStepper(0, 0, 14, (val) => this.onNightsChange(i, val))
        );
        container.appendChild(passCard);
        container.appendChild(Components.createConnector());
      } else {
        // City stay card
        container.appendChild(
          Components.createCityCard(
            plan.cities[i], i,
            (idx, nights) => this.onNightsChange(idx, nights),
            (idx, type) => this.onHotelTypeChange(idx, type)
          )
        );
        container.appendChild(Components.createConnector());

        // Hotel → Station/Airport transfer (departure) — skip 'none' type
        {
          const departureTransferIdx = 1 + i * 2 + 1;
          const depTransfer = plan.transfers[departureTransferIdx];
          if (depTransfer && depTransfer.type !== 'none') {
            container.appendChild(Components.createTransferCard(depTransfer, departureTransferIdx));
            container.appendChild(Components.createConnector());
          }
        }
      }
    }

    // Return leg (always the last leg)
    const returnLeg = plan.flightLegs[plan.flightLegs.length - 1];
    if (returnLeg.legType === 'skip') {
      // Same airport — no flight card for return
    } else if (returnLeg.legType === 'train') {
      container.appendChild(Components.createTrainCard(returnLeg, plan.flightLegs.length - 1));
      container.appendChild(Components.createConnector());
    } else {
      container.appendChild(Components.createFlightCard(returnLeg, plan.flightLegs.length - 1));
      container.appendChild(Components.createConnector());
    }

    // Airport to home transfer (or direct drive home)
    const lastTransferIdx = plan.transfers.length - 1;
    const lastTransfer = plan.transfers[lastTransferIdx];
    if (lastTransfer && lastTransfer.type !== 'none') {
      container.appendChild(Components.createTransferCard(lastTransfer, lastTransferIdx));
    }
  },

  async onNightsChange(cityIndex, nights) {
    const city = this.plan.cities[cityIndex];

    // Confirm when setting nights to 0 (skip hotel stay)
    if (nights === 0 && city.nights > 0) {
      const confirmed = await this._showConfirmPopup(
        'Skip hotel stay?',
        `Remove the overnight stay in ${city.name}? You'll pass through without staying.`
      );
      if (!confirmed) {
        // Reset stepper back to current value
        const stepper = document.querySelector(`.timeline-card[data-type="city"][data-index="${cityIndex}"] .stepper-value`);
        if (stepper) stepper.textContent = city.nights;
        return;
      }
    }

    const wasZero = city.nights === 0;
    city.nights = nights;
    const isZero = nights === 0;

    // If switching to/from 0 nights, recalculate affected transfers
    if (wasZero !== isZero) {
      await this._recalcCityTransfers(cityIndex);
    }

    // Recalculate flight dates and re-fetch if any changed
    const changedLegs = this.recalculateFlightDates();
    if (changedLegs.length > 0) {
      await this.refetchFlights(changedLegs);
    }

    // Always re-render timeline (schedule times change with nights)
    this.renderTimeline();
    this.recalculateAndRenderCost();
  },

  async _recalcCityTransfers(cityIndex) {
    const plan = this.plan;
    const city = plan.cities[cityIndex];
    const isZeroNights = city.nights === 0;

    // Determine destination point: city/place center (0 nights) or hotel
    const destLat = isZeroNights ? (city.lat || city.hotelLat) : city.hotelLat;
    const destLng = isZeroNights ? (city.lng || city.hotelLng) : city.hotelLng;
    const destLabel = isZeroNights
      ? city.name
      : (city.hotelName ? `${city.hotelName}, ${city.name}` : `${city.name} Hotel`);

    // Determine origin point for arrival transfer
    let originLabel, originLat, originLng;
    const arrIdx = 1 + cityIndex * 2;
    const depIdx = 1 + cityIndex * 2 + 1;
    const existingArr = plan.transfers[arrIdx];

    if (existingArr && existingArr.type === 'direct-drive') {
      // Direct-drive: origin is home or previous city's hotel
      if (cityIndex === 0) {
        originLabel = plan.from.name || plan.from.cityName;
        originLat = plan.from.cityLat;
        originLng = plan.from.cityLng;
      } else {
        const prev = plan.cities[cityIndex - 1];
        originLabel = prev.hotelName ? `${prev.hotelName}, ${prev.name}` : `${prev.name} Hotel`;
        originLat = prev.hotelLat;
        originLng = prev.hotelLng;
      }
    } else if (existingArr) {
      // Airport/station-based: keep same origin
      originLabel = existingArr.from;
      originLat = city.airportLat || city.lat;
      originLng = city.airportLng || city.lng;
    }

    // Recalculate arrival transfer
    if (existingArr && existingArr.type !== 'none' && originLat && originLng) {
      try {
        const est = await Api.getTransferEstimate(originLat, originLng, destLat, destLng, city.country, null, null);
        if (est) {
          const bestTransit = est.transitRoutes?.[0] || {};
          Object.assign(existingArr, {
            from: originLabel,
            to: destLabel,
            distanceKm: est.driving.distanceKm,
            durationText: est.driving.duration,
            drivingSummary: est.driving.summary,
            taxiCost: est.driving.taxiCost,
            publicTransportCost: bestTransit.publicTransportCost || 1,
            transitDuration: bestTransit.duration || est.driving.duration,
            transitRoutes: est.transitRoutes || [],
            walking: est.walking || null,
            bicycling: est.bicycling || null,
          });
        }
      } catch (e) { console.warn('Transfer recalc failed:', e); }
    }

    // Recalculate return/last transfer if this is the last city
    const lastIdx = plan.transfers.length - 1;
    const lastTransfer = plan.transfers[lastIdx];
    if (cityIndex === plan.cities.length - 1 && lastTransfer && lastTransfer.type !== 'none') {
      const homeName = plan.from.name || plan.from.cityName;
      try {
        const est = await Api.getTransferEstimate(destLat, destLng, plan.from.cityLat, plan.from.cityLng, city.country, null, null);
        if (est) {
          const bestTransit = est.transitRoutes?.[0] || {};
          Object.assign(lastTransfer, {
            from: destLabel,
            to: homeName,
            distanceKm: est.driving.distanceKm,
            durationText: est.driving.duration,
            drivingSummary: est.driving.summary,
            taxiCost: est.driving.taxiCost,
            publicTransportCost: bestTransit.publicTransportCost || 1,
            transitDuration: bestTransit.duration || est.driving.duration,
            transitRoutes: est.transitRoutes || [],
            walking: est.walking || null,
            bicycling: est.bicycling || null,
          });
        }
      } catch (e) { console.warn('Return transfer recalc failed:', e); }
    }

    // Also recalculate the departure transfer for the previous city if it points to hotel
    if (depIdx < plan.transfers.length) {
      const depTransfer = plan.transfers[depIdx];
      if (depTransfer && depTransfer.type !== 'none') {
        const stationName = city.airportName || `${city.name} Airport`;
        const stLat = city.airportLat || city.lat;
        const stLng = city.airportLng || city.lng;
        try {
          const est = await Api.getTransferEstimate(destLat, destLng, stLat, stLng, city.country, null, stationName);
          if (est) {
            const bestTransit = est.transitRoutes?.[0] || {};
            Object.assign(depTransfer, {
              from: destLabel,
              to: stationName,
              distanceKm: est.driving.distanceKm,
              durationText: est.driving.duration,
              drivingSummary: est.driving.summary,
              taxiCost: est.driving.taxiCost,
              publicTransportCost: bestTransit.publicTransportCost || 1,
              transitDuration: bestTransit.duration || est.driving.duration,
              transitRoutes: est.transitRoutes || [],
              walking: est.walking || null,
              bicycling: est.bicycling || null,
            });
          }
        } catch (e) { console.warn('Departure transfer recalc failed:', e); }
      }
    }
  },

  _showConfirmPopup(title, message) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-popup">
          <h3>${title}</h3>
          <p>${message}</p>
          <div class="confirm-actions">
            <button class="confirm-btn cancel">Keep Stay</button>
            <button class="confirm-btn confirm">Skip Stay</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('visible'));

      overlay.querySelector('.cancel').addEventListener('click', () => {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 200);
        resolve(false);
      });
      overlay.querySelector('.confirm').addEventListener('click', () => {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 200);
        resolve(true);
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('visible');
          setTimeout(() => overlay.remove(), 200);
          resolve(false);
        }
      });
    });
  },

  recalculateFlightDates() {
    const plan = this.plan;
    let currentDate = plan.departureDate;
    let legIdx = 0;
    const changedLegs = [];

    for (let i = 0; i < plan.cities.length; i++) {
      // Update all legs leading to this city
      let arrivalDate = currentDate; // fallback
      while (legIdx < plan.flightLegs.length - 1) {
        const leg = plan.flightLegs[legIdx];
        if (leg.date !== currentDate) {
          changedLegs.push(legIdx);
          leg.date = currentDate;
        }
        // Use selected offer arrival to determine actual arrival date
        const offerArrival = Utils.getArrivalDate(leg.selectedOffer);
        arrivalDate = offerArrival || currentDate;
        leg.arrivalDate = arrivalDate;

        const matchName = leg.toCityName || leg.toName;
        const isForThisCity = matchName === plan.cities[i].name;
        legIdx++;
        if (isForThisCity) break;
      }
      // City check-in is the arrival date of the flight, not the departure date
      plan.cities[i].checkInDate = arrivalDate;
      // Find the leg that just arrived at this city and store arrival time
      const arrivedLeg = plan.flightLegs[legIdx - 1];
      plan.cities[i].arrivalTime = arrivedLeg?.selectedOffer?.arrival || null;
      // Next departure = arrival date + nights stayed
      currentDate = Utils.addDays(arrivalDate, plan.cities[i].nights);
    }

    // Return leg
    const returnIdx = plan.flightLegs.length - 1;
    const returnLeg = plan.flightLegs[returnIdx];
    if (returnLeg.date !== currentDate) {
      changedLegs.push(returnIdx);
      returnLeg.date = currentDate;
    }

    return changedLegs;
  },

  async refetchFlights(legIndices) {
    const plan = this.plan;
    await Promise.all(legIndices.map(async (li) => {
      const leg = plan.flightLegs[li];
      if (leg.legType === 'train' || leg.legType === 'skip') return;
      try {
        const result = await Api.searchFlights(leg.from, leg.to, leg.date, plan.adults, plan.children);
        const flights = result?.flights || [];
        leg.offers = flights;
        leg.selectedOffer = flights[0] || null;
      } catch (e) {
        console.warn(`Failed to fetch flights for leg ${li}:`, e);
      }
    }));
  },

  onHotelTypeChange(cityIndex, type) {
    // No-op — hotel type pills removed
    this.recalculateAndRenderCost();
  },

  updateMealBreakdown(cityIndex) {
    const city = this.plan.cities[cityIndex];
    if (!city.mealCosts) return;
    const meals = city.mealCosts;
    const breakdownEl = document.getElementById(`meal-breakdown-${cityIndex}`);
    if (!breakdownEl) return;

    const b = meals.breakfast?.mid || 8;
    const l = meals.lunch?.mid || 14;
    const d = meals.dinner?.mid || 20;
    const daily = b + l + d;
    const totalPersons = this.plan.adults + this.plan.children * CostEngine.CHILD_MEAL_FACTOR;
    const cityTotal = daily * city.nights * totalPersons;

    breakdownEl.innerHTML = `
      <div class="meal-row"><span>Breakfast</span><span>${Utils.formatCurrency(b, 'EUR')}/person</span></div>
      <div class="meal-row"><span>Lunch</span><span>${Utils.formatCurrency(l, 'EUR')}/person</span></div>
      <div class="meal-row"><span>Dinner</span><span>${Utils.formatCurrency(d, 'EUR')}/person</span></div>
      <div class="meal-row total"><span>${city.nights} night${city.nights !== 1 ? 's' : ''} total</span><span>~${Utils.formatCurrency(Math.round(cityTotal), 'EUR')}</span></div>
    `;
  },

  onTravelersChange(adults, children) {
    this.plan.adults = adults;
    this.plan.children = children;
    this.plan.cities.forEach(c => c.adults = adults);
    this.recalculateAndRenderCost();
  },

  recalculateAndRenderCost() {
    this.renderCostSidebar();
  },

  renderCostSidebar() {
    const costs = CostEngine.calculate(this.plan);

    // Desktop sidebar
    const totalEl = document.getElementById('total-cost-range');
    if (totalEl) {
      totalEl.innerHTML = `
        ${Utils.formatCurrencyRange(costs.total.low, costs.total.high, 'EUR')}
        <div class="currency-label">${Utils.displayCurrency}</div>
      `;
    }

    const breakdownEl = document.getElementById('cost-breakdown');
    if (breakdownEl) {
      let html = `
        <div class="cost-line">
          <span class="cost-line-label"><span class="icon">&#9992;&#65039;</span> Flights (${this.plan.flightLegs.filter(l => l.legType === 'flight').length} legs)</span>
          <span class="cost-line-value">${Utils.formatCurrencyRange(costs.flights.low, costs.flights.high, 'EUR')}</span>
        </div>
      `;

      if (costs.layoverMeals.low > 0 || costs.layoverMeals.high > 0) {
        html += `
          <div class="cost-line">
            <span class="cost-line-label"><span class="icon">&#9749;</span> Layover Meals</span>
            <span class="cost-line-value">${Utils.formatCurrencyRange(costs.layoverMeals.low, costs.layoverMeals.high, 'EUR')}</span>
          </div>
        `;
      }

      html += `
        <div class="cost-line">
          <span class="cost-line-label"><span class="icon">&#127976;</span> Hotels (${this.plan.cities.reduce((s, c) => s + c.nights, 0)} nights)</span>
          <span class="cost-line-value">${Utils.formatCurrencyRange(costs.hotels.low, costs.hotels.high, 'EUR')}</span>
        </div>
      `;

      if (costs.dailyMeals.low > 0 || costs.dailyMeals.high > 0) {
        html += `
          <div class="cost-line">
            <span class="cost-line-label"><span class="icon">&#127860;</span> Daily Meals</span>
            <span class="cost-line-value">${Utils.formatCurrencyRange(costs.dailyMeals.low, costs.dailyMeals.high, 'EUR')}</span>
          </div>
        `;
      }

      html += `
        <div class="cost-line">
          <span class="cost-line-label"><span class="icon">&#128661;</span> Transfers</span>
          <span class="cost-line-value">${Utils.formatCurrencyRange(costs.transfers.low, costs.transfers.high, 'EUR')}</span>
        </div>
      `;

      breakdownEl.innerHTML = html;
    }

    const travelersEl = document.querySelector('.travelers-summary');
    if (!travelersEl) {
      const footer = document.querySelector('.cost-footer');
      if (footer) {
        const ts = document.createElement('div');
        ts.className = 'travelers-summary';
        ts.textContent = `${this.plan.adults} adult${this.plan.adults > 1 ? 's' : ''}${this.plan.children > 0 ? `, ${this.plan.children} child${this.plan.children > 1 ? 'ren' : ''}` : ''} · ${CostEngine.calculateRooms(this.plan.adults)} room${CostEngine.calculateRooms(this.plan.adults) > 1 ? 's' : ''}`;
        footer.insertBefore(ts, footer.firstChild);
      }
    } else {
      travelersEl.textContent = `${this.plan.adults} adult${this.plan.adults > 1 ? 's' : ''}${this.plan.children > 0 ? `, ${this.plan.children} child${this.plan.children > 1 ? 'ren' : ''}` : ''} · ${CostEngine.calculateRooms(this.plan.adults)} room${CostEngine.calculateRooms(this.plan.adults) > 1 ? 's' : ''}`;
    }

    // Mobile bar
    const mobileTotal = document.getElementById('mobile-total');
    if (mobileTotal) {
      mobileTotal.innerHTML = `
        <span class="label">Estimated Total</span>
        ${Utils.formatCurrencyRange(costs.total.low, costs.total.high, 'EUR')}
      `;
    }
  },
};
