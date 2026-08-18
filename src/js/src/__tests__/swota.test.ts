import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CabinOffering } from '../data/CabinOffering';
import { SwotaDataSetLoader } from '../loading/SwotaDataSetLoader';
import type { ISwotaAvailabilityClient } from '../availability/ISwotaAvailabilityClient';
import type { IFlatFileReader } from '../interfaces/IFlatFileReader';
import type { DataSources } from '../interfaces/IApiSdk';
import { FileNotFoundError } from '../errors/FileReadingErrors';

/**
 * A fake IFlatFileReader that serves canned JSON keyed by file name, and can
 * be told to throw FileNotFoundError the FIRST time a given name is
 * resolved — modelling a source that is transiently unavailable (e.g. the v3
 * feed not yet present for this market) — while every subsequent read of the
 * same name succeeds normally. This is the signal SwotaDataSetLoader watches
 * to decide whether to fall back to v1.
 */
class FakeReader implements IFlatFileReader {
  constructor(
    private readonly files: Record<string, unknown>,
    private readonly failFirstReadFor: Set<string> = new Set()
  ) {}

  private resolve(filePath: string): unknown {
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    if (this.failFirstReadFor.has(name)) {
      this.failFirstReadFor.delete(name);
      throw new FileNotFoundError(filePath);
    }
    if (!(name in this.files)) {
      throw new Error(`FakeReader: no canned file for ${name}`);
    }
    return this.files[name];
  }

  async readFile(filePath: string): Promise<string> {
    return JSON.stringify(this.resolve(filePath));
  }

  async readFileAsJson<T = unknown>(filePath: string): Promise<T> {
    return this.resolve(filePath) as T;
  }

  validatePath(): boolean {
    return true;
  }
}

const V3_SOURCES: DataSources = {
  format: 'swota',
  ports: 'ports.json',
  ships: 'ships_AU.json',
  voyages: 'voyages_AU.json',
  cabinGrades: '',
  sourceMarkets: [],
};

function v3Files(): Record<string, unknown> {
  return {
    'ports.json': [{ code: 'SYD', description: 'Sydney' }],
    'ships_AU.json': [{ shipId: 'SC', heading: 'MS Test Ship', passengerCapacity: 200 }],
    'voyages_AU.json': [
      {
        VoyageID: '_@SCABC-260101',
        Description: 'Test Voyage',
        DeparturePort: 'SYD',
        ArrivalPort: 'SYD',
        DepartureDate: '2026-01-01',
        ArrivalDate: '2026-01-07',
        ShipCode: 'SC',
        Currency: 'AUD',
        categories: [
          {
            Category: 'DS',
            RateCode: 'DARWIN SUITE',
            MaxOccupancy: 4,
            Rate_Sgl: '1000.00',
            Rate_Dbl: '900.00',
          },
        ],
      },
    ],
  };
}

// v1-shaped fixture, matching sdk.test.ts's conventions, used to prove the
// swota->v1 fallback path really runs the v1 loader end to end.
const V1_SOURCES: DataSources = {
  format: 'swota',
  voyages: 'voyages.json',
  ships: 'ships.json',
  cabinGrades: 'cabingrades.json',
  ports: 'portlist.json',
  sourceMarkets: ['SourceMarket_GBP.json'],
};

function v1Files(): Record<string, unknown> {
  return {
    'ships.json': [{ shipId: 'SC', heading: 'MS Test Ship' }],
    'portlist.json': [{ code: 'AAA', description: 'PORT A' }],
    'cabingrades.json': [
      { code: 'DS', shipDescriptions: [{ shipCode: 'SC', description: 'Darwin Suite desc' }] },
    ],
    'voyages.json': [
      {
        heading: 'Test Voyage',
        intro: 'an intro',
        sellingPoints: ['point one'],
        durationText: '6 days',
        travelSuggestionCodes: ['SCABC-260101'],
      },
    ],
    'SourceMarket_GBP.json': [
      {
        TourCode: '_@SCABC-260101',
        Category: 'DS',
        SuperCategory: 'SUITE',
        Currency: 'GBP',
        Rate_Sgl: '100.00',
        Rate_Dbl: '90.00',
        AvailableCabins: 3,
        TourStartDate: '2026-01-01',
        TourEndDate: '2026-01-07',
      },
    ],
  };
}

