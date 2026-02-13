const Landing = {
  fromPlace: null,
  destinations: [],
  sessionToken: null,

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
    await google.maps.importLibrary('places');

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
  },

  async fetchSuggestions(query, target) {
    try {
      if (!this.sessionToken) {
        this.sessionToken = new google.maps.places.AutocompleteSessionToken();
      }

      const options = {
        input: query,
        sessionToken: this.sessionToken,
      };

      // Both FROM and DESTINATIONS accept any place (cities, landmarks, malls, addresses, etc.)

      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(options);

      const dropdown = target === 'from' ? this.fromDropdown : this.toDropdown;
      this.renderDropdown(suggestions || [], dropdown, target);
    } catch (err) {
      console.warn('Autocomplete error:', err);
    }
  },

  renderDropdown(suggestions, dropdown, target) {
    dropdown.innerHTML = '';
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
      const chip = Components.createChip(dest.name, () => {
        this.destinations.splice(i, 1);
        this.renderChips();
        this.validateForm();
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

        if (btn.classList.contains('plus')) {
          val = Math.min(val + 1, targetId === 'adults-count' ? 9 : 6);
        } else {
          val = Math.max(val - 1, targetId === 'adults-count' ? 1 : 0);
        }

        valueEl.textContent = val;
      });
    });
  },

  setupFormSubmit() {
    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!this.validateForm()) return;

      const tripData = {
        from: this.fromPlace,
        destinations: [...this.destinations],
        departureDate: this.dateInput.value,
        startTime: '00:00',
        adults: parseInt(document.getElementById('adults-count').textContent),
        children: parseInt(document.getElementById('children-count').textContent),
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
