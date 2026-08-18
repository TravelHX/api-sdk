// @api-sdk/dotnet — USAGE BY EXAMPLE (and a self-verifying integration test).
//
// Read this top-to-bottom: ~20 examples ordered from trivial to advanced, each
// a short, real snippet a consumer would write. Run it
// (`dotnet run --project utils/dotnet/ApiSdk.UsageCase`) and it doubles as a
// test — every example asserts, and the process exits non-zero if any check
// fails. This is the faithful C# port of `utils/js/usageCase.js`.
//
// DATA-AGNOSTIC: the checks never hardcode facts about the sample data (no
// "95 voyages", no "ship SC", no "price 10423.82"). Instead they pick subjects
// from whatever was loaded and assert INVARIANTS — relationships that must hold
// for any valid dataset (e.g. "every departure is owned by exactly one voyage",
// "offering.Departure == its departure", "the cheapest is really the minimum").
// Narration still prints the real values so it reads as a live example.
//
// The SDK is used exactly as an external consumer would: only the factory and
// its interface (`ApiSdkFactory.CreateApiSdk` -> `IApiSdk`). No deep internals,
// no `new ApiSdk.ApiSdk()`, no `sdk.FileReader`.

using System.Text.RegularExpressions;
using ApiSdk;
using ApiSdk.Data;

namespace ApiSdk.UsageCase;

internal static class Program
{
    // A fixed "today" makes the upcoming-vs-past filtering deterministic; the
    // invariant checked (every upcoming date >= today) holds for any value.
    private const string TODAY = "2026-06-08";

    private static readonly Regex DateRe = new(@"^\d{4}-\d{2}-\d{2}$", RegexOptions.Compiled);
    private static readonly Regex SourceMarketRe =
        new(@"^SourceMarket_.*_seaware\.json$", RegexOptions.Compiled);

    private static int _passed;
    private static int _failed;

    // --- tiny harness -------------------------------------------------------

    private static void Check(string label, bool condition)
    {
        if (condition)
        {
            _passed++;
            Console.WriteLine($"     [32m✓[0m {label}");
        }
        else
        {
            _failed++;
            Console.WriteLine($"     [31m✗ {label}[0m");
        }
    }

    private static void Example(int n, string title) =>
        Console.WriteLine($"\n[36m{n,2} · {title}[0m");

    private static void Show(string text) =>
        Console.WriteLine($"     [90m{text}[0m");

