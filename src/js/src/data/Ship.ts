import type { RawShip } from './types';
import type { Departure } from './Departure';
import type { CabinGrade } from './CabinGrade';
import type { Voyage } from './Voyage';

/**
 * A ship (e.g. "SC" = MS Santa Cruz II). Navigable to the departures it
 * operates, the cabin grades offered aboard it, and (transitively) voyages.
 */
export class Ship {
  readonly id: string;
  readonly name: string;
  readonly passengerCapacity: number | null;
  readonly yearOfConstruction: number | null;

  private readonly _departures: Departure[] = [];
  private readonly _cabinGrades: CabinGrade[] = [];

  constructor(raw: RawShip) {
    this.id = (raw.shipId ?? '').trim();
    this.name = (raw.heading ?? '').trim();
    this.passengerCapacity = Ship.toNumber(raw.passengerCapacity);
    this.yearOfConstruction = Ship.toNumber(raw.yearOfConstruction);
  }

  /** Departures operated by this ship. */
  get departures(): readonly Departure[] {
    return this._departures;
  }

  /** Cabin grades actually offered aboard this ship. */
  get cabinGrades(): readonly CabinGrade[] {
    return this._cabinGrades;
  }

  /** Distinct voyages this ship sails, derived from its departures. */
  get voyages(): Voyage[] {
    const seen = new Set<Voyage>();
    for (const dep of this._departures) {
      const v = dep.voyage;
      if (v) seen.add(v);
    }
    return [...seen];
  }

  /** @internal */
  _addDeparture(departure: Departure): void {
    this._departures.push(departure);
  }

  /** @internal */
  _addCabinGrade(grade: CabinGrade): void {
    if (!this._cabinGrades.includes(grade)) this._cabinGrades.push(grade);
  }

  private static toNumber(value: number | string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const n = typeof value === 'number' ? value : parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
}
