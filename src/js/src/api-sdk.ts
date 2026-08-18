import { FlatFileReader } from './FlatFileReader';
import type { IFlatFileReader } from './interfaces/IFlatFileReader';
import type {
  Ship,
  Port,
  CabinGrade,
  CabinOffering,
  Departure,
  Voyage,
} from './data';
import type { IApiSdk, DataSources, ProgressFn, SdkStats } from './interfaces/IApiSdk';
import {
  V1DataSetLoader,
  V3DataSetLoader,
  SwotaDataSetLoader,
  type IDataSetLoader,
} from './loading';
import { SwotaAvailabilityClient, type ISwotaAvailabilityClient } from './availability';

// Re-export the contract types so consumers can import them from the SDK root.
export type { IApiSdk, DataSources, ProgressFn, SdkStats };

/**
 * The SDK entry point and concrete implementation of {@link IApiSdk}. It
 * absorbs the flat-file reader (exposing reads as async actions) and, once
 * {@link ApiSdk.load}ed, becomes a fully-wired, bidirectionally-navigable
 * object graph of voyages, ships, cabin grades, ports, departures and priced
 * cabin offerings.
 *
 * ```ts
 * const sdk = await ApiSdk.create(sources);
 * sdk.voyages[0].departures[0].ship.cabinGrades;
 * sdk.cabinGrade('DS').departures[0].voyage;
 * ```
 */
export class ApiSdk implements IApiSdk {
  private readonly _reader: IFlatFileReader;

  private _voyages: Voyage[] = [];
  private _ships: Ship[] = [];
  private _cabinGrades: CabinGrade[] = [];
  private _ports: Port[] = [];
  private _departures: Departure[] = [];
  private _offerings: CabinOffering[] = [];

  private _shipById = new Map<string, Ship>();
  private _cabinGradeByCode = new Map<string, CabinGrade>();
  private _portByCode = new Map<string, Port>();
  private _departureByCode = new Map<string, Departure>();

  private _loaded = false;

  private readonly _swotaAvailabilityClient?: ISwotaAvailabilityClient;

  /**
   * @param reader Flat-file reader; defaults to {@link FlatFileReader}.
   * @param swotaAvailabilityClient Live-availability client used only under
   *   `DataSources.format === 'swota'`; defaults to a real
   *   {@link SwotaAvailabilityClient} (evaluated lazily in {@link load}, so a
   *   `'v1'`/`'v3'` load — which never touches SWOTA — never constructs one).
   *   Pass a test double / alternate implementation here to cover SwOTA
   *   behavior without a real SWOTA integration, mirroring the .NET
   *   `ApiSdkFactory`'s optional `swOTAAvailabilityClient` parameter.
   */
  constructor(reader?: IFlatFileReader, swotaAvailabilityClient?: ISwotaAvailabilityClient) {
    this._reader = reader ?? new FlatFileReader();
    this._swotaAvailabilityClient = swotaAvailabilityClient;
  }

  // --- reader access / async read actions ---------------------------------

  /** The underlying flat-file reader. */
  get fileReader(): IFlatFileReader {
    return this._reader;
  }

  /** Read a file's raw contents (async action delegated to the reader). */
  readFile(filePath: string): Promise<string> {
    return this._reader.readFile(filePath);
  }

  /** Read and parse a JSON file (async action delegated to the reader). */
  readFileAsJson<T = unknown>(filePath: string): Promise<T> {
    return this._reader.readFileAsJson<T>(filePath);
  }

  // --- async load action ---------------------------------------------------

  /**
   * Convenience factory: construct and load in one async call.
   *
   * @param onProgress Optional progress callback forwarded to {@link load}.
   * @param swotaAvailabilityClient Optional custom {@link ISwotaAvailabilityClient}
   *   (see the constructor); only relevant when `sources.format === 'swota'`.
   */
  static async create(
    sources: DataSources,
    reader?: IFlatFileReader,
    onProgress?: ProgressFn,
    swotaAvailabilityClient?: ISwotaAvailabilityClient
  ): Promise<ApiSdk> {
    return new ApiSdk(reader, swotaAvailabilityClient).load(sources, onProgress);
  }

  /** Whether {@link load} has completed successfully. */
  get isLoaded(): boolean {
    return this._loaded;
  }

  /**
   * Loads the flat files through the reader and assembles them into the
   * navigable graph. All relationships are linked in both directions so the
   * result is traversable from any entity. Safe to call again to reload.
   *
   * This is a thin dispatcher: it selects the loading strategy by
   * {@link DataSources.format}, runs it, and assigns the returned
   * collections/maps to its fields. There is no default — an unrecognized
   * format THROWS rather than silently falling back. The v1 path is unchanged.
   */
  async load(sources: DataSources, onProgress: ProgressFn = () => {}): Promise<this> {
    let loader: IDataSetLoader;
    switch (sources.format) {
      case 'v3':
        loader = new V3DataSetLoader();
        break;
      case 'v1':
        loader = new V1DataSetLoader();
        break;
      case 'swota':
        loader = new SwotaDataSetLoader(
          this._swotaAvailabilityClient ?? new SwotaAvailabilityClient()
        );
        break;
      default:
        throw new Error(
          `Unrecognized DataSources.format "${String(sources.format)}". Expected "v1", "v3", or "swota".`
        );
    }

    const result = await loader.load(this._reader, sources, onProgress);

    // Commit the freshly-built graph
    this._voyages = result.voyages;
    this._ships = result.ships;
    this._cabinGrades = result.cabinGrades;
    this._ports = result.ports;
    this._departures = result.departures;
    this._offerings = result.offerings;
    this._shipById = result.shipById;
    this._cabinGradeByCode = result.cabinGradeByCode;
    this._portByCode = result.portByCode;
    this._departureByCode = result.departureByCode;
    this._loaded = true;

    return this;
  }

  // --- data graph: collections --------------------------------------------

  get voyages(): readonly Voyage[] {
    return this._voyages;
  }

  get ships(): readonly Ship[] {
    return this._ships;
  }

  get cabinGrades(): readonly CabinGrade[] {
    return this._cabinGrades;
  }

  get ports(): readonly Port[] {
    return this._ports;
  }

  get departures(): readonly Departure[] {
    return this._departures;
  }

  get offerings(): readonly CabinOffering[] {
    return this._offerings;
  }

  // --- data graph: lookups -------------------------------------------------

  ship(id: string): Ship | undefined {
    return this._shipById.get(id);
  }

  cabinGrade(code: string): CabinGrade | undefined {
    return this._cabinGradeByCode.get(code);
  }

  port(code: string): Port | undefined {
    return this._portByCode.get(code);
  }

  departure(code: string): Departure | undefined {
    return this._departureByCode.get(code);
  }

  get stats(): SdkStats {
    return {
      voyageCount: this._voyages.length,
      shipCount: this._ships.length,
      cabinGradeCount: this._cabinGrades.length,
      portCount: this._ports.length,
      departureCount: this._departures.length,
      offeringCount: this._offerings.length,
    };
  }
}

/**
 * Factory returning the SDK behind its {@link IApiSdk} interface, so callers
 * depend on the contract rather than the concrete class.
 *
 * @param swotaAvailabilityClient Optional custom {@link ISwotaAvailabilityClient}
 *   (see {@link ApiSdk}'s constructor); only relevant when loading with
 *   `format: 'swota'`. Defaults to a real {@link SwotaAvailabilityClient}.
 */
export function createApiSdk(
  reader?: IFlatFileReader,
  swotaAvailabilityClient?: ISwotaAvailabilityClient
): IApiSdk {
  return new ApiSdk(reader, swotaAvailabilityClient);
}
