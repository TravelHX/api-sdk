import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApiSdk } from '../api-sdk';
import type { IFlatFileReader } from '../interfaces/IFlatFileReader';
import type { DataSources } from '../interfaces/IApiSdk';

/**
 * A fake IFlatFileReader that serves canned JSON keyed by file name. This is
 * the whole point of the interface abstraction: the SDK can be exercised with
 * zero filesystem access by swapping the reader implementation.
 */
class FakeReader implements IFlatFileReader {
  constructor(private readonly files: Record<string, unknown>) {}

  private resolve(filePath: string): unknown {
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
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

const SOURCES: DataSources = {
  format: 'v1',
  voyages: 'voyages.json',
  ships: 'ships.json',
  cabinGrades: 'cabingrades.json',
  ports: 'portlist.json',
  sourceMarkets: ['SourceMarket_GBP.json'],
};

function buildFiles(): Record<string, unknown> {
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
        travelSuggestionCodes: ['SCABC-260101', 'SCABC-250101'], // one upcoming, one past
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

test('SDK loads through the reader interface and reports stats', async () => {
  const sdk = createApiSdk(new FakeReader(buildFiles()));
  assert.equal(sdk.isLoaded, false);
  await sdk.load(SOURCES);
  assert.equal(sdk.isLoaded, true);
  assert.equal(sdk.stats.voyageCount, 1);
  assert.equal(sdk.stats.shipCount, 1);
  assert.equal(sdk.stats.departureCount, 2);
  assert.equal(sdk.stats.offeringCount, 1);
});

test('forward traversal: voyage -> departure -> ship -> cabin grades', async () => {
  const sdk = await createApiSdk(new FakeReader(buildFiles())).load(SOURCES);
  const voyage = sdk.voyages[0];
  const departure = sdk.departure('SCABC-260101');
  assert.ok(departure);
  assert.equal(departure.voyage, voyage);
  assert.equal(departure.ship?.id, 'SC');
  assert.equal(departure.shipCode, 'SC');
  assert.deepEqual(departure.cabinGrades.map((g) => g.code), ['DS']);
});

test('offering carries description (resolved per ship) and prices', async () => {
  const sdk = await createApiSdk(new FakeReader(buildFiles())).load(SOURCES);
  const offering = sdk.departure('SCABC-260101')?.offeringForGrade('DS');
  assert.ok(offering);
  assert.equal(offering.name, 'SUITE');
  assert.equal(offering.availableCabins, 3);
  assert.deepEqual(offering.description, ['Darwin Suite desc']);
  assert.equal(offering.priceFor('GBP')?.double, 90);
  assert.equal(offering.priceFor('GBP')?.single, 100);
});

test('reverse traversal: cabinGrade & ship navigate back to the voyage', async () => {
  const sdk = await createApiSdk(new FakeReader(buildFiles())).load(SOURCES);
  const voyage = sdk.voyages[0];
  const grade = sdk.cabinGrade('DS');
  assert.ok(grade);
  assert.equal(grade.departures[0].voyage, voyage);
  assert.deepEqual(grade.ships.map((s) => s.id), ['SC']);
  assert.equal(sdk.ship('SC')?.voyages[0], voyage);
});

test('upcomingDepartures filters out past departures', async () => {
  const sdk = await createApiSdk(new FakeReader(buildFiles())).load(SOURCES);
  // asOf sits between the two departures (2025-01-01 past, 2026-01-01 upcoming)
  const upcoming = sdk.voyages[0].upcomingDepartures('2025-12-01');
  assert.deepEqual(upcoming.map((d) => d.code), ['SCABC-260101']);
});
