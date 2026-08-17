using System.Text.Json;
using ApiSdk;
using ApiSdk.Data;

namespace ApiSdk.Tests;

/// <summary>
/// Mirrors the JavaScript SDK's graph tests (<c>src/js/src/__tests__/sdk.test.ts</c>).
/// These tests double as usage examples: they drive the SDK through a fake
/// in-memory <see cref="IFlatFileReader"/> serving canned, deterministic JSON
/// and assert EXACT values (not data-agnostic invariants). The fake reader is
/// the whole point of the interface abstraction: the SDK can be exercised with
/// zero filesystem access by swapping the reader implementation.
/// </summary>
public class ApiSdkGraphTests
{
    /// <summary>
    /// A fake <see cref="IFlatFileReader"/> that serves canned JSON keyed by file
    /// name. The C# analogue of the JS <c>FakeReader</c>: it resolves a request
    /// by <see cref="Path.GetFileName(string?)"/>, throws when no canned file
    /// exists, and deserializes with the same options the production reader uses.
    /// </summary>
    private sealed class FakeReader : IFlatFileReader
    {
        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
        };

        private readonly IReadOnlyDictionary<string, string> _files;

        public FakeReader(IReadOnlyDictionary<string, string> files) => _files = files;

        private string Resolve(string filePath)
        {
            var name = Path.GetFileName(filePath);
            if (!_files.TryGetValue(name, out var json))
                throw new InvalidOperationException($"FakeReader: no canned file for {name}");
            return json;
        }

        public Task<string> ReadFileAsync(string filePath) => Task.FromResult(Resolve(filePath));

        public Task<T> ReadFileAsync<T>(string filePath) =>
            Task.FromResult(JsonSerializer.Deserialize<T>(Resolve(filePath), JsonOptions)!);

