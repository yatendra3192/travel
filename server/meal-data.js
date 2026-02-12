// Static meal cost database (all prices in EUR)
// Sources: Numbeo cost-of-living index, airport food surveys

// City-level meal costs: breakfast / lunch / dinner at 3 tiers
const CITY_MEAL_COSTS = {
  // Western Europe
  'AMS': { breakfast: { budget: 6, mid: 10, comfort: 16 }, lunch: { budget: 10, mid: 16, comfort: 25 }, dinner: { budget: 15, mid: 25, comfort: 40 }, source: 'Numbeo Amsterdam 2024' },
  'BRU': { breakfast: { budget: 5, mid: 9, comfort: 14 }, lunch: { budget: 9, mid: 15, comfort: 22 }, dinner: { budget: 14, mid: 22, comfort: 35 }, source: 'Numbeo Brussels 2024' },
  'PAR': { breakfast: { budget: 6, mid: 11, comfort: 18 }, lunch: { budget: 12, mid: 18, comfort: 28 }, dinner: { budget: 18, mid: 30, comfort: 50 }, source: 'Numbeo Paris 2024' },
  'CDG': { breakfast: { budget: 6, mid: 11, comfort: 18 }, lunch: { budget: 12, mid: 18, comfort: 28 }, dinner: { budget: 18, mid: 30, comfort: 50 }, source: 'Numbeo Paris 2024' },
  'BCN': { breakfast: { budget: 4, mid: 8, comfort: 13 }, lunch: { budget: 8, mid: 14, comfort: 22 }, dinner: { budget: 12, mid: 22, comfort: 35 }, source: 'Numbeo Barcelona 2024' },
  'MAD': { breakfast: { budget: 4, mid: 8, comfort: 12 }, lunch: { budget: 8, mid: 13, comfort: 20 }, dinner: { budget: 12, mid: 20, comfort: 32 }, source: 'Numbeo Madrid 2024' },
  'LON': { breakfast: { budget: 7, mid: 12, comfort: 18 }, lunch: { budget: 12, mid: 18, comfort: 28 }, dinner: { budget: 18, mid: 28, comfort: 45 }, source: 'Numbeo London 2024' },
  'LHR': { breakfast: { budget: 7, mid: 12, comfort: 18 }, lunch: { budget: 12, mid: 18, comfort: 28 }, dinner: { budget: 18, mid: 28, comfort: 45 }, source: 'Numbeo London 2024' },
  'ROM': { breakfast: { budget: 4, mid: 7, comfort: 12 }, lunch: { budget: 8, mid: 14, comfort: 22 }, dinner: { budget: 12, mid: 22, comfort: 35 }, source: 'Numbeo Rome 2024' },
  'FCO': { breakfast: { budget: 4, mid: 7, comfort: 12 }, lunch: { budget: 8, mid: 14, comfort: 22 }, dinner: { budget: 12, mid: 22, comfort: 35 }, source: 'Numbeo Rome 2024' },
  'BER': { breakfast: { budget: 5, mid: 8, comfort: 13 }, lunch: { budget: 8, mid: 13, comfort: 20 }, dinner: { budget: 12, mid: 20, comfort: 32 }, source: 'Numbeo Berlin 2024' },
  'FRA': { breakfast: { budget: 5, mid: 9, comfort: 14 }, lunch: { budget: 9, mid: 14, comfort: 22 }, dinner: { budget: 14, mid: 22, comfort: 35 }, source: 'Numbeo Frankfurt 2024' },
  'MUC': { breakfast: { budget: 5, mid: 9, comfort: 15 }, lunch: { budget: 9, mid: 15, comfort: 24 }, dinner: { budget: 14, mid: 24, comfort: 38 }, source: 'Numbeo Munich 2024' },
  'VIE': { breakfast: { budget: 5, mid: 8, comfort: 13 }, lunch: { budget: 8, mid: 13, comfort: 20 }, dinner: { budget: 12, mid: 20, comfort: 32 }, source: 'Numbeo Vienna 2024' },
  'ZRH': { breakfast: { budget: 8, mid: 14, comfort: 22 }, lunch: { budget: 14, mid: 22, comfort: 35 }, dinner: { budget: 22, mid: 35, comfort: 55 }, source: 'Numbeo Zurich 2024' },
  'PRG': { breakfast: { budget: 3, mid: 6, comfort: 10 }, lunch: { budget: 6, mid: 10, comfort: 16 }, dinner: { budget: 8, mid: 16, comfort: 25 }, source: 'Numbeo Prague 2024' },
  'LIS': { breakfast: { budget: 3, mid: 6, comfort: 10 }, lunch: { budget: 7, mid: 11, comfort: 18 }, dinner: { budget: 10, mid: 18, comfort: 28 }, source: 'Numbeo Lisbon 2024' },
  'ATH': { breakfast: { budget: 3, mid: 6, comfort: 10 }, lunch: { budget: 6, mid: 10, comfort: 16 }, dinner: { budget: 8, mid: 15, comfort: 25 }, source: 'Numbeo Athens 2024' },
  'DUB': { breakfast: { budget: 6, mid: 10, comfort: 16 }, lunch: { budget: 10, mid: 16, comfort: 25 }, dinner: { budget: 16, mid: 25, comfort: 40 }, source: 'Numbeo Dublin 2024' },
  'CPH': { breakfast: { budget: 7, mid: 12, comfort: 18 }, lunch: { budget: 12, mid: 18, comfort: 28 }, dinner: { budget: 18, mid: 28, comfort: 45 }, source: 'Numbeo Copenhagen 2024' },
  'BUD': { breakfast: { budget: 3, mid: 5, comfort: 8 }, lunch: { budget: 5, mid: 8, comfort: 14 }, dinner: { budget: 7, mid: 14, comfort: 22 }, source: 'Numbeo Budapest 2024' },
  'WAW': { breakfast: { budget: 3, mid: 5, comfort: 8 }, lunch: { budget: 5, mid: 8, comfort: 13 }, dinner: { budget: 7, mid: 13, comfort: 20 }, source: 'Numbeo Warsaw 2024' },

  // South Asia
  'BOM': { breakfast: { budget: 2, mid: 4, comfort: 8 }, lunch: { budget: 3, mid: 6, comfort: 12 }, dinner: { budget: 4, mid: 8, comfort: 16 }, source: 'Numbeo Mumbai 2024' },
  'DEL': { breakfast: { budget: 2, mid: 3, comfort: 7 }, lunch: { budget: 3, mid: 5, comfort: 10 }, dinner: { budget: 4, mid: 7, comfort: 14 }, source: 'Numbeo Delhi 2024' },
  'BLR': { breakfast: { budget: 2, mid: 3, comfort: 6 }, lunch: { budget: 3, mid: 5, comfort: 9 }, dinner: { budget: 3, mid: 7, comfort: 12 }, source: 'Numbeo Bangalore 2024' },
  'MAA': { breakfast: { budget: 1, mid: 3, comfort: 5 }, lunch: { budget: 2, mid: 4, comfort: 8 }, dinner: { budget: 3, mid: 6, comfort: 10 }, source: 'Numbeo Chennai 2024' },
  'HYD': { breakfast: { budget: 1, mid: 3, comfort: 5 }, lunch: { budget: 2, mid: 4, comfort: 8 }, dinner: { budget: 3, mid: 6, comfort: 10 }, source: 'Numbeo Hyderabad 2024' },

  // Middle East
  'DXB': { breakfast: { budget: 5, mid: 10, comfort: 18 }, lunch: { budget: 8, mid: 16, comfort: 28 }, dinner: { budget: 12, mid: 22, comfort: 40 }, source: 'Numbeo Dubai 2024' },
  'DOH': { breakfast: { budget: 5, mid: 10, comfort: 16 }, lunch: { budget: 8, mid: 15, comfort: 25 }, dinner: { budget: 12, mid: 20, comfort: 35 }, source: 'Numbeo Doha 2024' },
  'IST': { breakfast: { budget: 3, mid: 5, comfort: 10 }, lunch: { budget: 5, mid: 8, comfort: 15 }, dinner: { budget: 6, mid: 12, comfort: 22 }, source: 'Numbeo Istanbul 2024' },

  // Asia Pacific
  'SIN': { breakfast: { budget: 4, mid: 8, comfort: 15 }, lunch: { budget: 6, mid: 12, comfort: 22 }, dinner: { budget: 8, mid: 18, comfort: 35 }, source: 'Numbeo Singapore 2024' },
  'BKK': { breakfast: { budget: 2, mid: 4, comfort: 8 }, lunch: { budget: 3, mid: 6, comfort: 12 }, dinner: { budget: 4, mid: 8, comfort: 18 }, source: 'Numbeo Bangkok 2024' },
  'HKG': { breakfast: { budget: 4, mid: 8, comfort: 14 }, lunch: { budget: 6, mid: 12, comfort: 20 }, dinner: { budget: 8, mid: 18, comfort: 30 }, source: 'Numbeo Hong Kong 2024' },
  'TYO': { breakfast: { budget: 5, mid: 8, comfort: 14 }, lunch: { budget: 7, mid: 12, comfort: 20 }, dinner: { budget: 10, mid: 18, comfort: 35 }, source: 'Numbeo Tokyo 2024' },
  'NRT': { breakfast: { budget: 5, mid: 8, comfort: 14 }, lunch: { budget: 7, mid: 12, comfort: 20 }, dinner: { budget: 10, mid: 18, comfort: 35 }, source: 'Numbeo Tokyo 2024' },
  'KUL': { breakfast: { budget: 2, mid: 4, comfort: 8 }, lunch: { budget: 3, mid: 6, comfort: 11 }, dinner: { budget: 4, mid: 8, comfort: 16 }, source: 'Numbeo Kuala Lumpur 2024' },
  'DPS': { breakfast: { budget: 2, mid: 4, comfort: 8 }, lunch: { budget: 3, mid: 6, comfort: 12 }, dinner: { budget: 4, mid: 8, comfort: 18 }, source: 'Numbeo Bali 2024' },

  // Americas
  'JFK': { breakfast: { budget: 8, mid: 14, comfort: 22 }, lunch: { budget: 12, mid: 20, comfort: 32 }, dinner: { budget: 18, mid: 30, comfort: 50 }, source: 'Numbeo New York 2024' },
  'NYC': { breakfast: { budget: 8, mid: 14, comfort: 22 }, lunch: { budget: 12, mid: 20, comfort: 32 }, dinner: { budget: 18, mid: 30, comfort: 50 }, source: 'Numbeo New York 2024' },
  'LAX': { breakfast: { budget: 7, mid: 12, comfort: 18 }, lunch: { budget: 10, mid: 16, comfort: 26 }, dinner: { budget: 15, mid: 25, comfort: 40 }, source: 'Numbeo Los Angeles 2024' },
  'SFO': { breakfast: { budget: 8, mid: 13, comfort: 20 }, lunch: { budget: 12, mid: 18, comfort: 28 }, dinner: { budget: 16, mid: 28, comfort: 45 }, source: 'Numbeo San Francisco 2024' },

  // Oceania
  'SYD': { breakfast: { budget: 6, mid: 10, comfort: 16 }, lunch: { budget: 10, mid: 16, comfort: 25 }, dinner: { budget: 15, mid: 25, comfort: 40 }, source: 'Numbeo Sydney 2024' },
  'MEL': { breakfast: { budget: 5, mid: 9, comfort: 14 }, lunch: { budget: 9, mid: 14, comfort: 22 }, dinner: { budget: 13, mid: 22, comfort: 35 }, source: 'Numbeo Melbourne 2024' },
};

