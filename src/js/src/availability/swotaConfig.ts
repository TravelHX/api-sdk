import fs from 'fs';
import path from 'path';

/**
 * Config shape consumed by {@link SwotaAvailabilityClient}, mirroring the
 * `"SwOTA"` section of config.json / config.local.json verbatim (same key
 * casing as the JSON) so the loader below needs no field renaming.
 */
export interface SwotaAuth0Config {
  TokenUrl: string;
  ClientId: string;
  ClientSecret: string;
  Audience: string;
}

export interface SwotaPointOfSaleConfig {
  RequestorIdType: string;
  RequestorIdContext: string;
  RequestorId: string;
  BookingChannelType: string;
  BookingChannelCompanyName: string;
}

export interface SwotaConfig {
  /** Always normalized to end with a trailing slash — see {@link normalizeRestBaseUrl}. */
  RestBaseUrl: string;
  Auth0: SwotaAuth0Config;
  PointOfSale: SwotaPointOfSaleConfig;
  DefaultFareCode: string;
  DefaultGuestQty: number;
}

const CONFIG_FILE_NAME = 'config.json';
const LOCAL_CONFIG_FILE_NAME = 'config.local.json';
const MAX_UPWARD_SEARCH_DEPTH = 12;
// A path that only exists at THIS repo's root, checked alongside config.json
// so the walk-up below can't accidentally bind to an unrelated ancestor
// project's own config.json (e.g. if this package is ever installed as a
// dependency inside another project's node_modules and some ancestor
// directory of that project happens to have its own top-level config.json —
// a common filename). utils/js/SDKCLI.js is this same repo's CLI entry
// point, so requiring both together is a much stronger repo-identity check
// than config.json's presence alone, without needing a bigger redesign
// (e.g. an explicit override-path parameter).
const REPO_MARKER_RELATIVE_PATH = path.join('utils', 'js', 'SDKCLI.js');

/**
 * Walks up from {@link startDir} looking for the repo root, identified by the
 * presence of both the checked-in config.json AND
 * {@link REPO_MARKER_RELATIVE_PATH} (same config.json marker
 * utils/js/SDKCLI.js's loadConfig() reads, plus that same file's own
 * existence as a second check). Needed because this module runs from
 * compiled output (dist/availability/...) whose depth below the repo root
 * isn't guaranteed.
 */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < MAX_UPWARD_SEARCH_DEPTH; i++) {
    if (
      fs.existsSync(path.join(dir, CONFIG_FILE_NAME)) &&
      fs.existsSync(path.join(dir, REPO_MARKER_RELATIVE_PATH))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate the repo root (a directory containing both "${CONFIG_FILE_NAME}" and ` +
      `"${REPO_MARKER_RELATIVE_PATH}") walking up from "${startDir}".`
  );
}

/**
 * Reads and JSON-parses a file, returning `undefined` if it doesn't exist.
 * Also treats EISDIR as "doesn't exist": on some Docker setups, bind-mounting
 * a nonexistent host file path creates an empty directory at that path inside
 * the container instead of failing the mount, which would otherwise surface
 * here as a confusing crash instead of the intended "file absent" fallback
 * (see docker-compose.yml's config.local.json mount comment).
 */
function readJsonIfExists(filePath: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR') return undefined;
    throw new Error(`Failed to read ${filePath}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Deliberately NOT including the underlying SyntaxError's message: V8's
    // JSON parse errors can echo a snippet of the surrounding raw text, and
    // this file's most sensitive field (Auth0.ClientSecret) is exactly the
    // kind of value that could land inside that snippet if the secret itself
    // contains the malformed character. Keep the failure diagnosable (which
    // file, that it's a syntax error) without risking a secret fragment in
    // stderr/logs.
    throw new Error(`Failed to parse ${filePath}: invalid JSON.`);
  }
}

/** Narrows `value` to a plain (non-array, non-null) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges `local` over `base`, one level deep: object-valued keys present in
 * both (e.g. `Auth0`, `PointOfSale`) are merged key-by-key rather than one
 * wholesale replacing the other, so a `config.local.json` that overrides only
 * `SwOTA.Auth0.ClientSecret` doesn't silently drop `TokenUrl`/`ClientId`/
 * `Audience` from the base config. Scalar/array-valued keys still take
 * `local`'s value outright when present, matching a plain shallow override.
 */
function deepMergeSwotaSection(
  base: Record<string, unknown>,
  local: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base, ...local };
  for (const key of Object.keys(merged)) {
    const baseValue = base[key];
    const localValue = local[key];
    if (isPlainObject(baseValue) && isPlainObject(localValue)) {
      merged[key] = { ...baseValue, ...localValue };
    }
  }
  return merged;
}

function requireString(obj: Record<string, unknown>, key: string, context: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`SwOTA config: expected a non-empty string at "${context}.${key}".`);
  }
  return value;
}

