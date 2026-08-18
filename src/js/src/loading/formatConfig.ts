import type { DataSourceFormat } from '../interfaces/IApiSdk';

/**
 * The environment variable that carries the flat-file format selection. The
 * value lives in configuration (process environment) — NOT compiled into the
 * SDK — so the same build can be pointed at the v1 or v3 feed without a rebuild.
 * Mirrors the parallel .NET resolver, which reads the same variable name.
 */
export const DATASOURCE_FORMAT_ENV = 'DATASOURCE_FORMAT';

/**
 * Resolve the {@link DataSourceFormat} from configuration.
 *
 * The value is sourced from the `DATASOURCE_FORMAT` environment variable
 * (case-insensitive: `"v1"`, `"v3"`, or `"swota"`). There is NO silent default:
 * if the variable is unset, blank, or holds an unrecognized value, this THROWS
 * a clear Error. This mirrors the .NET resolver's throw-on-missing semantics so
 * neither SDK can silently fall back to v1.
 *
 * @param env The environment to read from (defaults to `process.env`); injectable for tests.
 * @throws {Error} when `DATASOURCE_FORMAT` is unset/blank or not one of `v1`/`v3`/`swota`.
 */
export function resolveDataSourceFormat(
  env: NodeJS.ProcessEnv = process.env
): DataSourceFormat {
  const raw = env[DATASOURCE_FORMAT_ENV];

  if (raw === undefined || raw.trim().length === 0) {
    throw new Error(
      `${DATASOURCE_FORMAT_ENV} is not set. It must be "v1", "v3", or "swota" — there is no default.`
    );
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'v1' || normalized === 'v3' || normalized === 'swota') {
    return normalized;
  }

  throw new Error(
    `${DATASOURCE_FORMAT_ENV} has an unrecognized value "${raw}". ` +
      `Expected "v1", "v3", or "swota".`
  );
}
