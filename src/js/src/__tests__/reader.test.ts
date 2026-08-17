import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { existsSync } from 'node:fs';

import { createApiSdk } from '../api-sdk';
import { FlatFileReader } from '../FlatFileReader';
import { InvalidFilePathError, FileNotFoundError } from '../errors/FileReadingErrors';

/**
 * Real-filesystem checks for the flat-file reader (folded in from the former
 * utils/js/index.js validator). Unlike sdk.test.ts (which drives the SDK with a
 * fake reader), these exercise the concrete FlatFileReader against the sample
 * data and the real error classes.
 *
 * Resolved from the compiled location dist/__tests__ up to the repo root.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data', 'flatfiles_dev', 'RefData');
const VOYAGES = path.join(DATA_DIR, 'voyages.json');

// The dev sample data is intentionally NOT tracked in git (same treatment as
// data/flatfiles_prod/): real fixtures live outside the repo and are only
// present on a machine/image that was given them out-of-band. These two
// tests are skipped (not failed) when the fixture is absent, mirroring the
// fixture-presence gate already used by the .NET V3 fixture integration test
// (Skip.IfNot in V3FixtureIntegrationTests.cs).
const hasFixture = existsSync(VOYAGES);

test('createApiSdk returns a dormant instance', () => {
  const sdk = createApiSdk();
  assert.ok(sdk);
  assert.equal(sdk.isLoaded, false);
});

test('reader reads a real file', { skip: !hasFixture && `sample data missing: ${VOYAGES}` }, async () => {
  const reader = new FlatFileReader();
  const content = await reader.readFile(VOYAGES);
  assert.ok(content.trim().length > 0);
});

test('reader deserializes JSON into a non-empty array', { skip: !hasFixture && `sample data missing: ${VOYAGES}` }, async () => {
  const reader = new FlatFileReader();
  const voyages = await reader.readFileAsJson<unknown[]>(VOYAGES);
  assert.ok(Array.isArray(voyages));
  assert.ok(voyages.length > 0);
});

test('reader throws InvalidFilePathError for a poisoned path', async () => {
  const reader = new FlatFileReader();
  await assert.rejects(
    () => reader.readFile('\0invalid\0path.json'),
    (e) => e instanceof InvalidFilePathError
  );
});

test('reader throws FileNotFoundError for a missing file', async () => {
  const reader = new FlatFileReader();
  await assert.rejects(
    () => reader.readFile(path.join(DATA_DIR, 'definitely_missing_file.json')),
    (e) => e instanceof FileNotFoundError
  );
});

test('validatePath accepts a valid path and rejects bad ones', () => {
  const reader = new FlatFileReader();
  assert.equal(reader.validatePath(VOYAGES), true);
  assert.equal(reader.validatePath('\0bad\0.json'), false);
  assert.equal(reader.validatePath(''), false);
  assert.equal(reader.validatePath(null as unknown as string), false);
});
