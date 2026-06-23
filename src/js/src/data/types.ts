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

// --- Prod flat-file raw shapes ---------------------------------------------
// The prod format is a different JSON schema (per-country files, pricing
// embedded per voyage). These raw types are consumed only by the prod loader;
// the OOP entities are unchanged (prod-only fields are normalized then dropped).

export interface RawProdPort {
  code?: string | null;
  /** ISO2 country code. Not stored on the Port entity (entity unchanged). */
  country?: string | null;
  description?: string | null;
}

export interface RawProdShip {
  shipId?: string | null;
  heading?: string | null;
  passengerCapacity?: string | number | null;
  yearOfConstruction?: string | number | null;
  /** e.g. "11,647 t" — normalized at parse time then dropped. */
  grossTonnage?: string | number | null;
  /** e.g. "114 m" — normalized at parse time then dropped. */
  length?: string | number | null;
  /** e.g. "13 knots" — normalized at parse time then dropped. */
  speed?: string | number | null;
}

export interface RawProdItineraryDay {
  day?: number | null;
  location?: string | null;
  heading?: string | null;
  body?: string | null;
  mediaContent?: string[] | null;
}

export interface RawProdCategory {
  Category?: string | null;
  MaxOccupancy?: number | null;
  Rate_Sgl?: string | null;
  Rate_Dbl?: string | null;
  RateCode?: string | null;
}

export interface RawProdVoyage {
  VoyageID?: string | null;
  DepartureDate?: string | null;
  ArrivalDate?: string | null;
  EmbarkationTime?: string | null;
  DisembarkationTime?: string | null;
  DeparturePort?: string | null;
  ArrivalPort?: string | null;
  ShipCode?: string | null;
  Description?: string | null;
  Region?: string | null;
  Currency?: string | null;
  itinerary?: RawProdItineraryDay[] | null;
  categories?: RawProdCategory[] | null;
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
