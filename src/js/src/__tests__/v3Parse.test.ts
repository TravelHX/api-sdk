import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normString,
  stripVoyageId,
  parseNumberWithUnits,
  parseIntStrict,
  parseRate,
  parseDateString,
} from '../loading/v3Parse';

test('parseNumberWithUnits strips thousands separators and unit suffixes', () => {
  assert.equal(parseNumberWithUnits('11,647 t'), 11647);
  assert.equal(parseNumberWithUnits('114 m'), 114);
  assert.equal(parseNumberWithUnits('13 knots'), 13);
  assert.equal(parseNumberWithUnits('200'), 200);
  assert.equal(parseNumberWithUnits('2007'), 2007);
  assert.equal(parseNumberWithUnits('1,234,567 t'), 1234567);
  assert.equal(parseNumberWithUnits(286), 286);
});

test('parseNumberWithUnits returns null for nullish / sentinel / non-numeric', () => {
  assert.equal(parseNumberWithUnits(null), null);
  assert.equal(parseNumberWithUnits(undefined), null);
  assert.equal(parseNumberWithUnits(''), null);
  assert.equal(parseNumberWithUnits('No Mapping'), null);
  assert.equal(parseNumberWithUnits('knots'), null);
  assert.equal(parseNumberWithUnits('NaT'), null);
});

test('string -> number for passengerCapacity / yearOfConstruction', () => {
  // These arrive as strings in the prod feed and must become numbers.
  assert.strictEqual(parseNumberWithUnits('200'), 200);
  assert.strictEqual(parseNumberWithUnits('2007'), 2007);
  assert.equal(typeof parseNumberWithUnits('200'), 'number');
});

test('parseIntStrict parses integers only, nulls decimals / sentinels', () => {
  // Mirrors .NET ParseInt (int.TryParse semantics).
  assert.equal(parseIntStrict('200'), 200);
  assert.equal(parseIntStrict('2007'), 2007);
  assert.equal(parseIntStrict('200.5'), null);
  assert.equal(parseIntStrict('No Mapping'), null);
});

test('normString maps null sentinels and empties to null', () => {
  assert.equal(normString('No Mapping'), null);
  assert.equal(normString('No Market'), null);
  assert.equal(normString('NaT'), null);
  assert.equal(normString(''), null);
  assert.equal(normString('   '), null);
  assert.equal(normString(null), null);
  assert.equal(normString(undefined), null);
  assert.equal(normString('  Alaska  '), 'Alaska');
  assert.equal(normString('USOME'), 'USOME');
});

test('parseRate parses embedded rate strings, nulls sentinels', () => {
  assert.equal(parseRate('38995.00'), 38995);
  assert.equal(parseRate('90.5'), 90.5);
  assert.equal(parseRate(null), null);
  assert.equal(parseRate(undefined), null);
  assert.equal(parseRate('No Market'), null);
  assert.equal(parseRate('NaT'), null);
  assert.equal(parseRate(''), null);
  assert.equal(parseRate('abc'), null);
});

test('parseDateString handles ISO datetime, date-only, garbage', () => {
  assert.equal(parseDateString('2026-09-07T22:00:00'), '2026-09-07');
  assert.equal(parseDateString('2026-09-06'), '2026-09-06');
  assert.equal(parseDateString('2026-09-06 12:00:00'), '2026-09-06');
  assert.equal(parseDateString('NaT'), null);
  assert.equal(parseDateString('No Mapping'), null);
  assert.equal(parseDateString('not a date'), null);
  assert.equal(parseDateString(''), null);
  assert.equal(parseDateString(null), null);
  assert.equal(parseDateString(undefined), null);
});

test('stripVoyageId strips the "_@" prefix exactly like dev TourCode', () => {
  assert.equal(stripVoyageId('_@FNALA04-260906'), 'FNALA04-260906');
  assert.equal(stripVoyageId('FNALA04-260906'), 'FNALA04-260906');
  assert.equal(stripVoyageId('_@_@X'), '_@X'); // only the leading prefix
  assert.equal(stripVoyageId(null), '');
  assert.equal(stripVoyageId(undefined), '');
});
