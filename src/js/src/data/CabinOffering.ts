import { EventEmitter } from 'node:events';
import type { Price } from './types';
import type { Departure } from './Departure';
import type { CabinGrade } from './CabinGrade';
import type { Ship } from './Ship';
import type { ISwotaAvailabilityClient } from '../availability/ISwotaAvailabilityClient';

/**
 * Observable state of a {@link CabinOffering}'s live-availability fetch (see
 * {@link CabinOffering.getAvailableCabinsAsync}).
 *
 * - `'static'`: no live client wired (`'v1'`/`'v3'` formats). The static
 *   {@link CabinOffering.availableCabins} snapshot IS the final answer —
 *   there is, and never will be, a live fetch. Set at construction and never
 *   changes.
 * - `'not-fetched'`: a live client IS wired (`'swota'` format), but
 *   {@link CabinOffering.getAvailableCabinsAsync} hasn't been called yet. Set
 *   at construction for `'swota'` offerings.
 * - `'loading'`: {@link CabinOffering.getAvailableCabinsAsync} has been
 *   called and the live fetch is in flight.
 * - `'loaded'`: the live fetch resolved successfully.
 * - `'failed'`: the live fetch threw (after whatever retries the client
 *   itself performs — this state layer adds no retry behavior of its own,
 *   it only surfaces the terminal failure).
 */
