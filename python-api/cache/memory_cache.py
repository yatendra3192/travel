"""TTL-based in-memory caches using cachetools."""

from cachetools import TTLCache

from config import (
    CACHE_TTL_FLIGHTS,
    CACHE_TTL_HOTELS_LIST,
    CACHE_TTL_HOTELS_OFFERS,
    CACHE_MAX_FLIGHTS,
    CACHE_MAX_HOTELS_LIST,
    CACHE_MAX_HOTELS_OFFERS,
)

flights_cache = TTLCache(maxsize=CACHE_MAX_FLIGHTS, ttl=CACHE_TTL_FLIGHTS)
hotels_list_cache = TTLCache(maxsize=CACHE_MAX_HOTELS_LIST, ttl=CACHE_TTL_HOTELS_LIST)
hotels_offers_cache = TTLCache(maxsize=CACHE_MAX_HOTELS_OFFERS, ttl=CACHE_TTL_HOTELS_OFFERS)


def get_flights(key: str):
    return flights_cache.get(key)


def set_flights(key: str, value):
    flights_cache[key] = value


def get_hotels_list(key: str):
    return hotels_list_cache.get(key)


def set_hotels_list(key: str, value):
    hotels_list_cache[key] = value


def get_hotels_offers(key: str):
    return hotels_offers_cache.get(key)


def set_hotels_offers(key: str, value):
    hotels_offers_cache[key] = value
