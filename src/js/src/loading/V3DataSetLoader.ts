import {
  Ship,
  Port,
  CabinOffering,
  Departure,
  Voyage,
} from '../data';
import type {
  RawShip,
  RawVoyage,
  RawPort,
  RawProdPort,
  RawProdShip,
  RawProdVoyage,
} from '../data';
import type { CabinGrade } from '../data';
import type { IFlatFileReader } from '../interfaces/IFlatFileReader';
import type { DataSources, ProgressFn } from '../interfaces/IApiSdk';
import type { IDataSetLoader, DataSetResult } from './IDataSetLoader';
import type { ISwotaAvailabilityClient } from '../availability/ISwotaAvailabilityClient';
import {
  normString,
  stripVoyageId,
  parseNumberWithUnits,
  parseIntStrict,
  parseRate,
  parseDateString,
} from './v3Parse';

/**
 * Loads the "v3" flat-file format (pricing embedded per voyage) into the same
 * navigable object graph the v1 loader produces.
 *
 * Like the v1 loader and the canonical .NET V3DataSetLoader, it reads SINGLE
 * files from the existing {@link DataSources} path fields — one country's worth
 * of data per load — and ignores `cabinGrades`/`sourceMarkets`.
 *
 * Differences from v1, per the frozen spec:
 *  - ports.json carries an ISO2 `country` that is NOT stored (entity unchanged).
 *  - the ships file carries grossTonnage/length/speed which are normalized at
 *    parse time then dropped — only passengerCapacity/yearOfConstruction feed
 *    the Ship entity.
 *  - the voyages file embeds pricing per voyage; there is no separate cabin
 *    grade reference, so the cabinGrades collection stays empty and grades are
 *    not wired.
 *
 * Mirrors the parallel .NET V3DataSetLoader arg-for-arg.
 *
 * An optional {@link ISwotaAvailabilityClient} may be supplied (used by the
 * `'swota'` format via {@link SwotaDataSetLoader}): when present, every
 * {@link CabinOffering} built here is wired with it (plus the RAW, unstripped
 * `VoyageID` from the source row — NOT the stripped departure code — as
 * `voyageId`, since that is what the live SWOTA REST API requires) so
 * `CabinOffering.getAvailableCabinsAsync()` fetches live availability instead
 * of returning the static `maxOccupancy` placeholder. Plain `'v3'` loads
 * construct this with no argument, so behaviour there is unchanged.
 */
export class V3DataSetLoader implements IDataSetLoader {
  constructor(private readonly liveClient?: ISwotaAvailabilityClient) {}

