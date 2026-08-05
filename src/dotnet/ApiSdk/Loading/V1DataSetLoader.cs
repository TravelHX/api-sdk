using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using ApiSdk.Data;

namespace ApiSdk.Loading;

/// <summary>
/// Loads the V1 (originally "dev") flat-file format into the navigable object graph.
/// The body of <see cref="LoadAsync"/> (and the private helpers below) were moved
/// VERBATIM out of <c>ApiSdk.LoadAsync</c> when the loader abstraction was
/// introduced; behaviour is byte-for-byte identical to the previous inline path.
/// </summary>
internal sealed class V1DataSetLoader : IDataSetLoader
{
    public async Task<DataSetLoadResult> LoadAsync(
        IFlatFileReader fileReader,
        DataSources sources,
        IProgress<string>? progress)
    {
        // --- Ships -----------------------------------------------------------
        progress?.Report("Loading ships...");
        var shipRows = await fileReader.ReadFileAsync<List<RawShip>>(sources.Ships);
        var ships = new List<Ship>();
        var shipById = new Dictionary<string, Ship>();
        foreach (var raw in shipRows)
        {
            var ship = new Ship(
                (raw.ShipId ?? string.Empty).Trim(),
                (raw.Heading ?? string.Empty).Trim(),
                ToInt(raw.PassengerCapacity),
                ToInt(raw.YearOfConstruction));
            ships.Add(ship);
            if (!string.IsNullOrEmpty(ship.Id)) shipById[ship.Id] = ship;
        }
        progress?.Report($"  {ships.Count} ships");

        // --- Ports -----------------------------------------------------------
        progress?.Report("Loading ports...");
        var portRows = await fileReader.ReadFileAsync<List<RawPort>>(sources.Ports);
        var ports = new List<Port>();
        var portByCode = new Dictionary<string, Port>();
        foreach (var raw in portRows)
        {
            var port = new Port((raw.Code ?? string.Empty).Trim(), (raw.Description ?? string.Empty).Trim());
            ports.Add(port);
            if (!string.IsNullOrEmpty(port.Code)) portByCode[port.Code] = port;
        }
        progress?.Report($"  {ports.Count} ports");

        // --- Cabin grades ----------------------------------------------------
        progress?.Report("Loading cabin grades...");
        var gradeRows = await fileReader.ReadFileAsync<List<RawCabinGrade>>(sources.CabinGrades);
        var cabinGrades = new List<CabinGrade>();
        var cabinGradeByCode = new Dictionary<string, CabinGrade>();
        foreach (var raw in gradeRows)
        {
            var code = (raw.Code ?? string.Empty).Trim();
            if (code.Length == 0) continue;
            var byShip = new Dictionary<string, List<string>>();
            foreach (var sd in raw.ShipDescriptions ?? new List<RawShipDescription>())
            {
                var shipCode = (sd.ShipCode ?? string.Empty).Trim();
                var desc = (sd.Description ?? string.Empty).Trim();
                if (desc.Length == 0) continue;
                if (!byShip.TryGetValue(shipCode, out var list)) byShip[shipCode] = list = new List<string>();
                if (!list.Contains(desc)) list.Add(desc);
            }
            var grade = new CabinGrade(code, byShip);
            cabinGrades.Add(grade);
            cabinGradeByCode[code] = grade;
        }
        progress?.Report($"  {cabinGrades.Count} cabin grades");

        // --- Voyages + departures -------------------------------------------
        progress?.Report("Loading voyages...");
        var voyageRows = await fileReader.ReadFileAsync<List<RawVoyage>>(sources.Voyages);
        var voyages = new List<Voyage>();
        var departures = new List<Departure>();
        var departureByCode = new Dictionary<string, Departure>();

        foreach (var raw in voyageRows)
        {
            var voyage = new Voyage(
                (raw.Heading ?? string.Empty).Trim(),
                (raw.Intro ?? string.Empty).Trim(),
                (raw.SellingPoints ?? new List<string?>()).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!.Trim()).ToList(),
                (raw.DurationText ?? string.Empty).Trim(),
                (raw.TravelSuggestionCodes ?? new List<string?>()).Where(c => !string.IsNullOrEmpty(c)).Select(c => c!).ToList(),
                raw.FromPort,
                raw.ToPort,
                (raw.Itinerary ?? new List<RawItineraryDay>()).Select(d => new ItineraryDay(d.Day, d.Location, d.Heading)).ToList());
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

            // First voyage to reference a code owns it.
            foreach (var code in voyage.TravelSuggestionCodes)
            {
                if (departureByCode.ContainsKey(code)) continue;
                var dep = new Departure(code, ParseDateFromCode(code));
                var ship = shipById.TryGetValue(dep.ShipCode, out var s) ? s : null;
                dep.SetShip(ship);
                dep.SetVoyage(voyage);
                voyage.AddDeparture(dep);
                ship?.AddDeparture(dep);
                departures.Add(dep);
                departureByCode[code] = dep;
            }
        }
        progress?.Report($"  {voyages.Count} voyages, {departures.Count} departures");

