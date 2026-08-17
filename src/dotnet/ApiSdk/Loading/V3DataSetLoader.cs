using System.Globalization;
using ApiSdk.Data;

namespace ApiSdk.Loading;

/// <summary>
/// Loads the V3 (originally "prod") flat-file format into the navigable object graph.
///
/// Differences from the V1 format:
/// <list type="bullet">
/// <item>Pricing is embedded per voyage (no separate source-market rate files).</item>
/// <item>There is no separate cabin-grade reference file, so the CabinGrades
/// collection is left empty and offerings are not wired to grades.</item>
/// <item>Ships carry numbers-with-units (grossTonnage/length/speed) which are
/// parsed and normalized at parse time, then DROPPED — only passengerCapacity
/// and yearOfConstruction feed the (unchanged) Ship entity.</item>
/// <item>Each voyage owns exactly one departure, keyed by its stripped VoyageID.</item>
/// </list>
/// Entities are NOT widened; V3-only fields without an entity home are dropped.
/// </summary>
internal sealed class V3DataSetLoader : IDataSetLoader
{
    public async Task<DataSetLoadResult> LoadAsync(
        IFlatFileReader fileReader,
        DataSources sources,
        IProgress<string>? progress)
    {
        // --- Ports -----------------------------------------------------------
        progress?.Report("Loading ports (V3)...");
        var portRows = await fileReader.ReadFileAsync<List<RawProdPort>>(sources.Ports);
        var ports = new List<Port>();
        var portByCode = new Dictionary<string, Port>();
        foreach (var raw in portRows)
        {
            // country is intentionally dropped: the Port entity is unchanged.
            var port = new Port(
                (V3Normalization.NormalizeString(raw.Code) ?? string.Empty),
                (V3Normalization.NormalizeString(raw.Description) ?? string.Empty));
            ports.Add(port);
            if (!string.IsNullOrEmpty(port.Code)) portByCode[port.Code] = port;
        }
        progress?.Report($"  {ports.Count} ports");

        // --- Ships -----------------------------------------------------------
        progress?.Report("Loading ships (V3)...");
        var shipRows = await fileReader.ReadFileAsync<List<RawProdShip>>(sources.Ships);
        var ships = new List<Ship>();
        var shipById = new Dictionary<string, Ship>();
        foreach (var raw in shipRows)
        {
            // grossTonnage/length/speed are parsed + normalized at parse time to
            // assert they are well-formed numbers-with-units, then DROPPED: they
            // have no home on the (unchanged) Ship entity.
            _ = V3Normalization.ParseNumberWithUnit(raw.GrossTonnage);
            _ = V3Normalization.ParseNumberWithUnit(raw.Length);
            _ = V3Normalization.ParseNumberWithUnit(raw.Speed);

            var ship = new Ship(
                (V3Normalization.NormalizeString(raw.ShipId) ?? string.Empty),
                (V3Normalization.NormalizeString(raw.Heading) ?? string.Empty),
                V3Normalization.ParseInt(raw.PassengerCapacity),
                V3Normalization.ParseInt(raw.YearOfConstruction));
            ships.Add(ship);
            if (!string.IsNullOrEmpty(ship.Id)) shipById[ship.Id] = ship;
        }
        progress?.Report($"  {ships.Count} ships");

        // --- Voyages + departures + embedded offerings -----------------------
        // V3 has no separate cabin-grade reference, so CabinGrades stays empty
        // and offerings are not wired to grades.
        progress?.Report("Loading voyages (V3)...");
        var voyageRows = await fileReader.ReadFileAsync<List<RawProdVoyage>>(sources.Voyages);

        var voyages = new List<Voyage>();
        var departures = new List<Departure>();
        var departureByCode = new Dictionary<string, Departure>();
        var offerings = new List<CabinOffering>();

        var cabinGrades = new List<CabinGrade>();
        var cabinGradeByCode = new Dictionary<string, CabinGrade>();

        foreach (var raw in voyageRows)
        {
            var depCode = V3Normalization.StripVoyageId(raw.VoyageId);

            var heading = V3Normalization.NormalizeString(raw.Description) ?? string.Empty;
            var fromPort = V3Normalization.NormalizeString(raw.DeparturePort);
            var toPort = V3Normalization.NormalizeString(raw.ArrivalPort);

            var itinerary = (raw.Itinerary ?? new List<RawProdItineraryDay>())
                .Select(d => new ItineraryDay(
                    d.Day?.ToString(CultureInfo.InvariantCulture),
                    V3Normalization.NormalizeString(d.Location),
                    V3Normalization.NormalizeString(d.Heading))
                {
                    Body = V3Normalization.NormalizeString(d.Body),
                })
                .ToList();

            var voyage = new Voyage(
                heading,
                intro: string.Empty,
                sellingPoints: Array.Empty<string>(),
                durationText: string.Empty,
                travelSuggestionCodes: depCode.Length > 0 ? new[] { depCode } : Array.Empty<string>(),
                fromPortCode: fromPort,
                toPortCode: toPort,
                itinerary: itinerary);
            voyages.Add(voyage);

            if (!string.IsNullOrEmpty(voyage.FromPortCode) && portByCode.TryGetValue(voyage.FromPortCode!, out var fp))
            {
                voyage.SetFromPort(fp);
                fp.AddVoyageFrom(voyage);
            }
            if (!string.IsNullOrEmpty(voyage.ToPortCode) && portByCode.TryGetValue(voyage.ToPortCode!, out var tp))
            {
                voyage.SetToPort(tp);
                tp.AddVoyageTo(voyage);
            }

            if (depCode.Length == 0 || departureByCode.ContainsKey(depCode)) continue;

            var date = V3Normalization.NormalizeDate(raw.DepartureDate);
            var dep = new Departure(depCode, date);

            // Wire the ship by ShipCode (V3 gives it explicitly).
            var shipCode = V3Normalization.NormalizeString(raw.ShipCode);
            var ship = shipCode is not null && shipById.TryGetValue(shipCode, out var s) ? s : null;
            dep.SetShip(ship);
            dep.SetVoyage(voyage);
            dep.SetEndDate(V3Normalization.NormalizeDate(raw.ArrivalDate));
            voyage.AddDeparture(dep);
            ship?.AddDeparture(dep);
            departures.Add(dep);
            departureByCode[depCode] = dep;

            var currency = V3Normalization.NormalizeString(raw.Currency) ?? string.Empty;

            foreach (var cat in raw.Categories ?? new List<RawProdCategory>())
            {
                var category = V3Normalization.NormalizeString(cat.Category) ?? string.Empty;

                // V3 has no SuperCategory; reuse RateCode as the human label.
                var name = V3Normalization.NormalizeString(cat.RateCode) ?? string.Empty;

                var offering = new CabinOffering(category, name, cat.MaxOccupancy);
                offering.SetDeparture(dep);
                dep.AddOffering(offering);
                offering.AddPrice(
                    currency,
                    V3Normalization.ParseRate(cat.RateSgl),
                    V3Normalization.ParseRate(cat.RateDbl));
                offerings.Add(offering);
            }
        }
        progress?.Report($"  {voyages.Count} voyages, {departures.Count} departures, {offerings.Count} offerings");

        return new DataSetLoadResult
        {
            Voyages = voyages,
            Ships = ships,
            CabinGrades = cabinGrades,
            Ports = ports,
            Departures = departures,
            Offerings = offerings,
            ShipById = shipById,
            CabinGradeByCode = cabinGradeByCode,
            PortByCode = portByCode,
            DepartureByCode = departureByCode,
        };
    }
}
