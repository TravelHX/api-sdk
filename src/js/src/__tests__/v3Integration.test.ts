import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { createApiSdk } from '../api-sdk';
import type { DataSources } from '../interfaces/IApiSdk';

/**
 * Integration test against real prod fixtures for ONE country (AU). It is GATED:
 * it runs only when PROD_FIXTURE_DIR points at a valid prod-flatfiles directory
 * (containing the expected files) and SKIPS otherwise, so the suite stays green
 * on machines without the fixtures.
 *
 * Like .NET and the dev path, the prod loader reads SINGLE files from the
 * existing DataSources path fields (ships/voyages/ports) — one country per load.
 */
const PROD_DIR = process.env.PROD_FIXTURE_DIR ?? '';
const COUNTRY = 'AU';
const fixturesPresent =
  PROD_DIR.length > 0 &&
  fs.existsSync(PROD_DIR) &&
  fs.existsSync(path.join(PROD_DIR, 'ports.json')) &&
  fs.existsSync(path.join(PROD_DIR, `ships_${COUNTRY}.json`)) &&
  fs.existsSync(path.join(PROD_DIR, `voyages_${COUNTRY}.json`));

test(
  'prod loader builds the .NET-equivalent AU graph from real fixtures',
  {
    skip: !fixturesPresent
      ? 'PROD_FIXTURE_DIR is unset or the prod fixtures directory is absent'
      : false,
  },
  async () => {
    const sources: DataSources = {
      format: 'v3',
      ports: path.join(PROD_DIR, 'ports.json'),
      ships: path.join(PROD_DIR, `ships_${COUNTRY}.json`),
      voyages: path.join(PROD_DIR, `voyages_${COUNTRY}.json`),
      // Dev-only fields are ignored by the prod loader.
      cabinGrades: '',
      sourceMarkets: [],
    };

    const sdk = await createApiSdk().load(sources);

    assert.equal(sdk.isLoaded, true);
    assert.ok(sdk.stats.shipCount > 0, 'expected ships');
    assert.ok(sdk.stats.voyageCount > 0, 'expected voyages');
    assert.ok(sdk.stats.departureCount > 0, 'expected departures');
    assert.ok(sdk.stats.offeringCount > 0, 'expected cabin offerings');
    assert.ok(sdk.stats.portCount > 0, 'expected ports');

    // Prod has no separate cabin-grade reference: collection stays empty.
    assert.equal(sdk.stats.cabinGradeCount, 0);

    // Spot-check a wired voyage: heading set, single departure, priced offerings.
    const voyage = sdk.voyages.find((v) => v.departures.length > 0);
    assert.ok(voyage, 'expected at least one voyage with a departure');
    const dep = voyage.departures[0];
    assert.ok(dep.code.length > 0);
    assert.equal(dep.code.startsWith('_@'), false, 'VoyageID prefix must be stripped');

    // At least one offering should carry a numeric rate in the voyage currency.
    const offering = sdk.offerings.find((o) => o.prices.length > 0);
    assert.ok(offering, 'expected an offering with at least one price');

    // Offering shape must mirror .NET arg-for-arg: name = RateCode (a non-empty
    // human label) and availableCabins = MaxOccupancy.
    const named = sdk.offerings.find((o) => o.name.length > 0);
    assert.ok(named, 'expected an offering whose name (RateCode) is non-empty');
    const withCabins = sdk.offerings.find((o) => o.availableCabins !== null);
    assert.ok(
      withCabins,
      'expected an offering whose availableCabins (MaxOccupancy) is populated'
    );
  }
);
