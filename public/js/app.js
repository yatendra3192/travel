const App = {
  currentPage: 'landing',

  async init() {
    try {
      await google.maps.importLibrary('places');
    } catch (e) {
      console.warn('Google Maps library loading:', e);
    }

    Landing.init();
    Results.init();
    this.setMinDate();
  },

  setMinDate() {
    const today = new Date().toISOString().split('T')[0];
    const dateInput = document.getElementById('departure-date');
    dateInput.min = today;

    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 14);
    dateInput.value = defaultDate.toISOString().split('T')[0];
  },

  showPage(pageName) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(`${pageName}-page`);
    if (page) page.classList.add('active');
    this.currentPage = pageName;
    window.scrollTo(0, 0);
  },

  async startCalculation(tripData) {
    this.showPage('results');
    await Results.generateTripPlan(tripData);
  },

  goBack() {
    this.showPage('landing');
    // Reset cost sidebar mobile overlay if open
    const sidebar = document.getElementById('cost-sidebar');
    sidebar.style.cssText = '';
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
