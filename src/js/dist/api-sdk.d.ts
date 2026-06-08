import type { IFlatFileReader } from './interfaces/IFlatFileReader';
import { Ship, Port, CabinGrade, CabinOffering, Departure, Voyage } from './data';
import type { IApiSdk, DataSources, ProgressFn, SdkStats } from './interfaces/IApiSdk';
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
export declare class ApiSdk implements IApiSdk {
    private readonly _reader;
    private _voyages;
    private _ships;
    private _cabinGrades;
    private _ports;
    private _departures;
    private _offerings;
    private _shipById;
    private _cabinGradeByCode;
    private _portByCode;
    private _departureByCode;
    private _loaded;
    constructor(reader?: IFlatFileReader);
    /** The underlying flat-file reader. */
    get fileReader(): IFlatFileReader;
    /** Read a file's raw contents (async action delegated to the reader). */
    readFile(filePath: string): Promise<string>;
    /** Read and parse a JSON file (async action delegated to the reader). */
    readFileAsJson<T = unknown>(filePath: string): Promise<T>;
    /** Convenience factory: construct and load in one async call. */
    static create(sources: DataSources, reader?: IFlatFileReader, onProgress?: ProgressFn): Promise<ApiSdk>;
    /** Whether {@link load} has completed successfully. */
    get isLoaded(): boolean;
    /**
     * Loads the flat files through the reader and assembles them into the
     * navigable graph. All relationships are linked in both directions so the
     * result is traversable from any entity. Safe to call again to reload.
     */
    load(sources: DataSources, onProgress?: ProgressFn): Promise<this>;
    get voyages(): readonly Voyage[];
    get ships(): readonly Ship[];
    get cabinGrades(): readonly CabinGrade[];
    get ports(): readonly Port[];
    get departures(): readonly Departure[];
    get offerings(): readonly CabinOffering[];
    ship(id: string): Ship | undefined;
    cabinGrade(code: string): CabinGrade | undefined;
    port(code: string): Port | undefined;
    departure(code: string): Departure | undefined;
    get stats(): SdkStats;
    /** Source-market TourCodes are prefixed with "_@" before the actual code. */
    private static stripTourCode;
    /** Codes end in a YYMMDD stamp, e.g. "SCGALEMAC-260403" -> 2026-04-03. */
    private static parseDateFromCode;
    private static parseRate;
    private static basename;
}
/**
 * Factory returning the SDK behind its {@link IApiSdk} interface, so callers
 * depend on the contract rather than the concrete class.
 */
export declare function createApiSdk(reader?: IFlatFileReader): IApiSdk;