// Country-level fallback meal costs
const COUNTRY_MEAL_COSTS = {
  'NL': { breakfast: { budget: 6, mid: 10, comfort: 16 }, lunch: { budget: 10, mid: 16, comfort: 25 }, dinner: { budget: 15, mid: 25, comfort: 40 }, source: 'Numbeo Netherlands avg' },
  'BE': { breakfast: { budget: 5, mid: 9, comfort: 14 }, lunch: { budget: 9, mid: 15, comfort: 22 }, dinner: { budget: 14, mid: 22, comfort: 35 }, source: 'Numbeo Belgium avg' },
  'FR': { breakfast: { budget: 5, mid: 10, comfort: 16 }, lunch: { budget: 10, mid: 16, comfort: 26 }, dinner: { budget: 15, mid: 25, comfort: 42 }, source: 'Numbeo France avg' },
  'ES': { breakfast: { budget: 4, mid: 7, comfort: 12 }, lunch: { budget: 7, mid: 12, comfort: 20 }, dinner: { budget: 10, mid: 18, comfort: 30 }, source: 'Numbeo Spain avg' },
  'DE': { breakfast: { budget: 5, mid: 9, comfort: 14 }, lunch: { budget: 8, mid: 14, comfort: 22 }, dinner: { budget: 12, mid: 22, comfort: 35 }, source: 'Numbeo Germany avg' },
  'IT': { breakfast: { budget: 3, mid: 6, comfort: 10 }, lunch: { budget: 7, mid: 12, comfort: 20 }, dinner: { budget: 10, mid: 18, comfort: 30 }, source: 'Numbeo Italy avg' },
  'GB': { breakfast: { budget: 6, mid: 10, comfort: 16 }, lunch: { budget: 10, mid: 16, comfort: 25 }, dinner: { budget: 15, mid: 25, comfort: 40 }, source: 'Numbeo UK avg' },
  'CH': { breakfast: { budget: 8, mid: 14, comfort: 22 }, lunch: { budget: 14, mid: 22, comfort: 35 }, dinner: { budget: 22, mid: 35, comfort: 55 }, source: 'Numbeo Switzerland avg' },
  'AT': { breakfast: { budget: 5, mid: 8, comfort: 13 }, lunch: { budget: 8, mid: 13, comfort: 20 }, dinner: { budget: 12, mid: 20, comfort: 32 }, source: 'Numbeo Austria avg' },
  'PT': { breakfast: { budget: 3, mid: 6, comfort: 10 }, lunch: { budget: 7, mid: 11, comfort: 18 }, dinner: { budget: 10, mid: 18, comfort: 28 }, source: 'Numbeo Portugal avg' },
  'GR': { breakfast: { budget: 3, mid: 6, comfort: 10 }, lunch: { budget: 6, mid: 10, comfort: 16 }, dinner: { budget: 8, mid: 15, comfort: 25 }, source: 'Numbeo Greece avg' },
  'CZ': { breakfast: { budget: 3, mid: 6, comfort: 10 }, lunch: { budget: 6, mid: 10, comfort: 16 }, dinner: { budget: 8, mid: 16, comfort: 25 }, source: 'Numbeo Czech Republic avg' },
  'PL': { breakfast: { budget: 3, mid: 5, comfort: 8 }, lunch: { budget: 5, mid: 8, comfort: 13 }, dinner: { budget: 7, mid: 13, comfort: 20 }, source: 'Numbeo Poland avg' },
  'HU': { breakfast: { budget: 3, mid: 5, comfort: 8 }, lunch: { budget: 5, mid: 8, comfort: 14 }, dinner: { budget: 7, mid: 14, comfort: 22 }, source: 'Numbeo Hungary avg' },
  'IN': { breakfast: { budget: 1, mid: 3, comfort: 6 }, lunch: { budget: 2, mid: 5, comfort: 9 }, dinner: { budget: 3, mid: 7, comfort: 12 }, source: 'Numbeo India avg' },
  'AE': { breakfast: { budget: 5, mid: 10, comfort: 18 }, lunch: { budget: 8, mid: 16, comfort: 28 }, dinner: { budget: 12, mid: 22, comfort: 40 }, source: 'Numbeo UAE avg' },
  'TR': { breakfast: { budget: 3, mid: 5, comfort: 10 }, lunch: { budget: 5, mid: 8, comfort: 15 }, dinner: { budget: 6, mid: 12, comfort: 22 }, source: 'Numbeo Turkey avg' },
  'US': { breakfast: { budget: 7, mid: 12, comfort: 18 }, lunch: { budget: 10, mid: 16, comfort: 26 }, dinner: { budget: 15, mid: 25, comfort: 42 }, source: 'Numbeo USA avg' },
  'AU': { breakfast: { budget: 6, mid: 10, comfort: 16 }, lunch: { budget: 10, mid: 16, comfort: 25 }, dinner: { budget: 14, mid: 24, comfort: 38 }, source: 'Numbeo Australia avg' },
  'JP': { breakfast: { budget: 4, mid: 7, comfort: 12 }, lunch: { budget: 6, mid: 10, comfort: 18 }, dinner: { budget: 8, mid: 15, comfort: 30 }, source: 'Numbeo Japan avg' },
  'TH': { breakfast: { budget: 2, mid: 4, comfort: 8 }, lunch: { budget: 3, mid: 6, comfort: 12 }, dinner: { budget: 4, mid: 8, comfort: 18 }, source: 'Numbeo Thailand avg' },
  'SG': { breakfast: { budget: 4, mid: 8, comfort: 15 }, lunch: { budget: 6, mid: 12, comfort: 22 }, dinner: { budget: 8, mid: 18, comfort: 35 }, source: 'Numbeo Singapore avg' },
  'QA': { breakfast: { budget: 5, mid: 10, comfort: 16 }, lunch: { budget: 8, mid: 15, comfort: 25 }, dinner: { budget: 12, mid: 20, comfort: 35 }, source: 'Numbeo Qatar avg' },
};

