import { FlatFileReader } from './FlatFileReader';
import type { IFlatFileReader } from './interfaces/IFlatFileReader';
import {
  Ship,
  Port,
  CabinGrade,
  CabinOffering,
  Departure,
  Voyage,
} from './data';
import type {
  RawVoyage,
  RawShip,
  RawCabinGrade,
  RawPort,
  RawSourceMarketRow,
} from './data';
import type { IApiSdk, DataSources, ProgressFn, SdkStats } from './interfaces/IApiSdk';

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

  constructor(reader?: IFlatFileReader) {
    this._reader = reader ?? new FlatFileReader();
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

  /** Convenience factory: construct and load in one async call. */
  static async create(
    sources: DataSources,
    reader?: IFlatFileReader,
    onProgress?: ProgressFn
  ): Promise<ApiSdk> {
    return new ApiSdk(reader).load(sources, onProgress);
  }

  /** Whether {@link load} has completed successfully. */
  get isLoaded(): boolean {
    return this._loaded;
  }

  /**
   * Loads the flat files through the reader and assembles them into the
   * navigable graph. All relationships are linked in both directions so the
   * result is traversable from any entity. Safe to call again to reload.
   */
  async load(sources: DataSources, onProgress: ProgressFn = () => {}): Promise<this> {
    // --- Ships -------------------------------------------------------------
    onProgress('Loading ships...');
    const shipRows = await this._reader.readFileAsJson<RawShip[]>(sources.ships);
    const ships: Ship[] = [];
    const shipById = new Map<string, Ship>();
    for (const raw of shipRows) {
      const ship = new Ship(raw);
      ships.push(ship);
      if (ship.id) shipById.set(ship.id, ship);
    }
    onProgress(`  ${ships.length} ships`);

    // --- Ports -------------------------------------------------------------
    onProgress('Loading ports...');
    const portRows = await this._reader.readFileAsJson<RawPort[]>(sources.ports);
    const ports: Port[] = [];
    const portByCode = new Map<string, Port>();
    for (const raw of portRows) {
      const port = new Port(raw);
      ports.push(port);
      if (port.code) portByCode.set(port.code, port);
    }
    onProgress(`  ${ports.length} ports`);

    // --- Cabin grades ------------------------------------------------------
    onProgress('Loading cabin grades...');
    const gradeRows = await this._reader.readFileAsJson<RawCabinGrade[]>(sources.cabinGrades);
    const cabinGrades: CabinGrade[] = [];
    const cabinGradeByCode = new Map<string, CabinGrade>();
    for (const raw of gradeRows) {
      const grade = new CabinGrade(raw);
      cabinGrades.push(grade);
      if (grade.code) cabinGradeByCode.set(grade.code, grade);
    }
    onProgress(`  ${cabinGrades.length} cabin grades`);

    // --- Voyages + departures ---------------------------------------------
    onProgress('Loading voyages...');
    const voyageRows = await this._reader.readFileAsJson<RawVoyage[]>(sources.voyages);
    const voyages: Voyage[] = [];
    const departures: Departure[] = [];
    const departureByCode = new Map<string, Departure>();

    for (const raw of voyageRows) {
      const voyage = new Voyage(raw);
      voyages.push(voyage);

      // Resolve from/to ports (sparse in current data)
      if (voyage.fromPortCode) {
        const p = portByCode.get(voyage.fromPortCode);
        if (p) {
          voyage._setFromPort(p);
          p._addVoyageFrom(voyage);
        }
      }
      if (voyage.toPortCode) {
        const p = portByCode.get(voyage.toPortCode);
        if (p) {
          voyage._setToPort(p);
          p._addVoyageTo(voyage);
        }
      }

      // Departures: first voyage to reference a code owns it
      for (const code of voyage.travelSuggestionCodes) {
        if (departureByCode.has(code)) continue;
        const dep = new Departure(code, ApiSdk.parseDateFromCode(code));
        const ship = shipById.get(dep.shipCode) ?? null;
        dep._setShip(ship);
        dep._setVoyage(voyage);
        voyage._addDeparture(dep);
        if (ship) ship._addDeparture(dep);
        departures.push(dep);
        departureByCode.set(code, dep);
      }
    }
    onProgress(`  ${voyages.length} voyages, ${departures.length} departures`);

    // --- Offerings (source-market rate files) ------------------------------
    const offerings: CabinOffering[] = [];
    const offeringByKey = new Map<string, CabinOffering>();

    for (const file of sources.sourceMarkets) {
      onProgress(`Indexing ${ApiSdk.basename(file)}...`);
      const rows = await this._reader.readFileAsJson<RawSourceMarketRow[]>(file);
      for (const row of rows) {
        const depCode = ApiSdk.stripTourCode(row.TourCode);
        if (!depCode) continue;
        const departure = departureByCode.get(depCode);
        if (!departure) continue; // rate with no matching voyage departure

        const category = (row.Category ?? '').trim();
        const key = `${depCode}|${category}`;

        let offering = offeringByKey.get(key);
        if (!offering) {
          offering = new CabinOffering(
            category,
            (row.SuperCategory ?? '').trim(),
            row.AvailableCabins ?? null
          );
          offering._setDeparture(departure);
          departure._addOffering(offering);

          const grade = cabinGradeByCode.get(category);
          if (grade) {
            offering._setCabinGrade(grade);
            grade._addOffering(offering);
            // Wire ship <-> grade based on actual availability
            if (departure.ship) {
              grade._addShip(departure.ship);
              departure.ship._addCabinGrade(grade);
            }
          }

          offerings.push(offering);
          offeringByKey.set(key, offering);
        }

        departure._setEndDate(row.TourEndDate ?? null);
        offering._addPrice(
          (row.Currency ?? '').trim(),
          ApiSdk.parseRate(row.Rate_Sgl),
          ApiSdk.parseRate(row.Rate_Dbl)
        );
      }
    }
    onProgress(`  ${offerings.length} cabin offerings indexed`);

    // Commit the freshly-built graph
    this._voyages = voyages;
    this._ships = ships;
    this._cabinGrades = cabinGrades;
    this._ports = ports;
    this._departures = departures;
    this._offerings = offerings;
    this._shipById = shipById;
    this._cabinGradeByCode = cabinGradeByCode;
    this._portByCode = portByCode;
    this._departureByCode = departureByCode;
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

  // --- private helpers -----------------------------------------------------

  /** Source-market TourCodes are prefixed with "_@" before the actual code. */
  private static stripTourCode(tourCode: string | null | undefined): string {
    return (tourCode ?? '').replace(/^_@/, '');
  }

  /** Codes end in a YYMMDD stamp, e.g. "SCGALEMAC-260403" -> 2026-04-03. */
  private static parseDateFromCode(code: string): string | null {
    const m = /-(\d{6})$/.exec(code);
    if (!m) return null;
    return `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`;
  }

  private static parseRate(value: string | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const n = parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }

  private static basename(filePath: string): string {
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
  }
}

/**
 * Factory returning the SDK behind its {@link IApiSdk} interface, so callers
 * depend on the contract rather than the concrete class.
 */
export function createApiSdk(reader?: IFlatFileReader): IApiSdk {
  return new ApiSdk(reader);
}
