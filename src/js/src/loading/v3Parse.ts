/**
 * Pure normalization helpers for the v3 flat-file format. Kept free of any
 * I/O or entity construction so they can be unit-tested in isolation. Mirrors
 * the normalization rules of the parallel .NET V3DataSetLoader.
 */

/** Literal strings the v3 feed uses to mean "absent". Normalized to null. */
const NULL_SENTINELS = new Set(['No Mapping', 'No Market', 'NaT']);

/**
 * Normalize an arbitrary string field: trims, and maps the empty string and the
 * prod null sentinels ("No Mapping", "No Market", "NaT") to null.
 */
export function normString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (NULL_SENTINELS.has(trimmed)) return null;
  return trimmed;
}

/**
 * Strip "_@" prefix from a prod VoyageID, exactly like the dev TourCode rule.
 * Returns the empty string for nullish input (caller decides whether to skip).
 */
export function stripVoyageId(voyageId: string | null | undefined): string {
  return (voyageId ?? '').replace(/^_@/, '');
}

/**
 * Parse a number that may carry comma thousands separators and a unit suffix,
 * e.g. "11,647 t" -> 11647, "114 m" -> 114, "13 knots" -> 13, "200" -> 200.
 * Returns null for nullish input, sentinels, or anything without a number.
 */
export function parseNumberWithUnits(
  value: string | number | null | undefined
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;

  const trimmed = value.trim();
  if (trimmed.length === 0 || NULL_SENTINELS.has(trimmed)) return null;

  // Remove comma thousands separators, then keep the leading numeric token.
  const noCommas = trimmed.replace(/,/g, '');
  const m = /^-?\d+(?:\.\d+)?/.exec(noCommas);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse a strict integer (e.g. passengerCapacity "200", yearOfConstruction
 * "2007"). Mirrors the .NET V3Normalization.ParseInt: returns null on
 * sentinel/blank and on any non-integer input (e.g. "200.5"). Clean integer
 * data parses identically; malformed data yields null on both sides.
 */
export function parseIntStrict(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || NULL_SENTINELS.has(trimmed)) return null;
  // int.TryParse semantics: an optional sign followed by digits only.
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse an embedded prod rate string to a number. Nullish, sentinel, or
 * unparseable input becomes null. Mirrors the dev parseRate behaviour.
 */
export function parseRate(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  const trimmed = value.trim();
  if (trimmed.length === 0 || NULL_SENTINELS.has(trimmed)) return null;
  const n = parseFloat(trimmed);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse a prod datetime defensively and return a normalized string, mirroring
 * dev which stores dates as strings. Accepts ISO datetimes
 * ("2026-09-07T22:00:00") and date-only values ("2026-09-06"), normalizing both
 * to "YYYY-MM-DD". Nullish, sentinel, or unrecognized input becomes null
 * (never throws).
 */
export function parseDateString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || NULL_SENTINELS.has(trimmed)) return null;

  // ISO datetime or date-only: take the leading YYYY-MM-DD.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/.exec(trimmed);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
