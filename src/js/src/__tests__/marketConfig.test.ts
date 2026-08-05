import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';

import {
  resolveMarket,
  resolveLocale,
  resolveMarketDataSources,
  resolveMarketDataSourcesV3,
  DATASOURCE_MARKET_ENV,
  DATASOURCE_LOCALE_ENV,
} from '../loading/marketConfig';

const BASE_DIR = path.join('data', 'flatfiles_dev', 'flatfiles_dev', 'RefData');
const BASE_DIR_V3 = path.join('data', 'flatfiles_prod', 'flatfiles_prod');

// --- resolveMarketDataSources -----------------------------------------------

test('single-locale market (UK) defaults locale when none is given', () => {
  const result = resolveMarketDataSources('UK', undefined, BASE_DIR);
  assert.equal(result.voyages, path.join(BASE_DIR, 'voyages_uk.json'));
  assert.equal(result.ships, path.join(BASE_DIR, 'ships_uk.json'));
  assert.deepEqual(result.sourceMarkets, [path.join(BASE_DIR, 'SourceMarket_GBP_seaware.json')]);
});

test('single-locale market (USA) defaults locale when none is given', () => {
  const result = resolveMarketDataSources('USA', undefined, BASE_DIR);
  assert.equal(result.voyages, path.join(BASE_DIR, 'voyages_us.json'));
  assert.equal(result.ships, path.join(BASE_DIR, 'ships_us.json'));
  assert.deepEqual(result.sourceMarkets, [path.join(BASE_DIR, 'SourceMarket_USD_seaware.json')]);
});

test('multi-locale market (EU) without a locale throws', () => {
  assert.throws(
    () => resolveMarketDataSources('EU', undefined, BASE_DIR),
    /requires an explicit locale/
  );
});

test('multi-locale market (Nordic) with a blank locale throws', () => {
  assert.throws(() => resolveMarketDataSources('Nordic', '  ', BASE_DIR), /requires an explicit locale/);
});

test('multi-locale market (EU) with an invalid locale throws', () => {
  assert.throws(
    () => resolveMarketDataSources('EU', 'us', BASE_DIR),
    /is not valid for market "EU"/
  );
});

test('single-locale market (Australia) with a mismatched locale throws', () => {
  assert.throws(
    () => resolveMarketDataSources('Australia', 'de', BASE_DIR),
    /is not valid for market "Australia"/
  );
});

test('resolves correct paths/currency for EU + fr', () => {
  const result = resolveMarketDataSources('EU', 'fr', BASE_DIR);
  assert.equal(result.voyages, path.join(BASE_DIR, 'voyages_fr.json'));
  assert.equal(result.ships, path.join(BASE_DIR, 'ships_fr.json'));
  assert.deepEqual(result.sourceMarkets, [path.join(BASE_DIR, 'SourceMarket_EUR_seaware.json')]);
});

test('resolves correct paths/currency for Nordic + se', () => {
  const result = resolveMarketDataSources('Nordic', 'se', BASE_DIR);
  assert.equal(result.voyages, path.join(BASE_DIR, 'voyages_se.json'));
  assert.equal(result.ships, path.join(BASE_DIR, 'ships_se.json'));
  assert.deepEqual(result.sourceMarkets, [path.join(BASE_DIR, 'SourceMarket_SEK_seaware.json')]);
});

test('resolves correct paths/currency for Nordic + no (Norway), locale is case-insensitive', () => {
  const result = resolveMarketDataSources('Nordic', 'NO', BASE_DIR);
  assert.equal(result.voyages, path.join(BASE_DIR, 'voyages_no.json'));
  assert.equal(result.ships, path.join(BASE_DIR, 'ships_no.json'));
  assert.deepEqual(result.sourceMarkets, [path.join(BASE_DIR, 'SourceMarket_NOK_seaware.json')]);
});

test('resolves correct paths/currency for Australia (default locale)', () => {
  const result = resolveMarketDataSources('Australia', undefined, BASE_DIR);
  assert.equal(result.voyages, path.join(BASE_DIR, 'voyages_au.json'));
  assert.equal(result.ships, path.join(BASE_DIR, 'ships_au.json'));
  assert.deepEqual(result.sourceMarkets, [path.join(BASE_DIR, 'SourceMarket_AUD_seaware.json')]);
});

// --- resolveMarket -----------------------------------------------------------

test('resolveMarket throws when DATASOURCE_MARKET is unset', () => {
  assert.throws(() => resolveMarket({}), new RegExp(`${DATASOURCE_MARKET_ENV} is not set`));
});

test('resolveMarket throws when DATASOURCE_MARKET is blank', () => {
  assert.throws(() => resolveMarket({ [DATASOURCE_MARKET_ENV]: '   ' }), /is not set/);
});

test('resolveMarket throws on an unrecognized value', () => {
  assert.throws(
    () => resolveMarket({ [DATASOURCE_MARKET_ENV]: 'Mars' }),
    /unrecognized value "Mars"/
  );
});

test('resolveMarket accepts a recognized value case-insensitively', () => {
  assert.equal(resolveMarket({ [DATASOURCE_MARKET_ENV]: 'eu' }), 'EU');
  assert.equal(resolveMarket({ [DATASOURCE_MARKET_ENV]: 'NORDIC' }), 'Nordic');
  assert.equal(resolveMarket({ [DATASOURCE_MARKET_ENV]: 'Australia' }), 'Australia');
});

