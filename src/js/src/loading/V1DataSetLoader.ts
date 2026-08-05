import {
  Ship,
  Port,
  CabinGrade,
  CabinOffering,
  Departure,
  Voyage,
} from '../data';
import type {
  RawVoyage,
  RawShip,
  RawCabinGrade,
  RawPort,
  RawSourceMarketRow,
} from '../data';
import type { IFlatFileReader } from '../interfaces/IFlatFileReader';
import type { DataSources, ProgressFn } from '../interfaces/IApiSdk';
import type { IDataSetLoader, DataSetResult } from './IDataSetLoader';

/**
 * Loads the original "v1" flat-file format into the navigable object graph.
 *
 * This is the SDK's original loading logic, moved verbatim out of
 * {@link ApiSdk.load} (including the static helpers). It is intentionally
 * behaviour-preserving — do not "improve" it. Mirrors the .NET V1DataSetLoader.
 */
export class V1DataSetLoader implements IDataSetLoader {
  async load(
    reader: IFlatFileReader,
    sources: DataSources,
    onProgress: ProgressFn
  ): Promise<DataSetResult> {
    // --- Ships -------------------------------------------------------------
    onProgress('Loading ships...');
    const shipRows = await reader.readFileAsJson<RawShip[]>(sources.ships);
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
    const portRows = await reader.readFileAsJson<RawPort[]>(sources.ports);
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
    const gradeRows = await reader.readFileAsJson<RawCabinGrade[]>(sources.cabinGrades);
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
    const voyageRows = await reader.readFileAsJson<RawVoyage[]>(sources.voyages);
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
        const dep = new Departure(code, V1DataSetLoader.parseDateFromCode(code));
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
      onProgress(`Indexing ${V1DataSetLoader.basename(file)}...`);
      const rows = await reader.readFileAsJson<RawSourceMarketRow[]>(file);
      for (const row of rows) {
        const depCode = V1DataSetLoader.stripTourCode(row.TourCode);
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
          V1DataSetLoader.parseRate(row.Rate_Sgl),
          V1DataSetLoader.parseRate(row.Rate_Dbl)
        );
      }
    }
    onProgress(`  ${offerings.length} cabin offerings indexed`);

    return {
      voyages,
      ships,
      cabinGrades,
      ports,
      departures,
      offerings,
      shipById,
      cabinGradeByCode,
      portByCode,
      departureByCode,
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
