const Landing = {
  fromPlace: null,
  destinations: [],
  sessionToken: null,
  _highlightIdx: -1,

  init() {
    this.fromInput = document.getElementById('from-input');
    this.toInput = document.getElementById('to-input');
    this.fromDropdown = document.getElementById('from-dropdown');
    this.toDropdown = document.getElementById('to-dropdown');
    this.chipsContainer = document.getElementById('destination-chips');
    this.dateInput = document.getElementById('departure-date');
    this.calculateBtn = document.getElementById('calculate-btn');
    this.form = document.getElementById('trip-form');

    this.setupAutocomplete();
    this.setupSteppers();
    this.setupFormSubmit();

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#from-input') && !e.target.closest('#from-dropdown')) {
        this.fromDropdown.classList.remove('show');
      }
      if (!e.target.closest('#to-input') && !e.target.closest('#to-dropdown')) {
        this.toDropdown.classList.remove('show');
      }
    });
  },

  async setupAutocomplete() {
    try {
      await google.maps.importLibrary('places');
      this._placesReady = true;
    } catch (e) {
      console.warn('Places library not ready, will retry on first search:', e);
      this._placesReady = false;
    }

    const debouncedFromSearch = Utils.debounce((query) => this.fetchSuggestions(query, 'from'), 300);
    const debouncedToSearch = Utils.debounce((query) => this.fetchSuggestions(query, 'to'), 300);

    this.fromInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val.length >= 2) debouncedFromSearch(val);
      else this.fromDropdown.classList.remove('show');
    });

    this.toInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      if (val.length >= 2) debouncedToSearch(val);
      else this.toDropdown.classList.remove('show');
    });

    // Keyboard navigation for autocomplete dropdowns
    const addKeyboardNav = (input, dropdown) => {
      input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        if (!items.length || !dropdown.classList.contains('show')) return;

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this._highlightIdx = Math.min(this._highlightIdx + 1, items.length - 1);
          items.forEach((el, i) => el.classList.toggle('highlighted', i === this._highlightIdx));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this._highlightIdx = Math.max(this._highlightIdx - 1, 0);
          items.forEach((el, i) => el.classList.toggle('highlighted', i === this._highlightIdx));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (this._highlightIdx >= 0 && items[this._highlightIdx]) {
            items[this._highlightIdx].click();
            this._highlightIdx = -1;
          }
        } else if (e.key === 'Escape') {
          dropdown.classList.remove('show');
          this._highlightIdx = -1;
        }
      });
    };
    addKeyboardNav(this.fromInput, this.fromDropdown);
    addKeyboardNav(this.toInput, this.toDropdown);
  },

  async fetchSuggestions(query, target) {
    try {
      // Ensure Places library is loaded
      if (!this._placesReady) {
        await google.maps.importLibrary('places');
        this._placesReady = true;
      }

      // Create a fresh session token if needed
      if (!this.sessionToken) {
        this.sessionToken = new google.maps.places.AutocompleteSessionToken();
      }

      const options = {
        input: query,
        sessionToken: this.sessionToken,
      };

      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(options);

      const dropdown = target === 'from' ? this.fromDropdown : this.toDropdown;
      this.renderDropdown(suggestions || [], dropdown, target);
    } catch (err) {
      console.warn('Autocomplete error:', err);
      // Reset session token on error — stale tokens can cause failures
      this.sessionToken = null;
      // Retry once with a fresh token
      try {
        this.sessionToken = new google.maps.places.AutocompleteSessionToken();
        const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: this.sessionToken,
        });
        const dropdown = target === 'from' ? this.fromDropdown : this.toDropdown;
        this.renderDropdown(suggestions || [], dropdown, target);
      } catch (retryErr) {
        console.warn('Autocomplete retry failed:', retryErr);
        this.sessionToken = null;
      }
    }
  },

  renderDropdown(suggestions, dropdown, target) {
    dropdown.innerHTML = '';
    this._highlightIdx = -1;
    if (suggestions.length === 0) {
      dropdown.classList.remove('show');
      return;
    }

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
        this.selectPlace(pred, target);
        dropdown.classList.remove('show');
        this.sessionToken = null;
      });

      dropdown.appendChild(item);
    });

    dropdown.classList.add('show');
  },

  async selectPlace(prediction, target) {
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
      this.fromPlace = placeData;
      this.fromInput.value = placeData.fullName || placeData.name;
    } else {
      const alreadyAdded = this.destinations.some(
        d => d.name.toLowerCase() === placeData.name.toLowerCase()
      );
      if (!alreadyAdded) {
        placeData.nights = 1;
        this.destinations.push(placeData);
        this.renderChips();
      }
      this.toInput.value = '';
    }

    this.validateForm();
  },

  renderChips() {
    this.chipsContainer.innerHTML = '';
    this.destinations.forEach((dest, i) => {
      const chip = document.createElement('div');
      chip.className = 'dest-chip';
      const nights = dest.nights ?? 1;
      chip.innerHTML = `
        <div class="dest-chip-top">
          <span class="dest-chip-name">${Utils.escapeHtml(dest.name)}</span>
          <button type="button" class="chip-remove" title="Remove" aria-label="Remove ${Utils.escapeHtml(dest.name)}">&times;</button>
        </div>
        <div class="dest-chip-nights">
          <button type="button" class="dest-nights-btn minus" aria-label="Decrease nights">-</button>
          <span class="dest-nights-val">${nights}</span>
          <button type="button" class="dest-nights-btn plus" aria-label="Increase nights">+</button>
          <span class="dest-nights-label">${nights === 0 ? 'pass-through' : nights === 1 ? 'night' : 'nights'}</span>
        </div>
      `;
      chip.querySelector('.chip-remove').addEventListener('click', () => {
        this.destinations.splice(i, 1);
        this.renderChips();
        this.validateForm();
      });
      const valEl = chip.querySelector('.dest-nights-val');
      const labelEl = chip.querySelector('.dest-nights-label');
      chip.querySelector('.dest-nights-btn.minus').addEventListener('click', () => {
        dest.nights = Math.max(0, (dest.nights ?? 1) - 1);
        valEl.textContent = dest.nights;
        labelEl.textContent = dest.nights === 0 ? 'pass-through' : dest.nights === 1 ? 'night' : 'nights';
      });
      chip.querySelector('.dest-nights-btn.plus').addEventListener('click', () => {
        dest.nights = Math.min(30, (dest.nights ?? 1) + 1);
        valEl.textContent = dest.nights;
        labelEl.textContent = dest.nights === 1 ? 'night' : 'nights';
      });
      this.chipsContainer.appendChild(chip);
    });
  },

  setupSteppers() {
    document.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const valueEl = document.getElementById(targetId);
        let val = parseInt(valueEl.textContent);

        const maxMap = { 'adults-count': 9, 'children-count': 6, 'infants-count': 4 };
        const minMap = { 'adults-count': 1, 'children-count': 0, 'infants-count': 0 };
        if (btn.classList.contains('plus')) {
          val = Math.min(val + 1, maxMap[targetId] || 6);
        } else {
          val = Math.max(val - 1, minMap[targetId] || 0);
        }

        valueEl.textContent = val;
      });
    });
  },

  setupFormSubmit() {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.validateForm()) return;

      // Check if any destination matches the origin
      const originName = (this.fromPlace.name || '').toLowerCase();
      const originLat = this.fromPlace.lat;
      const originLng = this.fromPlace.lng;
      const duplicate = this.destinations.some(d => {
        if (d.name.toLowerCase() === originName) return true;
        if (originLat && originLng && d.lat && d.lng &&
            Math.abs(d.lat - originLat) < 0.01 && Math.abs(d.lng - originLng) < 0.01) return true;
        return false;
      });
      if (duplicate) {
        alert('Origin and destination cannot be the same city.');
        return;
      }

      const tripData = {
        from: this.fromPlace,
        destinations: [...this.destinations],
        departureDate: this.dateInput.value,
        startTime: '00:00',
        adults: parseInt(document.getElementById('adults-count').textContent),
        children: parseInt(document.getElementById('children-count').textContent),
        infants: parseInt(document.getElementById('infants-count').textContent),
      };

      App.startCalculation(tripData);
    });
  },

  validateForm() {
    const valid = this.fromPlace && this.destinations.length > 0 && this.dateInput.value;
    this.calculateBtn.disabled = !valid;
    return valid;
  },
};