class ThrowingClient implements ISwotaAvailabilityClient {
  async getAvailableCabins(): Promise<number | null> {
    throw new Error('ThrowingClient should never be invoked in this test');
  }
}

test('SwotaDataSetLoader loads v3-shaped data (like the plain v3 loader) and wires a live client', async () => {
  const reader = new FakeReader(v3Files());
  const loader = new SwotaDataSetLoader(new ThrowingClient());
  const result = await loader.load(reader, V3_SOURCES, () => {});

  assert.equal(result.voyages.length, 1);
  assert.equal(result.departures.length, 1);
  assert.equal(result.offerings.length, 1);
  // v3 shape: no separate cabin-grade reference.
  assert.equal(result.cabinGrades.length, 0);

  const offering = result.offerings[0];
  assert.equal(offering.code, 'DS');
  assert.equal(offering.availableCabins, 4); // MaxOccupancy placeholder, untouched
  // The live SWOTA REST API requires the RAW, unstripped VoyageID — not the
  // stripped departure code ('SCABC-260101'). Regression guard for the bug
  // where depCode (stripped) was passed here instead, which 404s against the
  // real SWOTA API for every voyage.
  assert.equal(offering.voyageId, '_@SCABC-260101');
  assert.notEqual(offering.voyageId, result.departures[0].code);
});

test('SwotaDataSetLoader wires CabinOffering.voyageId to the raw VoyageID, not the stripped departure code, and the live client is invoked with it', async () => {
  const reader = new FakeReader(v3Files());
  const receivedArgs: Array<[string, string]> = [];
  const client: ISwotaAvailabilityClient = {
    async getAvailableCabins(voyageId: string, cabinCode: string): Promise<number | null> {
      receivedArgs.push([voyageId, cabinCode]);
      return 5;
    },
  };
  const loader = new SwotaDataSetLoader(client);
  const result = await loader.load(reader, V3_SOURCES, () => {});

  const offering = result.offerings[0];
  const availableCabins = await offering.getAvailableCabinsAsync();

  assert.equal(availableCabins, 5);
  // Must be invoked with the raw, "_@"-prefixed VoyageID from the source
  // row — never the stripped departure code used for internal identity.
  assert.deepEqual(receivedArgs, [['_@SCABC-260101', 'DS']]);
});

test('SwotaDataSetLoader fails fast when a VoyageID normalizes to empty (e.g. a null-sentinel value) instead of sending an empty voyageId to the live client', async () => {
  const files = v3Files();
  // "NaT" is a null-sentinel value (see normString / .NET's
  // V3Normalization.NormalizeString): stripVoyageId's cruder "_@"-prefix-only
  // stripping leaves it as a non-empty depCode ("NaT" has no "_@" prefix to
  // strip), so without the fail-fast check this row would silently wire a
  // live CabinOffering with an empty voyageId, which would 404/error against
  // the real SWOTA API on every lookup instead of failing loudly here.
  (files['voyages_AU.json'] as Array<Record<string, unknown>>)[0].VoyageID = 'NaT';
  const reader = new FakeReader(files);
  const loader = new SwotaDataSetLoader(new ThrowingClient());

  await assert.rejects(() => loader.load(reader, V3_SOURCES, () => {}), /empty\/unmapped VoyageID/);
});