  async load(
    reader: IFlatFileReader,
    sources: DataSources,
    onProgress: ProgressFn
  ): Promise<DataSetResult> {
    // --- Ports -------------------------------------------------------------
    onProgress('Loading ports (v3)...');
    const portRows = await reader.readFileAsJson<RawProdPort[]>(sources.ports);
    const ports: Port[] = [];
    const portByCode = new Map<string, Port>();
    for (const raw of portRows) {
      // country is intentionally dropped — Port entity is unchanged.
      // .NET runs code/description through NormalizeString (trim + sentinel→null)
      // and adds EVERY row unconditionally, last-wins on the lookup dict.
      const mapped: RawPort = {
        code: normString(raw.code) ?? '',
        description: normString(raw.description) ?? '',
      };
      const port = new Port(mapped);
      ports.push(port);
      if (port.code) portByCode.set(port.code, port); // last-wins
    }
    onProgress(`  ${ports.length} ports`);

    // --- Ships -------------------------------------------------------------
    onProgress('Loading ships (v3)...');
    const shipRows = await reader.readFileAsJson<RawProdShip[]>(sources.ships);
    const ships: Ship[] = [];
    const shipById = new Map<string, Ship>();
    for (const raw of shipRows) {
      // grossTonnage/length/speed are parsed+normalized at parse time to assert
      // they are well-formed numbers-with-units, then DROPPED (entity unchanged).
      void parseNumberWithUnits(raw.grossTonnage);
      void parseNumberWithUnits(raw.length);
      void parseNumberWithUnits(raw.speed);

      const mapped: RawShip = {
        shipId: normString(raw.shipId) ?? '',
        heading: normString(raw.heading) ?? '',
        // Strict integer parse to match .NET ParseInt (null on non-integer).
        passengerCapacity: parseIntStrict(raw.passengerCapacity),
        yearOfConstruction: parseIntStrict(raw.yearOfConstruction),
      };
      const ship = new Ship(mapped);
      ships.push(ship);
      if (ship.id) shipById.set(ship.id, ship); // last-wins
    }
    onProgress(`  ${ships.length} ships`);

    // --- Voyages + departures + embedded offerings ------------------------
    // Prod has no separate cabin-grade reference, so cabinGrades stays empty
    // and offerings are not wired to grades.
    onProgress('Loading voyages (v3)...');
    const voyageRows = await reader.readFileAsJson<RawProdVoyage[]>(sources.voyages);

    const voyages: Voyage[] = [];
    const departures: Departure[] = [];
    const departureByCode = new Map<string, Departure>();
    const offerings: CabinOffering[] = [];

    const cabinGrades: CabinGrade[] = [];
    const cabinGradeByCode = new Map<string, CabinGrade>();

    for (const raw of voyageRows) {
      const depCode = stripVoyageId(raw.VoyageID);
      // Raw (unstripped) VoyageID, WITHOUT stripping the "_@" prefix. The
      // live SWOTA REST API needs this exact raw form — depCode is internal
      // Departure identity only and must never be sent to it.
      //
      // Run through normString (mirrors .NET's V3Normalization.NormalizeString:
      // trim + null-sentinel check, e.g. "NaT"/"No Mapping"/"No Market") rather
      // than a bare `?? ''`. stripVoyageId does its own, DIFFERENT normalization
      // (nullish -> '', "_@" prefix stripped, no trim/sentinel check), so
      // depCode can be non-empty (e.g. a sentinel string like "NaT" has no "_@"
      // prefix to strip, so it passes through unchanged and non-empty) while
      // the properly-normalized rawVoyageId is empty. Without this, that row
      // would silently send an empty voyageId to the live SWOTA REST API
      // instead of failing fast below.
      const rawVoyageId = normString(raw.VoyageID) ?? '';

      const mappedVoyage: RawVoyage = {
        heading: normString(raw.Description) ?? '',
        itinerary: (raw.itinerary ?? []).map((d) => ({
          day: d.day === null || d.day === undefined ? null : String(d.day),
          location: normString(d.location),
          heading: normString(d.heading),
          body: normString(d.body),
        })),
        fromPort: normString(raw.DeparturePort),
        toPort: normString(raw.ArrivalPort),
        travelSuggestionCodes: depCode.length > 0 ? [depCode] : [],
      };
      const voyage = new Voyage(mappedVoyage);
      voyages.push(voyage);

      // Wire from/to ports.
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

      // First voyage to own the stripped code wins its departure AND offerings;
      // codeless or duplicate voyages are skipped entirely (mirrors .NET's
      // `continue` and the dev departureByCode pattern).
      if (depCode.length === 0 || departureByCode.has(depCode)) continue;

      // Fail fast rather than silently sending an empty voyageId to the live
      // SWOTA REST API: only reachable when a live client is wired (plain
      // 'v3' loads never hit this, since rawVoyageId is only ever consumed
      // below when this.liveClient is set) and depCode is non-empty (this
      // row wasn't skipped above) but normString still normalized VoyageID
      // to empty -- e.g. a null-sentinel VoyageID like "NaT" that
      // stripVoyageId's cruder "_@"-prefix-only stripping doesn't catch. A
      // request against SWOTA with an empty VoyageID would 404/error on
      // every lookup for this voyage's offerings, silently and repeatedly,
      // instead of failing once here with a clear cause.
      //
      // .NET's V3DataSetLoader.cs has the equivalent guard (same condition,
      // same reasoning) -- both SDKs now fail fast here identically.
      if (this.liveClient && rawVoyageId.length === 0) {
        throw new Error(
          `V3DataSetLoader: voyage row for departure "${depCode}" has an empty/unmapped VoyageID ` +
            'after normalization, so no valid raw voyageId can be threaded through to the live ' +
            'SWOTA client.'
        );
      }

      const departure = new Departure(depCode, parseDateString(raw.DepartureDate));
      // Wire ship by explicit ShipCode (prod gives it directly).
      const shipCode = normString(raw.ShipCode);
      const ship = (shipCode !== null ? shipById.get(shipCode) : undefined) ?? null;
      departure._setShip(ship);
      departure._setVoyage(voyage);
      departure._setEndDate(parseDateString(raw.ArrivalDate));
      voyage._addDeparture(departure);
      if (ship) ship._addDeparture(departure);
      departures.push(departure);
      departureByCode.set(depCode, departure);

      // Embedded pricing: one CabinOffering per category. No cabin-grade ref in
      // prod, so grades are not wired. Mirror .NET arg-for-arg:
      //   CabinOffering(code = Category, name = RateCode, availableCabins = MaxOccupancy)
      const currency = normString(raw.Currency) ?? '';
      for (const cat of raw.categories ?? []) {
        const code = normString(cat.Category) ?? '';
        const name = normString(cat.RateCode) ?? '';
        const maxOccupancy =
          cat.MaxOccupancy === null || cat.MaxOccupancy === undefined
            ? null
            : cat.MaxOccupancy;
        const offering = new CabinOffering(
          code,
          name,
          maxOccupancy,
          this.liveClient ? rawVoyageId : undefined,
          this.liveClient
        );
        offering._setDeparture(departure);
        departure._addOffering(offering);
        offering._addPrice(currency, parseRate(cat.Rate_Sgl), parseRate(cat.Rate_Dbl));
        offerings.push(offering);
      }
    }
    onProgress(
      `  ${voyages.length} voyages, ${departures.length} departures, ${offerings.length} cabin offerings`
    );

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
}
