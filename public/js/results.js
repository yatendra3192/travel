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
  _abortController: null,
  _costRecalcTimer: null,

  init() {
    document.getElementById('back-btn').addEventListener('click', () => App.goBack());

    // Bottom sheet toggle
    document.getElementById('mobile-details-btn')?.addEventListener('click', () => {
      const bar = document.getElementById('mobile-cost-bar');
      bar.classList.toggle('expanded');
    });

    // Bottom sheet touch drag support
    const handle = document.getElementById('bottom-sheet-handle');
    if (handle) {
      let startY = 0;
      let dragging = false;
      handle.addEventListener('touchstart', (e) => {
        startY = e.touches[0].clientY;
        dragging = true;
      }, { passive: true });
      handle.addEventListener('touchmove', (e) => {
        if (!dragging) return;
      }, { passive: true });
      handle.addEventListener('touchend', (e) => {
        if (!dragging) return;
        dragging = false;
        const endY = e.changedTouches[0].clientY;
        const diff = endY - startY;
        const bar = document.getElementById('mobile-cost-bar');
        if (diff > 50) {
          bar.classList.remove('expanded');
        } else if (diff < -50) {
          bar.classList.add('expanded');
        }
      }, { passive: true });
    }

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
      const btn = document.getElementById('header-recalc-btn');
      btn.disabled = true;
      btn.textContent = 'Calculating...';
      try {
        await this.generateTripPlan(this.tripData);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Recalculate';
      }
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
        <div class="autocomplete-item-main">${Utils.escapeHtml(mainText)}</div>
        ${secondaryText ? `<div class="autocomplete-item-sub">${Utils.escapeHtml(secondaryText)}</div>` : ''}
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
    this._renderHeaderTravelers(tripData.adults, tripData.children, tripData.infants);
  },

  _renderHeaderTravelers(adults, children, infants) {
    const adultsContainer = document.getElementById('header-adults-stepper');
    const childrenContainer = document.getElementById('header-children-stepper');
    const infantsContainer = document.getElementById('header-infants-stepper');
    if (!adultsContainer || !childrenContainer) return;
    adultsContainer.innerHTML = '';
    childrenContainer.innerHTML = '';
    if (infantsContainer) infantsContainer.innerHTML = '';
    adultsContainer.appendChild(
      Components.createStepper(adults, 1, 9, (val) => this.onTravelersChange(val, this.plan?.children || 0, this.plan?.infants || 0), 'adults')
    );
    childrenContainer.appendChild(
      Components.createStepper(children, 0, 6, (val) => this.onTravelersChange(this.plan?.adults || 2, val, this.plan?.infants || 0), 'children')
    );
    if (infantsContainer) {
      infantsContainer.appendChild(
        Components.createStepper(infants || 0, 0, 4, (val) => this.onTravelersChange(this.plan?.adults || 2, this.plan?.children || 0, val), 'infants')
      );
    }
  },

  async generateTripPlan(tripData) {
    // Abort any in-flight generation
    if (this._abortController) {
      this._abortController.abort();
    }
    this._abortController = new AbortController();
    const abortSignal = this._abortController.signal;
    this._generating = true;
    this._aborted = false;

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
      if (abortSignal.aborted) { this._generating = false; overlay.style.display = 'none'; return; }
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

      // Fetch city-to-city ground routes for each flight leg (parallel with flights/hotels)
      // Walk legs and track previous city to build proper from/to coordinates
      // (legs don't map 1:1 to destinations — no-airport cities produce flight + train)
      {
        let prevCityLat = iataResults[0].cityCenterLat || tripData.from?.lat;
        let prevCityLng = iataResults[0].cityCenterLng || tripData.from?.lng;
        let cityIdx = 0;
        for (let li = 0; li < flightLegs.length; li++) {
          const leg = flightLegs[li];
          // Store from/to coords on leg for ground route fetch
          leg._grFrom = { lat: prevCityLat, lng: prevCityLng };

          // Determine which city this leg arrives at
          const isReturn = leg.type === 'return';
          if (isReturn) {
            leg._grTo = {
              lat: iataResults[0].cityCenterLat || tripData.from?.lat,
              lng: iataResults[0].cityCenterLng || tripData.from?.lng,
              country: iataResults[0].country,
            };
          } else {
            // Find the destination airport coords for the "to" side
            const destIata = iataResults[cityIdx + 1];
            const dest = tripData.destinations[cityIdx];
            leg._grTo = {
              lat: destIata?.cityCenterLat || dest?.lat,
              lng: destIata?.cityCenterLng || dest?.lng,
              country: destIata?.country,
            };
          }

          // When this leg reaches its target city, advance to next city and update prevCity
          const matchName = leg.toCityName || leg.toName;
          const targetCity = isReturn ? null : tripData.destinations[cityIdx];
          if (!isReturn && targetCity && matchName === targetCity.name) {
            const iata = iataResults[cityIdx + 1];
            prevCityLat = iata?.cityCenterLat || targetCity.lat;
            prevCityLng = iata?.cityCenterLng || targetCity.lng;
            cityIdx++;
          }
        }
      }
      const groundRoutePromise = Promise.all(
        flightLegs.map((leg) => {
          if (leg.legType !== 'flight') return Promise.resolve(null);
          const f = leg._grFrom, t = leg._grTo;
          if (!f?.lat || !f?.lng || !t?.lat || !t?.lng) return Promise.resolve(null);
          return Api.getTransferEstimate(f.lat, f.lng, t.lat, t.lng, t.country, null, null, leg.date)
            .catch(() => null);
        })
      );

      // Fetch transit routes for train legs (airport city → no-airport city)
      const trainRoutePromise = Promise.all(
        flightLegs.map((leg) => {
          if (leg.legType !== 'train') return Promise.resolve(null);
          const f = leg._grFrom, t = leg._grTo;
          if (!f?.lat || !f?.lng || !t?.lat || !t?.lng) return Promise.resolve(null);
          return Api.getTransferEstimate(f.lat, f.lng, t.lat, t.lng, t.country, null, null, leg.date)
            .catch(() => null);
        })
      );

      // Meal costs only need IATA codes — start them immediately in parallel with flights/hotels
      Components.updateLoadingStep(3, 'active');
      const mealCostPromise = Promise.all(
        tripData.destinations.map((dest, i) => {
          const iata = iataResults[i + 1];
          return Api.getMealCosts(iata.cityCode, iata.country).catch(err => {
            console.warn(`Meal costs failed for ${iata.cityCode}:`, err);
            return { cityMeals: null };
          });
        })
      );

      // Wait for flights + hotels + ground routes + train routes + meals (all in parallel)
      const [flightResults, hotelResults, groundRouteResults, trainRouteResults, mealCostResults] = await Promise.all([
        flightSearchPromise, hotelSearchPromise, groundRoutePromise, trainRoutePromise, mealCostPromise
      ]);
      if (abortSignal.aborted) { this._generating = false; overlay.style.display = 'none'; return; }
      Components.updateLoadingStep(1, 'done');
      Components.updateLoadingStep(2, 'done');
      Components.updateLoadingStep(3, 'done');

      // Layover meals need flight results (for layover airports) — quick local data fetch
      const allLayovers = [];
      flightLegs.forEach((leg, i) => {
        if (leg.legType === 'train' || leg.legType === 'skip') return;
        const flights = flightResults[i]?.flights || [];
        if (flights.length > 0 && flights[0].layovers) {
          allLayovers.push(...flights[0].layovers);
        }
      });

      // Hotel offers need hotel list results — start immediately after hotels finish
      Components.updateLoadingStep(4, 'active');
      const [hotelOffers, layoverMealResult] = await Promise.all([
        Promise.all(
          tripData.destinations.map((dest, i) => {
            const hotels = hotelResults[i]?.hotels || [];
            if (hotels.length === 0) return Promise.resolve({ offers: [] });
            const sampleIds = hotels.slice(0, 20).map(h => h.hotelId);
            const checkIn = this.getCityCheckIn(tripData, iataResults, i);
            const cityNights = tripData.destinations[i].nights ?? 1;
            const checkOut = Utils.addDays(checkIn, Math.max(1, cityNights));
            return Api.getHotelOffers(sampleIds, checkIn, checkOut, tripData.adults)
              .catch(() => ({ offers: [] }));
          })
        ),
        allLayovers.length > 0
          ? Api.getMealCosts(null, null, allLayovers).catch(() => ({ layoverMeals: [] }))
          : Promise.resolve({ layoverMeals: [] }),
      ]);
      if (abortSignal.aborted) { this._generating = false; overlay.style.display = 'none'; return; }
      Components.updateLoadingStep(4, 'done');

      // Step 5: Transfer costs via Google Directions (now with actual hotel coords + bidirectional)
      Components.updateLoadingStep(5, 'active');
      this.plan = this.buildPlan(tripData, iataResults, flightLegs, flightResults, hotelResults, hotelOffers, mealCostResults, layoverMealResult, groundRouteResults, trainRouteResults);

      // Re-fetch flights for legs whose dates changed after arrival-date correction
      const legsToRefetch = [];
      this.plan.flightLegs.forEach((leg, i) => {
        if (leg.legType === 'flight' && leg.searchedDate && leg.date !== leg.searchedDate) {
          legsToRefetch.push(i);
        }
      });
      if (legsToRefetch.length > 0) {
        await this.refetchFlights(legsToRefetch);
        this._computeArrivalDates(this.plan.flightLegs, this.plan.cities);
      }

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
      if (abortSignal.aborted) { this._generating = false; return; }
      console.error('Trip generation failed:', err);
      overlay.style.display = 'none';
      this._generating = false;
      const timeline = document.getElementById('results-timeline');
      const errorDiv = document.createElement('div');
      errorDiv.className = 'error-banner';
      errorDiv.innerHTML = `Something went wrong: ${Utils.escapeHtml(err.message)}. Please try again.<br><button onclick="Results.generateTripPlan(Results.tripData)" class="btn-primary" style="margin-top:12px;padding:8px 24px;">Retry</button>`;
      timeline.innerHTML = '';
      timeline.appendChild(errorDiv);
    } finally {
      this._generating = false;
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
    let lastCityName = tripData.from.name;

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
            fromCityName: lastCityName,
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
            fromCityName: lastCityName,
            toCityName: toName,
            date: currentDate,
            type: i === 0 ? 'outbound' : 'inter-city',
            legType: 'flight'
          });
        }
        lastAirportCode = destIata.airportCode;
        lastAirportName = destAirportName;
        lastCityName = toName;
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
            fromCityName: lastCityName,
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
          fromCityName: destIata.nearestCity || lastCityName,
          toCityName: toName,
          date: currentDate,
          type: 'inter-city',
          legType: 'train',
          transitInfo: destIata.transitFromAirport,
        });
        lastAirportCode = nearestAirport;
        lastAirportName = nearestAirportName;
        lastCityName = toName;
      } else {
        // Unknown city with no airport data at all - try flight anyway
        legs.push({
          from: lastAirportCode,
          to: destIata.airportCode || lastAirportCode,
          fromName: lastAirportName,
          toName: destIata.airportName || toName,
          fromCityName: lastCityName,
          toCityName: toName,
          date: currentDate,
          type: 'inter-city',
          legType: 'flight'
        });
        lastCityName = toName;
      }

      // Advance date: 1 day for travel + nights at this destination (default 1 night)
      const cityNights = tripData.destinations[i].nights ?? 1;
      currentDate = Utils.addDays(currentDate, 1 + cityNights);
    }

    // Return leg: from last airport to origin
    const homeName = tripData.from.name;
    if (lastAirportCode === originAirport) {
      // Same airport — skip flight, direct ground transfer home
      legs.push({
        from: lastAirportCode,
        to: null,
        fromName: lastAirportName,
        toName: iataResults[0].cityName || iataResults[0].airportName || originAirport,
        fromCityName: lastCityName,
        toCityName: homeName,
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
        fromCityName: lastCityName,
        toCityName: homeName,
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

  buildPlan(tripData, iataResults, flightLegs, flightResults, hotelResults, hotelOffers, mealCostResults, layoverMealResult, groundRouteResults, trainRouteResults) {
    const cities = tripData.destinations.map((dest, i) => {
      const iata = iataResults[i + 1];
      // Build merged hotel options list
      const hotelOptions = [];
      const seenIds = new Set();
      const hotelListMap = {};
      for (const h of (hotelResults[i]?.hotels || [])) {
        if (h.hotelId) hotelListMap[h.hotelId] = h;
      }
      // Offers first (live pricePerNight)
      for (const offer of (hotelOffers[i]?.offers || [])) {
        if (offer.pricePerNight && !seenIds.has(offer.hotelId)) {
          seenIds.add(offer.hotelId);
          const listEntry = hotelListMap[offer.hotelId];
          hotelOptions.push({
            hotelId: offer.hotelId,
            name: offer.hotelName || listEntry?.name || 'Hotel',
            pricePerNight: offer.pricePerNight,
            roomType: offer.roomType || null,
            distance: listEntry?.distance?.value || null,
            photoUrl: offer.photoUrl || listEntry?.photoUrl || null,
            rating: offer.rating ?? listEntry?.rating ?? null,
            reviewCount: offer.reviewCount ?? listEntry?.reviewCount ?? null,
            listingUrl: offer.listingUrl || listEntry?.listingUrl || null,
            source: 'live',
          });
        }
      }
      // Hotels from list with price not already in offers
      for (const hotel of (hotelResults[i]?.hotels || [])) {
        if (hotel.pricePerNight && !seenIds.has(hotel.hotelId)) {
          seenIds.add(hotel.hotelId);
          hotelOptions.push({
            hotelId: hotel.hotelId,
            name: hotel.name || 'Hotel',
            pricePerNight: hotel.pricePerNight,
            roomType: null,
            distance: hotel.distance?.value || null,
            photoUrl: hotel.photoUrl || null,
            rating: hotel.rating ?? null,
            reviewCount: hotel.reviewCount ?? null,
            listingUrl: hotel.listingUrl || null,
            source: 'estimate',
          });
        }
      }
      // Filter out unverified hotels (no rating & no reviews) when any verified option exists
      const verified = hotelOptions.filter(h => h.rating || h.reviewCount);
      const filtered = verified.length >= 1 ? verified : hotelOptions;
      // Sort by price (cheapest first) — keep up to 20 for dual-column display
      filtered.sort((a, b) => a.pricePerNight - b.pricePerNight);
      hotelOptions.length = 0;
      hotelOptions.push(...filtered.slice(0, 20));

      let hotelBasePrice, hotelPriceSource;
      if (hotelOptions.length > 0) {
        hotelBasePrice = hotelOptions[0].pricePerNight;
        hotelPriceSource = hotelOptions[0].source;
      } else {
        hotelBasePrice = CostEngine.getHotelBasePrice(iata.cityCode);
        hotelPriceSource = 'estimate';
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
        nights: dest.nights ?? 1,
        hotelType: 'comfort',
        hotelBasePrice,
        hotelPriceSource,
        adults: tripData.adults,
        children: tripData.children,
        infants: tripData.infants || 0,
        hotels: hotelResults[i]?.hotels || [],
        lat: dest.lat,
        lng: dest.lng,
        airportLat: iata.airportLat || null,
        airportLng: iata.airportLng || null,
        hotelLat: firstHotel?.geoCode?.latitude || iata.cityCenterLat || dest.lat,
        hotelLng: firstHotel?.geoCode?.longitude || iata.cityCenterLng || dest.lng,
        hotelName: hotelOptions.length > 0 ? hotelOptions[0].name : (firstHotel?.name || null),
        hotelOptions,
        selectedHotel: hotelOptions[0] || null,
        selectedHotelId: hotelOptions[0]?.hotelId || null,
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
          if (!isNaN(dep.getTime()) && !isNaN(arr.getTime()) && durMatch) {
            const durMins = (parseInt(durMatch[1] || '0') * 60) + parseInt(durMatch[2] || '0');
            const expectedArr = new Date(dep.getTime() + durMins * 60000);
            // Compare local dates (not UTC) to avoid timezone shift issues
            const expectedDate = `${expectedArr.getFullYear()}-${String(expectedArr.getMonth()+1).padStart(2,'0')}-${String(expectedArr.getDate()).padStart(2,'0')}`;
            const actualDate = `${arr.getFullYear()}-${String(arr.getMonth()+1).padStart(2,'0')}-${String(arr.getDate()).padStart(2,'0')}`;
            if (expectedDate !== actualDate) {
              arr.setFullYear(expectedArr.getFullYear(), expectedArr.getMonth(), expectedArr.getDate());
              const correctedArr = `${arr.getFullYear()}-${String(arr.getMonth()+1).padStart(2,'0')}-${String(arr.getDate()).padStart(2,'0')}T${String(arr.getHours()).padStart(2,'0')}:${String(arr.getMinutes()).padStart(2,'0')}:00`;
              flight = { ...flight, arrival: correctedArr };
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

      // Enrich train legs with Google Maps transit data
      if (leg.legType === 'train' && trainRouteResults?.[i]) {
        const trainData = trainRouteResults[i];
        const transitRoutes = trainData.transitRoutes || [];
        const bestRoute = transitRoutes[0];
        const enrichedTransit = { ...leg.transitInfo };
        if (bestRoute) {
          if (bestRoute.fareSource === 'google') enrichedTransit.estimatedCostEur = bestRoute.publicTransportCost;
          if (bestRoute.duration) enrichedTransit.duration = bestRoute.duration;
          enrichedTransit.fareSource = bestRoute.fareSource || 'estimate';
        }
        return {
          ...leg,
          trainRoutes: trainData,
          transitInfo: enrichedTransit,
          offers: [],
          selectedOffer: null,
          groundRoutes: null,
          selectedMode: null,
        };
      }

      return {
        ...leg,
        offers: enrichedFlights,
        selectedOffer: enrichedFlights[0] || null,
        groundRoutes: groundRouteResults?.[i] || null,
        selectedMode: 'flight',
      };
    });

    // Save original search dates before arrival-based corrections
    enrichedFlightLegs.forEach(leg => { leg.searchedDate = leg.date; });

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
      infants: tripData.infants || 0,
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

        // Ground modes arrive same-day
        if (leg.selectedMode && leg.selectedMode !== 'flight' && leg.groundRoutes) {
          leg.arrivalDate = leg.date;
          legIdx++;
          if (isForThisCity) {
            cities[i].checkInDate = leg.arrivalDate;
            cities[i].arrivalTime = null;
            break;
          }
          continue;
        }

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
        } else if (leg.selectedMode && leg.selectedMode !== 'flight' && leg.groundRoutes) {
          // Ground transport mode: use duration from ground routes
          leg.scheduleStart = new Date(cursor);
          let durSec = 0;
          if (leg.selectedMode === 'transit') durSec = leg.groundRoutes.transitRoutes?.[0]?.durationSec || 0;
          else if (leg.selectedMode === 'drive') durSec = leg.groundRoutes.driving?.durationSec || 0;
          else if (leg.selectedMode === 'walk') durSec = leg.groundRoutes.walking?.durationSec || 0;
          else if (leg.selectedMode === 'bike') durSec = leg.groundRoutes.bicycling?.durationSec || 0;
          cursor = Utils.addMinutesToDate(cursor, Math.round(durSec / 60));
          leg.scheduleEnd = new Date(cursor);
          legIdx++;
          if (isForThisCity) break;
          continue;
        } else if (leg.legType === 'train') {
          // Train: prefer selected transit route duration, fall back to transitInfo
          leg.scheduleStart = new Date(cursor);
          const bestTransit = leg.trainRoutes?.transitRoutes?.[0];
          const trainDurSec = bestTransit?.durationSec;
          const trainDur = trainDurSec ? Math.round(trainDurSec / 60) : Utils.parseDurationMins(leg.transitInfo?.duration);
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

    // Return flight/train/ground
    const returnLeg = plan.flightLegs[plan.flightLegs.length - 1];
    if (returnLeg && returnLeg.legType !== 'skip') {
      if (returnLeg.selectedMode && returnLeg.selectedMode !== 'flight' && returnLeg.groundRoutes) {
        returnLeg.scheduleStart = new Date(cursor);
        let durSec = 0;
        if (returnLeg.selectedMode === 'transit') durSec = returnLeg.groundRoutes.transitRoutes?.[0]?.durationSec || 0;
        else if (returnLeg.selectedMode === 'drive') durSec = returnLeg.groundRoutes.driving?.durationSec || 0;
        else if (returnLeg.selectedMode === 'walk') durSec = returnLeg.groundRoutes.walking?.durationSec || 0;
        else if (returnLeg.selectedMode === 'bike') durSec = returnLeg.groundRoutes.bicycling?.durationSec || 0;
        cursor = Utils.addMinutesToDate(cursor, Math.round(durSec / 60));
        returnLeg.scheduleEnd = new Date(cursor);
      } else if (returnLeg.legType === 'train') {
        returnLeg.scheduleStart = new Date(cursor);
        const bestTransit = returnLeg.trainRoutes?.transitRoutes?.[0];
        const trainDurSec = bestTransit?.durationSec;
        const trainDur = trainDurSec ? Math.round(trainDurSec / 60) : Utils.parseDurationMins(returnLeg.transitInfo?.duration);
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
        // Sanity check: straight-line distance between coords
        const straightKm = haversineKmClient(oLat, oLng, dLat, dLng);
        // Max reasonable driving distance: 3x straight-line or 300km, whichever is larger
        const maxReasonableKm = Math.max(straightKm * 3, 300);
        try {
          const est = await Api.getTransferEstimate(oLat, oLng, dLat, dLng, country, originText, destText);
          if (est) {
            const drivingKm = est.driving?.distanceKm || 0;
            // If Google returned absurd distance (e.g. routing through another continent), fall back
            if (drivingKm > maxReasonableKm && drivingKm > 500) {
              console.warn(`Transfer ${fromLabel} → ${toLabel}: Google returned ${drivingKm}km but straight-line is ${Math.round(straightKm)}km. Using straight-line fallback.`);
            } else {
              const bestTransit = est.transitRoutes?.[0] || {};
              return {
                from: fromLabel,
                to: toLabel,
                type,
                originLat: oLat, originLng: oLng,
                destLat: dLat, destLng: dLng,
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
          }
        } catch (e) {
          console.warn('Transfer estimate failed:', e);
        }
      }
      // Fallback: rough estimate from straight-line distance
      const distKm = (oLat && oLng && dLat && dLng)
        ? Math.round(haversineKmClient(oLat, oLng, dLat, dLng))
        : 30;
      return {
        from: fromLabel,
        to: toLabel,
        type,
        originLat: oLat, originLng: oLng,
        destLat: dLat, destLng: dLng,
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
        originCountry, null, null
      ));
    } else {
      // Placeholder — will be replaced by direct drive below
      transfers.push(null);
    }

    // Build a map: which leg index leads to which city
    // legType 'skip' for a city means direct drive (no airport needed)
    // BUT if a real flight preceded the skip (e.g. AMS→IDR flight then IDR skip for Ratlam),
    // the city should use normal airport-to-hotel transfers, not direct drive
    const skipCity = [];
    let legIdx = 0;
    for (let i = 0; i < plan.cities.length; i++) {
      let cityIsSkip = false;
      let hadRealFlightBefore = false;
      while (legIdx < flightLegs.length - 1) {
        const leg = flightLegs[legIdx];
        const matchName = leg.toCityName || leg.toName;
        if (leg.legType === 'skip') {
          cityIsSkip = true;
        } else if (leg.legType === 'flight' || leg.legType === 'train') {
          hadRealFlightBefore = true;
        }
        legIdx++;
        if (matchName === plan.cities[i].name) break;
      }
      // Only a pure skip (direct drive) if there was NO real flight to get to the shared airport
      skipCity.push(cityIsSkip && !hadRealFlightBefore);
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
            city.country, null, null)
        );
        cityTransferPromises.push(
          liveTransfer(hotelLabel, stationOrAirportName, `hotel-to-${transferType}`,
            city.hotelLat, city.hotelLng,
            stationOrAirportLat, stationOrAirportLng,
            city.country, null, null)
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
        originCountry, null, null
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

    // Save expanded card state before re-render
    const expandedCards = new Set();
    container.querySelectorAll('.card-header.expanded').forEach(h => {
      const card = h.closest('.timeline-card');
      if (card) expandedCards.add(`${card.dataset.type}-${card.dataset.index}`);
    });

    container.innerHTML = '';

    // Compute schedule times for all cards before rendering
    this._computeTimelineSchedule();

    const plan = this.plan;

    // Stagger animation counter
    let staggerIdx = 0;
    function appendWithStagger(el) {
      if (el.classList && el.classList.contains('timeline-card')) {
        el.style.animationDelay = `${staggerIdx * 60}ms`;
        staggerIdx++;
      }
      container.appendChild(el);
    }

    // Home to airport transfer (skip if type 'none' — direct drive cases)
    if (plan.transfers[0] && plan.transfers[0].type !== 'none') {
      appendWithStagger(Components.createTransferCard(plan.transfers[0], 0));
      appendWithStagger(Components.createConnector());
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
          appendWithStagger(Components.createTrainCard(leg, legIdx));
          appendWithStagger(Components.createConnector());
          legIdx++;
        } else {
          appendWithStagger(Components.createFlightCard(leg, legIdx));
          appendWithStagger(Components.createConnector());
          legIdx++;
        }

        if (isForThisCity || isTrainToCity) break;
      }

      // Arrival transfer — always show (traveler still travels there)
      {
        const arrivalTransferIdx = 1 + i * 2;
        const arrTransfer = plan.transfers[arrivalTransferIdx];
        if (arrTransfer && arrTransfer.type !== 'none') {
          appendWithStagger(Components.createTransferCard(arrTransfer, arrivalTransferIdx));
          appendWithStagger(Components.createConnector());
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
              <h4>${Utils.escapeHtml(plan.cities[i].name)}</h4>
              <span class="card-subtitle">Passing through &middot; no overnight stay</span>
            </div>
            <button class="nights-edit-btn" onclick="event.stopPropagation(); Results.onNightsChange(${i})" style="margin-left:auto">
              <span class="nights-edit-value">0</span> nights
              <span class="nights-edit-icon">&#9998;</span>
            </button>
          </div>
        `;
        appendWithStagger(passCard);
        appendWithStagger(Components.createConnector());
      } else {
        // City stay card
        appendWithStagger(
          Components.createCityCard(plan.cities[i], i)
        );
        appendWithStagger(Components.createConnector());

        // Hotel → Station/Airport transfer (departure) — skip 'none' type
        {
          const departureTransferIdx = 1 + i * 2 + 1;
          const depTransfer = plan.transfers[departureTransferIdx];
          if (depTransfer && depTransfer.type !== 'none') {
            appendWithStagger(Components.createTransferCard(depTransfer, departureTransferIdx));
            appendWithStagger(Components.createConnector());
          }
        }
      }
    }

    // Return leg (always the last leg)
    const returnLeg = plan.flightLegs[plan.flightLegs.length - 1];
    if (returnLeg.legType === 'skip') {
      // Same airport — no flight card for return
    } else if (returnLeg.legType === 'train') {
      appendWithStagger(Components.createTrainCard(returnLeg, plan.flightLegs.length - 1));
      appendWithStagger(Components.createConnector());
    } else {
      appendWithStagger(Components.createFlightCard(returnLeg, plan.flightLegs.length - 1));
      appendWithStagger(Components.createConnector());
    }

    // Airport to home transfer (or direct drive home)
    const lastTransferIdx = plan.transfers.length - 1;
    const lastTransfer = plan.transfers[lastTransferIdx];
    if (lastTransfer && lastTransfer.type !== 'none') {
      appendWithStagger(Components.createTransferCard(lastTransfer, lastTransferIdx));
    }

    // Restore expanded card state
    expandedCards.forEach(key => {
      const [type, index] = key.split('-');
      const card = container.querySelector(`.timeline-card[data-type="${type}"][data-index="${index}"]`);
      if (card) {
        const header = card.querySelector('.card-header');
        const body = card.querySelector('.card-body');
        if (header && body) {
          header.classList.add('expanded');
          body.classList.add('expanded');
          body.style.maxHeight = body.scrollHeight + 'px';
          body.style.opacity = '1';
          body.style.paddingTop = '';
        }
      }
    });
  },

  async onNightsChange(cityIndex) {
    const city = this.plan.cities[cityIndex];
    const result = await this._showNightsPopup(city.name, city.nights);
    if (result === null) return; // cancelled

    const wasZero = city.nights === 0;
    city.nights = result;
    const isZero = result === 0;

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

  _showNightsPopup(cityName, currentNights) {
    return new Promise(resolve => {
      let nights = currentNights;
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';

      function render() {
        overlay.innerHTML = `
          <div class="confirm-popup nights-popup">
            <h3>Nights in ${Utils.escapeHtml(cityName)}</h3>
            <p>Changing nights will recalculate flight dates, transfers, and costs.</p>
            <div class="nights-popup-stepper">
              <button class="nights-popup-btn minus" ${nights <= 0 ? 'disabled' : ''}>−</button>
              <span class="nights-popup-value">${nights}</span>
              <button class="nights-popup-btn plus" ${nights >= 14 ? 'disabled' : ''}>+</button>
              <span class="nights-popup-label">night${nights !== 1 ? 's' : ''}</span>
            </div>
            <div class="confirm-actions">
              <button class="confirm-btn cancel">Cancel</button>
              <button class="confirm-btn confirm" ${nights === currentNights ? 'disabled' : ''}>Apply</button>
            </div>
          </div>
        `;

        overlay.querySelector('.minus').addEventListener('click', () => {
          if (nights > 0) { nights--; render(); }
        });
        overlay.querySelector('.plus').addEventListener('click', () => {
          if (nights < 14) { nights++; render(); }
        });
        overlay.querySelector('.cancel').addEventListener('click', () => {
          overlay.classList.remove('visible');
          setTimeout(() => overlay.remove(), 200);
          resolve(null);
        });
        overlay.querySelector('.confirm').addEventListener('click', () => {
          if (nights === currentNights) return;
          overlay.classList.remove('visible');
          setTimeout(() => overlay.remove(), 200);
          resolve(nights);
        });
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) {
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 200);
            resolve(null);
          }
        });
      }

      render();
      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('visible'));
    });
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
            originLat, originLng,
            destLat, destLng,
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
            originLat: destLat, originLng: destLng,
            destLat: plan.from.cityLat, destLng: plan.from.cityLng,
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
          const est = await Api.getTransferEstimate(destLat, destLng, stLat, stLng, city.country, null, null);
          if (est) {
            const bestTransit = est.transitRoutes?.[0] || {};
            Object.assign(depTransfer, {
              from: destLabel,
              to: stationName,
              originLat: destLat, originLng: destLng,
              destLat: stLat, destLng: stLng,
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

  // When user switches a flight leg to ground mode (or back), recalculate
  // adjacent transfers so they route via station/city center instead of airport.
  async _recalcTransfersForMode(legIndex) {
    const plan = this.plan;
    const leg = plan.flightLegs[legIndex];
    if (!leg) return;

    const isGround = leg.selectedMode && leg.selectedMode !== 'flight';

    // Extract real station names from the transit route's first/last TRANSIT steps
    let depStationName = null, arrStationName = null;
    if (isGround && leg.groundRoutes?.transitRoutes?.[0]?.steps) {
      const steps = leg.groundRoutes.transitRoutes[0].steps;
      const transitSteps = steps.filter(s => s.mode === 'TRANSIT');
      if (transitSteps.length > 0) {
        depStationName = transitSteps[0].departureStop || null;
        arrStationName = transitSteps[transitSteps.length - 1].arrivalStop || null;
      }
    }

    // Walk legs to find departure city index (city before this leg)
    let ci = 0;
    for (let li = 0; li < legIndex; li++) {
      const name = plan.flightLegs[li].toCityName || plan.flightLegs[li].toName;
      if (ci < plan.cities.length && name === plan.cities[ci].name) ci++;
    }
    const depCityIdx = ci - 1; // -1 = home/origin

    // Find arrival city: match toCityName, or look ahead for intermediate legs
    let arrCityIdx = -1;
    if (leg.type !== 'return') {
      const dest = leg.toCityName || leg.toName;
      arrCityIdx = plan.cities.findIndex(c => c.name === dest);
      if (arrCityIdx < 0) {
        for (let li = legIndex + 1; li < plan.flightLegs.length; li++) {
          const n = plan.flightLegs[li].toCityName || plan.flightLegs[li].toName;
          arrCityIdx = plan.cities.findIndex(c => c.name === n);
          if (arrCityIdx >= 0) break;
        }
      }
    }

    // Helper: fetch new transfer routing and update in-place
    async function refetchTransfer(t, fLat, fLng, tLat, tLng, fromLabel, toLabel, type, country) {
      if (!t || !fLat || !fLng || !tLat || !tLng) return;
      try {
        const est = await Api.getTransferEstimate(fLat, fLng, tLat, tLng, country);
        if (est) {
          const bt = est.transitRoutes?.[0] || {};
          Object.assign(t, {
            from: fromLabel, to: toLabel, type,
            originLat: fLat, originLng: fLng, destLat: tLat, destLng: tLng,
            distanceKm: est.driving.distanceKm, durationText: est.driving.duration,
            drivingSummary: est.driving.summary, taxiCost: est.driving.taxiCost,
            publicTransportCost: bt.publicTransportCost || 1,
            transitDuration: bt.duration || est.driving.duration,
            transitRoutes: est.transitRoutes || [], walking: est.walking || null, bicycling: est.bicycling || null,
          });
        }
      } catch (e) { console.warn('Transfer recalc for mode change failed:', e); }
    }

    // Build ground-mode label for a city: use real station name if available, else "City Station"
    function groundLabel(cityName, stationName) {
      return stationName || `${cityName} Station`;
    }

    const promises = [];

    // --- Departure side: recalculate transfer FROM departure city ---
    if (depCityIdx >= 0) {
      const city = plan.cities[depCityIdx];
      const tIdx = 1 + depCityIdx * 2 + 1; // departure transfer
      const t = plan.transfers[tIdx];
      if (t && t.type !== 'none') {
        const hotelLabel = city.hotelName ? `${city.hotelName}, ${city.name}` : `${city.name} Hotel`;
        const pointLat = isGround ? (city.lat || city.hotelLat) : (city.airportLat || city.lat);
        const pointLng = isGround ? (city.lng || city.hotelLng) : (city.airportLng || city.lng);
        const pointLabel = isGround ? groundLabel(city.name, depStationName) : (city.airportName || `${city.name} Airport`);
        const type = isGround ? 'hotel-to-station' : `hotel-to-${city.hasAirport ? 'airport' : 'station'}`;
        promises.push(refetchTransfer(t, city.hotelLat, city.hotelLng, pointLat, pointLng, hotelLabel, pointLabel, type, city.country));
      }
    } else {
      // Home → airport/station (transfers[0])
      const t = plan.transfers[0];
      if (t && t.type !== 'none') {
        const homeLabel = plan.from.name || plan.from.cityName;
        const pointLat = isGround ? plan.from.cityLat : plan.from.airportLat;
        const pointLng = isGround ? plan.from.cityLng : plan.from.airportLng;
        const pointLabel = isGround ? groundLabel(homeLabel, depStationName) : (plan.from.airportName || 'Airport');
        const type = isGround ? 'home-to-station' : 'home-to-airport';
        promises.push(refetchTransfer(t, plan.from.cityLat, plan.from.cityLng, pointLat, pointLng, homeLabel, pointLabel, type, plan.from.country));
      }
    }

    // --- Arrival side: recalculate transfer TO arrival city ---
    if (arrCityIdx >= 0) {
      const city = plan.cities[arrCityIdx];
      // Only recalculate for cities with airports; no-airport cities already use station routing
      if (city.hasAirport) {
        const tIdx = 1 + arrCityIdx * 2; // arrival transfer
        const t = plan.transfers[tIdx];
        if (t && t.type !== 'none') {
          const hotelLabel = city.hotelName ? `${city.hotelName}, ${city.name}` : `${city.name} Hotel`;
          const pointLat = isGround ? (city.lat || city.hotelLat) : (city.airportLat || city.lat);
          const pointLng = isGround ? (city.lng || city.hotelLng) : (city.airportLng || city.lng);
          const pointLabel = isGround ? groundLabel(city.name, arrStationName) : (city.airportName || `${city.name} Airport`);
          const type = isGround ? 'station-to-hotel' : 'airport-to-hotel';
          promises.push(refetchTransfer(t, pointLat, pointLng, city.hotelLat, city.hotelLng, pointLabel, hotelLabel, type, city.country));
        }
      }
    } else if (leg.type === 'return') {
      // Station/airport → home (transfers[last])
      const lastIdx = plan.transfers.length - 1;
      const t = plan.transfers[lastIdx];
      if (t && t.type !== 'none') {
        const homeLabel = plan.from.name || plan.from.cityName;
        const pointLat = isGround ? plan.from.cityLat : plan.from.airportLat;
        const pointLng = isGround ? plan.from.cityLng : plan.from.airportLng;
        const pointLabel = isGround ? groundLabel(homeLabel, arrStationName) : (plan.from.airportName || 'Airport');
        const type = isGround ? 'station-to-home' : 'airport-to-home';
        promises.push(refetchTransfer(t, pointLat, pointLng, plan.from.cityLat, plan.from.cityLng, pointLabel, homeLabel, type, plan.from.country));
      }
    }

    await Promise.all(promises);
  },

  _showConfirmPopup(title, message) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-popup">
          <h3>${Utils.escapeHtml(title)}</h3>
          <p>${Utils.escapeHtml(message)}</p>
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
        // Ground modes arrive same-day; flights use offer arrival
        if (leg.selectedMode && leg.selectedMode !== 'flight' && leg.groundRoutes) {
          arrivalDate = currentDate;
        } else {
          const offerArrival = Utils.getArrivalDate(leg.selectedOffer);
          arrivalDate = offerArrival || currentDate;
        }
        leg.arrivalDate = arrivalDate;

        const matchName = leg.toCityName || leg.toName;
        const isForThisCity = matchName === plan.cities[i].name;
        legIdx++;
        if (isForThisCity) break;
      }
      // City check-in is the arrival date of the flight, not the departure date
      plan.cities[i].checkInDate = arrivalDate;
      // Find the leg that just arrived at this city and store arrival time
      const arrivedLeg = legIdx > 0 ? plan.flightLegs[legIdx - 1] : null;
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
      if (leg.selectedMode && leg.selectedMode !== 'flight') return;
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

  selectHotelOption(cityIndex, optionIndex) {
    const city = this.plan.cities[cityIndex];
    if (!city || !city.hotelOptions || !city.hotelOptions[optionIndex]) return;

    const selected = city.hotelOptions[optionIndex];
    city.selectedHotel = selected;
    city.selectedHotelId = selected.hotelId;
    city.hotelBasePrice = selected.pricePerNight;
    city.hotelName = selected.name;

    // Update adjacent transfer labels to reflect new hotel name
    const newHotelLabel = selected.name ? `${selected.name}, ${city.name}` : `${city.name} Hotel`;
    const arrIdx = 1 + cityIndex * 2;
    const depIdx = 1 + cityIndex * 2 + 1;
    if (this.plan.transfers[arrIdx] && this.plan.transfers[arrIdx].type !== 'none') {
      this.plan.transfers[arrIdx].to = newHotelLabel;
    }
    if (this.plan.transfers[depIdx] && this.plan.transfers[depIdx].type !== 'none') {
      this.plan.transfers[depIdx].from = newHotelLabel;
    }
    // If last city, also update the final transfer (direct-drive home uses hotel label)
    if (cityIndex === this.plan.cities.length - 1) {
      const lastIdx = this.plan.transfers.length - 1;
      const lastTransfer = this.plan.transfers[lastIdx];
      if (lastTransfer && lastTransfer.type === 'direct-drive') {
        lastTransfer.from = newHotelLabel;
      }
    }

    // Re-render this city card in-place
    const oldCard = document.querySelector(`.timeline-card[data-type="city"][data-index="${cityIndex}"]`);
    if (oldCard) {
      const newCard = Components.createCityCard(city, cityIndex);
      oldCard.replaceWith(newCard);
    }

    // Re-render adjacent transfer cards with updated hotel name
    if (this.plan.transfers[arrIdx] && this.plan.transfers[arrIdx].type !== 'none') {
      const oldArr = document.querySelector(`.timeline-card[data-type="transfer"][data-index="${arrIdx}"]`);
      if (oldArr) oldArr.replaceWith(Components.createTransferCard(this.plan.transfers[arrIdx], arrIdx));
    }
    if (this.plan.transfers[depIdx] && this.plan.transfers[depIdx].type !== 'none') {
      const oldDep = document.querySelector(`.timeline-card[data-type="transfer"][data-index="${depIdx}"]`);
      if (oldDep) oldDep.replaceWith(Components.createTransferCard(this.plan.transfers[depIdx], depIdx));
    }
    // Also re-render last transfer if it was updated
    if (cityIndex === this.plan.cities.length - 1) {
      const lastIdx = this.plan.transfers.length - 1;
      const lastTransfer = this.plan.transfers[lastIdx];
      if (lastTransfer && lastTransfer.type !== 'none') {
        const oldLast = document.querySelector(`.timeline-card[data-type="transfer"][data-index="${lastIdx}"]`);
        if (oldLast) oldLast.replaceWith(Components.createTransferCard(lastTransfer, lastIdx));
      }
    }

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

  onTravelersChange(adults, children, infants) {
    this.plan.adults = adults;
    this.plan.children = children;
    this.plan.infants = infants || 0;
    this.plan.cities.forEach(c => { c.adults = adults; c.children = children; c.infants = infants || 0; });
    this.recalculateAndRenderCost();
  },

  async showAirportPicker(legIndex, side) {
    const leg = this.plan?.flightLegs?.[legIndex];
    if (!leg) return;

    // Determine which city's coords to use
    let lat, lng, currentCode;
    if (side === 'from') {
      if (legIndex === 0) {
        lat = this.plan.from.cityLat || this.plan.from.lat;
        lng = this.plan.from.cityLng || this.plan.from.lng;
      } else {
        const prevCity = this.plan.cities[legIndex - 1];
        lat = prevCity?.lat; lng = prevCity?.lng;
      }
      currentCode = leg.from;
    } else {
      const city = this.plan.cities[legIndex];
      lat = city?.lat; lng = city?.lng;
      currentCode = leg.to;
    }

    if (!lat || !lng) return;

    // Fetch nearby airports
    const nearbyAirports = await Api.getNearbyAirports(lat, lng);

    // Build popup
    const overlay = document.createElement('div');
    overlay.className = 'popup-overlay';
    overlay.innerHTML = `
      <div class="airport-picker-popup">
        <h3>Select Airport</h3>
        <div class="airport-search-box">
          <input type="text" class="airport-search-input" placeholder="Search any airport..." autocomplete="off">
        </div>
        <div class="airport-picker-section nearby-section">
          <div class="airport-section-label">Nearby Airports</div>
          <div class="airport-picker-list" id="nearby-airport-list">
            ${this._renderAirportItems(nearbyAirports, currentCode, true)}
          </div>
        </div>
        <div class="airport-picker-section search-section" style="display:none">
          <div class="airport-section-label">Search Results</div>
          <div class="airport-picker-list" id="search-airport-list"></div>
        </div>
        <button class="popup-cancel-btn" onclick="this.closest('.popup-overlay').remove()">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Bind click handlers for airport items
    const bindItemClicks = (container) => {
      container.querySelectorAll('.airport-picker-item').forEach(item => {
        item.addEventListener('click', async () => {
          const newCode = item.dataset.code;
          const newName = item.dataset.name;
          overlay.remove();
          if (newCode === currentCode) return;
          await this.changeFlightAirport(legIndex, side, newCode, newName);
        });
      });
    };
    bindItemClicks(overlay.querySelector('#nearby-airport-list'));

    // Search input with debounce
    const searchInput = overlay.querySelector('.airport-search-input');
    const nearbySection = overlay.querySelector('.nearby-section');
    const searchSection = overlay.querySelector('.search-section');
    const searchList = overlay.querySelector('#search-airport-list');
    const nearbyList = overlay.querySelector('#nearby-airport-list');
    let searchTimer = null;

    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();

      // Filter nearby list client-side
      if (q) {
        const lower = q.toLowerCase();
        const filtered = nearbyAirports.filter(a =>
          a.name.toLowerCase().includes(lower) || a.code.toLowerCase().includes(lower)
        );
        nearbyList.innerHTML = filtered.length
          ? this._renderAirportItems(filtered, currentCode, true)
          : '<div class="airport-no-results">No nearby matches</div>';
        bindItemClicks(nearbyList);
      } else {
        nearbyList.innerHTML = this._renderAirportItems(nearbyAirports, currentCode, true);
        bindItemClicks(nearbyList);
        searchSection.style.display = 'none';
        return;
      }

      // Remote search after 300ms for 2+ chars
      if (q.length >= 2) {
        searchTimer = setTimeout(async () => {
          searchList.innerHTML = '<div class="airport-search-loading">Searching...</div>';
          searchSection.style.display = '';
          const results = await Api.searchAirports(q);
          // Filter out airports already in nearby list
          const nearbyCodes = new Set(nearbyAirports.map(a => a.code));
          const extra = results.filter(a => !nearbyCodes.has(a.code));
          if (extra.length) {
            searchList.innerHTML = this._renderAirportItems(extra, currentCode, false);
            bindItemClicks(searchList);
          } else {
            searchList.innerHTML = '<div class="airport-no-results">No additional airports found</div>';
          }
        }, 300);
      } else {
        searchSection.style.display = 'none';
      }
    });

    searchInput.focus();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  },

  _renderAirportItems(airports, currentCode, showDistance) {
    if (!airports || airports.length === 0) return '<div class="airport-no-results">No airports found</div>';
    return airports.map(a => {
      const subtitle = showDistance && a.distance != null
        ? `${a.distance} km away`
        : [a.city, a.country].filter(Boolean).join(', ');
      return `
        <div class="airport-picker-item${a.code === currentCode ? ' selected' : ''}" data-code="${Utils.escapeHtml(a.code)}" data-name="${Utils.escapeHtml(a.name)}">
          <div class="airport-picker-code">${Utils.escapeHtml(a.code)}</div>
          <div class="airport-picker-info">
            <div class="airport-picker-name">${Utils.escapeHtml(a.name)}</div>
            <div class="airport-picker-dist">${Utils.escapeHtml(subtitle)}</div>
          </div>
        </div>`;
    }).join('');
  },

  async changeFlightAirport(legIndex, side, newCode, newName) {
    const leg = this.plan.flightLegs[legIndex];
    if (!leg) return;

    if (side === 'from') {
      leg.from = newCode;
      leg.fromName = newName;
    } else {
      leg.to = newCode;
      leg.toName = newName;
    }

    // Re-fetch flights for this leg
    const overlay = document.getElementById('loading-overlay');
    overlay.style.display = 'flex';
    Components.renderLoadingSteps(['Searching flights...']);
    try {
      const result = await Api.searchFlights(leg.from, leg.to, leg.date, this.plan.adults, this.plan.children);
      const flights = result?.flights || [];
      leg.offers = flights;
      leg.selectedOffer = flights[0] || null;
    } catch (e) {
      console.warn('Flight re-fetch failed:', e);
    }
    overlay.style.display = 'none';

    // Re-render flight card
    const oldCard = document.querySelector(`.timeline-card[data-type="flight"][data-index="${legIndex}"]`);
    if (oldCard) {
      oldCard.replaceWith(Components.createFlightCard(leg, legIndex));
    }

    // Recompute schedule & costs
    this._computeTimelineSchedule();
    this.renderTimeline();
    this.recalculateAndRenderCost();
  },

  recalculateAndRenderCost() {
    clearTimeout(this._costRecalcTimer);
    this._costRecalcTimer = setTimeout(() => {
      this.renderCostSidebar();
    }, 50);
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
          <span class="cost-line-label"><span class="icon">&#9992;&#65039;</span> Transport (${this.plan.flightLegs.filter(l => l.legType === 'flight' || l.legType === 'train').length} legs)</span>
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
        ts.textContent = `${this.plan.adults} adult${this.plan.adults > 1 ? 's' : ''}${this.plan.children > 0 ? ` · ${this.plan.children} child${this.plan.children > 1 ? 'ren' : ''}` : ''}${this.plan.infants > 0 ? ` · ${this.plan.infants} infant${this.plan.infants > 1 ? 's' : ''}` : ''} · ${CostEngine.calculateRooms(this.plan.adults)} room${CostEngine.calculateRooms(this.plan.adults) > 1 ? 's' : ''}`;
        footer.insertBefore(ts, footer.firstChild);
      }
    } else {
      travelersEl.textContent = `${this.plan.adults} adult${this.plan.adults > 1 ? 's' : ''}${this.plan.children > 0 ? ` · ${this.plan.children} child${this.plan.children > 1 ? 'ren' : ''}` : ''}${this.plan.infants > 0 ? ` · ${this.plan.infants} infant${this.plan.infants > 1 ? 's' : ''}` : ''} · ${CostEngine.calculateRooms(this.plan.adults)} room${CostEngine.calculateRooms(this.plan.adults) > 1 ? 's' : ''}`;
    }

    // Mobile bottom sheet
    const mobileTotal = document.getElementById('mobile-total');
    if (mobileTotal) {
      mobileTotal.innerHTML = `
        <span class="label">Estimated Total</span>
        ${Utils.formatCurrencyRange(costs.total.low, costs.total.high, 'EUR')}
      `;
    }

    // Populate bottom sheet full breakdown
    const bottomSheetFull = document.getElementById('bottom-sheet-full');
    if (bottomSheetFull && breakdownEl) {
      bottomSheetFull.innerHTML = `
        <div class="cost-breakdown">${breakdownEl.innerHTML}</div>
        <div class="cost-footer">
          <span class="travelers-summary">${this.plan.adults} adult${this.plan.adults > 1 ? 's' : ''}${this.plan.children > 0 ? ', ' + this.plan.children + ' child' + (this.plan.children > 1 ? 'ren' : '') : ''} · ${CostEngine.calculateRooms(this.plan.adults)} room${CostEngine.calculateRooms(this.plan.adults) > 1 ? 's' : ''}</span>
          <span class="estimate-note">Estimated prices based on available data.</span>
        </div>
      `;
    }
  },
};
