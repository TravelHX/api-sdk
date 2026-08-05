import * as path from 'path';

/**
 * Selects which market's flat-file sample data {@link resolveMarketDataSources}
 * resolves paths for. Each market maps to one or more locale-suffixed file sets
 * under RefData (see {@link MARKET_LOCALES}).
 */
export type Market = 'EU' | 'Nordic' | 'UK' | 'USA' | 'Australia';

/**
 * The locale codes that belong to each {@link Market}, in the order the sample
 * data was generated. A market with more than one locale has no "default" —
 * the caller must say which one they want (see {@link resolveMarketDataSources}).
 */
export const MARKET_LOCALES: Record<Market, readonly string[]> = {
  EU: ['de', 'fr', 'dk'],
  Nordic: ['se', 'no'],
  UK: ['uk'],
  USA: ['us'],
  Australia: ['au'],
};

/**
 * The settlement currency for each locale, used to pick the matching
 * `SourceMarket_{currency}_seaware.json` rate file.
 */
export const LOCALE_CURRENCY: Record<string, string> = {
  de: 'EUR',
  fr: 'EUR',
  dk: 'DKK',
  se: 'SEK',
  no: 'NOK',
  uk: 'GBP',
  us: 'USD',
  au: 'AUD',
};

const MARKETS = Object.keys(MARKET_LOCALES) as Market[];

/**
 * The environment variable that carries the market selection. Mirrors
 * {@link DATASOURCE_FORMAT_ENV} in {@link ./formatConfig}: the value lives in
 * configuration (process environment), not compiled into the SDK.
 */
export const DATASOURCE_MARKET_ENV = 'DATASOURCE_MARKET';

/**
 * The environment variable that carries the locale selection. Only required
 * when the resolved {@link Market} has more than one locale — see
 * {@link resolveMarketDataSources}.
 */
export const DATASOURCE_LOCALE_ENV = 'DATASOURCE_LOCALE';

/**
 * Resolve the {@link Market} from configuration.
 *
 * The value is sourced from the `DATASOURCE_MARKET` environment variable
 * (case-insensitive match against {@link MARKET_LOCALES}' keys). There is NO
 * silent default: if the variable is unset, blank, or holds an unrecognized
 * value, this THROWS a clear Error. Mirrors {@link resolveDataSourceFormat}'s
 * throw-on-missing semantics.
 *
 * @param env The environment to read from (defaults to `process.env`); injectable for tests.
 * @throws {Error} when `DATASOURCE_MARKET` is unset/blank or not a recognized market.
 */
export function resolveMarket(env: NodeJS.ProcessEnv = process.env): Market {
  const raw = env[DATASOURCE_MARKET_ENV];

  if (raw === undefined || raw.trim().length === 0) {
    throw new Error(
      `${DATASOURCE_MARKET_ENV} is not set. It must be one of ${MARKETS.join(', ')} — there is no default.`
    );
  }

  const trimmed = raw.trim();
  const match = MARKETS.find((m) => m.toLowerCase() === trimmed.toLowerCase());
  if (match) {
    return match;
  }

  throw new Error(
    `${DATASOURCE_MARKET_ENV} has an unrecognized value "${raw}". ` +
      `Expected one of ${MARKETS.join(', ')}.`
  );
}

/**
 * Resolve the locale from configuration.
 *
 * The value is sourced from the `DATASOURCE_LOCALE` environment variable.
 * Unlike {@link resolveMarket}, this does NOT throw when unset — whether a
 * locale is required depends on the resolved market (see
 * {@link resolveMarketDataSources}), so that check happens there instead.
 *
 * @param env The environment to read from (defaults to `process.env`); injectable for tests.
 * @returns The trimmed, lower-cased locale, or `undefined` if unset/blank.
 */
