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

// Periodic cleanup of expired entries every hour to prevent memory buildup
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiry) {
      cache.delete(key);
    }
  }
}, 60 * 60 * 1000).unref();

module.exports = { getCached, setCache, clearCache };