// --- resolveLocale -------------------------------------------------------------

test('resolveLocale returns undefined when DATASOURCE_LOCALE is unset (no throw)', () => {
  assert.equal(resolveLocale({}), undefined);
});

test('resolveLocale returns undefined when DATASOURCE_LOCALE is blank', () => {
  assert.equal(resolveLocale({ [DATASOURCE_LOCALE_ENV]: ' ' }), undefined);
});

test('resolveLocale trims and lower-cases the value', () => {
  assert.equal(resolveLocale({ [DATASOURCE_LOCALE_ENV]: '  DE ' }), 'de');
});

// --- resolveMarketDataSourcesV3 (prod) ---------------------------------------
//
// Separate table/resolver from V1 above: uppercase country codes, no
// `_seaware` suffix, no sourceMarkets/currency concept, and a different
// business grouping (CA under USA, CH under EU) that has no V1 equivalent.

test('single-locale market (UK/GB) defaults locale when none is given', () => {
  const result = resolveMarketDataSourcesV3('UK', undefined, BASE_DIR_V3);
  assert.equal(result.voyages, path.join(BASE_DIR_V3, 'voyages_GB.json'));
  assert.equal(result.ships, path.join(BASE_DIR_V3, 'ships_GB.json'));
});

test('single-locale market (Australia/AU) defaults locale when none is given', () => {
  const result = resolveMarketDataSourcesV3('Australia', undefined, BASE_DIR_V3);
  assert.equal(result.voyages, path.join(BASE_DIR_V3, 'voyages_AU.json'));
  assert.equal(result.ships, path.join(BASE_DIR_V3, 'ships_AU.json'));
});

test('V3: multi-locale market (EU) without a locale throws', () => {
  assert.throws(
    () => resolveMarketDataSourcesV3('EU', undefined, BASE_DIR_V3),
    /requires an explicit locale/
  );
});

test('V3: multi-locale market (USA) with a blank locale throws', () => {
  assert.throws(
    () => resolveMarketDataSourcesV3('USA', '  ', BASE_DIR_V3),
    /requires an explicit locale/
  );
});

test('V3: multi-locale market (EU) with an invalid locale throws', () => {
  assert.throws(
    () => resolveMarketDataSourcesV3('EU', 'US', BASE_DIR_V3),
    /is not valid for market "EU"/
  );
});

test('V3: single-locale market (UK) with a mismatched locale throws', () => {
  assert.throws(
    () => resolveMarketDataSourcesV3('UK', 'DE', BASE_DIR_V3),
    /is not valid for market "UK"/
  );
});

test('V3: resolves DE/FR/DK/CH under EU', () => {
  for (const [locale, code] of [
    ['DE', 'DE'],
    ['FR', 'FR'],
    ['DK', 'DK'],
    ['CH', 'CH'],
  ] as const) {
    const result = resolveMarketDataSourcesV3('EU', locale, BASE_DIR_V3);
    assert.equal(result.voyages, path.join(BASE_DIR_V3, `voyages_${code}.json`));
    assert.equal(result.ships, path.join(BASE_DIR_V3, `ships_${code}.json`));
  }
});

test('V3: resolves US/CA under USA', () => {
  const us = resolveMarketDataSourcesV3('USA', 'US', BASE_DIR_V3);
  assert.equal(us.voyages, path.join(BASE_DIR_V3, 'voyages_US.json'));
  assert.equal(us.ships, path.join(BASE_DIR_V3, 'ships_US.json'));

  const ca = resolveMarketDataSourcesV3('USA', 'CA', BASE_DIR_V3);
  assert.equal(ca.voyages, path.join(BASE_DIR_V3, 'voyages_CA.json'));
  assert.equal(ca.ships, path.join(BASE_DIR_V3, 'ships_CA.json'));
});

test('V3: resolves SE/NO under Nordic', () => {
  const se = resolveMarketDataSourcesV3('Nordic', 'SE', BASE_DIR_V3);
  assert.equal(se.voyages, path.join(BASE_DIR_V3, 'voyages_SE.json'));
  assert.equal(se.ships, path.join(BASE_DIR_V3, 'ships_SE.json'));

  const no = resolveMarketDataSourcesV3('Nordic', 'NO', BASE_DIR_V3);
  assert.equal(no.voyages, path.join(BASE_DIR_V3, 'voyages_NO.json'));
  assert.equal(no.ships, path.join(BASE_DIR_V3, 'ships_NO.json'));
});

test('V3: locale is matched case-insensitively but resolves to the upper-case on-disk code', () => {
  const result = resolveMarketDataSourcesV3('EU', 'ch', BASE_DIR_V3);
  assert.equal(result.voyages, path.join(BASE_DIR_V3, 'voyages_CH.json'));
  assert.equal(result.ships, path.join(BASE_DIR_V3, 'ships_CH.json'));
});

test('V3: does not return sourceMarkets/currency (no such concept in prod)', () => {
  const result = resolveMarketDataSourcesV3('UK', undefined, BASE_DIR_V3);
  assert.deepEqual(Object.keys(result).sort(), ['ships', 'voyages']);
});
