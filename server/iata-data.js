const CITY_TO_IATA = {
  'mumbai': { airportCode: 'BOM', cityCode: 'BOM', airportName: 'Chhatrapati Shivaji Maharaj International Airport', country: 'IN', lat: 19.0896, lng: 72.8656 },
  'bombay': { airportCode: 'BOM', cityCode: 'BOM', airportName: 'Chhatrapati Shivaji Maharaj International Airport', country: 'IN', lat: 19.0896, lng: 72.8656 },
  'delhi': { airportCode: 'DEL', cityCode: 'DEL', airportName: 'Indira Gandhi International Airport', country: 'IN', lat: 28.5562, lng: 77.1000 },
  'new delhi': { airportCode: 'DEL', cityCode: 'DEL', airportName: 'Indira Gandhi International Airport', country: 'IN', lat: 28.5562, lng: 77.1000 },
  'bangalore': { airportCode: 'BLR', cityCode: 'BLR', airportName: 'Kempegowda International Airport', country: 'IN', lat: 13.1986, lng: 77.7066 },
  'bengaluru': { airportCode: 'BLR', cityCode: 'BLR', airportName: 'Kempegowda International Airport', country: 'IN', lat: 13.1986, lng: 77.7066 },
  'chennai': { airportCode: 'MAA', cityCode: 'MAA', airportName: 'Chennai International Airport', country: 'IN', lat: 12.9941, lng: 80.1709 },
  'kolkata': { airportCode: 'CCU', cityCode: 'CCU', airportName: 'Netaji Subhas Chandra Bose International Airport', country: 'IN', lat: 22.6547, lng: 88.4467 },
  'hyderabad': { airportCode: 'HYD', cityCode: 'HYD', airportName: 'Rajiv Gandhi International Airport', country: 'IN', lat: 17.2403, lng: 78.4294 },
  'pune': { airportCode: 'PNQ', cityCode: 'PNQ', airportName: 'Pune Airport', country: 'IN', lat: 18.5822, lng: 73.9197 },
  'goa': { airportCode: 'GOI', cityCode: 'GOI', airportName: 'Goa International Airport', country: 'IN', lat: 15.3809, lng: 73.8314 },
  'jaipur': { airportCode: 'JAI', cityCode: 'JAI', airportName: 'Jaipur International Airport', country: 'IN', lat: 26.8242, lng: 75.8122 },
  'ahmedabad': { airportCode: 'AMD', cityCode: 'AMD', airportName: 'Sardar Vallabhbhai Patel International Airport', country: 'IN', lat: 23.0772, lng: 72.6347 },
  'kochi': { airportCode: 'COK', cityCode: 'COK', airportName: 'Cochin International Airport', country: 'IN', lat: 10.1520, lng: 76.4019 },
  'lucknow': { airportCode: 'LKO', cityCode: 'LKO', airportName: 'Chaudhary Charan Singh International Airport', country: 'IN', lat: 26.7606, lng: 80.8893 },
  'thane': { airportCode: 'BOM', cityCode: 'BOM', airportName: 'Chhatrapati Shivaji Maharaj International Airport', country: 'IN', lat: 19.0896, lng: 72.8656 },
  'navi mumbai': { airportCode: 'BOM', cityCode: 'BOM', airportName: 'Chhatrapati Shivaji Maharaj International Airport', country: 'IN', lat: 19.0896, lng: 72.8656 },
  'indore': { airportCode: 'IDR', cityCode: 'IDR', airportName: 'Devi Ahilyabai Holkar Airport', country: 'IN', lat: 22.7217, lng: 75.8011 },
  'nagpur': { airportCode: 'NAG', cityCode: 'NAG', airportName: 'Dr. Babasaheb Ambedkar International Airport', country: 'IN', lat: 21.0922, lng: 79.0472 },
  'bhopal': { airportCode: 'BHO', cityCode: 'BHO', airportName: 'Raja Bhoj Airport', country: 'IN', lat: 23.2875, lng: 77.3374 },
  'chandigarh': { airportCode: 'IXC', cityCode: 'IXC', airportName: 'Chandigarh International Airport', country: 'IN', lat: 30.6735, lng: 76.7885 },
  'patna': { airportCode: 'PAT', cityCode: 'PAT', airportName: 'Jay Prakash Narayan International Airport', country: 'IN', lat: 25.5913, lng: 85.0880 },
  'ranchi': { airportCode: 'IXR', cityCode: 'IXR', airportName: 'Birsa Munda Airport', country: 'IN', lat: 23.3143, lng: 85.3217 },
  'varanasi': { airportCode: 'VNS', cityCode: 'VNS', airportName: 'Lal Bahadur Shastri International Airport', country: 'IN', lat: 25.4524, lng: 82.8593 },
  'amritsar': { airportCode: 'ATQ', cityCode: 'ATQ', airportName: 'Sri Guru Ram Dass Jee International Airport', country: 'IN', lat: 31.7096, lng: 74.7973 },
  'srinagar': { airportCode: 'SXR', cityCode: 'SXR', airportName: 'Sheikh ul-Alam International Airport', country: 'IN', lat: 33.9871, lng: 74.7742 },
  'thiruvananthapuram': { airportCode: 'TRV', cityCode: 'TRV', airportName: 'Trivandrum International Airport', country: 'IN', lat: 8.4821, lng: 76.9201 },
  'trivandrum': { airportCode: 'TRV', cityCode: 'TRV', airportName: 'Trivandrum International Airport', country: 'IN', lat: 8.4821, lng: 76.9201 },
  'coimbatore': { airportCode: 'CJB', cityCode: 'CJB', airportName: 'Coimbatore International Airport', country: 'IN', lat: 11.0300, lng: 77.0434 },
  'mangalore': { airportCode: 'IXE', cityCode: 'IXE', airportName: 'Mangalore International Airport', country: 'IN', lat: 12.9613, lng: 74.8901 },
  'visakhapatnam': { airportCode: 'VTZ', cityCode: 'VTZ', airportName: 'Visakhapatnam Airport', country: 'IN', lat: 17.7212, lng: 83.2245 },
  'vizag': { airportCode: 'VTZ', cityCode: 'VTZ', airportName: 'Visakhapatnam Airport', country: 'IN', lat: 17.7212, lng: 83.2245 },
  'raipur': { airportCode: 'RPR', cityCode: 'RPR', airportName: 'Swami Vivekananda Airport', country: 'IN', lat: 21.1804, lng: 81.7388 },
  'dehradun': { airportCode: 'DED', cityCode: 'DED', airportName: 'Jolly Grant Airport', country: 'IN', lat: 30.1897, lng: 78.1803 },
  'guwahati': { airportCode: 'GAU', cityCode: 'GAU', airportName: 'Lokpriya Gopinath Bordoloi International Airport', country: 'IN', lat: 26.1061, lng: 91.5859 },
  'surat': { airportCode: 'STV', cityCode: 'STV', airportName: 'Surat Airport', country: 'IN', lat: 21.1141, lng: 72.7418 },
  'vadodara': { airportCode: 'BDQ', cityCode: 'BDQ', airportName: 'Vadodara Airport', country: 'IN', lat: 22.3362, lng: 73.2264 },
  'rajkot': { airportCode: 'RAJ', cityCode: 'RAJ', airportName: 'Rajkot Airport', country: 'IN', lat: 22.3092, lng: 70.7795 },
  'madurai': { airportCode: 'IXM', cityCode: 'IXM', airportName: 'Madurai Airport', country: 'IN', lat: 9.8345, lng: 78.0934 },
  'tiruchirappalli': { airportCode: 'TRZ', cityCode: 'TRZ', airportName: 'Tiruchirappalli International Airport', country: 'IN', lat: 10.7654, lng: 78.7097 },
  'trichy': { airportCode: 'TRZ', cityCode: 'TRZ', airportName: 'Tiruchirappalli International Airport', country: 'IN', lat: 10.7654, lng: 78.7097 },
  'jodhpur': { airportCode: 'JDH', cityCode: 'JDH', airportName: 'Jodhpur Airport', country: 'IN', lat: 26.2511, lng: 73.0489 },
  'udaipur': { airportCode: 'UDR', cityCode: 'UDR', airportName: 'Maharana Pratap Airport', country: 'IN', lat: 24.6177, lng: 73.8961 },
  'imphal': { airportCode: 'IMF', cityCode: 'IMF', airportName: 'Bir Tikendrajit International Airport', country: 'IN', lat: 24.7600, lng: 93.8967 },
  'bhubaneswar': { airportCode: 'BBI', cityCode: 'BBI', airportName: 'Biju Patnaik International Airport', country: 'IN', lat: 20.2444, lng: 85.8178 },
  'jammu': { airportCode: 'IXJ', cityCode: 'IXJ', airportName: 'Jammu Airport', country: 'IN', lat: 32.6891, lng: 74.8374 },
  'leh': { airportCode: 'IXL', cityCode: 'IXL', airportName: 'Kushok Bakula Rimpochee Airport', country: 'IN', lat: 34.1359, lng: 77.5465 },

  'amsterdam': { airportCode: 'AMS', cityCode: 'AMS', airportName: 'Amsterdam Airport Schiphol', country: 'NL', lat: 52.3105, lng: 4.7683 },
  'paris': { airportCode: 'CDG', cityCode: 'PAR', airportName: 'Charles de Gaulle Airport', country: 'FR', lat: 49.0097, lng: 2.5479 },
  'london': { airportCode: 'LHR', cityCode: 'LON', airportName: 'Heathrow Airport', country: 'GB', lat: 51.4700, lng: -0.4543 },
  'barcelona': { airportCode: 'BCN', cityCode: 'BCN', airportName: 'Barcelona-El Prat Airport', country: 'ES', lat: 41.2974, lng: 2.0833 },
  'brussels': { airportCode: 'BRU', cityCode: 'BRU', airportName: 'Brussels Airport', country: 'BE', lat: 50.9014, lng: 4.4844 },
  'rome': { airportCode: 'FCO', cityCode: 'ROM', airportName: 'Leonardo da Vinci International Airport', country: 'IT', lat: 41.8003, lng: 12.2389 },
  'milan': { airportCode: 'MXP', cityCode: 'MIL', airportName: 'Milan Malpensa Airport', country: 'IT', lat: 45.6306, lng: 8.7281 },
  'berlin': { airportCode: 'BER', cityCode: 'BER', airportName: 'Berlin Brandenburg Airport', country: 'DE', lat: 52.3667, lng: 13.5033 },
  'frankfurt': { airportCode: 'FRA', cityCode: 'FRA', airportName: 'Frankfurt Airport', country: 'DE', lat: 50.0379, lng: 8.5622 },
  'munich': { airportCode: 'MUC', cityCode: 'MUC', airportName: 'Munich Airport', country: 'DE', lat: 48.3538, lng: 11.7861 },
  'vienna': { airportCode: 'VIE', cityCode: 'VIE', airportName: 'Vienna International Airport', country: 'AT', lat: 48.1103, lng: 16.5697 },
  'zurich': { airportCode: 'ZRH', cityCode: 'ZRH', airportName: 'Zurich Airport', country: 'CH', lat: 47.4647, lng: 8.5492 },
  'prague': { airportCode: 'PRG', cityCode: 'PRG', airportName: 'Vaclav Havel Airport Prague', country: 'CZ', lat: 50.1008, lng: 14.2600 },
  'lisbon': { airportCode: 'LIS', cityCode: 'LIS', airportName: 'Lisbon Airport', country: 'PT', lat: 38.7756, lng: -9.1354 },
  'madrid': { airportCode: 'MAD', cityCode: 'MAD', airportName: 'Adolfo Suarez Madrid-Barajas Airport', country: 'ES', lat: 40.4983, lng: -3.5676 },
  'athens': { airportCode: 'ATH', cityCode: 'ATH', airportName: 'Athens International Airport', country: 'GR', lat: 37.9364, lng: 23.9445 },
  'istanbul': { airportCode: 'IST', cityCode: 'IST', airportName: 'Istanbul Airport', country: 'TR', lat: 41.2753, lng: 28.7519 },
  'dublin': { airportCode: 'DUB', cityCode: 'DUB', airportName: 'Dublin Airport', country: 'IE', lat: 53.4264, lng: -6.2499 },
  'copenhagen': { airportCode: 'CPH', cityCode: 'CPH', airportName: 'Copenhagen Airport', country: 'DK', lat: 55.6181, lng: 12.6561 },
  'stockholm': { airportCode: 'ARN', cityCode: 'STO', airportName: 'Stockholm Arlanda Airport', country: 'SE', lat: 59.6519, lng: 17.9186 },
  'oslo': { airportCode: 'OSL', cityCode: 'OSL', airportName: 'Oslo Gardermoen Airport', country: 'NO', lat: 60.1976, lng: 11.1004 },
  'helsinki': { airportCode: 'HEL', cityCode: 'HEL', airportName: 'Helsinki-Vantaa Airport', country: 'FI', lat: 60.3172, lng: 24.9633 },
  'warsaw': { airportCode: 'WAW', cityCode: 'WAW', airportName: 'Warsaw Chopin Airport', country: 'PL', lat: 52.1657, lng: 20.9671 },
  'budapest': { airportCode: 'BUD', cityCode: 'BUD', airportName: 'Budapest Ferenc Liszt International Airport', country: 'HU', lat: 47.4298, lng: 19.2611 },

  'dubai': { airportCode: 'DXB', cityCode: 'DXB', airportName: 'Dubai International Airport', country: 'AE', lat: 25.2532, lng: 55.3657 },
  'abu dhabi': { airportCode: 'AUH', cityCode: 'AUH', airportName: 'Abu Dhabi International Airport', country: 'AE', lat: 24.4330, lng: 54.6511 },
  'doha': { airportCode: 'DOH', cityCode: 'DOH', airportName: 'Hamad International Airport', country: 'QA', lat: 25.2731, lng: 51.6081 },

  'new york': { airportCode: 'JFK', cityCode: 'NYC', airportName: 'John F. Kennedy International Airport', country: 'US', lat: 40.6413, lng: -73.7781 },
  'nyc': { airportCode: 'JFK', cityCode: 'NYC', airportName: 'John F. Kennedy International Airport', country: 'US', lat: 40.6413, lng: -73.7781 },
  'los angeles': { airportCode: 'LAX', cityCode: 'LAX', airportName: 'Los Angeles International Airport', country: 'US', lat: 33.9425, lng: -118.4081 },
  'san francisco': { airportCode: 'SFO', cityCode: 'SFO', airportName: 'San Francisco International Airport', country: 'US', lat: 37.6213, lng: -122.3790 },
  'chicago': { airportCode: 'ORD', cityCode: 'CHI', airportName: "O'Hare International Airport", country: 'US', lat: 41.9742, lng: -87.9073 },
  'toronto': { airportCode: 'YYZ', cityCode: 'YTO', airportName: 'Toronto Pearson International Airport', country: 'CA', lat: 43.6777, lng: -79.6248 },

  'singapore': { airportCode: 'SIN', cityCode: 'SIN', airportName: 'Singapore Changi Airport', country: 'SG', lat: 1.3644, lng: 103.9915 },
  'bangkok': { airportCode: 'BKK', cityCode: 'BKK', airportName: 'Suvarnabhumi Airport', country: 'TH', lat: 13.6900, lng: 100.7501 },
  'tokyo': { airportCode: 'NRT', cityCode: 'TYO', airportName: 'Narita International Airport', country: 'JP', lat: 35.7720, lng: 140.3929 },
  'hong kong': { airportCode: 'HKG', cityCode: 'HKG', airportName: 'Hong Kong International Airport', country: 'HK', lat: 22.3080, lng: 113.9185 },
  'kuala lumpur': { airportCode: 'KUL', cityCode: 'KUL', airportName: 'Kuala Lumpur International Airport', country: 'MY', lat: 2.7456, lng: 101.7099 },
  'bali': { airportCode: 'DPS', cityCode: 'DPS', airportName: 'Ngurah Rai International Airport', country: 'ID', lat: -8.7482, lng: 115.1672 },
  'seoul': { airportCode: 'ICN', cityCode: 'SEL', airportName: 'Incheon International Airport', country: 'KR', lat: 37.4602, lng: 126.4407 },
  'sydney': { airportCode: 'SYD', cityCode: 'SYD', airportName: 'Sydney Kingsford Smith Airport', country: 'AU', lat: -33.9461, lng: 151.1772 },
  'melbourne': { airportCode: 'MEL', cityCode: 'MEL', airportName: 'Melbourne Airport', country: 'AU', lat: -37.6690, lng: 144.8410 },

  'cairo': { airportCode: 'CAI', cityCode: 'CAI', airportName: 'Cairo International Airport', country: 'EG', lat: 30.1219, lng: 31.4056 },
  'nairobi': { airportCode: 'NBO', cityCode: 'NBO', airportName: 'Jomo Kenyatta International Airport', country: 'KE', lat: -1.3192, lng: 36.9278 },
  'cape town': { airportCode: 'CPT', cityCode: 'CPT', airportName: 'Cape Town International Airport', country: 'ZA', lat: -33.9649, lng: 18.6017 },
  'johannesburg': { airportCode: 'JNB', cityCode: 'JNB', airportName: 'O.R. Tambo International Airport', country: 'ZA', lat: -26.1392, lng: 28.2460 },
};

