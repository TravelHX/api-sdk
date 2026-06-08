import type { RawPort } from './types';
import type { Voyage } from './Voyage';

/**
 * A port (e.g. "AAL" = AALBORG). Navigable to the voyages that start or end
 * here. Note: in the current sample data most voyages have null ports, so
 * these links are often empty — the relationship is modelled regardless.
 */
export class Port {
  readonly code: string;
  readonly description: string;

  private readonly _voyagesFrom: Voyage[] = [];
  private readonly _voyagesTo: Voyage[] = [];

  constructor(raw: RawPort) {
    this.code = (raw.code ?? '').trim();
    this.description = (raw.description ?? '').trim();
  }

  /** Voyages departing from this port. */
  get voyagesFrom(): readonly Voyage[] {
    return this._voyagesFrom;
  }

  /** Voyages terminating at this port. */
  get voyagesTo(): readonly Voyage[] {
    return this._voyagesTo;
  }

  /** @internal */
  _addVoyageFrom(voyage: Voyage): void {
    this._voyagesFrom.push(voyage);
  }

  /** @internal */
  _addVoyageTo(voyage: Voyage): void {
    this._voyagesTo.push(voyage);
  }
}