// Global default (moderate European pricing)
const DEFAULT_MEAL_COSTS = {
  breakfast: { budget: 5, mid: 8, comfort: 14 },
  lunch: { budget: 8, mid: 14, comfort: 22 },
  dinner: { budget: 12, mid: 20, comfort: 35 },
  source: 'Global average estimate',
};

// Airport food costs (city costs x ~1.5 markup)
const AIRPORT_MEAL_COSTS = {
  'DXB': { snack: 8, meal: 18, source: 'Dubai International airport food survey' },
  'DOH': { snack: 8, meal: 17, source: 'Hamad International airport food survey' },
  'IST': { snack: 6, meal: 14, source: 'Istanbul Airport food survey' },
  'AMS': { snack: 7, meal: 16, source: 'Schiphol airport food survey' },
  'CDG': { snack: 8, meal: 18, source: 'Charles de Gaulle airport food survey' },
  'FRA': { snack: 7, meal: 16, source: 'Frankfurt Airport food survey' },
  'LHR': { snack: 8, meal: 18, source: 'Heathrow airport food survey' },
  'MUC': { snack: 7, meal: 16, source: 'Munich Airport food survey' },
  'BOM': { snack: 4, meal: 8, source: 'Mumbai CSIA airport food survey' },
  'DEL': { snack: 4, meal: 8, source: 'Delhi IGI airport food survey' },
  'BLR': { snack: 3, meal: 7, source: 'Bangalore KIA airport food survey' },
  'SIN': { snack: 6, meal: 14, source: 'Changi airport food survey' },
  'BKK': { snack: 4, meal: 9, source: 'Suvarnabhumi airport food survey' },
  'HKG': { snack: 6, meal: 14, source: 'Hong Kong Intl airport food survey' },
  'NRT': { snack: 6, meal: 14, source: 'Narita airport food survey' },
  'JFK': { snack: 8, meal: 18, source: 'JFK airport food survey' },
  'LAX': { snack: 7, meal: 16, source: 'LAX airport food survey' },
  'SYD': { snack: 7, meal: 16, source: 'Sydney Airport food survey' },
  'BCN': { snack: 6, meal: 13, source: 'Barcelona El Prat airport food survey' },
  'MAD': { snack: 6, meal: 13, source: 'Madrid Barajas airport food survey' },
};

