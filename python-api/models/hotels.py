"""Pydantic models for hotel response validation."""

from pydantic import BaseModel


class HotelGeoCode(BaseModel):
    latitude: float | None = None
    longitude: float | None = None


class Hotel(BaseModel):
    hotelId: str
    name: str
    chainCode: str | None = None
    geoCode: HotelGeoCode | None = None
    distance: dict | None = None


class HotelListResponse(BaseModel):
    hotels: list[Hotel]
    searchRadius: int | None = None


class HotelOffer(BaseModel):
    hotelId: str
    hotelName: str
    pricePerNight: float
    totalPrice: float
    currency: str
    roomType: str
    checkIn: str
    checkOut: str


class HotelOffersResponse(BaseModel):
    offers: list[HotelOffer]
