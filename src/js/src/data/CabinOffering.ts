import type { Price } from './types';
import type { Departure } from './Departure';
import type { CabinGrade } from './CabinGrade';
import type { Ship } from './Ship';

/**
 * A cabin grade made available on a specific departure, with prices per
 * currency. This is the join between a Departure and a CabinGrade — the node
 * where pricing lives. Navigable to its departure, grade, and ship.
 */
export class CabinOffering {
  /** Cabin grade code (source-market "Category", e.g. "DS"). */
  readonly code: string;
  /** Human label (source-market "SuperCategory", e.g. "DARWIN SUITE"). */
  readonly name: string;
  readonly availableCabins: number | null;

  private readonly _prices = new Map<string, Price>();
  private _departure!: Departure;
  private _cabinGrade: CabinGrade | null = null;

  constructor(code: string, name: string, availableCabins: number | null) {
    this.code = code;
    this.name = name;
    this.availableCabins = availableCabins;
  }

  get departure(): Departure {
    return this._departure;
  }

  /** The cabin grade reference (null if the category is absent from cabingrades). */
  get cabinGrade(): CabinGrade | null {
    return this._cabinGrade;
  }

  /** The ship this offering sails on, via its departure. */
  get ship(): Ship | null {
    return this._departure.ship;
  }

  /** All prices, one per currency, sorted by currency code. */
  get prices(): Price[] {
    return [...this._prices.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  }

  priceFor(currency: string): Price | undefined {
    return this._prices.get(currency);
  }

  /** Cabin description resolved for this offering's ship. */
  get description(): string[] {
    if (!this._cabinGrade) return [];
    const shipCode = this._departure.shipCode;
    return this._cabinGrade.descriptionsForShip(shipCode);
  }

  /** @internal */
  _setDeparture(departure: Departure): void {
    this._departure = departure;
  }

  /** @internal */
  _setCabinGrade(grade: CabinGrade): void {
    this._cabinGrade = grade;
  }

  /** @internal */
  _addPrice(currency: string, single: number | null, double: number | null): void {
    this._prices.set(currency, { currency, single, double });
  }
}
