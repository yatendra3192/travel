const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlMs) {
  cache.set(key, { value, expiry: Date.now() + ttlMs });
}

function clearCache() {
  cache.clear();
}

module.exports = { getCached, setCache, clearCache };
