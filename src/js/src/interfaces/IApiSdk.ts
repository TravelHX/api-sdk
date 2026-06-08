import type {
  Voyage,
  Ship,
  CabinGrade,
  CabinOffering,
  Departure,
  Port,
} from '../data';

/** Absolute paths to the flat files the SDK is loaded from. */
export interface DataSources {
  voyages: string;
  ships: string;
  cabinGrades: string;
  ports: string;
  /** One or more source-market rate files (per currency). */
  sourceMarkets: string[];
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