function requireNumber(obj: Record<string, unknown>, key: string, context: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`SwOTA config: expected a number at "${context}.${key}".`);
  }
  return value;
}

/**
 * Normalizes `RestBaseUrl` to always end with a trailing slash, so callers
 * (see `SwotaAvailabilityClient.postCabinAvail`) can safely concatenate a
 * message name (e.g. `OTA_CruiseCabinAvailRQ`) directly onto it without
 * producing a malformed URL like `.../ota/restOTA_CruiseCabinAvailRQ`.
 * Matches `SwOTARestConfig.Bind`'s `restBaseUrl.EndsWith('/') ? restBaseUrl
 * : restBaseUrl + "/"` exactly (append if missing, never double it up).
 */
function normalizeRestBaseUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function requireObject(
  obj: Record<string, unknown>,
  key: string,
  context: string
): Record<string, unknown> {
  const value = obj[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`SwOTA config: expected an object at "${context}.${key}".`);
  }
  return value as Record<string, unknown>;
}

/** Validates and narrows a merged raw SwOTA config object into {@link SwotaConfig}. */
export function validateSwotaConfig(raw: Record<string, unknown>): SwotaConfig {
  const auth0Raw = requireObject(raw, 'Auth0', 'SwOTA');
  const posRaw = requireObject(raw, 'PointOfSale', 'SwOTA');

  return {
    RestBaseUrl: normalizeRestBaseUrl(requireString(raw, 'RestBaseUrl', 'SwOTA')),
    Auth0: {
      TokenUrl: requireString(auth0Raw, 'TokenUrl', 'SwOTA.Auth0'),
      ClientId: requireString(auth0Raw, 'ClientId', 'SwOTA.Auth0'),
      ClientSecret: requireString(auth0Raw, 'ClientSecret', 'SwOTA.Auth0'),
      Audience: requireString(auth0Raw, 'Audience', 'SwOTA.Auth0'),
    },
    PointOfSale: {
      RequestorIdType: requireString(posRaw, 'RequestorIdType', 'SwOTA.PointOfSale'),
      RequestorIdContext: requireString(posRaw, 'RequestorIdContext', 'SwOTA.PointOfSale'),
      RequestorId: requireString(posRaw, 'RequestorId', 'SwOTA.PointOfSale'),
      BookingChannelType: requireString(posRaw, 'BookingChannelType', 'SwOTA.PointOfSale'),
      BookingChannelCompanyName: requireString(
        posRaw,
        'BookingChannelCompanyName',
        'SwOTA.PointOfSale'
      ),
    },
    DefaultFareCode: requireString(raw, 'DefaultFareCode', 'SwOTA'),
    DefaultGuestQty: requireNumber(raw, 'DefaultGuestQty', 'SwOTA'),
  };
}

/**
 * Loads the `"SwOTA"` configuration section from the repo root: config.json
 * (checked-in) with config.local.json (gitignored, real credentials) merged
 * on top as an optional override — matching the layering convention
 * config.local.json / appsettings.local.json already use elsewhere in this
 * repo (see .gitignore). Only the "SwOTA" key is read from either file.
 *
 * The merge is one level deep (see {@link deepMergeSwotaSection}): overriding
 * just `Auth0.ClientSecret` in config.local.json keeps `Auth0.TokenUrl`/
 * `ClientId`/`Audience` from config.json rather than dropping them, matching
 * the per-leaf-key merge .NET's `ConfigurationBuilder` performs over the same
 * file pair (see `BuildConfiguration()` in
 * utils/dotnet/ApiSdk.SDKCLI/Program.cs) so both SDKs behave the same way
 * against identical config files.
 *
 * @param startDir Directory to start the upward repo-root search from
 *   (defaults to this module's directory; overridable for tests).
 * @throws {Error} if the repo root can't be located, neither file defines a
 *   "SwOTA" section, or required fields are missing/malformed.
 */
export function loadSwotaConfig(startDir: string = __dirname): SwotaConfig {
  const repoRoot = findRepoRoot(startDir);
  const base = readJsonIfExists(path.join(repoRoot, CONFIG_FILE_NAME));
  const local = readJsonIfExists(path.join(repoRoot, LOCAL_CONFIG_FILE_NAME));

  const baseSwota = (base?.SwOTA as Record<string, unknown> | undefined) ?? {};
  const localSwota = (local?.SwOTA as Record<string, unknown> | undefined) ?? {};
  const merged = deepMergeSwotaSection(baseSwota, localSwota);

  if (Object.keys(merged).length === 0) {
    throw new Error(
      `No "SwOTA" configuration section found in config.json or config.local.json under "${repoRoot}". ` +
        'SwotaAvailabilityClient requires RestBaseUrl, Auth0, PointOfSale, DefaultFareCode and DefaultGuestQty ' +
        '(typically supplied via the gitignored config.local.json).'
    );
  }

  return validateSwotaConfig(merged);
}