test('SwotaDataSetLoader falls back to the v1 loader when the v3 source is unavailable', async () => {
  // The SAME `sources` object is reused for both the v3 attempt and the v1
  // fallback (SwotaDataSetLoader does not swap DataSources), so this models
  // the v3 read of `voyages.json` failing (FileNotFoundError) while every
  // other file — plus a *retried* read of `voyages.json` — succeeds and is
  // v1-shaped, exactly like V1DataSetLoader expects.
  const reader = new FakeReader(v1Files(), new Set(['voyages.json']));
  const loader = new SwotaDataSetLoader(new ThrowingClient());
  const result = await loader.load(reader, V1_SOURCES, () => {});

  assert.equal(result.voyages.length, 1);
  assert.equal(result.departures.length, 1);
  assert.equal(result.offerings.length, 1);
  // v1 shape: cabin-grade reference is populated.
  assert.equal(result.cabinGrades.length, 1);

  const offering = result.offerings[0];
  assert.equal(offering.code, 'DS');
  assert.equal(offering.availableCabins, 3); // real v1 AvailableCabins, not a placeholder
  // v1 CabinOfferings carry no live client — no voyageId is threaded through.
  assert.equal(offering.voyageId, undefined);
});

test('SwotaDataSetLoader re-throws non-missing-source errors instead of falling back', async () => {
  const reader = new FakeReader({}); // no canned files at all -> generic Error, not FileNotFoundError
  const loader = new SwotaDataSetLoader(new ThrowingClient());

  await assert.rejects(
    () => loader.load(reader, V3_SOURCES, () => {}),
    /no canned file for ports\.json/
  );
});

test('CabinOffering.getAvailableCabinsAsync returns the static value when no live client is wired', async () => {
  const offering = new CabinOffering('DS', 'DARWIN SUITE', 7);
  const result = await offering.getAvailableCabinsAsync();
  assert.equal(result, 7);
});

test('CabinOffering.getAvailableCabinsAsync returns null statically when static value is null and no client is wired', async () => {
  const offering = new CabinOffering('DS', 'DARWIN SUITE', null);
  const result = await offering.getAvailableCabinsAsync();
  assert.equal(result, null);
});

test('CabinOffering.getAvailableCabinsAsync invokes a wired live client once and caches the result', async () => {
  let callCount = 0;
  const receivedArgs: Array<[string, string]> = [];
  const client: ISwotaAvailabilityClient = {
    async getAvailableCabins(voyageId: string, cabinCode: string): Promise<number | null> {
      callCount += 1;
      receivedArgs.push([voyageId, cabinCode]);
      return 5;
    },
  };

  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  const first = await offering.getAvailableCabinsAsync();
  const second = await offering.getAvailableCabinsAsync();

  assert.equal(first, 5);
  assert.equal(second, 5);
  // The static placeholder (999) must never leak through once a live client is wired.
  assert.notEqual(first, offering.availableCabins);
  assert.equal(callCount, 1, 'expected the live client to be invoked exactly once');
  assert.deepEqual(receivedArgs, [['SCABC-260101', 'DS']]);
});

test('CabinOffering.getAvailableCabinsAsync dedupes concurrent first-callers onto one in-flight call', async () => {
  let callCount = 0;
  let resolveClient!: (value: number | null) => void;
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      callCount += 1;
      return new Promise((resolve) => {
        resolveClient = resolve;
      });
    },
  };

  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  const p1 = offering.getAvailableCabinsAsync();
  const p2 = offering.getAvailableCabinsAsync();

  resolveClient(6);

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, 6);
  assert.equal(r2, 6);
  assert.equal(callCount, 1, 'concurrent first-callers must share one in-flight request');
});

// --- availabilityState / lastKnownAvailableCabins / onAvailabilityChange ---

test('CabinOffering.availabilityState is "static" and lastKnownAvailableCabins mirrors availableCabins when no live client is wired', async () => {
  const offering = new CabinOffering('DS', 'DARWIN SUITE', 7);
  assert.equal(offering.availabilityState, 'static');
  assert.equal(offering.lastKnownAvailableCabins, 7);

  await offering.getAvailableCabinsAsync();

  // Never transitions — 'static' means "this is already the final answer".
  assert.equal(offering.availabilityState, 'static');
  assert.equal(offering.lastKnownAvailableCabins, 7);
});

