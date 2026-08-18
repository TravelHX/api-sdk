import type {
  Voyage,
  Ship,
  CabinGrade,
  CabinOffering,
  Departure,
  Port,
} from '../data';

/**
 * Selects which data-source format {@link IApiSdk.load} uses. `'v1'` is the
 * original flat-file format; `'v3'` is the per-voyage-priced flat-file format;
 * `'swota'` loads the same static graph as `'v3'` (falling back to `'v1'` if
 * the v3 flat-file source is unavailable) but wires each cabin offering to
 * SWOTA (Seaware OTA) for live availability instead of a static snapshot. There
 * is no default: callers must choose explicitly (see
 * {@link resolveDataSourceFormat} for the env-driven resolution). Mirrors the
 * .NET `DataSourceFormat`.
 */
export type DataSourceFormat = 'v1' | 'v3' | 'swota';

/**
 * Absolute paths to the flat files the SDK is loaded from.
 *
 * The v1 loader uses {@link DataSources.voyages}, {@link DataSources.ships},
 * {@link DataSources.cabinGrades}, {@link DataSources.ports} and
 * {@link DataSources.sourceMarkets}. The v3 loader (when
 * {@link DataSources.format} is `'v3'`) reads single ships/voyages/ports files
 * from {@link DataSources.ships}/{@link DataSources.voyages}/{@link DataSources.ports}
 * — exactly like the v1 loader's path fields — and simply ignores
 * `cabinGrades`/`sourceMarkets` (v3 pricing is embedded per voyage and there
 * is no separate cabin-grade reference). The shape is identical to .NET's
 * `DataSources`: the only v3 addition is the {@link DataSources.format} flag.
 */
export interface DataSources {
  /** Voyages file. */
  voyages: string;
  /** Ships file. */
  ships: string;
  /** Cabin-grade reference file (v1 only; v3 has no separate ref). */
  cabinGrades: string;
  ports: string;
  /** One or more source-market rate files (v1 only, per currency). */
  sourceMarkets: string[];

  /**
   * Which flat-file format to parse. REQUIRED — there is no compiled-in
   * default. Resolve it from configuration via {@link resolveDataSourceFormat}
   * or set the literal explicitly.
   */
  format: DataSourceFormat;
}

/** Progress callback invoked during {@link IApiSdk.load}. */
export type ProgressFn = (message: string) => void;

export interface SdkStats {
  voyageCount: number;
  shipCount: number;
  cabinGradeCount: number;
  portCount: number;
  departureCount: number;
  offeringCount: number;
}

/**
 * The public contract of the SDK. Every interaction a consumer needs — reading
 * files, loading data, and traversing the resulting object graph — is exposed
 * here, so callers can depend on this interface rather than the concrete class.
 */
export interface IApiSdk {
  /** Whether {@link load} has completed successfully. */
  readonly isLoaded: boolean;

  /** Read a file's raw contents. */
  readFile(filePath: string): Promise<string>;

  /** Read and parse a JSON file. */
  readFileAsJson<T = unknown>(filePath: string): Promise<T>;

  /** Load the flat files and assemble the navigable object graph. */
  load(sources: DataSources, onProgress?: ProgressFn): Promise<IApiSdk>;

  readonly voyages: readonly Voyage[];
  readonly ships: readonly Ship[];
  readonly cabinGrades: readonly CabinGrade[];
  readonly ports: readonly Port[];
  readonly departures: readonly Departure[];
  readonly offerings: readonly CabinOffering[];

  ship(id: string): Ship | undefined;
  cabinGrade(code: string): CabinGrade | undefined;
  port(code: string): Port | undefined;
  departure(code: string): Departure | undefined;

  readonly stats: SdkStats;
}
