import type { RawCabinGrade } from './types';
import type { CabinOffering } from './CabinOffering';
import type { Ship } from './Ship';
import type { Departure } from './Departure';

/**
 * A cabin grade (e.g. "DS" = Darwin Suite). The same grade can have different
 * descriptions per ship, so descriptions are keyed by ship code. Navigable to
 * its offerings, the ships it appears on, and (transitively) departures.
 */
export class CabinGrade {
  readonly code: string;

  private readonly _descriptionsByShip = new Map<string, string[]>();
  private readonly _offerings: CabinOffering[] = [];
  private readonly _ships: Ship[] = [];

  constructor(raw: RawCabinGrade) {
    this.code = (raw.code ?? '').trim();
    for (const sd of raw.shipDescriptions ?? []) {
      const ship = (sd.shipCode ?? '').trim();
      const desc = (sd.description ?? '').trim();
      if (!desc) continue;
      const list = this._descriptionsByShip.get(ship) ?? [];
      if (!list.includes(desc)) list.push(desc);
      this._descriptionsByShip.set(ship, list);
    }
  }

  /** Priced offerings of this grade across all departures. */
  get offerings(): readonly CabinOffering[] {
    return this._offerings;
  }

  /** Ships this grade is actually offered on. */
  get ships(): readonly Ship[] {
    return this._ships;
  }

  /** Distinct departures on which this grade is offered. */
  get departures(): Departure[] {
    const seen = new Set<Departure>();
    for (const offering of this._offerings) seen.add(offering.departure);
    return [...seen];
  }

  /**
   * Descriptions for this grade on a given ship. Falls back to the distinct
   * descriptions across all ships when the exact ship has none.
   */
  descriptionsForShip(shipCode: string): string[] {
    const exact = this._descriptionsByShip.get(shipCode);
    if (exact && exact.length > 0) return [...exact];

    const all: string[] = [];
    for (const list of this._descriptionsByShip.values()) {
      for (const d of list) if (!all.includes(d)) all.push(d);
    }
    return all;
  }

  /** @internal */
  _addOffering(offering: CabinOffering): void {
    this._offerings.push(offering);
  }

  /** @internal */
  _addShip(ship: Ship): void {
    if (!this._ships.includes(ship)) this._ships.push(ship);
  }
}