export function resolveLocale(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env[DATASOURCE_LOCALE_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  return raw.trim().toLowerCase();
}

/** The subset of {@link DataSources} paths that vary by market/locale. */
export interface MarketDataSources {
  voyages: string;
  ships: string;
  sourceMarkets: string[];
}

/**
 * Resolve the market/locale-specific flat-file paths for {@link DataSources}.
 *
 * If {@link market} has exactly one locale, `locale` is optional and defaults
 * to it. If {@link market} has more than one locale, `locale` is REQUIRED and
 * MUST be one of that market's locales — there is no default. Both cases THROW
 * a clear Error on invalid input, mirroring {@link resolveDataSourceFormat}'s
 * no-silent-fallback convention.
 *
 * @param market The resolved {@link Market} (see {@link resolveMarket}).
 * @param locale The resolved locale (see {@link resolveLocale}), or `undefined`.
 * @param baseDir Absolute path to the RefData directory the files live under.
 * @throws {Error} when `locale` is missing but required, or not valid for `market`.
 */
export function resolveMarketDataSources(
  market: Market,
  locale: string | undefined,
  baseDir: string
): MarketDataSources {
  const locales = MARKET_LOCALES[market];

  let resolvedLocale: string;
  if (locales.length === 1) {
    resolvedLocale = locale?.trim() ? locale.trim().toLowerCase() : locales[0];
  } else {
    if (locale === undefined || locale.trim().length === 0) {
      throw new Error(
        `${DATASOURCE_LOCALE_ENV} is not set. Market "${market}" has multiple locales ` +
          `(${locales.join(', ')}) and requires an explicit locale — there is no default.`
      );
    }
    resolvedLocale = locale.trim().toLowerCase();
  }

  if (!locales.includes(resolvedLocale)) {
    throw new Error(
      `Locale "${locale}" is not valid for market "${market}". ` +
        `Expected one of: ${locales.join(', ')}.`
    );
  }

  const currency = LOCALE_CURRENCY[resolvedLocale];
  if (!currency) {
    throw new Error(`No currency configured for locale "${resolvedLocale}".`);
  }

  return {
    voyages: path.join(baseDir, `voyages_${resolvedLocale}.json`),
    ships: path.join(baseDir, `ships_${resolvedLocale}.json`),
    sourceMarkets: [path.join(baseDir, `SourceMarket_${currency}_seaware.json`)],
  };
}

// =============================================================================
// V3 (prod) — a SEPARATE table, deliberately not merged with the V1 one above.
//
// Prod (data/flatfiles_prod) uses a different naming scheme entirely: uppercase
// 2-letter country codes (no `_seaware` suffix), no SourceMarket rate files
// (v3 pricing is embedded per voyage — see V3DataSetLoader), and no locale-
// scoped ports/cabin-grades file. V1 dev and V3 prod also cover genuinely
// different, only-partially-overlapping locale sets (dev has no CA/CH
// fixtures; prod has no `uk` — it's `GB`), so they get independent tables
// rather than one shared shape.
// =============================================================================

/**
 * The V3 (prod) locale codes for each {@link Market}, already upper-cased —
 * that is the real on-disk casing (`voyages_AU.json`, not `voyages_au.json`).
 *
 * Business grouping differs from {@link MARKET_LOCALES} (V1/dev) by design:
 * Canada (`CA`) groups under USA, Switzerland (`CH`) groups under EU — dev has
 * no fixtures for either, so this is a prod-only distinction.
 */
export const MARKET_LOCALES_V3: Record<Market, readonly string[]> = {
  EU: ['DE', 'FR', 'DK', 'CH'],
  Nordic: ['SE', 'NO'],
  UK: ['GB'],
  USA: ['US', 'CA'],
  Australia: ['AU'],
};

/** The subset of {@link DataSources} paths V3 (prod) varies by market/locale. */
export interface MarketDataSourcesV3 {
  voyages: string;
  ships: string;
}

/**
 * Resolve the V3 (prod) market/locale-specific flat-file paths for
 * {@link DataSources}.
 *
 * Same convention as {@link resolveMarketDataSources}: if {@link market} has
 * exactly one locale, `locale` is optional and defaults to it; if it has more
 * than one, `locale` is REQUIRED and MUST be one of that market's locales —
 * no default, THROWS a clear Error otherwise. `locale` is matched
 * case-insensitively (env values are lower-cased by {@link resolveLocale}) but
 * resolved paths always use the upper-case on-disk codes from
 * {@link MARKET_LOCALES_V3}.
 *
 * Unlike the V1 resolver, there is no currency/`sourceMarkets` concept in
 * prod — pricing is embedded per voyage — so only `voyages`/`ships` are
 * returned; `ports` is flat and un-suffixed (not market/locale-specific),
 * same as V1's `cabinGrades`/`ports`, so callers build that path separately.
 *
 * @param market The resolved {@link Market} (see {@link resolveMarket}).
 * @param locale The resolved locale (see {@link resolveLocale}), or `undefined`.
 * @param baseDir Absolute path to the prod flat-files directory.
 * @throws {Error} when `locale` is missing but required, or not valid for `market`.
 */
export function resolveMarketDataSourcesV3(
  market: Market,
  locale: string | undefined,
  baseDir: string
): MarketDataSourcesV3 {
  const locales = MARKET_LOCALES_V3[market];

  let resolvedLocale: string;
  if (locales.length === 1) {
    resolvedLocale = locale?.trim() ? locale.trim().toUpperCase() : locales[0];
  } else {
    if (locale === undefined || locale.trim().length === 0) {
      throw new Error(
        `${DATASOURCE_LOCALE_ENV} is not set. Market "${market}" has multiple locales ` +
          `(${locales.join(', ')}) and requires an explicit locale — there is no default.`
      );
    }
    resolvedLocale = locale.trim().toUpperCase();
  }

  if (!locales.includes(resolvedLocale)) {
    throw new Error(
      `Locale "${locale}" is not valid for market "${market}". ` +
        `Expected one of: ${locales.join(', ')}.`
    );
  }

  return {
    voyages: path.join(baseDir, `voyages_${resolvedLocale}.json`),
    ships: path.join(baseDir, `ships_${resolvedLocale}.json`),
  };
}
