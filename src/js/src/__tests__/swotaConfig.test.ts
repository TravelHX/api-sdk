import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadSwotaConfig, validateSwotaConfig } from '../availability/swotaConfig';

const BASE_AUTH0 = {
  TokenUrl: 'https://auth0.example.com/oauth/token',
  ClientId: 'base-client-id',
  ClientSecret: 'base-secret',
  Audience: 'https://partner.example.com/api',
};

const BASE_POS = {
  RequestorIdType: '5',
  RequestorIdContext: 'SEAWARE',
  RequestorId: '0000',
  BookingChannelType: '1',
  BookingChannelCompanyName: 'INT-AGENT',
};

const BASE_SWOTA = {
  RestBaseUrl: 'https://swota.example.com/ota/rest/',
  Auth0: BASE_AUTH0,
  PointOfSale: BASE_POS,
  DefaultFareCode: 'BESTPRICE',
  DefaultGuestQty: 2,
};

/**
 * Builds a throwaway fake repo root: config.json (+ optional config.local.json)
 * plus the utils/js/SDKCLI.js marker file findRepoRoot() also requires, so
 * loadSwotaConfig()'s upward walk from a nested "compiled output" directory
 * resolves to this fixture instead of walking further up into the real repo.
 * Returns the directory loadSwotaConfig() should be pointed at (a nested
 * subdirectory, mirroring dist/availability/... below the real repo root).
 */
function makeFakeRepoRoot(base: unknown, local?: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swota-config-test-'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ SwOTA: base }));
  if (local !== undefined) {
    const localContent =
      typeof local === 'string' ? local : JSON.stringify({ SwOTA: local });
    fs.writeFileSync(path.join(root, 'config.local.json'), localContent);
  }
  const markerDir = path.join(root, 'utils', 'js');
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(markerDir, 'SDKCLI.js'), '// marker\n');

  const startDir = path.join(root, 'dist', 'availability');
  fs.mkdirSync(startDir, { recursive: true });
  return startDir;
}

test('config.local.json overriding only Auth0.ClientSecret still merges the rest of Auth0 (and all of PointOfSale) from config.json', () => {
  const startDir = makeFakeRepoRoot(BASE_SWOTA, {
    Auth0: { ClientSecret: 'local-only-secret' },
  });

  const config = loadSwotaConfig(startDir);

  assert.equal(config.Auth0.ClientSecret, 'local-only-secret', 'local override should win');
  assert.equal(config.Auth0.TokenUrl, BASE_AUTH0.TokenUrl, 'base TokenUrl must survive the merge');
  assert.equal(config.Auth0.ClientId, BASE_AUTH0.ClientId, 'base ClientId must survive the merge');
  assert.equal(config.Auth0.Audience, BASE_AUTH0.Audience, 'base Audience must survive the merge');
  assert.deepEqual(config.PointOfSale, BASE_POS, 'untouched PointOfSale section should come from base');
  assert.equal(config.RestBaseUrl, BASE_SWOTA.RestBaseUrl);
});

test('config.local.json can override a whole nested section while other sections still come from config.json', () => {
  const localPos = { ...BASE_POS, RequestorId: '9999' };
  const startDir = makeFakeRepoRoot(BASE_SWOTA, { PointOfSale: localPos });

  const config = loadSwotaConfig(startDir);

  assert.deepEqual(config.PointOfSale, localPos);
  assert.deepEqual(config.Auth0, BASE_AUTH0, 'untouched Auth0 section should come from base');
});

test('no config.local.json falls back entirely to config.json', () => {
  const startDir = makeFakeRepoRoot(BASE_SWOTA);
  const config = loadSwotaConfig(startDir);
  assert.deepEqual(config.Auth0, BASE_AUTH0);
  assert.deepEqual(config.PointOfSale, BASE_POS);
});

// --- RestBaseUrl trailing-slash normalization -------------------------------
//
// Mirrors .NET's SwOTARestConfig.Bind: `restBaseUrl.EndsWith('/') ?
// restBaseUrl : restBaseUrl + "/"`. Without this, a config value like
// "https://swota.example.com/ota/rest" (no trailing slash) would
// silently produce a malformed URL ("...ota/restOTA_CruiseCabinAvailRQ")
// only on the JS side once SwotaAvailabilityClient concatenates the message
// name onto it.

test('a RestBaseUrl missing a trailing slash gets one appended', () => {
  const config = validateSwotaConfig({ ...BASE_SWOTA, RestBaseUrl: 'https://swota.example.com/ota/rest' });
  assert.equal(config.RestBaseUrl, 'https://swota.example.com/ota/rest/');
});

test('a RestBaseUrl that already ends with a slash is left as-is (not doubled up)', () => {
  const config = validateSwotaConfig({ ...BASE_SWOTA, RestBaseUrl: 'https://swota.example.com/ota/rest/' });
  assert.equal(config.RestBaseUrl, 'https://swota.example.com/ota/rest/');
});

test('a malformed config.local.json throws a sanitized error, never the raw JSON parse error text', () => {
  // Deliberately malformed near a value that looks like a secret, to
  // reproduce the scenario V8's JSON.parse error messages could otherwise
  // leak a fragment of: an unescaped quote inside the "secret" text.
  const malformed = '{"SwOTA": {"Auth0": {"ClientSecret": "abc"def"}}}';
  const startDir = makeFakeRepoRoot(BASE_SWOTA, malformed);

  assert.throws(
    () => loadSwotaConfig(startDir),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /invalid JSON/i);
      assert.doesNotMatch(err.message, /abc/);
      assert.doesNotMatch(err.message, /Unexpected/); // no raw V8 SyntaxError text
      return true;
    }
  );
});