test('CabinOffering.onAvailabilityChange never notifies for a "static" offering', async () => {
  const offering = new CabinOffering('DS', 'DARWIN SUITE', 7);
  let notified = false;
  const unsubscribe = offering.onAvailabilityChange(() => {
    notified = true;
  });

  await offering.getAvailableCabinsAsync();
  unsubscribe();

  assert.equal(notified, false);
});

test('CabinOffering.availabilityState starts "not-fetched" when a live client is wired, before any call', () => {
  const client: ISwotaAvailabilityClient = {
    async getAvailableCabins(): Promise<number | null> {
      return 5;
    },
  };
  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  assert.equal(offering.availabilityState, 'not-fetched');
  assert.equal(offering.lastKnownAvailableCabins, null);
});

test('CabinOffering.availabilityState transitions "not-fetched" -> "loading" synchronously, before the underlying client call settles', () => {
  let resolveClient!: (value: number | null) => void;
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      return new Promise((resolve) => {
        resolveClient = resolve;
      });
    },
  };
  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  // Fire-and-forget, exactly like a TUI kicking off a background fetch.
  void offering.getAvailableCabinsAsync();

  // Synchronously true immediately after the call, with no await in between.
  assert.equal(offering.availabilityState, 'loading');
  assert.equal(offering.lastKnownAvailableCabins, null);

  resolveClient(5); // let the pending promise settle so it doesn't leak into other tests
});

test('CabinOffering.availabilityState transitions "loading" -> "loaded" on success and notifies listeners with the offering', async () => {
  let resolveClient!: (value: number | null) => void;
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      return new Promise((resolve) => {
        resolveClient = resolve;
      });
    },
  };
  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  const notifications: CabinOffering[] = [];
  offering.onAvailabilityChange((o) => notifications.push(o));

  const pending = offering.getAvailableCabinsAsync();
  assert.equal(offering.availabilityState, 'loading');

  resolveClient(5);
  const result = await pending;

  assert.equal(result, 5);
  assert.equal(offering.availabilityState, 'loaded');
  assert.equal(offering.lastKnownAvailableCabins, 5);
  assert.equal(notifications.length, 2, 'expected one notification for "loading", one for "loaded"');
  assert.equal(notifications[0], offering);
  assert.equal(notifications[1], offering);
});

test('CabinOffering.availabilityState transitions "loading" -> "failed" when the live client rejects, and lastKnownAvailableCabins stays null', async () => {
  let rejectClient!: (err: Error) => void;
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      return new Promise((_resolve, reject) => {
        rejectClient = reject;
      });
    },
  };
  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  const states: string[] = [];
  offering.onAvailabilityChange((o) => states.push(o.availabilityState));

  const pending = offering.getAvailableCabinsAsync();
  rejectClient(new Error('SWOTA unavailable'));

  await assert.rejects(() => pending, /SWOTA unavailable/);

  assert.equal(offering.availabilityState, 'failed');
  assert.equal(offering.lastKnownAvailableCabins, null);
  assert.deepEqual(states, ['loading', 'failed']);
});

test('CabinOffering.onAvailabilityChange concurrent first-callers cause exactly one "loading" and one "loaded" notification, not duplicates', async () => {
  let resolveClient!: (value: number | null) => void;
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      return new Promise((resolve) => {
        resolveClient = resolve;
      });
    },
  };
  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  let notifyCount = 0;
  offering.onAvailabilityChange(() => {
    notifyCount += 1;
  });

  const p1 = offering.getAvailableCabinsAsync();
  const p2 = offering.getAvailableCabinsAsync();
  assert.equal(notifyCount, 1, 'only the first caller should trigger the "loading" transition');

  resolveClient(6);
  await Promise.all([p1, p2]);

  assert.equal(notifyCount, 2, 'exactly one "loading" + one "loaded" notification total');
});