export type CabinAvailabilityState = 'static' | 'not-fetched' | 'loading' | 'loaded' | 'failed';

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
  /**
   * Static available-cabins snapshot. Untouched by the `'swota'` format: under
   * `'v1'` this is a real value from the flat file, under `'v3'`/`'swota'` it
   * is `maxOccupancy` used as a placeholder. Always prefer
   * {@link getAvailableCabinsAsync} over reading this directly — it resolves
   * live availability when a live client is wired (`'swota'` format) and
   * falls back to this static value otherwise.
   */
  readonly availableCabins: number | null;
  /**
   * The RAW, unstripped source `VoyageID` this offering belongs to (e.g.
   * `"_@FNALA04-260906"`), used as the `voyageId` argument to
   * {@link ISwotaAvailabilityClient.getAvailableCabins}. The live SWOTA REST
   * API requires this exact raw form — it is NOT the same as the stripped
   * departure code. Only set when a live client is wired (`'swota'` format);
   * `undefined` for `'v1'`/`'v3'`.
   */
  readonly voyageId: string | undefined;

  private readonly _prices = new Map<string, Price>();
  private _departure!: Departure;
  private _cabinGrade: CabinGrade | null = null;
  private readonly _liveClient: ISwotaAvailabilityClient | undefined;
  private _liveAvailability: Promise<number | null> | undefined;
  private readonly _events = new EventEmitter();
  private _availabilityState: CabinAvailabilityState;
  private _lastKnownAvailableCabins: number | null;

  constructor(
    code: string,
    name: string,
    availableCabins: number | null,
    voyageId?: string,
    liveClient?: ISwotaAvailabilityClient
  ) {
    this.code = code;
    this.name = name;
    this.availableCabins = availableCabins;
    this.voyageId = voyageId;
    this._liveClient = liveClient;
    if (this._liveClient) {
      this._availabilityState = 'not-fetched';
      this._lastKnownAvailableCabins = null;
    } else {
      this._availabilityState = 'static';
      this._lastKnownAvailableCabins = availableCabins;
    }
  }

  /** Current state of the live-availability fetch. See {@link CabinAvailabilityState}. */
  get availabilityState(): CabinAvailabilityState {
    return this._availabilityState;
  }

  /**
   * Sync, side-effect-free snapshot of whatever's currently known: `null`
   * while `'not-fetched'`/`'loading'`/`'failed'`, the resolved value once
   * `'loaded'`, or the static {@link availableCabins} value immediately when
   * {@link availabilityState} is `'static'`. Never triggers a fetch — safe to
   * poll/read repeatedly, e.g. from a render loop.
   */
  get lastKnownAvailableCabins(): number | null {
    return this._lastKnownAvailableCabins;
  }

  /**
   * Registers `listener` to be called whenever {@link availabilityState} (and
   * therefore {@link lastKnownAvailableCabins}) changes:
   * `'not-fetched'`→`'loading'`, then `'loading'`→`'loaded'`/`'failed'`.
   * Never fires for `'static'` offerings — that state never changes.
   *
   * @returns An unsubscribe function.
   */
  onAvailabilityChange(listener: (offering: CabinOffering) => void): () => void {
    const wrapped = (): void => listener(this);
    this._events.on('change', wrapped);
    return () => {
      this._events.off('change', wrapped);
    };
  }

  private _transition(state: CabinAvailabilityState, resolvedValue?: number | null): void {
    this._availabilityState = state;
    if (resolvedValue !== undefined) {
      this._lastKnownAvailableCabins = resolvedValue;
    }
    this._emitChange();
  }

  /**
   * Emits the `'change'` event, swallowing any exception a listener throws.
   *
   * `EventEmitter.emit()` re-throws synchronously if a listener throws (Node
   * has no default `'error'` handler installed here). Every call site of
   * this method runs from inside the `.then()`/`.catch()` chain that
   * resolves/rejects {@link _liveAvailability} (via {@link _transition}) or
   * from the synchronous `'loading'` kickoff in
   * {@link getAvailableCabinsAsync} — in both cases, letting a listener's
   * exception propagate out of this method would let it get caught by that
   * surrounding chain and mis-attributed as a fetch failure, corrupting an
   * otherwise-successful result. By the time this is called, state and
   * {@link _lastKnownAvailableCabins}/{@link _liveAvailability} are already
   * finalized for this transition, so a listener's exception has nothing
   * left to corrupt — it's safe to just swallow it here. Mirrors .NET's
   * `CabinOffering.RaiseAvailabilityChanged`.
   */
  private _emitChange(): void {
    try {
      this._events.emit('change', this);
    } catch {
      // Deliberately swallowed -- see doc comment above.
    }
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

  /**
   * Resolves the current available-cabins count.
   *
   * - No live client wired (`'v1'`/`'v3'` formats): resolves immediately to
   *   the static {@link availableCabins} snapshot. Not cached — there is
   *   nothing to cache, it's a synchronous value wrapped in a Promise.
   * - Live client wired (`'swota'` format): invokes
   *   {@link ISwotaAvailabilityClient.getAvailableCabins} on the FIRST call
   *   and caches the resulting promise, so concurrent first-callers await the
   *   same in-flight request and later callers get the resolved result
   *   without re-invoking the client. The FIRST call also drives
   *   {@link availabilityState} through `'not-fetched'` → `'loading'` →
   *   `'loaded'`/`'failed'` (synchronously into `'loading'`, before any
   *   `await` point), notifying {@link onAvailabilityChange} listeners at
   *   each transition. Concurrent callers riding the same in-flight request
   *   never cause duplicate transitions or notifications. A `'failed'`
   *   offering is retryable, not terminal: a later call re-invokes the
   *   client rather than staying memoized as failed forever. Only `'loaded'`
   *   is truly final.
   *
   * This returned promise rejects if the live lookup fails (after this
   * class's own retry budget is exhausted) — callers are responsible for
   * handling that rejection. In particular, if you only need this call to
   * kick off the fetch (e.g. to start `'loading'` for a UI list) and don't
   * need the result here, you must still attach a `.catch()` when calling it
   * without `await`: a bare `void offering.getAvailableCabinsAsync()` with
   * no `.catch()` is an unhandled promise rejection, which crashes the
   * process under Node's default behavior. Always write it as:
   * ```ts
   * void offering.getAvailableCabinsAsync().catch(() => {});
   * ```
   * (see `utils/js/SDKCLI.js`'s `selectDeparture`, which does exactly this
   * when kicking off availability fetches for every offering in a
   * departure).
   */
  async getAvailableCabinsAsync(): Promise<number | null> {
    if (!this._liveClient) {
      return this.availableCabins;
    }
    // Entry guard checks `_availabilityState`, NOT `_liveAvailability` --
    // this is the reentrancy fix. `_transition('loading')` used to run
    // BEFORE `_liveAvailability` was assigned, which emitted 'change'
    // synchronously while `_liveAvailability` was still falsy; a listener
    // that reacted by calling this method again (a realistic UI-redraw
    // pattern) would see `!this._liveAvailability` still true, re-enter this
    // branch, transition to 'loading' again, emit again, and recurse without
    // bound -- reproduced as 1048 duplicate client calls and a stack
    // overflow.
    //
    // A 'not-fetched'/'failed' offering is what may start a fetch -- 'failed'
    // is retryable, not terminal, so a later call re-invokes the client
    // rather than staying memoized as failed forever; only 'loaded' is truly
    // final. The exact sequencing below is the safety-critical part:
    //   1. Flip `_availabilityState` to 'loading' as a raw synchronous field
    //      write -- no listener-invoking side effect yet.
    //   2. Assign `_liveAvailability` to the fetch's promise chain.
    //   3. ONLY THEN emit the 'loading' 'change' notification.
    // Steps 1 and 2 have nothing reentrant-triggering between them, so a
    // reentrant call arriving during step 3's emit (from inside a
    // synchronous listener) always observes `_availabilityState === 'loading'`
    // AND `_liveAvailability` already assigned -- it fails this guard and
    // falls straight through to `return this._liveAvailability` below,
    // riding the same in-flight fetch instead of starting a second one. No
    // code path can result in a second live fetch starting while one is
    // already logically in-flight, no matter what a synchronous 'change'
    // listener does.
    if (this._availabilityState === 'not-fetched' || this._availabilityState === 'failed') {
      this._availabilityState = 'loading';
      // A conforming `ISwotaAvailabilityClient` implementation returns a
      // Promise, but nothing stops one from throwing SYNCHRONOUSLY instead (a
      // plain, non-`async` function with a `throw` statement, executing
      // before any Promise is ever returned). Calling it directly here and
      // chaining `.then()`/`.catch()` off the return value would let that
      // throw propagate straight out of this method, uncaught -- and since
      // `_availabilityState` was already flipped to 'loading' above (which is
      // NOT one of the retryable entry states), the offering would be
      // permanently stuck 'loading' forever: no `_emitChange()`, no
      // subscriber notification, no way back in. The try/catch below
      // normalizes a synchronous throw into an ordinary rejected Promise, so
      // it flows through the same `.catch()` -> `_transition('failed')` path
      // as an async rejection, WITHOUT deferring the call itself into a
      // microtask (an alternative like `Promise.resolve().then(() => ...)`
      // would invoke the client one tick later than before, which is an
      // observable timing change -- this preserves synchronous invocation).
      // Mirrors .NET's guard for the same scenario.
      let clientPromise: Promise<number | null>;
      try {
        clientPromise = this._liveClient.getAvailableCabins(this.voyageId ?? '', this.code);
      } catch (err) {
        clientPromise = Promise.reject(err as unknown);
      }
      const promise = clientPromise
        .then((value) => {
          this._transition('loaded', value);
          return value;
        })
        .catch((err: unknown) => {
          this._transition('failed');
          throw err;
        });
      this._liveAvailability = promise;
      this._emitChange();
      return promise;
    }
    // Reachable only when `_availabilityState` is 'loading' or 'loaded' (the
    // only two states not handled above), both of which invariantly imply
    // `_liveAvailability` was already assigned by a previous call.
    return this._liveAvailability!;
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
