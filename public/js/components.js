const Components = {
  createChip(text, onRemove) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `
      <span>${Utils.escapeHtml(text)}</span>
      <button type="button" class="chip-remove" title="Remove" aria-label="Remove ${Utils.escapeHtml(text)}">&times;</button>
    `;
    chip.querySelector('.chip-remove').addEventListener('click', onRemove);
    return chip;
  },

  createStepper(value, min, max, onChange, label) {
    const stepper = document.createElement('div');
    stepper.className = 'stepper';
    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'stepper-btn minus';
    minusBtn.textContent = '-';
    minusBtn.setAttribute('aria-label', label ? `Decrease ${label}` : 'Decrease');

    const valueSpan = document.createElement('span');
    valueSpan.className = 'stepper-value';
    valueSpan.textContent = value;

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'stepper-btn plus';
    plusBtn.textContent = '+';
    plusBtn.setAttribute('aria-label', label ? `Increase ${label}` : 'Increase');

    function update(newVal) {
      const clamped = Utils.clamp(newVal, min, max);
      valueSpan.style.opacity = '0.3';
      requestAnimationFrame(() => {
        valueSpan.textContent = clamped;
        requestAnimationFrame(() => { valueSpan.style.opacity = '1'; });
      });
      onChange(clamped);
    }

    minusBtn.addEventListener('click', () => update(parseInt(valueSpan.textContent) - 1));
    plusBtn.addEventListener('click', () => update(parseInt(valueSpan.textContent) + 1));

    stepper.append(minusBtn, valueSpan, plusBtn);
    return stepper;
  },

  createTransferCard(transfer, index) {
    const card = document.createElement('div');
    card.className = 'timeline-card';
    card.dataset.type = 'transfer';
    card.dataset.index = index;

    const icon = transfer.type === 'home-to-airport' || transfer.type === 'airport-to-home'
      ? '&#128663;' : '&#128652;';

    // Set default selectedMode if not already set
    if (!transfer.selectedMode) {
      transfer.selectedMode = 'transit';
    }
    const sel = transfer.selectedMode;

    // Build transit routes detail HTML
    const routes = transfer.transitRoutes || [];
    let transitDetailHtml = '';

    if (routes.length > 0 && routes[0].steps?.length > 0) {
      transitDetailHtml = routes.map((route, ri) => {
        const fareBadge = route.fareSource === 'google'
          ? '<span class="fare-badge live">Google fare</span>'
          : '<span class="fare-badge est">est.</span>';

        const stepsHtml = route.steps.map(step => {
          if (step.mode === 'WALKING') {
            return `
              <div class="route-step walk-step">
                <div class="step-icon-col"><span class="step-dot walk-dot"></span><div class="step-line walk-line"></div></div>
                <div class="step-content">
                  <div class="step-label">Walk</div>
                  <div class="step-meta">${step.duration}${step.distance ? ', ' + step.distance : ''}</div>
                </div>
              </div>`;
          }
          if (step.mode === 'TRANSIT') {
            const vType = { BUS: 'Bus', HEAVY_RAIL: 'Train', SUBWAY: 'Metro', COMMUTER_TRAIN: 'Train', TRAM: 'Tram', LIGHT_RAIL: 'Light Rail', FERRY: 'Ferry' }[step.vehicleType] || 'Transit';
            const vIcon = { BUS: '&#128653;', HEAVY_RAIL: '&#128646;', SUBWAY: '&#x24C2;', COMMUTER_TRAIN: '&#128646;', TRAM: '&#128651;', FERRY: '&#x26F4;' }[step.vehicleType] || '&#128652;';
            return `
              <div class="route-step transit-step">
                <div class="step-icon-col">
                  <span class="step-dot transit-dot" style="border-color:${Utils.sanitizeColor(step.lineColor)}"></span>
                  <div class="step-line transit-line" style="background:${Utils.sanitizeColor(step.lineColor)}"></div>
                </div>
                <div class="step-content">
                  <div class="step-departure">${step.departureTime ? Utils.escapeHtml(step.departureTime) + ' — ' : ''}${Utils.escapeHtml(step.departureStop)}</div>
                  <div class="step-transit-info">
                    <span class="transit-badge" style="background:${Utils.sanitizeColor(step.lineColor)};color:${Utils.sanitizeColor(step.lineTextColor)}">${Utils.escapeHtml(step.lineName || vType)}</span>
                    <span class="step-headsign">${Utils.escapeHtml(step.headsign)}</span>
                  </div>
                  <div class="step-meta">${Utils.escapeHtml(step.duration)}${step.numStops ? ' (' + step.numStops + ' stops)' : ''}</div>
                  <div class="step-arrival">${step.arrivalTime ? Utils.escapeHtml(step.arrivalTime) + ' — ' : ''}${Utils.escapeHtml(step.arrivalStop)}</div>
                </div>
              </div>`;
          }
          return '';
        }).join('');

        return `
          <div class="transit-route-option ${ri === 0 ? 'active' : ''}" data-route="${ri}">
            <div class="route-option-header" onclick="event.stopPropagation(); Components.toggleRouteDetail(this)">
              <div class="route-option-summary">
                <span class="route-time">${route.departureTime && route.arrivalTime ? Utils.escapeHtml(route.departureTime) + ' — ' + Utils.escapeHtml(route.arrivalTime) : ''}</span>
                <span class="route-duration">${Utils.escapeHtml(route.duration)}</span>
              </div>
              <div class="route-option-detail">
                <span class="route-summary-text">${Utils.escapeHtml(route.summary || 'Transit')}</span>
                <span class="route-cost">${Utils.formatCurrency(route.publicTransportCost, 'EUR')} ${fareBadge}</span>
              </div>
            </div>
            <div class="route-steps-timeline" style="display:${ri === 0 ? 'none' : 'none'}">
              ${stepsHtml}
            </div>
          </div>`;
      }).join('');
    }

    const walk = transfer.walking;
    const bike = transfer.bicycling;

    // Compute header cost based on selected mode
    const headerCost = this._getTransferModeCost(transfer);

    // Schedule times with dates
    const schedStart = Utils.formatDateTimeFromDate(transfer.scheduleStart);
    const schedEnd = Utils.formatDateTimeFromDate(transfer.scheduleEnd);
    const schedHtml = (schedStart && schedEnd)
      ? `<span class="card-schedule">${schedStart} &rarr; ${schedEnd}</span>` : '';

    // Google Maps directions link
    const mapsUrl = (transfer.originLat && transfer.destLat)
      ? `https://www.google.com/maps/dir/${encodeURIComponent(transfer.from)}/@${transfer.originLat},${transfer.originLng}/${encodeURIComponent(transfer.to)}/@${transfer.destLat},${transfer.destLng}`
      : null;
    const mapsLinkHtml = mapsUrl
      ? `<a class="transfer-maps-link" href="${Utils.escapeHtml(mapsUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open in Google Maps">&#x1F5FA;</a>`
      : '';

    card.innerHTML = `
      <div class="card-header" aria-expanded="false" onclick="Components.toggleCard(this)">
        <div class="card-icon">${icon}</div>
        <div class="card-title">
          <h4>${Utils.escapeHtml(transfer.from)} &rarr; ${Utils.escapeHtml(transfer.to)} ${mapsLinkHtml}</h4>
          <span class="card-subtitle">${transfer.durationText || 'Transfer'}${transfer.distanceKm ? ' &middot; ~' + Math.round(transfer.distanceKm) + ' km' : ''}</span>
          ${schedHtml}
        </div>
        <div class="card-cost" id="transfer-cost-${index}">${Utils.formatCurrency(headerCost, 'EUR')}</div>
        <span class="expand-arrow">&#9660;</span>
      </div>
      <div class="card-body">
        <div class="transfer-mode-section${sel === 'taxi' ? ' selected' : ''}" data-mode="taxi" onclick="Components.selectTransferMode(${index}, 'taxi')">
          <div class="transfer-mode-header">
            <span class="transfer-mode-check">${sel === 'taxi' ? '&#9679;' : '&#9675;'}</span>
            &#128661; <strong>Taxi / Cab</strong>
            <span class="transfer-mode-cost">${Utils.formatCurrency(transfer.taxiCost, 'EUR')}</span>
          </div>
          <div class="transfer-mode-meta">
            ${Utils.escapeHtml(transfer.durationText || '')}${transfer.drivingSummary ? ' via ' + Utils.escapeHtml(transfer.drivingSummary) : ''} &middot; ~${Math.round(transfer.distanceKm)} km
          </div>
        </div>

        <div class="transfer-mode-section${sel === 'transit' ? ' selected' : ''}" data-mode="transit" onclick="Components.selectTransferMode(${index}, 'transit')">
          <div class="transfer-mode-header">
            <span class="transfer-mode-check">${sel === 'transit' ? '&#9679;' : '&#9675;'}</span>
            &#128646; <strong>Public Transport</strong>
            <span class="transfer-mode-cost">${Utils.formatCurrency(transfer.publicTransportCost, 'EUR')}</span>
          </div>
          ${transitDetailHtml
            ? `<div class="transit-routes-list" onclick="event.stopPropagation()">${transitDetailHtml}</div>`
            : `<div class="transfer-mode-meta">${transfer.transitDuration || transfer.durationText || 'Duration varies'}</div>`
          }
        </div>

        ${bike ? `<div class="transfer-mode-section${sel === 'bike' ? ' selected' : ''}" data-mode="bike" onclick="Components.selectTransferMode(${index}, 'bike')">
          <div class="transfer-mode-header">
            <span class="transfer-mode-check">${sel === 'bike' ? '&#9679;' : '&#9675;'}</span>
            &#128690; <strong>Bicycle</strong>
            <span class="transfer-mode-cost">Free</span>
          </div>
          <div class="transfer-mode-meta">${bike.duration} &middot; ${bike.distanceText || bike.distanceKm + ' km'}${bike.summary ? ' via ' + bike.summary : ''}</div>
        </div>` : ''}

        ${walk ? `<div class="transfer-mode-section${sel === 'walk' ? ' selected' : ''}" data-mode="walk" onclick="Components.selectTransferMode(${index}, 'walk')">
          <div class="transfer-mode-header">
            <span class="transfer-mode-check">${sel === 'walk' ? '&#9679;' : '&#9675;'}</span>
            &#128694; <strong>Walking</strong>
            <span class="transfer-mode-cost">Free</span>
          </div>
          <div class="transfer-mode-meta">${walk.duration} &middot; ${walk.distanceText || walk.distanceKm + ' km'}</div>
        </div>` : ''}
      </div>
    `;
    return card;
  },

  _getTransferModeCost(transfer) {
    switch (transfer.selectedMode) {
      case 'taxi': return transfer.taxiCost || 0;
      case 'transit': return transfer.publicTransportCost || 0;
      case 'bike': return 0;
      case 'walk': return 0;
      default: return transfer.publicTransportCost || 0;
    }
  },

  selectTransferMode(transferIndex, mode) {
    const plan = Results.plan;
    if (!plan || !plan.transfers[transferIndex]) return;
    const transfer = plan.transfers[transferIndex];
    transfer.selectedMode = mode;

    // Update the card UI
    const card = document.querySelector(`.timeline-card[data-type="transfer"][data-index="${transferIndex}"]`);
    if (card) {
      // Toggle selected class on mode sections
      card.querySelectorAll('.transfer-mode-section').forEach(sec => {
        const isSelected = sec.dataset.mode === mode;
        sec.classList.toggle('selected', isSelected);
        const check = sec.querySelector('.transfer-mode-check');
        if (check) check.innerHTML = isSelected ? '&#9679;' : '&#9675;';
      });
      // Update header cost
      const costEl = card.querySelector(`#transfer-cost-${transferIndex}`);
      if (costEl) {
        const cost = this._getTransferModeCost(transfer);
        costEl.textContent = Utils.formatCurrency(cost, 'EUR');
      }
    }

    // Recalculate cost sidebar
    Results.recalculateAndRenderCost();
  },

  toggleRouteDetail(headerEl) {
    const timeline = headerEl.nextElementSibling;
    if (timeline) {
      const isVisible = timeline.style.display === 'block';
      timeline.style.display = isVisible ? 'none' : 'block';
      headerEl.classList.toggle('expanded', !isVisible);
    }
  },

  // Airline brand colors for logo circles
  AIRLINE_COLORS: {
    KL: '#00A1DE', AF: '#002157', EK: '#D71921', EY: '#BD8B13', QR: '#5C0632',
    SQ: '#F0AB00', LH: '#05164D', BA: '#075AAA', AA: '#B6252A', DL: '#003366',
    UA: '#005DAA', '6E': '#2D2073', AI: '#E3350D', SV: '#006633', TK: '#C8102E',
    MS: '#00205B', WY: '#8D1B3D', GF: '#C4975C', KU: '#006B3F', RJ: '#1B365D',
    WZ: '#C6007E', FR: '#073590', U2: '#FF6600', W6: '#C6007E', LX: '#E2001A',
    OS: '#D81E05', SK: '#00005E', AY: '#0B1560', IB: '#D81E05', TP: '#027651',
  },

  getAirlineColor(code) {
    return this.AIRLINE_COLORS[code] || 'var(--color-primary)';
  },

  _buildModePills(leg, legIndex) {
    if (!leg.groundRoutes) return '';
    const mode = leg.selectedMode || 'flight';
    const gr = leg.groundRoutes;
    const pills = [];
    // Flight is always available if there are offers
    if (leg.offers && leg.offers.length > 0) {
      pills.push({ key: 'flight', icon: '&#9992;&#65039;', tip: 'Flight' });
    }
    if (gr.transitRoutes && gr.transitRoutes.length > 0) {
      pills.push({ key: 'transit', icon: '&#128646;', tip: 'Train / Transit' });
    }
    if (gr.driving) {
      pills.push({ key: 'drive', icon: '&#128663;', tip: 'Drive' });
    }
    if (gr.walking && gr.walking.durationSec < 36000) { // only if < 10h
      pills.push({ key: 'walk', icon: '&#128694;', tip: 'Walk' });
    }
    if (gr.bicycling && gr.bicycling.durationSec < 36000) {
      pills.push({ key: 'bike', icon: '&#128690;', tip: 'Bike' });
    }
    if (pills.length <= 1) return ''; // no toggle needed
    return `<div class="transport-mode-toggle">${pills.map(p =>
      `<button class="mode-pill${p.key === mode ? ' active' : ''}" title="${p.tip}" onclick="event.stopPropagation(); Components.selectTransportMode(${legIndex}, '${p.key}')">${p.icon}</button>`
    ).join('')}</div>`;
  },

  _buildTransitOptionRow(route, legIndex, routeIndex, isSelected) {
    const fareBadge = route.fareSource === 'google'
      ? '<span class="fare-badge live">Google fare</span>'
      : '<span class="fare-badge est">est.</span>';
    return `
      <div class="flight-option${isSelected ? ' selected' : ''}" onclick="Components.selectTransitOption(${legIndex}, ${routeIndex})" data-route-idx="${routeIndex}">
        <div class="flight-option-airline">
          <div class="airline-logo" style="background:var(--color-primary)">&#128646;</div>
          <span class="airline-name">Transit</span>
        </div>
        <div class="flight-option-route">
          <div class="flight-option-times">
            <span class="dep-time">${route.departureTime || ''}</span>
            <div class="flight-option-duration">
              <span class="duration-text">${route.duration}</span>
              <div class="duration-line"></div>
              <span class="stops-text">${route.summary || 'Transit'}</span>
            </div>
            <span class="arr-time">${route.arrivalTime || ''}</span>
          </div>
        </div>
        <div class="flight-option-price">
          <span class="price-amount">${Utils.formatCurrency(route.publicTransportCost || 0, 'EUR')}</span>
          <span class="price-label">per person ${fareBadge}</span>
        </div>
      </div>`;
  },

  selectTransitOption(legIndex, routeIndex) {
    const leg = Results.plan?.flightLegs?.[legIndex];
    if (!leg) return;

    // Train legs use trainRoutes, flight legs use groundRoutes
    const isTrain = leg.legType === 'train';
    const routes = isTrain
      ? leg.trainRoutes?.transitRoutes
      : leg.groundRoutes?.transitRoutes;
    if (!routes?.[routeIndex]) return;

    const selected = routes[routeIndex];
    // Move selected to top
    if (routeIndex !== 0) {
      routes.splice(routeIndex, 1);
      routes.unshift(selected);
    }

    if (isTrain) {
      // Update transitInfo with selected route's fare/duration
      if (!leg.transitInfo) leg.transitInfo = {};
      if (selected.fareSource === 'google') leg.transitInfo.estimatedCostEur = selected.publicTransportCost;
      if (selected.duration) leg.transitInfo.duration = selected.duration;
      leg.transitInfo.fareSource = selected.fareSource || 'estimate';
      // Recompute schedule (duration may have changed) and re-render
      Results._computeTimelineSchedule();
      const oldCard = document.querySelector(`.timeline-card[data-type="train"][data-index="${legIndex}"]`);
      if (oldCard) oldCard.replaceWith(this.createTrainCard(leg, legIndex));
    } else {
      // Re-render flight card in-place
      const oldCard = document.querySelector(`.timeline-card[data-type="flight"][data-index="${legIndex}"]`);
      if (oldCard) oldCard.replaceWith(this.createFlightCard(leg, legIndex));
    }
    Results.recalculateAndRenderCost();
  },

  _buildGroundRouteBody(leg, legIndex) {
    const gr = leg.groundRoutes;
    const mode = leg.selectedMode;
    if (mode === 'transit') {
      const routes = gr.transitRoutes || [];
      if (routes.length === 0) return '<div class="ground-route-body"><p>No transit routes found.</p></div>';

      // Selected (first) route shown prominently
      const topHtml = this._buildTransitOptionRow(routes[0], legIndex, 0, true);

      // Remaining routes in collapsible "more options"
      let moreHtml = '';
      const remaining = routes.slice(1);
      if (remaining.length > 0) {
        const moreRows = remaining.map((r, ri) => this._buildTransitOptionRow(r, legIndex, ri + 1, false)).join('');
        moreHtml = `
          <div class="flight-more-toggle" onclick="Components.toggleMoreOptions(this)">
            &#9662; ${remaining.length} more option${remaining.length > 1 ? 's' : ''}
          </div>
          <div class="flight-more-list">${moreRows}</div>
        `;
      }

      return `
        <div class="flight-options">${topHtml}</div>
        ${moreHtml}
      `;
    }
    if (mode === 'drive') {
      const d = gr.driving;
      return `<div class="ground-route-body">
        <div class="ground-route-summary">
          <div class="ground-route-icon">&#128663;</div>
          <div class="ground-route-info">
            <div class="route-label">Drive${d.summary ? ' via ' + d.summary : ''}</div>
            <div class="route-meta">${d.duration} &middot; ~${Math.round(d.distanceKm)} km</div>
          </div>
          <div class="ground-route-cost">
            <span class="cost-amount">${Utils.formatCurrency(d.taxiCost || 0, 'EUR')}</span>
            <span class="cost-label">taxi estimate</span>
          </div>
        </div>
      </div>`;
    }
    if (mode === 'walk') {
      const w = gr.walking;
      return `<div class="ground-route-body">
        <div class="ground-route-summary">
          <div class="ground-route-icon">&#128694;</div>
          <div class="ground-route-info">
            <div class="route-label">Walk</div>
            <div class="route-meta">${w.duration} &middot; ${w.distanceText || (Math.round(w.distanceKm) + ' km')}</div>
          </div>
          <div class="ground-route-cost"><span class="cost-amount">Free</span></div>
        </div>
      </div>`;
    }
    if (mode === 'bike') {
      const b = gr.bicycling;
      return `<div class="ground-route-body">
        <div class="ground-route-summary">
          <div class="ground-route-icon">&#128690;</div>
          <div class="ground-route-info">
            <div class="route-label">Bicycle</div>
            <div class="route-meta">${b.duration} &middot; ${b.distanceText || (Math.round(b.distanceKm) + ' km')}</div>
          </div>
          <div class="ground-route-cost"><span class="cost-amount">Free</span></div>
        </div>
      </div>`;
    }
    return '';
  },

  async selectTransportMode(legIndex, mode) {
    const leg = Results.plan?.flightLegs?.[legIndex];
    if (!leg) return;
    leg.selectedMode = mode;
    // Recalculate adjacent transfers (airport vs city center routing)
    await Results._recalcTransfersForMode(legIndex);
    // Re-render full timeline (transfers + schedule times all update)
    Results.renderTimeline();
    Results.recalculateAndRenderCost();
  },

  createFlightCard(leg, index) {
    const card = document.createElement('div');
    card.className = 'timeline-card';
    card.dataset.type = 'flight';
    card.dataset.index = index;

    const modePillsHtml = this._buildModePills(leg, index);
    const currentMode = leg.selectedMode || 'flight';

    // Non-flight mode: render ground transport body
    if (currentMode !== 'flight' && leg.groundRoutes) {
      const groundBodyHtml = this._buildGroundRouteBody(leg, index);
      // Schedule times
      const schedStart = Utils.formatDateTimeFromDate(leg.scheduleStart);
      const schedEnd = Utils.formatDateTimeFromDate(leg.scheduleEnd);
      const schedHtml = (schedStart && schedEnd)
        ? `<span class="card-schedule">${schedStart} &rarr; ${schedEnd}</span>` : '';

      const modeIcons = { transit: '&#128646;', drive: '&#128663;', walk: '&#128694;', bike: '&#128690;' };
      const fromLabel = leg.fromCityName || leg.fromName || leg.from;
      const toLabel = leg.toCityName || leg.toName || leg.to;

      card.innerHTML = `
        <div class="flight-card-header">
          <span class="card-icon">${modeIcons[currentMode] || '&#128646;'}</span>
          <div class="card-title">
            <h4>${fromLabel} &rarr; ${toLabel}</h4>
            ${schedHtml}
          </div>
          ${modePillsHtml}
          <span class="flight-date">${Utils.formatDate(leg.date)}</span>
        </div>
        ${groundBodyHtml}
      `;
      return card;
    }

    // Flight mode (existing behavior)
    if (!leg.offers || leg.offers.length === 0) {
      card.innerHTML = `
        <div class="flight-card-header">
          <span class="card-icon">&#9992;&#65039;</span>
          <h4>${leg.fromName || leg.from} &rarr; ${leg.toName || leg.to}</h4>
          ${modePillsHtml}
          <span class="flight-date">No flights found for ${Utils.formatDateShort(leg.date)}</span>
        </div>
      `;
      return card;
    }

    const selectedIdx = leg.offers.indexOf(leg.selectedOffer);
    const selectedOfferIdx = selectedIdx >= 0 ? selectedIdx : 0;
    const topOffers = leg.offers.slice(0, 1);
    const remaining = leg.offers.slice(1);

    // Build top 1 option row (always visible)
    const optionsHtml = topOffers.map((offer, oi) => this._buildFlightOptionRow(offer, index, oi, oi === selectedOfferIdx)).join('');

    // Build remaining offers rows
    let moreHtml = '';
    if (remaining.length > 0) {
      const moreRows = remaining.map((offer, oi) => this._buildFlightOptionRow(offer, index, oi + 1, (oi + 1) === selectedOfferIdx)).join('');
      moreHtml = `
        <div class="flight-more-toggle" onclick="Components.toggleMoreOptions(this)">
          &#9662; ${remaining.length} more option${remaining.length > 1 ? 's' : ''}
        </div>
        <div class="flight-more-list">${moreRows}</div>
      `;
    }

    // Layover meals for selected offer
    const selOffer = leg.selectedOffer || leg.offers[0];
    const layoverHtml = this._buildLayoverMealsHtml(selOffer);

    // Flight time summary with dates
    const flightDepDt = selOffer?.departure ? new Date(selOffer.departure) : null;
    const flightArrDt = selOffer?.arrival ? new Date(selOffer.arrival) : null;
    const flightDepStr = flightDepDt ? Utils.formatDateTimeFromDate(flightDepDt) : '';
    const flightArrStr = flightArrDt ? Utils.formatDateTimeFromDate(flightArrDt) : '';
    const flightSchedHtml = (flightDepStr && flightArrStr)
      ? `<span class="card-schedule">${flightDepStr} &rarr; ${flightArrStr}</span>` : '';

    card.innerHTML = `
      <div class="flight-card-header">
        <span class="card-icon">&#9992;&#65039;</span>
        <div class="card-title">
          <h4>${leg.fromName || leg.from} &rarr; ${leg.toName || leg.to}</h4>
          ${flightSchedHtml}
        </div>
        ${modePillsHtml}
        <span class="flight-date">${Utils.formatDate(leg.date)}</span>
      </div>
      <div class="flight-options">${optionsHtml}</div>
      ${moreHtml}
      <div class="flight-layover-area">${layoverHtml}</div>
    `;
    return card;
  },

  _buildFlightOptionRow(offer, legIndex, offerIndex, isSelected) {
    const airlineCode = offer.airline || '';
    const airlineName = offer.airlineName || airlineCode;
    const color = this.getAirlineColor(airlineCode);
    const fromCode = offer.segments?.[0]?.from || '';
    const toCode = offer.segments?.[offer.segments.length - 1]?.to || '';
    let stopsText;
    if (offer.stops === 0) {
      stopsText = '<span class="stops-direct">Nonstop</span>';
    } else {
      const layoverDetail = offer.layovers?.map(l => {
        const dur = l.durationText || '';
        return dur ? `${dur} ${l.airportCode}` : l.airportCode;
      }).join(', ') || '';
      stopsText = `${offer.stops} stop${offer.stops > 1 ? 's' : ''}`;
      if (layoverDetail) stopsText += ` · ${layoverDetail}`;
    }

    return `
      <div class="flight-option${isSelected ? ' selected' : ''}" onclick="Components.selectFlightOption(${legIndex}, ${offerIndex})" data-offer-idx="${offerIndex}">
        <div class="flight-option-airline">
          <div class="airline-logo" style="background:${color}">${airlineCode.slice(0, 2)}</div>
          <span class="airline-name">${airlineName}</span>
        </div>
        <div class="flight-option-route">
          <div class="flight-option-times">
            <span class="dep-time">${Utils.formatTime(offer.departure)}</span>
            <div class="flight-option-duration">
              <span class="duration-text">${Utils.formatDuration(offer.duration)}</span>
              <div class="duration-line"></div>
              <span class="stops-text">${stopsText}</span>
            </div>
            <span class="arr-time">${Utils.formatTime(offer.arrival)}</span>
          </div>
          <div class="flight-option-codes">
            <span>${fromCode}–${toCode}</span>
          </div>
        </div>
        <div class="flight-option-price">
          <span class="price-amount">${Utils.formatCurrency(offer.price, offer.currency || 'EUR')}</span>
          <span class="price-label">per adult</span>
        </div>
      </div>`;
  },

  _buildLayoverMealsHtml(offer) {
    if (!offer?.layovers || !offer.layovers.some(l => l.mealCost && l.mealCost.cost > 0)) return '';
    return `
      <div class="layover-meals-section">
        <div class="card-detail-label" style="margin-bottom:6px;">Layover Meals</div>
        ${offer.layovers.filter(l => l.mealCost && l.mealCost.cost > 0).map(l => `
          <div class="layover-meal-row">
            <div class="layover-meal-info">
              <span class="layover-airport">${l.airportCode}</span>
              <span class="layover-duration">${l.durationText} layover</span>
            </div>
            <div class="layover-meal-detail">
              <span>${l.mealCost.description}</span>
              <span class="layover-meal-cost">${Utils.formatCurrency(l.mealCost.cost, 'EUR')}/person</span>
              ${l.mealCost.source ? `<span class="confidence-badge default">${l.mealCost.source.includes('airport') ? 'airport data' : 'estimate'}</span>` : ''}
            </div>
          </div>
        `).join('')}
      </div>`;
  },

  selectFlightOption(legIndex, offerIndex) {
    // Update data model
    if (typeof Results === 'undefined' || !Results.plan) return;
    const leg = Results.plan.flightLegs[legIndex];
    if (!leg || !leg.offers[offerIndex]) return;

    const selected = leg.offers[offerIndex];
    leg.selectedOffer = selected;

    // Move selected offer to top of the list
    if (offerIndex !== 0) {
      leg.offers.splice(offerIndex, 1);
      leg.offers.unshift(selected);
    }

    // Re-render just this flight card in-place (collapsed "more options")
    const oldCard = document.querySelector(`.timeline-card[data-type="flight"][data-index="${legIndex}"]`);
    if (oldCard) {
      const newCard = this.createFlightCard(leg, legIndex);
      oldCard.replaceWith(newCard);
    }

    // Recalculate dates (arrival date may differ) and cost sidebar
    const oldArrival = leg.arrivalDate;
    const newArrival = Utils.getArrivalDate(leg.selectedOffer) || leg.date;
    leg.arrivalDate = newArrival;
    if (oldArrival !== newArrival) {
      Results.recalculateFlightDates();
      Results.renderTimeline();
    }
    Results.recalculateAndRenderCost();
  },

  toggleMoreOptions(toggleEl) {
    const list = toggleEl.nextElementSibling;
    if (!list) return;
    const isVisible = list.classList.contains('expanded');
    list.classList.toggle('expanded');
    toggleEl.innerHTML = isVisible
      ? `&#9662; ${list.children.length} more option${list.children.length > 1 ? 's' : ''}`
      : `&#9652; hide options`;
  },

  _buildHotelOptionRow(hotel, cityIndex, optionIndex, isSelected) {
    const distanceText = hotel.distance ? `${hotel.distance.toFixed(1)} km` : '';
    const roomText = hotel.roomType || '';
    const metaParts = [distanceText, roomText].filter(Boolean).join(' \u00b7 ');

    // Photo: show image if available, fall back to emoji icon
    const photoHtml = hotel.photoUrl
      ? `<img class="hotel-option-photo" src="${Utils.escapeHtml(hotel.photoUrl)}" alt="${Utils.escapeHtml(hotel.name || 'Hotel')}" loading="lazy" onerror="this.outerHTML='<div class=\\'hotel-option-icon\\'>&#127976;</div>'">`
      : '<div class="hotel-option-icon">&#127976;</div>';

    // Rating badge
    let ratingHtml = '';
    if (hotel.rating) {
      const reviewText = hotel.reviewCount ? `(${hotel.reviewCount.toLocaleString()})` : '';
      ratingHtml = `<div class="hotel-option-rating">
        <span class="rating-score">${hotel.rating.toFixed(1)}</span>
        ${reviewText ? `<span class="rating-reviews">${reviewText}</span>` : ''}
      </div>`;
    }

    // Listing link
    const linkHtml = hotel.listingUrl
      ? `<a class="hotel-option-link" href="${Utils.escapeHtml(hotel.listingUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="View on Booking.com">&#8599;</a>`
      : '';

    return `
      <div class="hotel-option${isSelected ? ' selected' : ''}" onclick="Results.selectHotelOption(${cityIndex}, ${optionIndex})">
        ${photoHtml}
        <div class="hotel-option-info">
          <div class="hotel-option-name">${Utils.escapeHtml(hotel.name || 'Hotel')}${linkHtml}</div>
          ${ratingHtml}
          ${metaParts ? `<div class="hotel-option-meta">${Utils.escapeHtml(metaParts)}</div>` : ''}
        </div>
        <div class="hotel-option-price">
          <span class="price-amount">${Utils.formatCurrency(hotel.pricePerNight, 'EUR')}</span>
          <span class="price-label">per night</span>
        </div>
      </div>`;
  },

  createCityCard(city, index) {
    const card = document.createElement('div');
    card.className = 'timeline-card';
    card.dataset.type = 'city';
    card.dataset.index = index;

    const nightlyRate = city.hotelBasePrice || CostEngine.getHotelBasePrice(city.cityCode);
    const rooms = CostEngine.calculateRooms(city.adults || 2);
    const isLive = city.hotelPriceSource === 'live';

    // Build meal breakdown HTML
    let mealHtml = '';
    if (city.mealCosts) {
      const meals = city.mealCosts;
      const mealTier = 'mid';
      const b = meals.breakfast?.[mealTier] || 8;
      const l = meals.lunch?.[mealTier] || 14;
      const d = meals.dinner?.[mealTier] || 20;
      const daily = b + l + d;
      const totalPersons = (city.adults || 2) + ((typeof city.children !== 'undefined' ? city.children : 0) * CostEngine.CHILD_MEAL_FACTOR);
      const cityTotal = daily * city.nights * totalPersons;
      const levelLabel = meals.level === 'city' ? 'city data' : meals.level === 'country' ? 'country avg' : 'estimate';
      const levelClass = meals.level || 'default';

      mealHtml = `
        <div class="meal-costs-section">
          <div class="meal-section-header">
            &#127860; <strong>Daily Meals</strong>
            <span class="confidence-badge ${levelClass}">${levelLabel}</span>
          </div>
          <div class="meal-breakdown" id="meal-breakdown-${index}">
            <div class="meal-row"><span>Breakfast</span><span>${Utils.formatCurrency(b, 'EUR')}/person</span></div>
            <div class="meal-row"><span>Lunch</span><span>${Utils.formatCurrency(l, 'EUR')}/person</span></div>
            <div class="meal-row"><span>Dinner</span><span>${Utils.formatCurrency(d, 'EUR')}/person</span></div>
            <div class="meal-row total"><span>${city.nights} night${city.nights !== 1 ? 's' : ''} total</span><span>~${Utils.formatCurrency(Math.round(cityTotal), 'EUR')}</span></div>
          </div>
          ${meals.source ? `<div class="source-note">${meals.source}</div>` : ''}
        </div>
      `;
    }

    const hotelNameDisplay = city.hotelName || `${city.name} Hotel`;

    // Compute dates
    const checkInDate = city.checkInDate || '';
    const checkOutDate = checkInDate ? Utils.addDays(checkInDate, city.nights) : '';

    // Traveler arrival time (when they actually reach the hotel)
    const travArrival = Utils.formatTimeFromDate(city.travelerArrival);
    // Hotel standard check-in / check-out
    const hotelCiTime = Utils.formatTimeFromDate(city.hotelCheckIn);
    const hotelCoTime = Utils.formatTimeFromDate(city.hotelCheckOut);
    const ciDateStr = checkInDate ? Utils.formatDateShort(checkInDate) : '';
    const coDateStr = checkOutDate ? Utils.formatDateShort(checkOutDate) : '';

    // Early / late check-in indicator
    let arrivalNote = '';
    if (city.travelerArrival && city.hotelCheckIn) {
      if (city.travelerArrival.getTime() < city.hotelCheckIn.getTime()) {
        arrivalNote = '<span class="arrival-early">early check-in</span>';
      } else if (city.travelerArrival.getTime() > city.hotelCheckIn.getTime()) {
        arrivalNote = '<span class="arrival-late">late check-in</span>';
      }
    }

    // Schedule line for card header (3 separate lines)
    let schedHtml = '';
    if (ciDateStr) {
      const checkinStr = `Check-in ${hotelCiTime || '3:00 PM'}`;
      const arrivalStr = travArrival ? `Arrives ${travArrival}` : '';
      const checkoutStr = (coDateStr && hotelCoTime) ? `Check-out ${coDateStr} ${hotelCoTime}` : '';
      schedHtml = `<span class="card-schedule">${checkinStr}</span>`;
      if (arrivalStr && arrivalNote) {
        schedHtml += `<span class="card-schedule">${arrivalStr} ${arrivalNote}</span>`;
      } else if (arrivalStr) {
        schedHtml += `<span class="card-schedule">${arrivalStr}</span>`;
      }
      if (checkoutStr) {
        schedHtml += `<span class="card-schedule">${checkoutStr}</span>`;
      }
    }

    // Detailed dates inside card body
    let datesHtml = '';
    if (ciDateStr) {
      datesHtml = `<div class="city-dates">
        <div class="city-dates-row">
          <span>&#128273; Hotel check-in</span>
          <strong>${ciDateStr}, ${hotelCiTime || '3:00 PM'}</strong>
        </div>
        <div class="city-dates-row">
          <span>&#128337; Arrives at hotel</span>
          <strong>${ciDateStr}${travArrival ? ', ' + travArrival : ''}</strong>
          ${arrivalNote}
        </div>
        <div class="city-dates-row">
          <span>&#128682; Hotel check-out</span>
          <strong>${coDateStr}${hotelCoTime ? ', ' + hotelCoTime : ''}</strong>
        </div>
      </div>`;
    }

    // Build hotel options HTML
    let hotelOptionsHtml = '';
    const hotelOpts = city.hotelOptions || [];
    if (hotelOpts.length > 0) {
      const topHtml = this._buildHotelOptionRow(hotelOpts[0], index, 0, true);
      let moreHtml = '';
      const remaining = hotelOpts.slice(1);
      if (remaining.length > 0) {
        const moreRows = remaining.map((h, hi) => this._buildHotelOptionRow(h, index, hi + 1, false)).join('');
        moreHtml = `
          <div class="hotel-more-toggle" onclick="Components.toggleMoreOptions(this)">
            &#9662; ${remaining.length} more option${remaining.length > 1 ? 's' : ''}
          </div>
          <div class="hotel-more-list">${moreRows}</div>
        `;
      }
      hotelOptionsHtml = `
        <div class="hotel-options">${topHtml}</div>
        ${moreHtml}
      `;
    } else {
      hotelOptionsHtml = `
        <div class="hotel-price-note">
          ${Utils.formatCurrency(nightlyRate, 'EUR')} / night ${rooms > 1 ? `&middot; ${rooms} rooms` : ''}
          <span class="confidence-badge ${isLive ? 'live' : 'default'}">${isLive ? 'live price' : 'estimate'}</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-header" aria-expanded="false" onclick="Components.toggleCard(this)">
        <div class="card-icon">&#127976;</div>
        <div class="card-title">
          <h4>${Utils.escapeHtml(hotelNameDisplay)}, ${Utils.escapeHtml(city.name)}</h4>
          <span class="card-subtitle">${city.nights} night${city.nights !== 1 ? 's' : ''} stay &middot; ${Utils.formatCurrency(nightlyRate, 'EUR')}/night${rooms > 1 ? ` &middot; ${rooms} rooms` : ''}</span>
          ${schedHtml}
        </div>
        <div class="card-cost" id="city-cost-${index}">${Utils.formatCurrency(nightlyRate * city.nights * rooms, 'EUR')}</div>
        <span class="expand-arrow">&#9660;</span>
      </div>
      <div class="card-body">
        <div class="city-card-body">
          ${datesHtml}
          <div class="city-edit-row">
            <label>Nights</label>
            <button class="nights-edit-btn" onclick="event.stopPropagation(); Results.onNightsChange(${index})">
              <span class="nights-edit-value">${city.nights}</span> night${city.nights !== 1 ? 's' : ''}
              <span class="nights-edit-icon">&#9998;</span>
            </button>
          </div>
          ${hotelOptionsHtml}
          ${mealHtml}
        </div>
      </div>
    `;

    return card;
  },

  createTrainCard(leg, index) {
    const card = document.createElement('div');
    card.className = 'timeline-card';
    card.dataset.type = 'train';
    card.dataset.index = index;

    const transit = leg.transitInfo || {};
    const costPerPerson = transit.estimatedCostEur || 15;
    const routes = leg.trainRoutes?.transitRoutes || [];

    const trainStart = Utils.formatDateTimeFromDate(leg.scheduleStart);
    const trainEnd = Utils.formatDateTimeFromDate(leg.scheduleEnd);
    const trainSchedHtml = (trainStart && trainEnd)
      ? `<span class="card-schedule">${trainStart} &rarr; ${trainEnd}</span>` : '';

    // When we have Google Maps transit routes, show them like flight options
    if (routes.length > 0) {
      const topHtml = this._buildTransitOptionRow(routes[0], index, 0, true);
      let moreHtml = '';
      const remaining = routes.slice(1);
      if (remaining.length > 0) {
        const moreRows = remaining.map((r, ri) => this._buildTransitOptionRow(r, index, ri + 1, false)).join('');
        moreHtml = `
          <div class="flight-more-toggle" onclick="Components.toggleMoreOptions(this)">
            &#9662; ${remaining.length} more option${remaining.length > 1 ? 's' : ''}
          </div>
          <div class="flight-more-list">${moreRows}</div>
        `;
      }

      card.innerHTML = `
        <div class="flight-card-header">
          <div class="card-icon">&#128646;</div>
          <div class="card-title">
            <h4>${leg.fromName || leg.from} &rarr; ${leg.toName}</h4>
            <span class="card-subtitle">Train/Bus &middot; ${Utils.formatDateShort(leg.date)}</span>
            ${trainSchedHtml}
          </div>
        </div>
        <div class="flight-options">${topHtml}</div>
        ${moreHtml}
      `;
    } else {
      // Fallback: static card when no transit data
      card.innerHTML = `
        <div class="card-header" aria-expanded="false" onclick="Components.toggleCard(this)">
          <div class="card-icon">&#128646;</div>
          <div class="card-title">
            <h4>${leg.fromName || leg.from} &rarr; ${leg.toName}</h4>
            <span class="card-subtitle">
              ${transit.duration || 'Train/Bus'} &middot; ${Utils.formatDateShort(leg.date)}
            </span>
            ${trainSchedHtml}
          </div>
          <div class="card-cost">${Utils.formatCurrency(costPerPerson, 'EUR')}<br>
            <span style="font-size:0.72rem;font-weight:400;color:var(--color-text-secondary)">per person</span>
          </div>
          <span class="expand-arrow">&#9660;</span>
        </div>
        <div class="card-body">
          <div class="card-detail-row">
            <span class="card-detail-label">Transport</span>
            <span class="card-detail-value">Train / Bus</span>
          </div>
          <div class="card-detail-row">
            <span class="card-detail-label">Duration</span>
            <span class="card-detail-value">${transit.duration || 'Varies'}</span>
          </div>
          <div class="card-detail-row">
            <span class="card-detail-label">Distance</span>
            <span class="card-detail-value">${transit.distanceKm ? `~${transit.distanceKm} km` : 'Varies'}</span>
          </div>
          <div class="card-detail-row">
            <span class="card-detail-label">Est. cost per person</span>
            <span class="card-detail-value">${Utils.formatCurrency(costPerPerson, 'EUR')}</span>
          </div>
          <div class="hotel-price-note" style="margin-top:8px;">
            No direct flights available. Train/bus is the recommended route.
          </div>
        </div>
      `;
    }
    return card;
  },

  createConnector() {
    const div = document.createElement('div');
    div.className = 'timeline-connector';
    return div;
  },

  toggleCard(headerEl) {
    const body = headerEl.nextElementSibling;
    if (!body) return;
    const isExpanded = headerEl.classList.contains('expanded');

    if (isExpanded) {
      // Collapse: set explicit max-height first, then animate to 0
      body.style.maxHeight = body.scrollHeight + 'px';
      body.offsetHeight; // force reflow
      requestAnimationFrame(() => {
        body.style.maxHeight = '0';
        body.style.opacity = '0';
        body.style.paddingTop = '0';
      });
      headerEl.classList.remove('expanded');
      headerEl.setAttribute('aria-expanded', 'false');
      body.classList.remove('expanded');
      // Clean up inline styles after transition
      const onEnd = () => {
        body.style.maxHeight = '';
        body.style.opacity = '';
        body.style.paddingTop = '';
        body.removeEventListener('transitionend', onEnd);
      };
      body.addEventListener('transitionend', onEnd, { once: true });
    } else {
      // Expand: set expanded class and animate to scrollHeight
      headerEl.classList.add('expanded');
      headerEl.setAttribute('aria-expanded', 'true');
      body.classList.add('expanded');
      body.style.maxHeight = body.scrollHeight + 'px';
      // Remove inline max-height after transition so content can resize
      const onEnd = () => {
        body.style.maxHeight = '';
        body.removeEventListener('transitionend', onEnd);
      };
      body.addEventListener('transitionend', onEnd, { once: true });
    }
  },

  renderLoadingSteps(steps) {
    const container = document.getElementById('loading-steps');
    container.innerHTML = '';
    steps.forEach((text, i) => {
      const step = document.createElement('div');
      step.className = 'loading-step';
      step.id = `loading-step-${i}`;
      step.innerHTML = `
        <span class="loading-step-icon">&#9675;</span>
        <span>${text}</span>
      `;
      container.appendChild(step);
    });
  },

  updateLoadingStep(index, status) {
    const step = document.getElementById(`loading-step-${index}`);
    if (!step) return;

    step.classList.remove('active', 'done');
    const icon = step.querySelector('.loading-step-icon');

    if (status === 'active') {
      step.classList.add('active');
      icon.innerHTML = '&#9679;';
    } else if (status === 'done') {
      step.classList.add('done');
      icon.innerHTML = '&#10003;';
    }
  },
};
