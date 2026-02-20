const Itinerary = {
  _plan: null,
  _dragSrcId: null,

  // ── Build the day-by-day itinerary from plan data ──
  buildDays(plan, aiResult, placeData, transitData) {
    const days = [];
    let dayNum = 1;
    let segCounter = 0;
    const segId = () => `seg-${segCounter++}`;

    // Day 1: Travel to first city
    days.push(this._buildTravelDay(dayNum++, plan, 0, 'outbound', segId));

    // For each city
    for (let ci = 0; ci < plan.cities.length; ci++) {
      const city = plan.cities[ci];
      const cityActivities = aiResult?.days?.filter(d => {
        const dCity = (d.city || '').toLowerCase();
        const pCity = (city.name || '').toLowerCase();
        return dCity === pCity || pCity.includes(dCity) || dCity.includes(pCity);
      }) || [];

      // Activity days for this city
      for (let n = 0; n < city.nights; n++) {
        const dayActs = cityActivities[n]?.activities || [];
        days.push(this._buildActivityDay(dayNum++, plan, ci, n, dayActs, placeData, transitData, segId));
      }

      // Intercity travel day (if not last city)
      if (ci < plan.cities.length - 1) {
        const legIndex = this._findIntercityLeg(plan, ci);
        days.push(this._buildTravelDay(dayNum++, plan, legIndex, 'intercity', segId));
      }
    }

    // Return day (round-trip only)
    if (plan.tripMode !== 'oneway') {
      days.push(this._buildTravelDay(dayNum++, plan, plan.flightLegs.length - 1, 'return', segId));
    }

    plan.itinerary = days;
    this._plan = plan;

    // Compute per-day costs
    days.forEach(day => {
      day.dayCost = this._computeDayCost(day, plan);
    });
  },

  _findIntercityLeg(plan, cityIndex) {
    // Find the flight leg index that departs from city[cityIndex] to city[cityIndex+1]
    let legIdx = 0;
    let citiesPassed = 0;
    for (let li = 0; li < plan.flightLegs.length; li++) {
      const leg = plan.flightLegs[li];
      const matchName = leg.toCityName || leg.toName;
      if (matchName === plan.cities[citiesPassed]?.name) {
        citiesPassed++;
        if (citiesPassed > cityIndex) {
          // The next leg(s) go to cityIndex+1
          return li + 1;
        }
      }
    }
    return Math.min(cityIndex + 1, plan.flightLegs.length - 1);
  },

  // ── Buffer via entry (security / baggage) ──
  _bufferVia(type, durationMin, anchorTime) {
    const label = type === 'security' ? 'Security' : 'Baggage';
    const icon = type === 'security' ? 'security' : 'luggage';
    let startTime = null, endTime = null;
    if (anchorTime instanceof Date && !isNaN(anchorTime)) {
      if (type === 'security') {
        // security ends at anchorTime (flight departure), starts durationMin before
        endTime = new Date(anchorTime);
        startTime = new Date(anchorTime.getTime() - durationMin * 60000);
      } else {
        // baggage starts at anchorTime (flight arrival), ends durationMin after
        startTime = new Date(anchorTime);
        endTime = new Date(anchorTime.getTime() + durationMin * 60000);
      }
    }
    return {
      mode: 'buffer',
      icon,
      label,
      duration: `${durationMin} min`,
      cost: 0,
      isBuffer: true,
      startTime,
      endTime,
    };
  },

  // ── Check-in status relative to standard 3 PM ──
  _getCheckInStatus(arrivalTime, checkInTime) {
    if (!arrivalTime || !checkInTime || !(arrivalTime instanceof Date) || !(checkInTime instanceof Date)) return null;
    if (isNaN(arrivalTime) || isNaN(checkInTime)) return null;
    const diffMin = (arrivalTime.getTime() - checkInTime.getTime()) / 60000;
    if (diffMin < -30) return 'early';  // arriving >30min before 3PM
    if (diffMin > 30) return 'late';    // arriving >30min after 3PM
    return 'ontime';
  },

  _buildTravelDay(dayNum, plan, legIndex, travelType, segId) {
    let label = '';
    let from, to, via = [], cityIndex;

    if (travelType === 'outbound') {
      const city = plan.cities[0];
      label = `Travel to ${city?.name || 'Destination'}`;
      cityIndex = 0;
      const t0 = plan.transfers[0];
      from = {
        label: 'HOME', sublabel: plan.from.name,
        time: t0?.scheduleStart || null,
      };
      to = {
        label: 'HTL',
        sublabel: city?.hotelName || `Hotel ${city?.name}`,
        isHotel: true,
        lat: city?.hotelLat, lng: city?.hotelLng,
      };
      // home → airport
      if (t0 && t0.type !== 'none') via.push(this._transferVia(t0, 0, 'To Airport'));
      // flight
      const leg = plan.flightLegs[0];
      const isActualFlight = leg && leg.legType !== 'skip' && (!leg.selectedMode || leg.selectedMode === 'flight') && leg.legType !== 'train';
      if (leg && leg.legType !== 'skip') {
        // Insert security buffer before flight (only for actual flights)
        if (isActualFlight && leg.scheduleStart) {
          via.push(this._bufferVia('security', 120, leg.scheduleStart));
        }
        via.push(this._flightVia(leg, 0));
        // Insert baggage buffer after flight (only for actual flights)
        if (isActualFlight && leg.scheduleEnd) {
          via.push(this._bufferVia('baggage', 30, leg.scheduleEnd));
        }
      }
      // airport → hotel
      const t1 = plan.transfers[1];
      if (t1 && t1.type !== 'none') via.push(this._transferVia(t1, 1, 'To Hotel'));
      // Attach arrival info to 'to'
      const arrTransfer = plan.transfers[1];
      to.arriveTime = arrTransfer?.scheduleEnd || city?.travelerArrival || null;
      to.hotelCheckIn = city?.hotelCheckIn || null;
      to.checkInStatus = this._getCheckInStatus(to.arriveTime, to.hotelCheckIn);

    } else if (travelType === 'return') {
      const lastCityIdx = plan.cities.length - 1;
      const lastCity = plan.cities[lastCityIdx];
      label = `Return to ${plan.from.name || 'Home'}`;
      const depIdx = 1 + lastCityIdx * 2 + 1;
      const depT = plan.transfers[depIdx];
      from = {
        label: 'HTL',
        sublabel: lastCity?.hotelName || `Hotel ${lastCity?.name}`,
        isHotel: true,
        time: lastCity?.hotelCheckOut || depT?.scheduleStart || null,
        isCheckOut: true,
      };
      to = { label: 'HOME', sublabel: plan.from.name };
      // hotel → airport
      if (depT && depT.type !== 'none') via.push(this._transferVia(depT, depIdx, 'To Airport'));
      // flight
      const fIdx = plan.flightLegs.length - 1;
      const leg = plan.flightLegs[fIdx];
      const isActualFlight = leg && leg.legType !== 'skip' && (!leg.selectedMode || leg.selectedMode === 'flight') && leg.legType !== 'train';
      if (leg && leg.legType !== 'skip') {
        if (isActualFlight && leg.scheduleStart) {
          via.push(this._bufferVia('security', 120, leg.scheduleStart));
        }
        via.push(this._flightVia(leg, fIdx));
        if (isActualFlight && leg.scheduleEnd) {
          via.push(this._bufferVia('baggage', 30, leg.scheduleEnd));
        }
      }
      // airport → home
      const lastTIdx = plan.transfers.length - 1;
      const lastT = plan.transfers[lastTIdx];
      if (lastT && lastT.type !== 'none') via.push(this._transferVia(lastT, lastTIdx, 'To Home'));
      // Attach arrival time on HOME
      to.arriveTime = lastT?.scheduleEnd || null;

    } else if (travelType === 'intercity') {
      // Find which city this leg goes to
      let targetCityIdx = 0;
      for (let ci = 0; ci < plan.cities.length; ci++) {
        const leg = plan.flightLegs[legIndex];
        if (leg && (leg.toCityName === plan.cities[ci].name || leg.toName === plan.cities[ci].name)) {
          targetCityIdx = ci;
          break;
        }
      }
      const fromCityIdx = targetCityIdx > 0 ? targetCityIdx - 1 : 0;
      const fromCity = plan.cities[fromCityIdx];
      const toCity = plan.cities[targetCityIdx] || plan.cities[plan.cities.length - 1];
      label = `Travel to ${toCity.name}`;
      cityIndex = targetCityIdx;
      const depIdx = 1 + fromCityIdx * 2 + 1;
      const depT = plan.transfers[depIdx];
      from = {
        label: 'HTL',
        sublabel: fromCity?.hotelName || `Hotel ${fromCity?.name}`,
        isHotel: true,
        time: fromCity?.hotelCheckOut || depT?.scheduleStart || null,
        isCheckOut: true,
      };
      to = {
        label: 'HTL',
        sublabel: toCity?.hotelName || `Hotel ${toCity?.name}`,
        isHotel: true,
        lat: toCity?.hotelLat, lng: toCity?.hotelLng,
      };
      // hotel → airport (departure)
      if (depT && depT.type !== 'none') via.push(this._transferVia(depT, depIdx, 'To Airport'));
      // flight
      const leg = plan.flightLegs[legIndex];
      const isActualFlight = leg && leg.legType !== 'skip' && (!leg.selectedMode || leg.selectedMode === 'flight') && leg.legType !== 'train';
      if (leg && leg.legType !== 'skip') {
        if (isActualFlight && leg.scheduleStart) {
          via.push(this._bufferVia('security', 120, leg.scheduleStart));
        }
        via.push(this._flightVia(leg, legIndex));
        if (isActualFlight && leg.scheduleEnd) {
          via.push(this._bufferVia('baggage', 30, leg.scheduleEnd));
        }
      }
      // airport → hotel (arrival)
      const arrIdx = 1 + targetCityIdx * 2;
      const arrT = plan.transfers[arrIdx];
      if (arrT && arrT.type !== 'none') via.push(this._transferVia(arrT, arrIdx, 'To Hotel'));
      // Attach arrival info to 'to'
      to.arriveTime = arrT?.scheduleEnd || toCity?.travelerArrival || null;
      to.hotelCheckIn = toCity?.hotelCheckIn || null;
      to.checkInStatus = this._getCheckInStatus(to.arriveTime, to.hotelCheckIn);
    }

    const totalCost = via.filter(v => !v.isBuffer).reduce((s, v) => s + (v.cost || 0), 0);
    const segments = [{
      id: segId(),
      from,
      to,
      via,
      cost: { low: totalCost, high: totalCost },
      cityIndex,
    }];

    return {
      dayNumber: dayNum,
      type: travelType === 'intercity' ? 'intercity' : 'travel',
      label,
      segments,
      legIndex,
      dayCost: { low: 0, high: 0 },
    };
  },

  _transferVia(transfer, transferIdx, label) {
    const mode = transfer.selectedMode || 'transit';
    let perTrip;
    if (mode === 'taxi') {
      perTrip = transfer.taxiCost || 0; // taxi is shared fare
    } else if (mode === 'walk' || mode === 'bike') {
      perTrip = 0;
    } else {
      const plan = this._plan;
      const passengers = ((plan?.adults || 1) + (plan?.children || 0));
      perTrip = (transfer.publicTransportCost || 0) * passengers;
    }
    return {
      mode,
      icon: this._modeIcon(mode),
      label: label || undefined,
      duration: transfer.transitDuration || transfer.durationText || '',
      cost: perTrip,
      sourceRef: `transfer:${transferIdx}`,
      startTime: transfer.scheduleStart || null,
      endTime: transfer.scheduleEnd || null,
    };
  },

  _flightVia(leg, legIndex) {
    const offer = leg.selectedOffer;
    const durMatch = offer?.duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
    const durStr = durMatch ? `${durMatch[1] || 0}h ${durMatch[2] || 0}m` : '';
    let modeIcon = 'flight', modeLabel = 'flight';
    if (leg.legType === 'train') { modeIcon = 'train'; modeLabel = 'train'; }
    else if (leg.selectedMode && leg.selectedMode !== 'flight') {
      modeIcon = this._modeIcon(leg.selectedMode); modeLabel = leg.selectedMode;
    }
    const seg0 = offer?.segments?.[0];
    const depTime = seg0?.departure ? new Date(seg0.departure) : null;
    const arrTime = seg0?.arrival ? new Date(seg0.arrival) : null;
    const perAdult = offer?.price || 0;
    const plan = this._plan;
    const adults = plan?.adults || 1;
    const children = plan?.children || 0;
    const totalCost = (perAdult * adults) + (perAdult * 0.75 * children);
    return {
      mode: modeLabel,
      icon: modeIcon,
      label: seg0?.flightNumber || '',
      duration: durStr,
      cost: totalCost,
      airlineName: offer?.airlineName || '',
      airlineLogo: offer?.airlineLogo || '',
      departure: depTime ? depTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      arrival: arrTime ? arrTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
      fromCode: seg0?.from || leg.fromIata || '',
      toCode: seg0?.to || leg.toIata || '',
      stops: offer?.stops || 0,
      price: perAdult,
      sourceRef: `flight:${legIndex}`,
      startTime: leg.scheduleStart || null,
      endTime: leg.scheduleEnd || null,
    };
  },

  _buildActivityDay(dayNum, plan, cityIndex, dayOffset, activities, placeData, transitData, segId) {
    const city = plan.cities[cityIndex];
    const segments = [];
    const hotelLabel = city.hotelName || `Hotel ${city.name}`;
    const hotelSublabel = `${city.nights} night${city.nights !== 1 ? 's' : ''}`;

    const hotelFrom = {
      label: 'HTL',
      sublabel: hotelLabel,
      lat: city.hotelLat,
      lng: city.hotelLng,
      isHotel: true,
    };

    let prevPoint = hotelFrom;

    // Activities for this day
    for (let ai = 0; ai < activities.length; ai++) {
      const act = activities[ai];
      const place = placeData?.[`${act.name}:${city.name}`];
      const actTo = {
        label: act.name || 'Activity',
        sublabel: `${act.category || 'Attraction'}${act.entryFee ? ` · EUR ${act.entryFee}` : ''}`,
        lat: place?.lat || city.hotelLat,
        lng: place?.lng || city.hotelLng,
        isActivity: true,
        placeId: place?.placeId || null,
        entryFee: act.entryFee || 0,
        photoUrl: place?.photoUrl || null,
        rating: place?.rating || null,
      };

      // Transit from previous point
      const transitKey = `${prevPoint.lat},${prevPoint.lng}->${actTo.lat},${actTo.lng}`;
      const transit = transitData?.[transitKey];
      const via = this._buildVia(transit, 'walk');

      segments.push({
        id: segId(),
        from: { ...prevPoint },
        to: actTo,
        via,
        cost: {
          low: (act.entryFee || 0) + via.reduce((s, v) => s + (v.cost || 0), 0),
          high: (act.entryFee || 0) + via.reduce((s, v) => s + (v.cost || 0), 0),
        },
        sourceRef: `activity:${cityIndex}:${dayOffset}:${ai}`,
        transitData: transit || null,
      });

      prevPoint = actTo;
    }

    // Return to hotel
    if (activities.length > 0) {
      const hotelTo = { ...hotelFrom, sublabel: hotelLabel };
      const returnTransitKey = `${prevPoint.lat},${prevPoint.lng}->${hotelTo.lat},${hotelTo.lng}`;
      const returnTransit = transitData?.[returnTransitKey];
      const returnVia = this._buildVia(returnTransit, 'walk');
      segments.push({
        id: segId(),
        from: { ...prevPoint },
        to: hotelTo,
        via: returnVia,
        cost: { low: returnVia.reduce((s, v) => s + (v.cost || 0), 0), high: returnVia.reduce((s, v) => s + (v.cost || 0), 0) },
        sourceRef: `return-hotel:${cityIndex}`,
        transitData: returnTransit || null,
      });
    }

    return {
      dayNumber: dayNum,
      type: 'activity',
      label: `Explore ${city.name}`,
      cityIndex,
      segments,
      dayCost: { low: 0, high: 0 },
    };
  },

  _buildVia(transit, fallbackMode) {
    if (!transit) {
      return [{ mode: fallbackMode || 'walk', icon: 'directions_walk', duration: '~15 min', cost: 0 }];
    }
    // If transit data has steps, build multi-modal chain
    const bestRoute = transit.transitRoutes?.[0];
    if (bestRoute?.steps?.length > 0) {
      const viaSteps = [];
      for (const step of bestRoute.steps) {
        if (step.mode === 'WALKING') {
          if (step.durationSec > 120) { // skip very short walks
            viaSteps.push({ mode: 'walk', icon: 'directions_walk', duration: step.duration, cost: 0 });
          }
        } else if (step.mode === 'TRANSIT') {
          const typeMap = { BUS: 'directions_bus', HEAVY_RAIL: 'train', SUBWAY: 'subway', TRAM: 'tram', COMMUTER_TRAIN: 'train', LIGHT_RAIL: 'light_rail', FERRY: 'directions_boat' };
          viaSteps.push({
            mode: 'transit',
            icon: typeMap[step.vehicleType] || 'directions_transit',
            duration: step.duration,
            cost: 0,
            label: step.lineName || '',
          });
        }
      }
      if (viaSteps.length > 0) {
        // Distribute cost across transit steps
        const transitCost = bestRoute.publicTransportCost || 0;
        const transitSteps = viaSteps.filter(v => v.mode === 'transit');
        if (transitSteps.length > 0) {
          const perStep = transitCost / transitSteps.length;
          transitSteps.forEach(s => { s.cost = Math.round(perStep * 100) / 100; });
        }
        return viaSteps;
      }
    }

    // Fallback: simple driving/transit
    if (transit.driving) {
      return [{
        mode: 'taxi',
        icon: 'local_taxi',
        duration: transit.driving.duration,
        cost: transit.driving.taxiCost || 0,
      }];
    }

    return [{ mode: fallbackMode || 'walk', icon: 'directions_walk', duration: '~15 min', cost: 0 }];
  },

  _modeIcon(mode) {
    const map = {
      'flight': 'flight', 'transit': 'directions_transit', 'drive': 'directions_car',
      'taxi': 'local_taxi', 'walk': 'directions_walk', 'bike': 'directions_bike',
      'train': 'train', 'bus': 'directions_bus',
    };
    return map[mode] || 'directions_transit';
  },

  _modeLabel(mode) {
    const map = {
      'flight': 'FLIGHT', 'transit': 'TRANSIT', 'drive': 'DRIVE',
      'taxi': 'CAB', 'walk': 'WALK', 'bike': 'BIKE',
      'train': 'TRAIN', 'bus': 'BUS',
    };
    return map[mode] || (mode || '').toUpperCase();
  },

  _fmtTime(date) {
    if (!date || !(date instanceof Date) || isNaN(date)) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  _computeDayCost(day, plan) {
    let low = 0, high = 0;
    for (const seg of day.segments) {
      low += seg.cost?.low || 0;
      high += seg.cost?.high || 0;
    }
    // Add meals for activity days
    if (day.type === 'activity' && day.cityIndex != null) {
      const city = plan.cities[day.cityIndex];
      if (city?.mealCosts) {
        const b = city.mealCosts.breakfast?.mid || 8;
        const l = city.mealCosts.lunch?.mid || 14;
        const d = city.mealCosts.dinner?.mid || 20;
        const dailyMeal = (b + l + d) * (plan.adults + plan.children * 0.6);
        low += dailyMeal * 0.85;
        high += dailyMeal * 1.15;
      }
    }
    return { low: Math.round(low), high: Math.round(high) };
  },

  // ── Render the day-by-day grid ──
  render(plan) {
    if (!plan.itinerary || plan.itinerary.length === 0) return;
    this._plan = plan;

    const container = document.getElementById('results-timeline');
    // Build all day sections in a DocumentFragment (single DOM operation)
    const fragment = document.createDocumentFragment();
    const itinContainer = document.createElement('div');
    itinContainer.id = 'itinerary-grid';

    for (const day of plan.itinerary) {
      const section = document.createElement('div');
      section.className = 'day-section';
      section.dataset.day = day.dayNumber;

      // Day header
      const costStr = day.dayCost.low === day.dayCost.high
        ? Utils.formatCurrency(day.dayCost.low)
        : `${Utils.formatCurrency(day.dayCost.low)} - ${Utils.formatCurrency(day.dayCost.high)}`;

      section.innerHTML = `
        <div class="day-header">
          <span class="day-number">DAY ${day.dayNumber}</span>
          <span class="day-label">${Utils.escapeHtml(day.label)}</span>
          <span class="day-cost">${costStr}</span>
        </div>
        <div class="day-segments"></div>
      `;

      const segContainer = section.querySelector('.day-segments');

      // Render segments
      for (const seg of day.segments) {
        segContainer.appendChild(this._renderSegmentRow(seg, day));
      }

      // Add activity button for activity days
      if (day.type === 'activity') {
        const addBtn = document.createElement('div');
        addBtn.className = 'add-activity-row';
        addBtn.innerHTML = `<span class="material-symbols-outlined">add_circle</span><span>Add Activity</span>`;
        addBtn.addEventListener('click', () => this.showAddActivity(plan.itinerary.indexOf(day)));
        segContainer.appendChild(addBtn);
      }

      itinContainer.appendChild(section);
    }

    fragment.appendChild(itinContainer);
    // Single DOM mutation: clear and insert all at once
    container.innerHTML = '';
    container.appendChild(fragment);
  },

  _renderSegmentRow(seg, day) {
    const row = document.createElement('div');
    const isHotelRow = seg.to?.isHotel;
    const isActivityRow = seg.to?.isActivity;
    row.className = `itinerary-segment-row${isHotelRow ? ' hotel-row' : ''}${isActivityRow ? ' activity-row' : ''}`;
    row.dataset.seg = seg.id;

    // From column — with optional time label
    const fromTimeHtml = this._buildFromTimeHtml(seg.from);
    let fromHtml;
    if (seg.from?.isHotel) {
      fromHtml = `<div class="seg-from hotel-ref">
        <span class="material-symbols-outlined">hotel</span>
        <span class="seg-sublabel">${Utils.escapeHtml(seg.from.sublabel || 'Hotel')}</span>
        ${fromTimeHtml}
      </div>`;
    } else if (seg.from?.isActivity) {
      const fromActThumb = seg.from.photoUrl
        ? `<img class="activity-ref-thumb" src="${Utils.escapeHtml(seg.from.photoUrl)}" alt="">`
        : `<span class="material-symbols-outlined" style="font-size:1rem;color:var(--color-city-accent)">place</span>`;
      fromHtml = `<div class="seg-from activity-ref">
        ${fromActThumb}
        <span class="seg-sublabel">${Utils.escapeHtml(seg.from.label || 'Activity')}</span>
        ${fromTimeHtml}
      </div>`;
    } else {
      fromHtml = `<div class="seg-from">
        <span class="seg-code">${Utils.escapeHtml(seg.from?.label || '')}</span>
        <span class="seg-sublabel">${Utils.escapeHtml(seg.from?.sublabel || '')}</span>
        ${fromTimeHtml}
      </div>`;
    }

    // Via column — buffer chips get special styling
    const viaChips = (seg.via || []).map((v, vi) => {
      const connector = vi > 0 ? '<span class="via-connector"></span>' : '';
      const bufferClass = v.isBuffer ? ' buffer-chip' : '';
      return `${connector}<span class="via-chip ${v.mode}${bufferClass}" data-via-idx="${vi}" title="${Utils.escapeHtml(v.duration || '')}">
        <span class="material-symbols-outlined">${Utils.escapeHtml(v.icon || 'directions_transit')}</span>
      </span>`;
    }).join('');

    const viaLabels = (seg.via || []).map((v, vi) => {
      const spacer = vi > 0 ? '<span class="via-label-spacer"></span>' : '';
      const label = v.isBuffer ? v.label : (v.label || this._modeLabel(v.mode));
      const bufferClass = v.isBuffer ? ' buffer-label' : '';
      return `${spacer}<span class="via-label${bufferClass}">${Utils.escapeHtml(label)}</span>`;
    }).join('');

    // Total duration excludes buffer entries
    const totalDuration = (seg.via || []).filter(v => !v.isBuffer).map(v => v.duration || '').filter(Boolean).join(' + ');
    const viaHtml = `<div class="seg-via">
      <div class="via-chain">${viaChips}</div>
      <div class="via-labels">${viaLabels}</div>
    </div>`;

    // To column — with optional arrive time and check-in badge
    const toTimeHtml = this._buildToTimeHtml(seg.to);
    let toHtml;
    if (seg.to?.isHotel) {
      const nightsInfo = seg.cityIndex != null ? this._plan?.cities[seg.cityIndex] : null;
      const selectedHotel = nightsInfo?.selectedHotel;
      const nightsLabel = nightsInfo ? `${nightsInfo.nights} night${nightsInfo.nights !== 1 ? 's' : ''}` : '';
      const priceLabel = nightsInfo?.hotelBasePrice ? ` · ${Utils.formatCurrency(nightsInfo.hotelBasePrice)}/n` : '';
      const thumbHtml = selectedHotel?.photoUrl
        ? `<img class="hotel-tile-thumb" src="${Utils.escapeHtml(selectedHotel.photoUrl)}" alt="">`
        : `<span class="material-symbols-outlined hotel-icon">hotel</span>`;
      const ratingHtml = selectedHotel?.rating
        ? `<span class="hotel-tile-rating">${selectedHotel.rating}</span>`
        : '';
      const linkHtml = selectedHotel?.listingUrl
        ? `<a href="${Utils.escapeHtml(selectedHotel.listingUrl)}" target="_blank" rel="noopener" class="hotel-tile-link" title="View hotel"><span class="material-symbols-outlined" style="font-size:14px">open_in_new</span></a>`
        : '';
      toHtml = `<div class="seg-to hotel-tile">
        ${thumbHtml}
        <span class="seg-code">${Utils.escapeHtml(seg.to.sublabel || seg.to.label || 'Hotel')}</span>
        <span class="seg-sublabel">${nightsLabel}${priceLabel}${ratingHtml ? ' · ' + ratingHtml : ''}</span>
        ${toTimeHtml}
        ${linkHtml}
      </div>`;
    } else if (seg.to?.isActivity) {
      const hasPhoto = !!seg.to.photoUrl;
      const bgStyle = hasPhoto
        ? ` style="background-image: url('${Utils.escapeHtml(seg.to.photoUrl)}')"`
        : '';
      const actRatingHtml = seg.to.rating
        ? `<span class="activity-tile-rating">${seg.to.rating}</span>`
        : '';
      const wikiUrl = `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(seg.to.label || '')}`;
      const actLinkHtml = `<a href="${Utils.escapeHtml(wikiUrl)}" target="_blank" rel="noopener" class="activity-tile-link" title="Wikipedia" onclick="event.stopPropagation()"><span class="material-symbols-outlined" style="font-size:14px">open_in_new</span></a>`;
      toHtml = `<div class="seg-to activity-tile${hasPhoto ? ' has-photo' : ''}"${bgStyle}>
        <span class="material-symbols-outlined activity-icon">place</span>
        <span class="seg-code">${Utils.escapeHtml(seg.to.label || '')}</span>
        <span class="seg-sublabel">${Utils.escapeHtml(seg.to.sublabel || '')}${actRatingHtml ? ' · ' + actRatingHtml : ''}</span>
        ${actLinkHtml}
      </div>`;
    } else {
      toHtml = `<div class="seg-to">
        <span class="seg-code">${Utils.escapeHtml(seg.to?.label || '')}</span>
        <span class="seg-sublabel">${Utils.escapeHtml(seg.to?.sublabel || '')}</span>
        ${toTimeHtml}
      </div>`;
    }

    // Remove button for activity segments
    let removeHtml = '';
    if (isActivityRow && day.type === 'activity') {
      removeHtml = `<button class="seg-remove-btn" title="Remove activity" onclick="event.stopPropagation(); Itinerary.removeActivity('${seg.id}')">
        <span class="material-symbols-outlined" style="font-size:14px">close</span>
      </button>`;
    }

    // Build footer with flight details if available
    const flightVia = (seg.via || []).find(v => v.mode === 'flight' || v.mode === 'train');
    let footerDetailHtml = '';
    if (flightVia && flightVia.airlineName) {
      const parts = [];
      if (flightVia.airlineLogo) {
        parts.push(`<img src="${Utils.escapeHtml(flightVia.airlineLogo)}" alt="" style="height:16px;width:16px;border-radius:2px;vertical-align:middle;margin-right:4px">`);
      }
      parts.push(`<span>${Utils.escapeHtml(flightVia.airlineName)}</span>`);
      if (flightVia.departure && flightVia.arrival) {
        parts.push(`<span style="margin-left:8px">${Utils.escapeHtml(flightVia.departure)} → ${Utils.escapeHtml(flightVia.arrival)}</span>`);
      }
      if (flightVia.stops > 0) {
        parts.push(`<span style="margin-left:8px;color:var(--color-gold)">${flightVia.stops} stop${flightVia.stops > 1 ? 's' : ''}</span>`);
      }
      footerDetailHtml = parts.join('');
    } else {
      // Exclude buffer labels from footer
      footerDetailHtml = Utils.escapeHtml((seg.via || []).filter(v => !v.isBuffer).map(v => v.label || this._modeLabel(v.mode)).join(' → '));
    }
    const footerHtml = totalDuration ? `<div class="seg-footer">
      <span class="seg-footer-detail">${footerDetailHtml}</span>
      <span class="seg-footer-duration">${Utils.escapeHtml(totalDuration)}</span>
    </div>` : '';

    row.innerHTML = `${fromHtml}${viaHtml}${toHtml}${removeHtml}${footerHtml}`;

    // Click handlers
    if (isHotelRow && seg.cityIndex != null) {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => this.openHotelPopup(seg.cityIndex));
    }

    row.querySelectorAll('.via-chip').forEach(chip => {
      // Skip buffer chips — they're not interactive
      if (chip.classList.contains('buffer-chip')) return;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const viaIdx = parseInt(chip.dataset.viaIdx, 10);
        this.openViaModal(seg.id, viaIdx);
      });
    });

    // Flight footer click → open flight popup
    const footerEl = row.querySelector('.seg-footer');
    const flightViaData = (seg.via || []).find(v => (v.mode === 'flight' || v.mode === 'train') && v.sourceRef);
    if (footerEl && flightViaData?.sourceRef) {
      const legIdx = parseInt(flightViaData.sourceRef.split(':')[1], 10);
      if (!isNaN(legIdx)) {
        footerEl.style.cursor = 'pointer';
        footerEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openFlightPopup(legIdx);
        });
      }
    }

    // Drag-and-drop for activity rows
    if (isActivityRow && day.type === 'activity') {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        this._dragSrcId = seg.id;
        row.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        this._dragSrcId = null;
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (this._dragSrcId && this._dragSrcId !== seg.id) {
          this._handleDrop(this._dragSrcId, seg.id);
        }
      });
    }

    return row;
  },

  // ── Time label helpers for FROM/TO cells ──

  _buildFromTimeHtml(from) {
    if (!from?.time) return '';
    const timeStr = this._fmtTime(from.time);
    if (!timeStr) return '';
    if (from.isCheckOut) {
      return `<span class="seg-time seg-time-depart">Check out ${timeStr}</span>`;
    }
    return `<span class="seg-time seg-time-depart">Leave ${timeStr}</span>`;
  },

  _buildToTimeHtml(to) {
    if (!to?.arriveTime) return '';
    const timeStr = this._fmtTime(to.arriveTime);
    if (!timeStr) return '';
    let html = `<span class="seg-time seg-time-arrive">Arrive ${timeStr}</span>`;
    // Check-in badge for hotels
    if (to.isHotel && to.checkInStatus) {
      const cls = to.checkInStatus === 'early' ? 'checkin-early' : to.checkInStatus === 'late' ? 'checkin-late' : 'checkin-ontime';
      const label = to.checkInStatus === 'early' ? 'Early check-in' : to.checkInStatus === 'late' ? 'Late check-in' : 'On time';
      html += `<span class="checkin-badge ${cls}">${label}</span>`;
    }
    return html;
  },

  // ── Interaction Handlers ──

  openViaModal(segId, viaIndex) {
    const { day, seg } = this._findSegment(segId);
    if (!seg) return;

    // Find real transfer data from the plan
    const targetVia = (typeof viaIndex === 'number' && seg.via?.[viaIndex]) ? seg.via[viaIndex] : seg.via?.[0];
    // Skip if buffer chip was somehow clicked
    if (targetVia?.isBuffer) return;
    const currentMode = targetVia?.mode || 'walk';
    let transfer = null;
    if (targetVia?.sourceRef?.startsWith('transfer:')) {
      const tIdx = parseInt(targetVia.sourceRef.split(':')[1], 10);
      transfer = this._plan?.transfers?.[tIdx];
    }
    // For activity segments, use the stored transitData from Google Maps
    if (!transfer && seg.transitData) {
      transfer = seg.transitData;
    }

    // Build real cost/duration from transfer data
    const walkDur = transfer?.walking?.duration || '~15 min';
    const transitCost = transfer?.publicTransportCost || 5;
    const transitDur = transfer?.transitDuration || transfer?.transitRoutes?.[0]?.duration || '~25 min';
    const taxiCost = transfer?.taxiCost || 15;
    const taxiDur = transfer?.driving?.duration || transfer?.durationText || '~15 min';
    const transitRoutes = transfer?.transitRoutes || [];

    // Find associated flight leg for this segment's day
    let flightLeg = null;
    let flightLegIndex = -1;
    const parentDay = day;
    // 1. Search via items for a flight sourceRef
    for (const v of (seg.via || [])) {
      if (v.sourceRef?.startsWith('flight:')) {
        flightLegIndex = parseInt(v.sourceRef.split(':')[1], 10);
        flightLeg = this._plan?.flightLegs?.[flightLegIndex] || null;
        break;
      }
    }
    // 2. If not found, check the day's legIndex (stored on travel/intercity days)
    if (!flightLeg && parentDay?.legIndex != null) {
      flightLegIndex = parentDay.legIndex;
      flightLeg = this._plan?.flightLegs?.[flightLegIndex] || null;
    }
    // 3. If still not found, search all segments in the same day for a flight via
    if (!flightLeg && parentDay) {
      for (const s of parentDay.segments) {
        for (const v of (s.via || [])) {
          if (v.sourceRef?.startsWith('flight:')) {
            flightLegIndex = parseInt(v.sourceRef.split(':')[1], 10);
            flightLeg = this._plan?.flightLegs?.[flightLegIndex] || null;
            break;
          }
        }
        if (flightLeg) break;
      }
    }
    const flightOffers = flightLeg?.offers || [];
    const selectedFlight = flightLeg?.selectedOffer;

    const overlay = document.createElement('div');
    overlay.className = 'transit-modal';

    const applyMode = (mode, cost, duration, icon) => {
      const newVia = { mode, icon, duration, cost, sourceRef: targetVia?.sourceRef };
      if (typeof viaIndex === 'number' && seg.via?.length > 1) {
        seg.via[viaIndex] = newVia;
      } else {
        seg.via = [newVia];
      }
      const viaCost = seg.via.reduce((s, v) => s + (v.cost || 0), 0);
      seg.cost = { low: (seg.to?.entryFee || 0) + viaCost, high: (seg.to?.entryFee || 0) + viaCost };
      if (day) day.dayCost = this._computeDayCost(day, this._plan);
      overlay.remove();
      this.render(this._plan);
      if (typeof Results !== 'undefined') Results.recalculateAndRenderCost();
    };

    // Build transit route cards
    const _buildRouteSteps = (steps) => {
      return (steps || []).map(step => {
        if (step.mode === 'WALKING') {
          return `<span class="rt-step rt-walk"><span class="material-symbols-outlined">directions_walk</span> ${Utils.escapeHtml(step.duration || '')}</span>`;
        } else if (step.mode === 'TRANSIT') {
          const typeIcons = { BUS: 'directions_bus', HEAVY_RAIL: 'train', SUBWAY: 'subway', TRAM: 'tram', COMMUTER_TRAIN: 'train', LIGHT_RAIL: 'light_rail' };
          const icon = typeIcons[step.vehicleType] || 'directions_transit';
          const lineName = step.lineName || step.vehicleType || 'Transit';
          const stopsBadge = step.numStops ? ` (${step.numStops})` : '';
          // Color-code badges for line names
          const colors = ['#00bcd4','#e91e63','#ff9800','#4caf50','#9c27b0','#2196f3'];
          const colorIdx = lineName.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
          return `<span class="rt-step rt-transit"><span class="material-symbols-outlined">${icon}</span></span><span class="rt-badge" style="background:${colors[colorIdx]}">${Utils.escapeHtml(lineName)}${stopsBadge}</span>`;
        }
        return '';
      }).filter(Boolean).join('<span class="rt-arrow">›</span>');
    };

    // Build Google Maps directions URL from transfer coords or segment from/to
    let mapsUrl = '';
    const mapsOriginLat = transfer?.originLat || seg.from?.lat;
    const mapsOriginLng = transfer?.originLng || seg.from?.lng;
    const mapsDestLat = transfer?.destLat || seg.to?.lat;
    const mapsDestLng = transfer?.destLng || seg.to?.lng;
    if (mapsOriginLat && mapsDestLat) {
      mapsUrl = `https://www.google.com/maps/dir/${mapsOriginLat},${mapsOriginLng}/${mapsDestLat},${mapsDestLng}/@${mapsOriginLat},${mapsOriginLng},12z/data=!3m1!4b1!4m2!4m1!3e3`;
    }

    let transitRoutesHtml = '';
    if (transitRoutes.length > 0) {
      transitRoutesHtml = transitRoutes.map((route, ri) => {
        const depTime = route.departureTime || '';
        const arrTime = route.arrivalTime || '';
        const dur = route.duration || '';
        const fare = route.publicTransportCost || transitCost;
        const stepsHtml = _buildRouteSteps(route.steps);
        // Extra info: first transit departure
        const firstTransit = (route.steps || []).find(s => s.mode === 'TRANSIT');
        const departFrom = firstTransit?.departureStop || '';
        const walkTime = (route.steps || []).filter(s => s.mode === 'WALKING').map(s => s.duration || '').filter(Boolean).join(' + ');
        const detailsHtml = mapsUrl
          ? `<a href="${mapsUrl}" target="_blank" rel="noopener" class="rt-details">Details <span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle">open_in_new</span></a>`
          : `<span class="rt-details">Details</span>`;

        return `<div class="rt-card" data-route-idx="${ri}">
          <div class="rt-header">
            <span class="rt-times">${Utils.escapeHtml(depTime)}—${Utils.escapeHtml(arrTime)}</span>
            <span class="rt-dur">${Utils.escapeHtml(dur)}</span>
          </div>
          <div class="rt-steps">${stepsHtml}</div>
          ${departFrom ? `<div class="rt-depart-info">${Utils.escapeHtml(depTime)} from ${Utils.escapeHtml(departFrom)}</div>` : ''}
          ${walkTime ? `<div class="rt-walk-total"><span class="material-symbols-outlined">directions_walk</span> ${Utils.escapeHtml(walkTime)}</div>` : ''}
          <div class="rt-bottom">
            <span class="rt-fare">${Utils.formatCurrency(fare)}</span>
            ${detailsHtml}
          </div>
        </div>`;
      }).join('');
    }

    // Tab subtitles
    const walkSub = 'Free';
    const transitSub = transitRoutes.length > 0 ? 'Check routes' : transitDur;
    const taxiSub = 'Fastest';
    const flightSub = selectedFlight ? Utils.formatCurrency(selectedFlight.price) : 'Search';

    // Build flight offers HTML
    const fmtTime = (isoStr) => {
      if (!isoStr) return '--';
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    const fmtDuration = (dur) => {
      if (!dur) return '';
      const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
      return m ? `${m[1] || 0}h ${m[2] || 0}m` : dur;
    };

    let flightOffersHtml = '';
    if (flightOffers.length > 0) {
      const sorted = flightOffers.slice().sort((a, b) => (a.price || 0) - (b.price || 0));
      flightOffersHtml = sorted.map(f => {
        const isSelected = selectedFlight && f.id === selectedFlight.id;
        const stopsText = (!f.stops || f.stops === 0) ? 'Nonstop' : `${f.stops} stop${f.stops > 1 ? 's' : ''}`;
        const stopsClass = (!f.stops || f.stops === 0) ? 'color:var(--color-savings)' : 'color:var(--color-gold)';
        return `<div class="rt-card rt-flight-card${isSelected ? ' rt-flight-selected' : ''}" data-flight-id="${Utils.escapeHtml(f.id)}">
          <div class="rt-flight-row">
            <div class="rt-flight-airline">
              ${f.airlineLogo ? `<img src="${Utils.escapeHtml(f.airlineLogo)}" alt="" class="rt-airline-logo">` : `<span class="material-symbols-outlined" style="font-size:20px;color:var(--color-text-secondary)">flight</span>`}
              <span class="rt-airline-name">${Utils.escapeHtml(f.airlineName || f.airline || '')}</span>
            </div>
            <div class="rt-flight-price">${Utils.formatCurrency(f.price)}</div>
          </div>
          <div class="rt-flight-times">
            <span class="rt-flight-time">${fmtTime(f.departure)}</span>
            <span class="rt-flight-line"><span class="rt-flight-dot"></span><span class="rt-flight-bar-line"></span><span class="rt-flight-dot"></span></span>
            <span class="rt-flight-time">${fmtTime(f.arrival)}</span>
          </div>
          <div class="rt-flight-meta">
            <span>${fmtDuration(f.duration)}</span>
            <span style="${stopsClass}">${stopsText}</span>
            <span>${Utils.escapeHtml((f.segments?.[0]?.from || '') + '–' + (f.segments?.[f.segments.length - 1]?.to || ''))}</span>
          </div>
        </div>`;
      }).join('');
    }

    // Show flight tab on travel/intercity days (even if no offers loaded yet)
    const isTravelDay = parentDay && (parentDay.type === 'travel' || parentDay.type === 'intercity');
    const hasFlights = flightOffers.length > 0;
    const showFlightTab = hasFlights || isTravelDay;
    const initialTab = (currentMode === 'flight' && showFlightTab) ? 'flight' : currentMode;

    overlay.innerHTML = `
      <div class="transit-modal-content">
        <div class="transit-modal-title">Change Transport</div>
        <div class="tm-tabs">
          ${showFlightTab ? `<div class="tm-tab${initialTab === 'flight' ? ' active' : ''}" data-mode="flight">
            <span class="material-symbols-outlined">flight</span>
            <span class="tm-tab-label">Flight</span>
            <span class="tm-tab-sub">${Utils.escapeHtml(flightSub)}</span>
          </div>` : ''}
          <div class="tm-tab${initialTab === 'walk' ? ' active' : ''}" data-mode="walk">
            <span class="material-symbols-outlined">directions_walk</span>
            <span class="tm-tab-label">Walk</span>
            <span class="tm-tab-sub">${Utils.escapeHtml(walkSub)}</span>
          </div>
          <div class="tm-tab${initialTab === 'transit' ? ' active' : ''}" data-mode="transit">
            <span class="material-symbols-outlined">directions_transit</span>
            <span class="tm-tab-label">Public Transit</span>
            <span class="tm-tab-sub">${Utils.escapeHtml(transitSub)}</span>
          </div>
          <div class="tm-tab${initialTab === 'taxi' ? ' active' : ''}" data-mode="taxi">
            <span class="material-symbols-outlined">local_taxi</span>
            <span class="tm-tab-label">Taxi / Cab</span>
            <span class="tm-tab-sub">${Utils.escapeHtml(taxiSub)}</span>
          </div>
        </div>
        ${showFlightTab ? `<div class="tm-panel tm-panel-flight${initialTab === 'flight' ? ' visible' : ''}">
          ${hasFlights
            ? `<div class="rt-list">${flightOffersHtml}</div>`
            : `<div class="tm-panel-msg">
                <span class="material-symbols-outlined" style="font-size:40px;color:var(--color-text-secondary)">flight</span>
                <p>${selectedFlight ? `${Utils.escapeHtml(selectedFlight.airlineName || '')} · ${Utils.formatCurrency(selectedFlight.price)}` : 'Current flight'}</p>
                <p style="font-size:0.75rem;color:var(--color-text-light)">${flightLeg ? `${Utils.escapeHtml(flightLeg.fromIata || '')} → ${Utils.escapeHtml(flightLeg.toIata || '')}` : 'Flight details'}</p>
              </div>`
          }
        </div>` : ''}
        <div class="tm-panel tm-panel-walk${initialTab === 'walk' ? ' visible' : ''}">
          <div class="tm-panel-msg">
            <span class="material-symbols-outlined" style="font-size:40px;color:var(--color-savings)">directions_walk</span>
            <p>${Utils.escapeHtml(walkDur)}</p>
            <span style="color:var(--color-savings);font-weight:700;font-size:1.1rem">Free</span>
          </div>
          <button class="tm-select-btn" data-mode="walk">Select Walk</button>
        </div>
        <div class="tm-panel tm-panel-transit${initialTab === 'transit' ? ' visible' : ''}">
          ${transitRoutes.length > 0
            ? `<div class="rt-list">${transitRoutesHtml}</div>`
            : `<div class="tm-panel-msg"><span class="material-symbols-outlined" style="font-size:40px;color:var(--color-cyan)">directions_transit</span><p>${Utils.escapeHtml(transitDur)}</p><span style="color:var(--color-cyan);font-weight:700;font-size:1.1rem">~${Utils.formatCurrency(transitCost)}</span></div><button class="tm-select-btn" data-mode="transit">Select Transit</button>`
          }
        </div>
        <div class="tm-panel tm-panel-taxi${initialTab === 'taxi' ? ' visible' : ''}">
          <div class="tm-panel-msg">
            <span class="material-symbols-outlined" style="font-size:40px;color:var(--color-amber)">local_taxi</span>
            <p>${Utils.escapeHtml(taxiDur)}</p>
            <span style="color:var(--color-amber);font-weight:700;font-size:1.1rem">~${Utils.formatCurrency(taxiCost)}</span>
          </div>
          <button class="tm-select-btn" data-mode="taxi">Select Taxi</button>
        </div>
        <button class="transit-modal-close">Cancel</button>
      </div>
    `;

    overlay.querySelector('.transit-modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Tab switching
    const tabs = overlay.querySelectorAll('.tm-tab');
    const panels = overlay.querySelectorAll('.tm-panel');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const mode = tab.dataset.mode;
        panels.forEach(p => p.classList.remove('visible'));
        overlay.querySelector(`.tm-panel-${mode}`)?.classList.add('visible');
      });
    });

    // Select buttons (walk, taxi, fallback transit)
    overlay.querySelectorAll('.tm-select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        const modeMap = {
          walk: { icon: 'directions_walk', cost: 0, dur: walkDur },
          transit: { icon: 'directions_transit', cost: transitCost, dur: transitDur },
          taxi: { icon: 'local_taxi', cost: taxiCost, dur: taxiDur },
        };
        const cfg = modeMap[mode] || modeMap.walk;
        applyMode(mode, cfg.cost, cfg.dur, cfg.icon);
      });
    });

    // Transit route card clicks
    overlay.querySelectorAll('.rt-card[data-route-idx]').forEach(card => {
      card.addEventListener('click', () => {
        const ri = parseInt(card.dataset.routeIdx, 10);
        const route = transitRoutes[ri];
        if (route) {
          const dur = route.duration || transitDur;
          const cost = route.publicTransportCost || transitCost;
          applyMode('transit', cost, dur, 'directions_transit');
        }
      });
    });

    // Flight offer card clicks
    overlay.querySelectorAll('.rt-flight-card[data-flight-id]').forEach(card => {
      card.addEventListener('click', () => {
        const fId = card.dataset.flightId;
        const flight = flightOffers.find(f => f.id === fId);
        if (flight && flightLeg) {
          flightLeg.selectedOffer = flight;
          overlay.remove();
          // Rebuild itinerary with the new flight
          const plan = this._plan;
          if (typeof Results !== 'undefined') {
            Results._computeArrivalDates(plan.flightLegs, plan.cities);
            Results._computeTimelineSchedule();
            Itinerary.buildDays(plan, null, null, null);
            Itinerary.render(plan);
            Results.recalculateAndRenderCost();
          } else {
            this.render(plan);
          }
        }
      });
    });

    document.body.appendChild(overlay);
  },

  openHotelPopup(cityIndex) {
    const plan = this._plan;
    if (!plan || !plan.cities[cityIndex]) return;
    const city = plan.cities[cityIndex];
    let currentSort = 'price'; // 'price' or 'rating'
    let searchQuery = '';

    const overlay = document.createElement('div');
    overlay.className = 'hotel-popup-overlay';

    const renderList = () => {
      let hotels = (city.hotelOptions || []).slice();
      // Filter by search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        hotels = hotels.filter(h => (h.name || '').toLowerCase().includes(q));
      }
      // Sort
      if (currentSort === 'rating') {
        hotels.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      } else {
        hotels.sort((a, b) => (a.pricePerNight || 0) - (b.pricePerNight || 0));
      }

      const listEl = overlay.querySelector('.hotel-options-list');
      if (!listEl) return;

      if (hotels.length === 0) {
        listEl.innerHTML = '<p style="color:var(--color-text-secondary);text-align:center;padding:20px">No hotels found</p>';
        return;
      }

      listEl.innerHTML = hotels.map(h => `
        <div class="hotel-option${h.hotelId === city.selectedHotelId ? ' selected' : ''}" data-hotel-id="${Utils.escapeHtml(h.hotelId)}">
          ${h.photoUrl ? `<img class="hotel-option-photo" src="${Utils.escapeHtml(h.photoUrl)}" alt="">` : `<div class="hotel-option-icon"><span class="material-symbols-outlined">hotel</span></div>`}
          <div class="hotel-option-info">
            <div class="hotel-option-name"><span class="hotel-option-name-text">${Utils.escapeHtml(h.name)}</span></div>
            ${h.rating ? `<div class="hotel-option-rating"><span class="rating-score">${h.rating}</span>${h.reviewCount ? `<span style="font-size:0.7rem;color:var(--color-text-secondary);margin-left:4px">(${h.reviewCount})</span>` : ''}</div>` : ''}
          </div>
          <div class="hotel-option-price">
            <div style="font-weight:700;color:var(--color-cyan)">${Utils.formatCurrency(h.pricePerNight)}</div>
            <div style="font-size:0.7rem;color:var(--color-text-secondary)">/night</div>
          </div>
          ${h.listingUrl ? `<a href="${Utils.escapeHtml(h.listingUrl)}" target="_blank" rel="noopener" class="hotel-option-link" title="View hotel page" onclick="event.stopPropagation()"><span class="material-symbols-outlined" style="font-size:16px">open_in_new</span></a>` : ''}
        </div>
      `).join('');

      // Attach click handlers to hotel options
      listEl.querySelectorAll('.hotel-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const hotelId = opt.dataset.hotelId;
          const hotel = city.hotelOptions.find(h => h.hotelId === hotelId);
          if (hotel) {
            city.selectedHotel = hotel;
            city.selectedHotelId = hotel.hotelId;
            city.hotelBasePrice = hotel.pricePerNight;
            city.hotelName = hotel.name;
            overlay.remove();
            this.render(this._plan);
            if (typeof Results !== 'undefined') Results.recalculateAndRenderCost();
          }
        });
      });
    };

    overlay.innerHTML = `
      <div class="hotel-popup">
        <div class="hotel-popup-header">
          <h3>${Utils.escapeHtml(city.name)} — Hotel</h3>
          <button class="hotel-popup-close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div style="margin-bottom:12px;font-size:0.85rem;color:var(--color-text-secondary)">
          <strong style="color:var(--color-text)">${Utils.escapeHtml(city.hotelName || 'No hotel')}</strong>
          ${city.hotelBasePrice ? ` · ${Utils.formatCurrency(city.hotelBasePrice)}/night` : ''}
          ${city.nights > 0 ? ` · ${city.nights} night${city.nights !== 1 ? 's' : ''}` : ''}
        </div>
        <input type="text" class="hotel-search-input" placeholder="Search hotels..." autofocus>
        <div class="hotel-sort-tabs">
          <button class="hotel-sort-tab active" data-sort="price">
            <span class="material-symbols-outlined" style="font-size:16px">arrow_downward</span> Lowest Price
          </button>
          <button class="hotel-sort-tab" data-sort="rating">
            <span class="material-symbols-outlined" style="font-size:16px">star</span> Highest Rated
          </button>
        </div>
        <div class="hotel-options-list"></div>
      </div>
    `;

    // Close handlers
    overlay.querySelector('.hotel-popup-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Search
    const searchInput = overlay.querySelector('.hotel-search-input');
    searchInput.addEventListener('input', () => {
      searchQuery = searchInput.value.trim();
      renderList();
    });

    // Sort tabs
    overlay.querySelectorAll('.hotel-sort-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        currentSort = tab.dataset.sort;
        overlay.querySelectorAll('.hotel-sort-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderList();
      });
    });

    document.body.appendChild(overlay);
    renderList();
  },

  openFlightPopup(legIndex) {
    const plan = this._plan;
    if (!plan?.flightLegs?.[legIndex]) return;
    const leg = plan.flightLegs[legIndex];
    const offers = leg.offers || [];
    if (offers.length === 0) return;

    let currentSort = 'price';
    const selectedId = leg.selectedOffer?.id;

    const overlay = document.createElement('div');
    overlay.className = 'hotel-popup-overlay';

    const fmtTime = (isoStr) => {
      if (!isoStr) return '--';
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };
    const fmtDuration = (dur) => {
      if (!dur) return '';
      const m = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
      return m ? `${m[1] || 0}h ${m[2] || 0}m` : dur;
    };
    const stopsLabel = (flight) => {
      if (!flight.stops || flight.stops === 0) return '<span style="color:var(--color-savings)">Nonstop</span>';
      const layoverInfo = (flight.layovers || []).map(l => `${l.durationText || ''} in ${l.airportCode || ''}`).filter(s => s.trim() !== 'in').join(', ');
      return `<span style="color:var(--color-gold)">${flight.stops} stop${flight.stops > 1 ? 's' : ''}</span>${layoverInfo ? ` · ${Utils.escapeHtml(layoverInfo)}` : ''}`;
    };

    const renderFlights = () => {
      let sorted = offers.slice();
      if (currentSort === 'duration') {
        sorted.sort((a, b) => {
          const da = Utils.parseDurationMins(a.duration) || 9999;
          const db = Utils.parseDurationMins(b.duration) || 9999;
          return da - db;
        });
      } else {
        sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
      }

      const listEl = overlay.querySelector('.flight-options-list');
      if (!listEl) return;

      listEl.innerHTML = sorted.map(f => `
        <div class="flight-option${f.id === selectedId ? ' selected' : ''}" data-flight-id="${Utils.escapeHtml(f.id)}">
          <div class="flight-option-airline">
            ${f.airlineLogo ? `<img src="${Utils.escapeHtml(f.airlineLogo)}" alt="" class="flight-option-logo">` : ''}
            <div>
              <div class="flight-option-airline-code">${Utils.escapeHtml(f.airline || '')}</div>
              <div class="flight-option-airline-name">${Utils.escapeHtml(f.airlineName || '')}</div>
            </div>
          </div>
          <div class="flight-option-dep">
            <div class="flight-option-time">${fmtTime(f.departure)}</div>
          </div>
          <div class="flight-option-mid">
            <div class="flight-option-duration">${fmtDuration(f.duration)}</div>
            <div class="flight-option-bar"></div>
            <div class="flight-option-stops">${stopsLabel(f)}</div>
            <div class="flight-option-route">${Utils.escapeHtml(f.segments?.[0]?.from || '')}–${Utils.escapeHtml(f.segments?.[f.segments.length - 1]?.to || '')}</div>
          </div>
          <div class="flight-option-arr">
            <div class="flight-option-time">${fmtTime(f.arrival)}</div>
          </div>
          <div class="flight-option-price">
            <div class="flight-option-price-val">${Utils.formatCurrency(f.price)}</div>
            <div class="flight-option-price-unit">per adult</div>
          </div>
        </div>
      `).join('');

      listEl.querySelectorAll('.flight-option').forEach(opt => {
        opt.addEventListener('click', () => {
          const fId = opt.dataset.flightId;
          const flight = offers.find(f => f.id === fId);
          if (flight) {
            leg.selectedOffer = flight;
            overlay.remove();
            // Rebuild itinerary with new flight and re-render
            if (typeof Results !== 'undefined') {
              Results._computeArrivalDates(plan.flightLegs, plan.cities);
              Results._computeTimelineSchedule();
              Itinerary.buildDays(plan, null, null, null);
              Itinerary.render(plan);
              Results.recalculateAndRenderCost();
            } else {
              this.render(plan);
            }
          }
        });
      });
    };

    const routeLabel = `${leg.fromIata || leg.fromName || ''} → ${leg.toIata || leg.toName || ''}`;
    overlay.innerHTML = `
      <div class="hotel-popup" style="max-width:700px">
        <div class="hotel-popup-header">
          <h3>Flights — ${Utils.escapeHtml(routeLabel)}</h3>
          <button class="hotel-popup-close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div style="margin-bottom:12px;font-size:0.85rem;color:var(--color-text-secondary)">
          ${leg.selectedOffer ? `<strong style="color:var(--color-text)">${Utils.escapeHtml(leg.selectedOffer.airlineName || '')} ${Utils.escapeHtml(leg.selectedOffer.segments?.[0]?.flightNumber || '')}</strong> · ${Utils.formatCurrency(leg.selectedOffer.price)}` : 'No flight selected'}
          · ${Utils.escapeHtml(leg.date || '')}
        </div>
        <div class="hotel-sort-tabs">
          <button class="hotel-sort-tab active" data-sort="price">
            <span class="material-symbols-outlined" style="font-size:16px">arrow_downward</span> Lowest Price
          </button>
          <button class="hotel-sort-tab" data-sort="duration">
            <span class="material-symbols-outlined" style="font-size:16px">schedule</span> Shortest
          </button>
        </div>
        <div class="flight-options-list"></div>
      </div>
    `;

    overlay.querySelector('.hotel-popup-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.hotel-sort-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        currentSort = tab.dataset.sort;
        overlay.querySelectorAll('.hotel-sort-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        renderFlights();
      });
    });

    document.body.appendChild(overlay);
    renderFlights();
  },

  async showAddActivity(dayIndex) {
    const plan = this._plan;
    if (!plan?.itinerary?.[dayIndex]) return;
    const day = plan.itinerary[dayIndex];
    if (day.type !== 'activity' || day.cityIndex == null) return;
    const city = plan.cities[day.cityIndex];

    const overlay = document.createElement('div');
    overlay.className = 'transit-modal';
    overlay.innerHTML = `
      <div class="transit-modal-content">
        <div class="transit-modal-title">Add Activity in ${Utils.escapeHtml(city.name)}</div>
        <div style="margin-bottom:12px">
          <input type="text" class="airport-search-input" id="activity-search-input" placeholder="Search for attractions, museums, restaurants..." autofocus>
        </div>
        <div id="activity-search-results" style="max-height:300px;overflow-y:auto"></div>
        <button class="transit-modal-close">Cancel</button>
      </div>
    `;

    overlay.querySelector('.transit-modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    document.body.appendChild(overlay);

    const input = document.getElementById('activity-search-input');
    const resultsDiv = document.getElementById('activity-search-results');
    let searchTimeout;
    let sessionToken = new google.maps.places.AutocompleteSessionToken();

    input.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      const query = input.value.trim();
      if (query.length < 2) { resultsDiv.innerHTML = ''; return; }
      searchTimeout = setTimeout(async () => {
        resultsDiv.innerHTML = '<div class="hotel-search-loading">Searching...</div>';
        try {
          const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: query,
            sessionToken,
            locationBias: { lat: city.lat || city.hotelLat, lng: city.lng || city.hotelLng, radius: 15000 },
          });

          if (!suggestions || suggestions.length === 0) {
            resultsDiv.innerHTML = '<div class="hotel-search-no-results">No results found</div>';
            return;
          }

          resultsDiv.innerHTML = suggestions.map((s, i) => {
            const pred = s.placePrediction;
            const mainText = pred.mainText?.text || pred.text?.text || '';
            const secondaryText = pred.secondaryText?.text || '';
            return `
              <div class="hotel-option" data-idx="${i}">
                <div class="hotel-option-icon"><span class="material-symbols-outlined">place</span></div>
                <div class="hotel-option-info">
                  <div class="hotel-option-name"><span class="hotel-option-name-text">${Utils.escapeHtml(mainText)}</span></div>
                  ${secondaryText ? `<div style="font-size:0.72rem;color:var(--color-text-secondary)">${Utils.escapeHtml(secondaryText)}</div>` : ''}
                </div>
              </div>
            `;
          }).join('');

          resultsDiv.querySelectorAll('.hotel-option').forEach(opt => {
            opt.addEventListener('click', async () => {
              const idx = parseInt(opt.dataset.idx);
              const pred = suggestions[idx].placePrediction;
              const name = pred.mainText?.text || pred.text?.text || '';
              let lat = null, lng = null, types = [];
              try {
                const place = await pred.toPlace();
                await place.fetchFields({ fields: ['location', 'types'] });
                if (place.location) { lat = place.location.lat(); lng = place.location.lng(); }
                types = place.types || [];
              } catch (e) { console.warn('Could not fetch place details:', e); }
              sessionToken = null;
              this._addActivity(dayIndex, { name, lat, lng, types });
              overlay.remove();
            });
          });
        } catch (err) {
          resultsDiv.innerHTML = `<div class="hotel-search-no-results">Search failed: ${Utils.escapeHtml(err.message)}</div>`;
        }
      }, 400);
    });
  },

  _addActivity(dayIndex, placeData) {
    const plan = this._plan;
    const day = plan.itinerary[dayIndex];
    if (!day) return;

    const newSeg = {
      id: `seg-add-${Date.now()}`,
      from: day.segments.length > 0
        ? { ...day.segments[day.segments.length - 1].to }
        : { label: 'HTL', sublabel: 'Hotel', isHotel: true },
      to: {
        label: placeData.name,
        sublabel: (placeData.types || []).slice(0, 2).join(', ') || 'Attraction',
        lat: placeData.lat,
        lng: placeData.lng,
        isActivity: true,
        placeId: placeData.placeId,
        entryFee: 0,
      },
      via: [{ mode: 'walk', icon: 'directions_walk', duration: '~15 min', cost: 0 }],
      cost: { low: 0, high: 0 },
      sourceRef: `activity:added:${Date.now()}`,
    };

    // Insert before the return-to-hotel segment (last segment if it goes to hotel)
    const lastSeg = day.segments[day.segments.length - 1];
    if (lastSeg?.to?.isHotel && day.segments.length > 1) {
      // Update last segment's "from" to be this new activity
      lastSeg.from = { ...newSeg.to };
      day.segments.splice(day.segments.length - 1, 0, newSeg);
    } else {
      day.segments.push(newSeg);
      // Add return to hotel
      const city = plan.cities[day.cityIndex];
      day.segments.push({
        id: `seg-return-${Date.now()}`,
        from: { ...newSeg.to },
        to: { label: 'HTL', sublabel: city?.hotelName || 'Hotel', isHotel: true, lat: city?.hotelLat, lng: city?.hotelLng },
        via: [{ mode: 'walk', icon: 'directions_walk', duration: '~15 min', cost: 0 }],
        cost: { low: 0, high: 0 },
        sourceRef: `return-hotel:${day.cityIndex}`,
      });
    }

    day.dayCost = this._computeDayCost(day, plan);
    this.render(plan);
    if (typeof Results !== 'undefined') Results.recalculateAndRenderCost();
  },

  removeActivity(segId) {
    const plan = this._plan;
    if (!plan?.itinerary) return;

    for (const day of plan.itinerary) {
      const idx = day.segments.findIndex(s => s.id === segId);
      if (idx === -1) continue;

      // Remove the segment
      const removed = day.segments.splice(idx, 1)[0];

      // Update adjacent segments
      if (idx > 0 && idx < day.segments.length) {
        // The next segment's "from" should now point to the previous segment's "to"
        day.segments[idx].from = { ...day.segments[idx - 1].to };
      }

      day.dayCost = this._computeDayCost(day, plan);
      this.render(plan);
      if (typeof Results !== 'undefined') Results.recalculateAndRenderCost();
      return;
    }
  },

  reorderActivity(segId, direction) {
    const { day, seg, index } = this._findSegment(segId);
    if (!day || index === -1) return;

    const newIdx = direction === 'up' ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= day.segments.length) return;

    // Swap
    [day.segments[index], day.segments[newIdx]] = [day.segments[newIdx], day.segments[index]];

    // Fix from/to references
    for (let i = 1; i < day.segments.length; i++) {
      day.segments[i].from = { ...day.segments[i - 1].to };
    }

    day.dayCost = this._computeDayCost(day, this._plan);
    this.render(this._plan);
  },

  _handleDrop(srcId, targetId) {
    const src = this._findSegment(srcId);
    const tgt = this._findSegment(targetId);
    if (!src.day || !tgt.day || src.day !== tgt.day) return;

    const day = src.day;
    const srcIdx = src.index;
    const tgtIdx = tgt.index;

    const [moved] = day.segments.splice(srcIdx, 1);
    day.segments.splice(tgtIdx, 0, moved);

    // Fix from/to
    for (let i = 1; i < day.segments.length; i++) {
      day.segments[i].from = { ...day.segments[i - 1].to };
    }

    day.dayCost = this._computeDayCost(day, this._plan);
    this.render(this._plan);
  },

  showDayCost(dayIndex) {
    // Could show a detailed breakdown popup - for now just scroll to that day
    const section = document.querySelector(`.day-section[data-day="${dayIndex + 1}"]`);
    if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  _findSegment(segId) {
    if (!this._plan?.itinerary) return { day: null, seg: null, index: -1 };
    for (const day of this._plan.itinerary) {
      const idx = day.segments.findIndex(s => s.id === segId);
      if (idx !== -1) return { day, seg: day.segments[idx], index: idx };
    }
    return { day: null, seg: null, index: -1 };
  },
};