// Cities without major airports → mapped to nearest airport + train/bus info
const NO_AIRPORT_CITIES = {
  'bruges': { nearestAirportCode: 'BRU', nearestCityCode: 'BRU', nearestAirportName: 'Brussels Airport', nearestCityName: 'Brussels', country: 'BE', distanceKm: 100, transitDuration: '~1h by train', transitCostEur: 15 },
  'brugge': { nearestAirportCode: 'BRU', nearestCityCode: 'BRU', nearestAirportName: 'Brussels Airport', nearestCityName: 'Brussels', country: 'BE', distanceKm: 100, transitDuration: '~1h by train', transitCostEur: 15 },
  'ghent': { nearestAirportCode: 'BRU', nearestCityCode: 'BRU', nearestAirportName: 'Brussels Airport', nearestCityName: 'Brussels', country: 'BE', distanceKm: 60, transitDuration: '~35min by train', transitCostEur: 12 },
  'antwerp': { nearestAirportCode: 'BRU', nearestCityCode: 'BRU', nearestAirportName: 'Brussels Airport', nearestCityName: 'Brussels', country: 'BE', distanceKm: 45, transitDuration: '~30min by train', transitCostEur: 10 },
  'florence': { nearestAirportCode: 'FLR', nearestCityCode: 'FLR', nearestAirportName: 'Florence Airport', nearestCityName: 'Florence', country: 'IT', distanceKm: 5, transitDuration: '~20min by bus', transitCostEur: 6 },
  'venice': { nearestAirportCode: 'VCE', nearestCityCode: 'VCE', nearestAirportName: 'Venice Marco Polo Airport', nearestCityName: 'Venice', country: 'IT', distanceKm: 13, transitDuration: '~30min by bus', transitCostEur: 8 },
  'pisa': { nearestAirportCode: 'PSA', nearestCityCode: 'PSA', nearestAirportName: 'Pisa International Airport', nearestCityName: 'Pisa', country: 'IT', distanceKm: 2, transitDuration: '~10min', transitCostEur: 3 },
  'nice': { nearestAirportCode: 'NCE', nearestCityCode: 'NCE', nearestAirportName: 'Nice Cote d\'Azur Airport', nearestCityName: 'Nice', country: 'FR', distanceKm: 7, transitDuration: '~20min by bus', transitCostEur: 6 },
  'lyon': { nearestAirportCode: 'LYS', nearestCityCode: 'LYS', nearestAirportName: 'Lyon-Saint Exupery Airport', nearestCityName: 'Lyon', country: 'FR', distanceKm: 25, transitDuration: '~30min by train', transitCostEur: 15 },
  'salzburg': { nearestAirportCode: 'SZG', nearestCityCode: 'SZG', nearestAirportName: 'Salzburg Airport', nearestCityName: 'Salzburg', country: 'AT', distanceKm: 4, transitDuration: '~15min by bus', transitCostEur: 3 },
  'lucerne': { nearestAirportCode: 'ZRH', nearestCityCode: 'ZRH', nearestAirportName: 'Zurich Airport', nearestCityName: 'Zurich', country: 'CH', distanceKm: 65, transitDuration: '~1h by train', transitCostEur: 25 },
  'interlaken': { nearestAirportCode: 'BRN', nearestCityCode: 'BRN', nearestAirportName: 'Bern Airport', nearestCityName: 'Bern', country: 'CH', distanceKm: 60, transitDuration: '~50min by train', transitCostEur: 30 },
  'oxford': { nearestAirportCode: 'LHR', nearestCityCode: 'LON', nearestAirportName: 'Heathrow Airport', nearestCityName: 'London', country: 'GB', distanceKm: 90, transitDuration: '~1h 30min by bus', transitCostEur: 18 },
  'bath': { nearestAirportCode: 'BRS', nearestCityCode: 'BRS', nearestAirportName: 'Bristol Airport', nearestCityName: 'Bristol', country: 'GB', distanceKm: 30, transitDuration: '~40min by bus', transitCostEur: 10 },
  'agra': { nearestAirportCode: 'DEL', nearestCityCode: 'DEL', nearestAirportName: 'Indira Gandhi International Airport', nearestCityName: 'Delhi', country: 'IN', distanceKm: 230, transitDuration: '~2h by train (Gatimaan Express)', transitCostEur: 12 },
  'shimla': { nearestAirportCode: 'DEL', nearestCityCode: 'DEL', nearestAirportName: 'Indira Gandhi International Airport', nearestCityName: 'Delhi', country: 'IN', distanceKm: 350, transitDuration: '~4h by train+bus', transitCostEur: 15 },
  'manali': { nearestAirportCode: 'DEL', nearestCityCode: 'DEL', nearestAirportName: 'Indira Gandhi International Airport', nearestCityName: 'Delhi', country: 'IN', distanceKm: 530, transitDuration: '~12h by bus', transitCostEur: 18 },
  'rishikesh': { nearestAirportCode: 'DED', nearestCityCode: 'DED', nearestAirportName: 'Jolly Grant Airport', nearestCityName: 'Dehradun', country: 'IN', distanceKm: 35, transitDuration: '~45min', transitCostEur: 5 },
  'lonavala': { nearestAirportCode: 'BOM', nearestCityCode: 'BOM', nearestAirportName: 'Chhatrapati Shivaji Maharaj International Airport', nearestCityName: 'Mumbai', country: 'IN', distanceKm: 83, transitDuration: '~2h by train', transitCostEur: 3 },
  'mahabaleshwar': { nearestAirportCode: 'PNQ', nearestCityCode: 'PNQ', nearestAirportName: 'Pune Airport', nearestCityName: 'Pune', country: 'IN', distanceKm: 120, transitDuration: '~3h by bus', transitCostEur: 5 },
};