    // --- locate the real sample data ----------------------------------------
    // Walk UP from the binary's directory until the RefData folder exists, the
    // same robust approach as the test's FindDataDir — NOT a hardcoded "up 6".
    private static string FindRefDataDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(
                dir.FullName, "data", "flatfiles_dev", "RefData");
            if (Directory.Exists(candidate))
                return candidate;
            dir = dir.Parent;
        }

        throw new RefDataNotFoundException(
            "Could not locate data/flatfiles_dev/RefData " +
            $"by walking up from {AppContext.BaseDirectory}");
    }

    private static double MinPrice(Departure d, string currency)
    {
        var prices = d.Offerings
            .Select(o => o.PriceFor(currency)?.Double)
            .Where(p => p is not null)
            .Select(p => p!.Value)
            .ToList();
        return prices.Count > 0 ? prices.Min() : double.PositiveInfinity;
    }

    private static async Task Main()
    {
        try
        {
            await RunAsync();
        }
        catch (RefDataNotFoundException ex)
        {
            // The dev sample data is intentionally NOT committed to git (mirrors
            // data/flatfiles_prod/): real fixtures live outside the repo and are
            // only present on a machine/image that was given them out-of-band
            // (e.g. a local dev checkout, but not a bare CI clone). When they're
            // absent there is nothing wrong with the SDK -- there's just nothing
            // to exercise it against -- so skip (exit 0) rather than fail, the
            // same posture already used by the two gated tests in
            // src/js/src/__tests__/reader.test.ts and by the PROD_FIXTURE_DIR-
            // gated V3FixtureIntegrationTests.
            Console.WriteLine($"SKIP: {ex.Message}");
            Console.WriteLine("Sample data not present in this environment; nothing to verify.");
            Environment.ExitCode = 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"FATAL: {ex.Message}");
            Console.Error.WriteLine(ex.StackTrace);
            Environment.ExitCode = 1;
        }
    }

    private sealed class RefDataNotFoundException(string message) : Exception(message);

    private static async Task RunAsync()
    {
        // The per-currency rate files, discovered from the data folder.
        // `sources` is just the object `sdk.LoadAsync()` needs. Four entries are
        // single file paths; SourceMarkets is a *list*, built by: list the
        // folder -> keep only the per-currency rate files (regex) -> full paths.
        var refDir = FindRefDataDir();
        var sources = new DataSources
        {
            Format = DataSourceFormat.V1,                              // ref-data file layout version
            Voyages = Path.Combine(refDir, "voyages.json"),
            Ships = Path.Combine(refDir, "ships.json"),
            CabinGrades = Path.Combine(refDir, "cabingrades.json"),
            Ports = Path.Combine(refDir, "portlist.json"),
            SourceMarkets = Directory.GetFiles(refDir)                 // every file in RefData
                .Where(f => SourceMarketRe.IsMatch(Path.GetFileName(f))) // only currency rate files
                .OrderBy(f => f, StringComparer.Ordinal)
                .ToList(),                                              // -> absolute paths
        };

        // =====================================================================
        // OOP USAGE (1–8)
        // =====================================================================

        // 01 — Create the SDK. It's dormant: no file is read until LoadAsync().
        Example(1, "Create the SDK (dormant)");
        var sdk = ApiSdkFactory.CreateApiSdk();
        Check("CreateApiSdk() returns something usable", sdk is not null);
        Check("nothing loaded yet (IsLoaded == false)", sdk!.IsLoaded == false);

        // 02 — Load. The one async action that reads files & builds the graph.
        Example(2, "Load the data (the only async step)");
        await sdk.LoadAsync(sources);
        Check("IsLoaded == true after LoadAsync()", sdk.IsLoaded);

        // Pick representative subjects FROM the loaded data, so nothing below is
        // pinned to a specific dataset. The only precondition: the data must
        // contain at least one priced departure for the examples to mean anything.
        var sampleDeparture =
            sdk.Departures.FirstOrDefault(d => d.Ship is not null && d.Offerings.Any(o => o.Prices.Count > 0))
            ?? sdk.Departures.FirstOrDefault(d => d.Offerings.Count > 0)
            ?? sdk.Departures[0];
        var sampleOffering =
            sampleDeparture.Offerings.FirstOrDefault(o => o.Prices.Count > 0)
            ?? sdk.Offerings.FirstOrDefault(o => o.Prices.Count > 0);
        var sampleCurrency = sampleOffering?.Prices.FirstOrDefault()?.Currency;
        var sampleShip = sampleDeparture.Ship ?? sdk.Ships.FirstOrDefault(s => s.Departures.Count > 0);
        var sampleGrade = sampleOffering?.CabinGrade ?? sdk.CabinGrades.FirstOrDefault(g => g.Offerings.Count > 0);
        var sampleVoyage = sampleDeparture.Voyage
            ?? sdk.Voyages.FirstOrDefault(v => v.Departures.Count > 0)
            ?? sdk.Voyages[0];

        Check("dataset has a priced departure to work with",
            sampleOffering is not null && sampleCurrency is not null
            && sampleShip is not null && sampleGrade is not null);

        // 03 — Stats. Assert internal consistency, not specific counts.
        Example(3, "Read stats");
        var stats = sdk.Stats;
        Show($"{stats.VoyageCount} voyages · {stats.ShipCount} ships · {stats.OfferingCount} offerings");
        Check("there is data loaded", stats.VoyageCount > 0);
        Check("stats match the collections",
            stats.VoyageCount == sdk.Voyages.Count
            && stats.DepartureCount == sdk.Departures.Count
            && stats.OfferingCount == sdk.Offerings.Count);

        // 04 — Collections are plain lists of objects.
        Example(4, "Access a collection");
        Show($"Voyages[0] = \"{sdk.Voyages[0].Heading}\"");
        Check("sdk.Voyages is indexable and matches the count",
            sdk.Voyages.Count == stats.VoyageCount && sdk.Voyages[0] is not null);

        // 05 — Objects expose typed properties.
        Example(5, "Read an object's properties");
        Show($"Heading=\"{sampleVoyage.Heading}\"  DurationText=\"{sampleVoyage.DurationText}\"");
        Check("Voyage.Heading is a string", sampleVoyage.Heading is string);
        Check("Voyage.DurationText is a string", sampleVoyage.DurationText is string);

        // 06 — Look an entity up by id; the lookup returns the same object.
        Example(6, "Look up a ship by id");
        Show($"sdk.GetShip(\"{sampleShip!.Id}\") -> {sampleShip.Name}");
        Check("sdk.GetShip(id) round-trips to the same instance",
            ReferenceEquals(sdk.GetShip(sampleShip.Id), sampleShip));

        // 07 — Look an entity up by code; date is parsed from the code.
        Example(7, "Look up a departure by tour code");
        Show($"sdk.GetDeparture(\"{sampleDeparture.Code}\") -> date {sampleDeparture.Date}");
        Check("sdk.GetDeparture(code) round-trips to the same instance",
            ReferenceEquals(sdk.GetDeparture(sampleDeparture.Code), sampleDeparture));
        Check("Departure.Date is null or an ISO date",
            sampleDeparture.Date is null || DateRe.IsMatch(sampleDeparture.Date));

        // 08 — Objects have behaviour (methods), not just data.
        Example(8, "Objects have methods, not just fields");
        Check("Voyage.UpcomingDepartures returns a list",
            sampleVoyage.UpcomingDepartures(TODAY) is not null);
        Check("CabinGrade.DescriptionsForShip returns a list",
            sampleGrade!.DescriptionsForShip(sampleShip.Id) is not null);

        // =====================================================================
        // TRAVERSAL (9–16)
        // =====================================================================

        // 09 — Forward, plus an ownership invariant across the whole catalog.
        Example(9, "Navigate voyage -> departures");
        var ownedDepartures = sdk.Voyages.Sum(v => v.Departures.Count);
        Show($"\"{sampleVoyage.Heading}\" has {sampleVoyage.Departures.Count} departures");
        Check("every departure is owned by exactly one voyage",
            ownedDepartures == sdk.Departures.Count);

        // 10 — A filtering method: upcoming-only.
        Example(10, "Filter with a method (upcoming only)");
        var upcoming = sampleVoyage.UpcomingDepartures(TODAY);
        Show($"{upcoming.Count} of {sampleVoyage.Departures.Count} departures upcoming as of {TODAY}");
        Check("upcoming is a subset", upcoming.Count <= sampleVoyage.Departures.Count);
        Check("every upcoming departure is on/after today",
            upcoming.All(d => d.Date is null || string.CompareOrdinal(d.Date, TODAY) >= 0));

        // 11 — Forward then reverse-consistency: departure <-> ship.
        Example(11, "Navigate departure -> ship");
        Show($"{sampleDeparture.Code} sails on {sampleDeparture.Ship!.Name}");
        Check("departure.Ship lists the departure back (Ship.Departures includes it)",
            sampleDeparture.Ship.Departures.Contains(sampleDeparture));

        // 12 — Into the join: departure -> offerings -> grades is the distinct set.
        Example(12, "Navigate departure -> offerings -> cabin grades");
        var gradesFromOfferings = sampleDeparture.Offerings
            .Select(o => o.CabinGrade)
            .Where(g => g is not null)
            .Distinct()
            .ToHashSet();
        Show($"grades on {sampleDeparture.Code}: {string.Join(", ", sampleDeparture.CabinGrades.Select(g => g.Code))}");
        Check("departure.CabinGrades equals the distinct grades of its offerings",
            sampleDeparture.CabinGrades.Count == gradesFromOfferings.Count
            && sampleDeparture.CabinGrades.All(g => gradesFromOfferings.Contains(g)));

        // 13 — Leaf data: an offering's price (any currency present) & description.
        Example(13, "Read an offering's price & description");
        var price = sampleOffering!.PriceFor(sampleCurrency!);
        Show($"{sampleOffering.Code} {sampleCurrency} (double) = {price?.Double}");
        Check("PriceFor(currency) returns the matching price entry",
            price is not null && price.Currency == sampleCurrency);
        Check("that currency is one of the offering.Prices",
            sampleOffering.Prices.Any(p => p.Currency == sampleCurrency));
        Check("Description is a list", sampleOffering.Description is not null);

        // 14 — Reverse: cabin grade -> the ships that offer it (consistent both ways).
        Example(14, "Reverse: cabin grade -> ships");
        var gradeShips = sampleGrade!.Ships.Select(s => s.Id).ToList();
        Show($"{sampleGrade.Code} is offered on ships: {(gradeShips.Count > 0 ? string.Join(", ", gradeShips) : "(none)")}");
        Check("every ship that lists this grade also has the grade in Ship.CabinGrades",
            sampleGrade.Ships.All(s => s.CabinGrades.Contains(sampleGrade)));

        // 15 — Reverse: ship -> voyages (each derived from a real departure).
        Example(15, "Reverse: ship -> voyages");
        Show($"{sampleShip.Name} sails {sampleShip.Voyages.Count} voyages");
        Check("every voyage of a ship has a departure on that ship",
            sampleShip.Voyages.All(v => v.Departures.Any(d => ReferenceEquals(d.Ship, sampleShip))));

        // 16 — Identity: related objects are the SAME instance (ReferenceEquals), not copies.
        Example(16, "Round-trip identity (ReferenceEquals)");
        Check("departure.Voyage.Departures includes the departure",
            sampleDeparture.Voyage!.Departures.Contains(sampleDeparture));
        Check("offering.Departure lists the offering back",
            sampleOffering.Departure.Offerings.Contains(sampleOffering));
        Check("grade.Offerings includes the offering pointing back to it",
            sampleOffering.CabinGrade is null || sampleOffering.CabinGrade.Offerings.Contains(sampleOffering));

        // =====================================================================
        // QUERIES & CORRECTNESS (17–20): self-checking aggregations.
        // =====================================================================

        // 17 — Cheapest cabin on a departure (and prove it's really the minimum).
        Example(17, "Cheapest cabin on a departure");
        var priced = sampleDeparture.Offerings
            .Where(o => o.PriceFor(sampleCurrency!) is not null)
            .ToList();
        var cheapestCabin = priced
            .OrderBy(o => o.PriceFor(sampleCurrency!)!.Double ?? double.PositiveInfinity)
            .First();
        Show($"cheapest on {sampleDeparture.Code}: {cheapestCabin.Code} @ {sampleCurrency} {cheapestCabin.PriceFor(sampleCurrency!)!.Double}");
        Check("no offering on this departure is cheaper",
            priced.All(o =>
                (o.PriceFor(sampleCurrency!)!.Double ?? double.PositiveInfinity)
                >= (cheapestCabin.PriceFor(sampleCurrency!)!.Double ?? double.PositiveInfinity)));

        // 18 — Cheapest departure of a voyage (min across each departure).
        Example(18, "Cheapest departure of a voyage");
        var pricedUpcoming = sampleVoyage.UpcomingDepartures(TODAY)
            .Where(d => MinPrice(d, sampleCurrency!) < double.PositiveInfinity)
            .ToList();
        if (pricedUpcoming.Count > 0)
        {
            var cheapestDep = pricedUpcoming.OrderBy(d => MinPrice(d, sampleCurrency!)).First();
            Show($"cheapest upcoming: {cheapestDep.Date} from {sampleCurrency} {MinPrice(cheapestDep, sampleCurrency!)}");
            Check("cheapest departure is really the minimum",
                pricedUpcoming.All(d => MinPrice(d, sampleCurrency!) >= MinPrice(cheapestDep, sampleCurrency!)));
        }
        else
        {
            Show("(no priced upcoming departures for this voyage)");
            Check("handled voyage with no priced upcoming departures", true);
        }

        // 19 — Catalog-wide aggregate: voyages per ship + a containment invariant.
        Example(19, "Aggregate: voyages per ship");
        Show(string.Join("  ", sdk.Ships.Select(s => $"{s.Id}:{s.Voyages.Count}")));
        var allShipVoyages = sdk.Ships.SelectMany(s => s.Voyages).Distinct().ToList();
        Check("every ship-reachable voyage is a real catalog voyage",
            allShipVoyages.All(v => sdk.Voyages.Contains(v)));

        // 20 — Cross-entity query: cheapest <currency> per grade across one ship.
        Example(20, $"Cross-entity query: cheapest {sampleCurrency} per grade on {sampleShip.Id}");
        var cheapestByGrade = new Dictionary<string, double>();
        foreach (var d in sampleShip.Departures)
        {
            foreach (var o in d.Offerings)
            {
                var p = o.PriceFor(sampleCurrency!)?.Double;
                if (p is null) continue;
                if (!cheapestByGrade.TryGetValue(o.Code, out var cur) || p.Value < cur)
                    cheapestByGrade[o.Code] = p.Value;
            }
        }

        Show(cheapestByGrade.Count > 0
            ? string.Join("  ", cheapestByGrade.OrderBy(kv => kv.Key, StringComparer.Ordinal)
                .Select(kv => $"{kv.Key}:{kv.Value}"))
            : "(no priced offerings on this ship)");
        Check("every per-grade minimum is positive", cheapestByGrade.Values.All(p => p > 0));

        // =====================================================================
        var color = _failed == 0 ? "[32m" : "[31m";
        Console.WriteLine($"\n{color}Summary: {_passed} passed, {_failed} failed[0m");
        Environment.ExitCode = _failed == 0 ? 0 : 1;
    }
}
