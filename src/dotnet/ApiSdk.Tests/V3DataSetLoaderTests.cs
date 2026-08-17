using System.Text.Json;
using ApiSdk;
using ApiSdk.Data;

namespace ApiSdk.Tests;

/// <summary>
/// Drives the V3 loader through a fake in-memory reader with canned V3-shaped
/// JSON (no fixture files), asserting exact graph values: embedded pricing,
/// "_@" VoyageID stripping, string→int ship fields, numbers-with-units dropped,
/// and that CabinGrades stays empty (V3 has no grade reference).
/// </summary>
public class V3DataSetLoaderTests
{
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
        Voyages = "voyages_AU.json",
        Ships = "ships_AU.json",
        CabinGrades = "unused.json",
        Ports = "ports.json",
        Format = DataSourceFormat.V3,
    };

    private static Dictionary<string, string> BuildFiles() => new()
    {
        ["ports.json"] = """
            [{ "code": "USOME", "country": "US", "description": "Seattle" },
             { "code": "CAVAN", "country": "CA", "description": "Vancouver" }]
            """,
        ["ships_AU.json"] = """
            [{
              "shipId": "FN",
              "heading": "MS Fram",
              "passengerCapacity": "200",
              "yearOfConstruction": "2007",
              "grossTonnage": "11,647 t",
              "length": "114 m",
              "speed": "13 knots"
            }]
            """,
        ["voyages_AU.json"] = """
            [{
              "VoyageID": "_@FNALA04-260906",
              "DepartureDate": "2026-09-06",
              "ArrivalDate": "2026-09-23",
              "EmbarkationTime": "2026-09-07T22:00:00",
              "DisembarkationTime": "2026-09-23T08:00:00",
              "DeparturePort": "USOME",
              "ArrivalPort": "CAVAN",
              "ShipCode": "FN",
              "Description": "Alaska and British Columbia",
              "Region": "ALASKA",
              "Currency": "AUD",
              "itinerary": [{ "day": 1, "location": null, "heading": "Scenic Seattle", "body": "x", "mediaContent": ["u"] }],
              "categories": [
                { "Category": "MA", "MaxOccupancy": 4, "Rate_Sgl": null, "Rate_Dbl": "38995.00", "RateCode": "BESTPRICE" },
                { "Category": "MG", "MaxOccupancy": 2, "Rate_Sgl": "50000.00", "Rate_Dbl": "45000.00", "RateCode": "BESTPRICE" }
              ]
            }]
            """,
    };

    private static async Task<IApiSdk> LoadV3Async()
    {
        var sdk = ApiSdkFactory.CreateApiSdk(new FakeReader(BuildFiles()));
        return await sdk.LoadAsync(Sources);
    }

    [Fact]
    public async Task V3_builds_graph_with_embedded_pricing()
    {
        var sdk = await LoadV3Async();

        Assert.True(sdk.IsLoaded);
        Assert.Equal(1, sdk.Stats.VoyageCount);
        Assert.Equal(1, sdk.Stats.ShipCount);
        Assert.Equal(1, sdk.Stats.DepartureCount);
        Assert.Equal(2, sdk.Stats.OfferingCount);
        // V3 has no separate cabin-grade reference: grades stay empty.
        Assert.Equal(0, sdk.Stats.CabinGradeCount);
    }

    [Fact]
    public async Task V3_strips_voyage_id_and_dates_the_departure()
    {
        var sdk = await LoadV3Async();

        var dep = sdk.GetDeparture("FNALA04-260906");
        Assert.NotNull(dep);
        Assert.Equal("2026-09-06", dep!.Date);
        Assert.Equal("2026-09-23", dep.EndDate);
        Assert.Equal("FN", dep.Ship?.Id);
    }

    [Fact]
    public async Task V3_parses_ship_string_ints_and_drops_unit_fields()
    {
        var sdk = await LoadV3Async();

        var ship = sdk.GetShip("FN");
        Assert.NotNull(ship);
        Assert.Equal(200, ship!.PassengerCapacity);
        Assert.Equal(2007, ship.YearOfConstruction);
        // grossTonnage/length/speed have no entity home; nothing else to assert.
        Assert.Equal("MS Fram", ship.Name);
    }

    [Fact]
    public async Task V3_embedded_rates_and_currency_land_on_offering()
    {
        var sdk = await LoadV3Async();

        var dep = sdk.GetDeparture("FNALA04-260906")!;
        var ma = dep.OfferingForGrade("MA");
        Assert.NotNull(ma);
        Assert.Null(ma!.PriceFor("AUD")?.Single);
        Assert.Equal(38995d, ma.PriceFor("AUD")?.Double);

        var mg = dep.OfferingForGrade("MG");
        Assert.NotNull(mg);
        Assert.Equal(50000d, mg!.PriceFor("AUD")?.Single);
        Assert.Equal(45000d, mg.PriceFor("AUD")?.Double);
    }

    [Fact]
    public async Task V3_wires_ports_and_itinerary()
    {
        var sdk = await LoadV3Async();

        var voyage = sdk.Voyages[0];
        Assert.Equal("Alaska and British Columbia", voyage.Heading);
        Assert.Equal("USOME", voyage.FromPort?.Code);
        Assert.Equal("CAVAN", voyage.ToPort?.Code);
        Assert.Single(voyage.Itinerary);
        Assert.Equal("1", voyage.Itinerary[0].Day);
        Assert.Equal("Scenic Seattle", voyage.Itinerary[0].Heading);
        Assert.Equal("x", voyage.Itinerary[0].Body);
    }
}