test('an offering in the failed state is retried by a later call instead of staying stuck forever', async () => {
  let callCount = 0;
  const client: ISwotaAvailabilityClient = {
    async getAvailableCabins(): Promise<number | null> {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('transient SWOTA failure');
      }
      return 5;
    },
  };

  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  await assert.rejects(() => offering.getAvailableCabinsAsync(), /transient SWOTA failure/);
  assert.equal(offering.availabilityState, 'failed');
  assert.equal(callCount, 1, 'first call should have invoked the client once');

  const result = await offering.getAvailableCabinsAsync();

  assert.equal(callCount, 2, 'a later call on a "failed" offering must re-invoke the client, not stay memoized');
  assert.equal(result, 5);
  assert.equal(offering.availabilityState, 'loaded');
});

// --- synchronous-throw regression --------------------------------------------

test('CabinOffering.getAvailableCabinsAsync: a client that throws SYNCHRONOUSLY still transitions to "failed", notifies listeners, and rejects instead of hanging', async () => {
  // A plain, non-async function with a `throw` statement -- it never returns
  // a Promise at all, as opposed to returning a rejected one. Before the fix,
  // `getAvailableCabinsAsync()` called `this._liveClient.getAvailableCabins(...)`
  // directly and chained `.then()`/`.catch()` off its return value; a
  // synchronous throw here propagated straight out of `getAvailableCabinsAsync()`
  // uncaught, leaving `_availabilityState` permanently stuck at 'loading'
  // (already flipped before the throwing call ran, and 'loading' is not a
  // retryable entry state) -- no `_emitChange()`, no subscriber notification,
  // and no way for a later call to ever retry.
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      throw new Error('boom: synchronous throw, no Promise ever returned');
    },
  };

  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  const states: string[] = [];
  offering.onAvailabilityChange((o) => states.push(o.availabilityState));

  const pending = offering.getAvailableCabinsAsync();

  await assert.rejects(() => pending, /boom: synchronous throw/);

  assert.equal(offering.availabilityState, 'failed');
  assert.deepEqual(states, ['loading', 'failed']);
  assert.equal(offering.lastKnownAvailableCabins, null);

  // The offering must not be stuck: 'failed' is a retryable entry state (per
  // the earlier reentrancy fix), so a later call re-invokes the client
  // instead of hanging or memoizing 'failed' forever -- proving the offering
  // itself, not just a fresh one, recovers.
  const retryPending = offering.getAvailableCabinsAsync();
  await assert.rejects(() => retryPending, /boom: synchronous throw/);
  assert.equal(offering.availabilityState, 'failed');
});

// --- reentrancy / listener-exception regressions ----------------------------

test('CabinOffering.getAvailableCabinsAsync is not reentrant: a "change" listener that calls it again during the "loading" transition must not start a second fetch', async () => {
  let callCount = 0;
  let resolveClient!: (value: number | null) => void;
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      callCount += 1;
      return new Promise((resolve) => {
        resolveClient = resolve;
      });
    },
  };

  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  // Simulates a realistic UI-redraw callback that reacts to a "loading"
  // notification by re-checking/re-triggering availability. Before the fix,
  // this listener would observe `_liveAvailability` still falsy (it was
  // assigned AFTER the 'change' emit), re-enter getAvailableCabinsAsync(),
  // transition to 'loading' again, emit again, and recurse without bound --
  // reproduced by the reviewer as 1048 duplicate client calls followed by a
  // RangeError (stack overflow).
  let reentrantCalls = 0;
  const reentrantPromises: Array<Promise<number | null>> = [];
  offering.onAvailabilityChange(() => {
    if (reentrantCalls < 5) {
      reentrantCalls += 1;
      reentrantPromises.push(offering.getAvailableCabinsAsync());
    }
  });

  const outer = offering.getAvailableCabinsAsync();

  // The listener fired synchronously (during the 'loading' emit) and had
  // every opportunity to recurse -- assert it did NOT start extra fetches
  // before the client call is even allowed to resolve.
  assert.equal(callCount, 1, 'a reentrant call from a synchronous "change" listener must not start a second fetch');
  assert.equal(reentrantCalls, 1, 'sanity check: the listener did fire, so this is a real reentrancy exercise');

  resolveClient(5);
  const [outerResult, ...reentrantResults] = await Promise.all([outer, ...reentrantPromises]);

  assert.equal(outerResult, 5);
  for (const r of reentrantResults) {
    assert.equal(r, 5, 'the reentrant call must resolve to the same, single fetch result');
  }
  assert.equal(callCount, 1, 'expected the underlying client to be invoked exactly once, never recursively');
});

