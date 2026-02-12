const AMADEUS_API_KEY = 'jiQL8P6GPSANkQ81sMK1HV9BHpTDiiqK';
const AMADEUS_API_SECRET = 'PeDBRA2zf3gfNMfn';
const TOKEN_URL = 'https://test.api.amadeus.com/v1/security/oauth2/token';

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${AMADEUS_API_KEY}&client_secret=${AMADEUS_API_SECRET}`
  });

  if (!resp.ok) {
    throw new Error(`Amadeus auth failed: ${resp.status}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

module.exports = { getToken };
