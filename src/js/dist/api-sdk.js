"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiSdk = void 0;
exports.createApiSdk = createApiSdk;
const FlatFileReader_1 = require("./FlatFileReader");
const data_1 = require("./data");
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
class ApiSdk {
    constructor(reader) {
        this._voyages = [];
        this._ships = [];
        this._cabinGrades = [];
        this._ports = [];
        this._departures = [];
        this._offerings = [];
        this._shipById = new Map();
        this._cabinGradeByCode = new Map();
        this._portByCode = new Map();
        this._departureByCode = new Map();
        this._loaded = false;
        this._reader = reader ?? new FlatFileReader_1.FlatFileReader();
    }
    // --- reader access / async read actions ---------------------------------
    /** The underlying flat-file reader. */
    get fileReader() {
        return this._reader;
    }
    /** Read a file's raw contents (async action delegated to the reader). */
    readFile(filePath) {
        return this._reader.readFile(filePath);
    }
    /** Read and parse a JSON file (async action delegated to the reader). */
    readFileAsJson(filePath) {
        return this._reader.readFileAsJson(filePath);
    }
    // --- async load action ---------------------------------------------------
    /** Convenience factory: construct and load in one async call. */
    static async create(sources, reader, onProgress) {
        return new ApiSdk(reader).load(sources, onProgress);
    }
    /** Whether {@link load} has completed successfully. */
    get isLoaded() {
        return this._loaded;
    }
    /**
     * Loads the flat files through the reader and assembles them into the
     * navigable graph. All relationships are linked in both directions so the
     * result is traversable from any entity. Safe to call again to reload.
     */
    async load(sources, onProgress = () => { }) {
        // --- Ships -------------------------------------------------------------
        onProgress('Loading ships...');
        const shipRows = await this._reader.readFileAsJson(sources.ships);
        const ships = [];
        const shipById = new Map();
        for (const raw of shipRows) {
            const ship = new data_1.Ship(raw);
            ships.push(ship);
            if (ship.id)
                shipById.set(ship.id, ship);
        }
        onProgress(`  ${ships.length} ships`);
        // --- Ports -------------------------------------------------------------
        onProgress('Loading ports...');
        const portRows = await this._reader.readFileAsJson(sources.ports);
        const ports = [];
        const portByCode = new Map();
        for (const raw of portRows) {
            const port = new data_1.Port(raw);
            ports.push(port);
            if (port.code)
                portByCode.set(port.code, port);
        }
        onProgress(`  ${ports.length} ports`);
        // --- Cabin grades ------------------------------------------------------
        onProgress('Loading cabin grades...');
        const gradeRows = await this._reader.readFileAsJson(sources.cabinGrades);
        const cabinGrades = [];
        const cabinGradeByCode = new Map();
        for (const raw of gradeRows) {
            const grade = new data_1.CabinGrade(raw);
            cabinGrades.push(grade);
            if (grade.code)
                cabinGradeByCode.set(grade.code, grade);
        }
        onProgress(`  ${cabinGrades.length} cabin grades`);
        // --- Voyages + departures ---------------------------------------------
        onProgress('Loading voyages...');
        const voyageRows = await this._reader.readFileAsJson(sources.voyages);
        const voyages = [];
        const departures = [];
        const departureByCode = new Map();
        for (const raw of voyageRows) {
            const voyage = new data_1.Voyage(raw);
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
                if (departureByCode.has(code))
                    continue;
                const dep = new data_1.Departure(code, ApiSdk.parseDateFromCode(code));
                const ship = shipById.get(dep.shipCode) ?? null;
                dep._setShip(ship);
                dep._setVoyage(voyage);
                voyage._addDeparture(dep);
                if (ship)
                    ship._addDeparture(dep);
                departures.push(dep);
                departureByCode.set(code, dep);
            }
        }
        onProgress(`  ${voyages.length} voyages, ${departures.length} departures`);
        // --- Offerings (source-market rate files) ------------------------------
        const offerings = [];
        const offeringByKey = new Map();
        for (const file of sources.sourceMarkets) {
            onProgress(`Indexing ${ApiSdk.basename(file)}...`);
            const rows = await this._reader.readFileAsJson(file);
            for (const row of rows) {
                const depCode = ApiSdk.stripTourCode(row.TourCode);
                if (!depCode)
                    continue;
                const departure = departureByCode.get(depCode);
                if (!departure)
                    continue; // rate with no matching voyage departure
                const category = (row.Category ?? '').trim();
                const key = `${depCode}|${category}`;
                let offering = offeringByKey.get(key);
                if (!offering) {
                    offering = new data_1.CabinOffering(category, (row.SuperCategory ?? '').trim(), row.AvailableCabins ?? null);
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
                offering._addPrice((row.Currency ?? '').trim(), ApiSdk.parseRate(row.Rate_Sgl), ApiSdk.parseRate(row.Rate_Dbl));
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
    get voyages() {
        return this._voyages;
    }
    get ships() {
        return this._ships;
    }
    get cabinGrades() {
        return this._cabinGrades;
    }
    get ports() {
        return this._ports;
    }
    get departures() {
        return this._departures;
    }
    get offerings() {
        return this._offerings;
    }
    // --- data graph: lookups -------------------------------------------------
    ship(id) {
        return this._shipById.get(id);
    }
    cabinGrade(code) {
        return this._cabinGradeByCode.get(code);
    }
    port(code) {
        return this._portByCode.get(code);
    }
    departure(code) {
        return this._departureByCode.get(code);
    }
    get stats() {
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
    static stripTourCode(tourCode) {
        return (tourCode ?? '').replace(/^_@/, '');
    }
    /** Codes end in a YYMMDD stamp, e.g. "SCGALEMAC-260403" -> 2026-04-03. */
    static parseDateFromCode(code) {
        const m = /-(\d{6})$/.exec(code);
        if (!m)
            return null;
        return `20${m[1].slice(0, 2)}-${m[1].slice(2, 4)}-${m[1].slice(4, 6)}`;
    }
    static parseRate(value) {
        if (value === null || value === undefined)
            return null;
        const n = parseFloat(value);
        return Number.isNaN(n) ? null : n;
    }
    static basename(filePath) {
        const parts = filePath.split(/[\\/]/);
        return parts[parts.length - 1] || filePath;
    }
}
exports.ApiSdk = ApiSdk;
/**
 * Factory returning the SDK behind its {@link IApiSdk} interface, so callers
 * depend on the contract rather than the concrete class.
 */
function createApiSdk(reader) {
    return new ApiSdk(reader);
}