        // --- Offerings (source-market rate files) ----------------------------
        var offerings = new List<CabinOffering>();
        var offeringByKey = new Dictionary<string, CabinOffering>();

        foreach (var file in sources.SourceMarkets)
        {
            progress?.Report($"Indexing {Path.GetFileName(file)}...");
            var rows = await fileReader.ReadFileAsync<List<RawSourceMarketRow>>(file);
            foreach (var row in rows)
            {
                var depCode = StripTourCode(row.TourCode);
                if (depCode.Length == 0) continue;
                if (!departureByCode.TryGetValue(depCode, out var departure)) continue;

                var category = (row.Category ?? string.Empty).Trim();
                var key = depCode + "|" + category;

                if (!offeringByKey.TryGetValue(key, out var offering))
                {
                    offering = new CabinOffering(category, (row.SuperCategory ?? string.Empty).Trim(), row.AvailableCabins);
                    offering.SetDeparture(departure);
                    departure.AddOffering(offering);

                    if (cabinGradeByCode.TryGetValue(category, out var grade))
                    {
                        offering.SetCabinGrade(grade);
                        grade.AddOffering(offering);
                        if (departure.Ship is not null)
                        {
                            grade.AddShip(departure.Ship);
                            departure.Ship.AddCabinGrade(grade);
                        }
                    }

                    offerings.Add(offering);
                    offeringByKey[key] = offering;
                }

                departure.SetEndDate(row.TourEndDate);
                offering.AddPrice((row.Currency ?? string.Empty).Trim(), ParseRate(row.RateSgl), ParseRate(row.RateDbl));
            }
        }
        progress?.Report($"  {offerings.Count} cabin offerings indexed");

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

    // --- helpers -------------------------------------------------------------

    /// <summary>Source-market TourCodes are prefixed with "_@" before the actual code.</summary>
    private static string StripTourCode(string? tourCode)
    {
        if (string.IsNullOrEmpty(tourCode)) return string.Empty;
        return tourCode.StartsWith("_@", StringComparison.Ordinal) ? tourCode.Substring(2) : tourCode;
    }

    /// <summary>Codes end in a YYMMDD stamp, e.g. "SCGALEMAC-260403" -> 2026-04-03.</summary>
    private static string? ParseDateFromCode(string code)
    {
        var m = Regex.Match(code, "-(\\d{6})$");
        if (!m.Success) return null;
        var s = m.Groups[1].Value;
        return $"20{s.Substring(0, 2)}-{s.Substring(2, 2)}-{s.Substring(4, 2)}";
    }

    private static double? ParseRate(string? value)
    {
        if (string.IsNullOrEmpty(value)) return null;
        return double.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var d) ? d : null;
    }

    private static int? ToInt(JsonElement? element)
    {
        if (element is not JsonElement e) return null;
        if (e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var n)) return n;
        if (e.ValueKind == JsonValueKind.String && int.TryParse(e.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var m)) return m;
        return null;
    }
}
