import type { CabinOffering } from './CabinOffering';
import type { Voyage } from './Voyage';
import type { Ship } from './Ship';
import type { CabinGrade } from './CabinGrade';

/**
 * A single dated departure of a voyage, identified by its tour code
 * (e.g. "SCGALEMAC-260821"). The ship is the first two letters of the code.
 * Navigable to its voyage, ship, and cabin offerings.
 */
export class Departure {
  /** Full tour code, e.g. "SCGALEMAC-260821". */
  readonly code: string;
  /** Departure (start) date as YYYY-MM-DD, or null if not parseable. */
  readonly date: string | null;
  /** Ship code: the first two letters of the tour code. */
  readonly shipCode: string;

  private _endDate: string | null = null;
  private _voyage: Voyage | null = null;
  private _ship: Ship | null = null;
  private readonly _offerings: CabinOffering[] = [];

  constructor(code: string, date: string | null) {
    this.code = code;
    this.date = date;
    this.shipCode = code.slice(0, 2);
  }

  /** Return (end) date as YYYY-MM-DD, from the rate data, if known. */
  get endDate(): string | null {
    return this._endDate;
  }

  get voyage(): Voyage | null {
    return this._voyage;
  }

  get ship(): Ship | null {
    return this._ship;
  }

  /** Cabin offerings (one per cabin grade) available on this departure. */
  get offerings(): readonly CabinOffering[] {
    return this._offerings;
  }

  /** Distinct cabin grades available on this departure. */
  get cabinGrades(): CabinGrade[] {
    const seen = new Set<CabinGrade>();
    for (const offering of this._offerings) {
      if (offering.cabinGrade) seen.add(offering.cabinGrade);
    }
    return [...seen];
  }

  offeringForGrade(code: string): CabinOffering | undefined {
    return this._offerings.find((o) => o.code === code);
  }

  /** True if the departure is on/after the given YYYY-MM-DD, or has no date. */
  isUpcoming(asOf: string): boolean {
    return this.date === null || this.date >= asOf;
  }

  /** @internal */
  _setVoyage(voyage: Voyage): void {
    this._voyage = voyage;
  }

  /** @internal */
  _setShip(ship: Ship | null): void {
    this._ship = ship;
  }

  /** @internal */
  _setEndDate(endDate: string | null): void {
    if (endDate && !this._endDate) this._endDate = endDate;
  }

  /** @internal */
  _addOffering(offering: CabinOffering): void {
    this._offerings.push(offering);
  }
}
