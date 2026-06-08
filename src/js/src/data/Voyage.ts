import type { RawVoyage, ItineraryDay } from './types';
import type { Departure } from './Departure';
import type { Ship } from './Ship';
import type { Port } from './Port';

/**
 * A voyage / destination product (e.g. the Galápagos itinerary). Holds the
 * marketing content and is navigable to its departures, the ships that sail
 * it, and its from/to ports.
 */
export class Voyage {
  readonly heading: string;
  readonly intro: string;
  readonly sellingPoints: string[];
  readonly durationText: string;
  readonly itinerary: ItineraryDay[];
  /** Raw departure codes referenced by this voyage. */
  readonly travelSuggestionCodes: string[];

  /** Raw port codes from the source (resolved to Port objects when present). */
  readonly fromPortCode: string | null;
  readonly toPortCode: string | null;

  private readonly _departures: Departure[] = [];
  private _fromPort: Port | null = null;
  private _toPort: Port | null = null;

  constructor(raw: RawVoyage) {
    this.heading = (raw.heading ?? '').trim();
    this.intro = (raw.intro ?? '').trim();
    this.sellingPoints = (raw.sellingPoints ?? []).filter((s): s is string => !!s && !!s.trim());
    this.durationText = (raw.durationText ?? '').trim();
    this.travelSuggestionCodes = (raw.travelSuggestionCodes ?? []).filter((c): c is string => !!c);
    this.fromPortCode = raw.fromPort ?? null;
    this.toPortCode = raw.toPort ?? null;
    this.itinerary = (raw.itinerary ?? []).map((d) => ({
      day: d.day ?? null,
      location: d.location ?? null,
      heading: d.heading ?? null,
    }));
  }

  /** All departures of this voyage. */
  get departures(): readonly Departure[] {
    return this._departures;
  }

  /** Upcoming departures (on/after asOf, or undated), sorted by date. */
  upcomingDepartures(asOf: string): Departure[] {
    return this._departures
      .filter((d) => d.isUpcoming(asOf))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  /** Distinct ships that sail this voyage. */
  get ships(): Ship[] {
    const seen = new Set<Ship>();
    for (const dep of this._departures) {
      if (dep.ship) seen.add(dep.ship);
    }
    return [...seen];
  }

  get fromPort(): Port | null {
    return this._fromPort;
  }

  get toPort(): Port | null {
    return this._toPort;
  }

  /** @internal */
  _addDeparture(departure: Departure): void {
    this._departures.push(departure);
  }

  /** @internal */
  _setFromPort(port: Port): void {
    this._fromPort = port;
  }

  /** @internal */
  _setToPort(port: Port): void {
    this._toPort = port;
  }
}