        public bool ValidatePath(string filePath) => true;
    }

    private static readonly DataSources Sources = new()
    {
        Voyages = "voyages.json",
        Ships = "ships.json",
        CabinGrades = "cabingrades.json",
        Ports = "portlist.json",
        SourceMarkets = new[] { "SourceMarket_GBP.json" },
        // Format is now required (no compiled-in default). This suite drives the
        // V1 (originally "dev") format.
        Format = DataSourceFormat.V1,
    };

    private static Dictionary<string, string> BuildFiles() => new()
    {
        ["ships.json"] = """
            [{ "shipId": "SC", "heading": "MS Test Ship" }]
            """,
        ["portlist.json"] = """
            [{ "code": "AAA", "description": "PORT A" }]
            """,
        ["cabingrades.json"] = """
            [{ "code": "DS", "shipDescriptions": [{ "shipCode": "SC", "description": "Darwin Suite desc" }] }]
            """,
        // One voyage with one upcoming (260101) and one past (250101) departure.
        ["voyages.json"] = """
            [{
              "heading": "Test Voyage",
              "intro": "an intro",
              "sellingPoints": ["point one"],
              "durationText": "6 days",
              "travelSuggestionCodes": ["SCABC-260101", "SCABC-250101"],
              "itinerary": [
                { "day": "Day 1", "location": "PORT A", "heading": "Arrival", "body": "<p>Welcome aboard.</p>" }
              ]
            }]
            """,
        ["SourceMarket_GBP.json"] = """
            [{
              "TourCode": "_@SCABC-260101",
              "Category": "DS",
              "SuperCategory": "SUITE",
              "Currency": "GBP",
              "Rate_Sgl": "100.00",
              "Rate_Dbl": "90.00",
              "AvailableCabins": 3,
              "TourStartDate": "2026-01-01",
              "TourEndDate": "2026-01-07"
            }]
            """,
    };

    private static IApiSdk NewSdk() => ApiSdkFactory.CreateApiSdk(new FakeReader(BuildFiles()));

    [Fact]
    public async Task SDK_loads_through_the_reader_interface_and_reports_stats()
    {
        var sdk = NewSdk();
        Assert.False(sdk.IsLoaded);

        await sdk.LoadAsync(Sources);

        Assert.True(sdk.IsLoaded);
        Assert.Equal(1, sdk.Stats.VoyageCount);
        Assert.Equal(1, sdk.Stats.ShipCount);
        Assert.Equal(2, sdk.Stats.DepartureCount);
        Assert.Equal(1, sdk.Stats.OfferingCount);
    }

    [Fact]
    public async Task Forward_traversal_voyage_to_departure_to_ship_to_cabin_grades()
    {
        var sdk = await NewSdk().LoadAsync(Sources);

        var voyage = sdk.Voyages[0];
        var departure = sdk.GetDeparture("SCABC-260101");

        Assert.NotNull(departure);
        Assert.Same(voyage, departure!.Voyage);
        Assert.Equal("SC", departure.Ship?.Id);
        Assert.Equal("SC", departure.ShipCode);
        Assert.Equal(new[] { "DS" }, departure.CabinGrades.Select(g => g.Code));
    }

    [Fact]
    public async Task Offering_carries_description_and_prices()
    {
        var sdk = await NewSdk().LoadAsync(Sources);

        var offering = sdk.GetDeparture("SCABC-260101")?.OfferingForGrade("DS");

        Assert.NotNull(offering);
        Assert.Equal("SUITE", offering!.Name);
        Assert.Equal(3, offering.AvailableCabins);
        Assert.Equal(new[] { "Darwin Suite desc" }, offering.Description);
        Assert.Equal(90, offering.PriceFor("GBP")?.Double);
        Assert.Equal(100, offering.PriceFor("GBP")?.Single);
    }

    [Fact]
    public async Task Reverse_traversal_cabinGrade_and_ship_navigate_back_to_voyage()
    {
        var sdk = await NewSdk().LoadAsync(Sources);

        var voyage = sdk.Voyages[0];
        var grade = sdk.GetCabinGrade("DS");

        Assert.NotNull(grade);
        Assert.Same(voyage, grade!.Departures[0].Voyage);
        Assert.Equal(new[] { "SC" }, grade.Ships.Select(s => s.Id));
        Assert.Same(voyage, sdk.GetShip("SC")?.Voyages[0]);
    }

    [Fact]
    public async Task UpcomingDepartures_filters_out_past_departures()
    {
        var sdk = await NewSdk().LoadAsync(Sources);

        // asOf sits between the two departures (2025-01-01 past, 2026-01-01 upcoming).
        var upcoming = sdk.Voyages[0].UpcomingDepartures("2025-12-01");

        Assert.Equal(new[] { "SCABC-260101" }, upcoming.Select(d => d.Code));
    }

    /// <summary>
    /// <see cref="ItineraryDay.Body"/> is an init-only property (not a positional
    /// record parameter) specifically so adding it didn't change the record's
    /// constructor arity/Deconstruct for consumers on an unchanged package
    /// version. This asserts the V1 loader still wires it through end to end.
    /// </summary>
    [Fact]
    public async Task V1_itinerary_day_body_is_wired_through_the_loader()
    {
        var sdk = await NewSdk().LoadAsync(Sources);

        var day = Assert.Single(sdk.Voyages[0].Itinerary);
        Assert.Equal("Day 1", day.Day);
        Assert.Equal("PORT A", day.Location);
        Assert.Equal("Arrival", day.Heading);
        Assert.Equal("<p>Welcome aboard.</p>", day.Body);
    }

    /// <summary>
    /// Regression guard for the record shape itself: <c>ItineraryDay</c> must
    /// keep its 3-arity positional constructor (Day, Location, Heading) with
    /// Body settable only via object-initializer syntax. If Body were ever
    /// made positional again, this call site wouldn't compile.
    /// </summary>
    [Fact]
    public void ItineraryDay_body_is_object_initializer_only()
    {
        var day = new ItineraryDay("Day 1", "PORT A", "Arrival") { Body = "text" };

        Assert.Equal("Day 1", day.Day);
        Assert.Equal("PORT A", day.Location);
        Assert.Equal("Arrival", day.Heading);
        Assert.Equal("text", day.Body);
    }
}
