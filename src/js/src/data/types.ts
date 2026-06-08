/**
 * Raw JSON shapes as they appear in the flat files. These are intentionally
 * permissive (nullable) because the source data is not strictly validated.
 * The OOP entities in this folder wrap these into a navigable object graph.
 */

export interface RawItineraryDay {
  day?: string | null;
  location?: string | null;
  heading?: string | null;
  body?: string | null;
}

export interface RawVoyage {
  url?: string | null;
  heading?: string | null;
  intro?: string | null;
  sellingPoints?: string[] | null;
  durationText?: string | null;
  travelSuggestionCodes?: string[] | null;
  fromPort?: string | null;
  toPort?: string | null;
  itinerary?: RawItineraryDay[] | null;
}

export interface RawShip {
  shipId?: string | null;
  heading?: string | null;
  passengerCapacity?: number | string | null;
  yearOfConstruction?: number | string | null;
}

export interface RawShipDescription {
  shipCode?: string | null;
  maxCapacity?: number | null;
  description?: string | null;
}

export interface RawCabinGrade {
  code?: string | null;
  shipDescriptions?: RawShipDescription[] | null;
}

export interface RawPort {
  code?: string | null;
  description?: string | null;
}

export interface RawSourceMarketRow {
  MasterSailingId?: number | null;
  Currency?: string | null;
  Category?: string | null;
  SuperCategory?: string | null;
  AvailableCabins?: number | null;
  Rate_Sgl?: string | null;
  Rate_Dbl?: string | null;
  TourCode?: string | null;
  TourStartDate?: string | null;
  TourEndDate?: string | null;
}

/** A double/single price in a single currency. */
export interface Price {
  currency: string;
  single: number | null;
  double: number | null;
}

/** A lightweight, read-only view of one itinerary day. */
export interface ItineraryDay {
  day: string | null;
  location: string | null;
  heading: string | null;
}