function normalize(cityName) {
  if (!cityName) return '';
  return cityName.toLowerCase().trim()
    .replace(/,.*$/, '')
    .replace(/\s+(west|east|north|south|central|city|town|district|area)$/i, '')
    .trim();
}

function getFallbackIata(cityName) {
  if (!cityName) return null;
  const normalized = normalize(cityName);

  if (CITY_TO_IATA[normalized]) return { ...CITY_TO_IATA[normalized], hasAirport: true };

  for (const key of Object.keys(CITY_TO_IATA)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return { ...CITY_TO_IATA[key], hasAirport: true };
    }
  }

  return null;
}

function getNoAirportCity(cityName) {
  if (!cityName) return null;
  const normalized = normalize(cityName);

  if (NO_AIRPORT_CITIES[normalized]) return NO_AIRPORT_CITIES[normalized];

  for (const key of Object.keys(NO_AIRPORT_CITIES)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return NO_AIRPORT_CITIES[key];
    }
  }

  return null;
}

// Find nearest airport from static data using coordinates (haversine distance)
function getNearestAirportByCoords(lat, lng) {
  if (!lat || !lng) return null;

  const R = 6371;
  function haversine(lat1, lng1, lat2, lng2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Deduplicate airports (multiple city names can point to same airport)
  const seen = new Set();
  let bestMatch = null;
  let bestDist = Infinity;

  for (const entry of Object.values(CITY_TO_IATA)) {
    if (!entry.lat || !entry.lng) continue;
    if (seen.has(entry.airportCode)) continue;
    seen.add(entry.airportCode);

    const dist = haversine(lat, lng, entry.lat, entry.lng);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = entry;
    }
  }

  // Only return if within 500km (otherwise it's not a useful match)
  if (bestMatch && bestDist < 500) {
    return { ...bestMatch, distanceKm: Math.round(bestDist), hasAirport: bestDist < 80 };
  }
  return null;
}

module.exports = { getFallbackIata, getNoAirportCity, getNearestAirportByCoords, CITY_TO_IATA, NO_AIRPORT_CITIES };