test('CabinOffering.getAvailableCabinsAsync: a "change" listener that throws must not corrupt a successful fetch', async () => {
  let resolveClient!: (value: number | null) => void;
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      return new Promise((resolve) => {
        resolveClient = resolve;
      });
    },
  };

  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  // A real subscriber (e.g. a TUI redraw callback) that misbehaves and
  // throws. Node's EventEmitter re-throws synchronously from emit() when a
  // listener throws (no 'error' handler installed) -- since the 'loaded'
  // transition's emit runs from inside the .then() that resolves
  // _liveAvailability, an unswallowed throw here would be caught by the
  // surrounding .catch() and flip this otherwise-successful fetch to
  // 'failed', rejecting the promise every caller is awaiting.
  offering.onAvailabilityChange(() => {
    throw new Error('listener misbehaved');
  });

  const pending = offering.getAvailableCabinsAsync();
  resolveClient(5);

  const result = await pending;

  assert.equal(result, 5, 'a throwing listener must not change the resolved value of a successful fetch');
  assert.equal(offering.availabilityState, 'loaded', 'a throwing listener must not flip a successful fetch to "failed"');
  assert.equal(offering.lastKnownAvailableCabins, 5);
});

test('CabinOffering.getAvailableCabinsAsync: a "change" listener that throws during "loading" does not prevent the fetch from starting or later succeeding', async () => {
  let callCount = 0;
  let resolveClient!: (value: number | null) => void;
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      callCount += 1;
      return new Promise((resolve) => {
        resolveClient = resolve;
      });
    },
  };

  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);
  offering.onAvailabilityChange(() => {
    throw new Error('listener misbehaved on "loading" too');
  });

  // Must not throw synchronously out of getAvailableCabinsAsync() itself.
  const pending = offering.getAvailableCabinsAsync();
  assert.equal(offering.availabilityState, 'loading');
  assert.equal(callCount, 1);

  resolveClient(5);
  const result = await pending;

  assert.equal(result, 5);
  assert.equal(offering.availabilityState, 'loaded');
});

test('CabinOffering.onAvailabilityChange returns a working unsubscribe function', async () => {
  let resolveClient!: (value: number | null) => void;
  const client: ISwotaAvailabilityClient = {
    getAvailableCabins(): Promise<number | null> {
      return new Promise((resolve) => {
        resolveClient = resolve;
      });
    },
  };
  const offering = new CabinOffering('DS', 'DARWIN SUITE', 999, 'SCABC-260101', client);

  let notifyCount = 0;
  const unsubscribe = offering.onAvailabilityChange(() => {
    notifyCount += 1;
  });

  const pending = offering.getAvailableCabinsAsync();
  assert.equal(notifyCount, 1, 'subscribed before the call, so "loading" is observed');

  unsubscribe();
  resolveClient(5);
  await pending;

  assert.equal(notifyCount, 1, 'unsubscribed before "loaded" fired, so no further notifications');
});
