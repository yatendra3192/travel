"""Pydantic models for flight response validation."""

from pydantic import BaseModel


class Layover(BaseModel):
    airportCode: str
    durationMinutes: int
    durationText: str


class Segment(BaseModel):
    from_: str  # aliased from 'from' in serialization
    to: str
    departure: str
    arrival: str
    airline: str
    flightNumber: str
    duration: str

    class Config:
        populate_by_name = True

    def model_dump(self, **kwargs):
        d = super().model_dump(**kwargs)
        d["from"] = d.pop("from_")
        return d


class Flight(BaseModel):
    id: str
    price: float
    currency: str
    airline: str
    airlineName: str
    departure: str
    arrival: str
    departureTerminal: str
    arrivalTerminal: str
    duration: str
    stops: int
    layovers: list[Layover]
    segments: list[Segment]


class FlightsResponse(BaseModel):
    flights: list[Flight]
    carriers: dict[str, str]