// Default airport meal costs
const DEFAULT_AIRPORT_COSTS = { snack: 6, meal: 14, source: 'Average airport estimate' };

/**
 * Calculate layover meal cost for a given airport and layover duration.
 * Logic: <2h = nothing, 2-4h = 1 snack, 4-7h = 1 meal, >7h = meal + snack
 */
function getLayoverMealCost(airportCode, layoverMinutes) {
  if (layoverMinutes < 120) {
    return { cost: 0, description: 'Short layover', items: [], source: null };
  }

  const airport = AIRPORT_MEAL_COSTS[airportCode] || DEFAULT_AIRPORT_COSTS;
  const source = airport.source;

  if (layoverMinutes < 240) {
    return {
      cost: airport.snack,
      description: '1 snack/coffee',
      items: [{ type: 'snack', cost: airport.snack }],
      source,
    };
  }

  if (layoverMinutes < 420) {
    return {
      cost: airport.meal,
      description: '1 meal',
      items: [{ type: 'meal', cost: airport.meal }],
      source,
    };
  }

  // >7 hours
  return {
    cost: airport.meal + airport.snack,
    description: '1 meal + 1 snack',
    items: [
      { type: 'meal', cost: airport.meal },
      { type: 'snack', cost: airport.snack },
    ],
    source,
  };
}

/**
 * Get city meal costs with 3-tier lookup: city code -> country code -> global default.
 * Returns costs with source and confidence level.
 */
function getCityMealCosts(cityCode, countryCode) {
  // Tier 1: City-level
  if (cityCode && CITY_MEAL_COSTS[cityCode]) {
    return {
      ...CITY_MEAL_COSTS[cityCode],
      level: 'city',
    };
  }

  // Tier 2: Country-level
  if (countryCode && COUNTRY_MEAL_COSTS[countryCode]) {
    return {
      ...COUNTRY_MEAL_COSTS[countryCode],
      level: 'country',
    };
  }

  // Tier 3: Global default
  return {
    ...DEFAULT_MEAL_COSTS,
    level: 'default',
  };
}

module.exports = { getLayoverMealCost, getCityMealCosts };
