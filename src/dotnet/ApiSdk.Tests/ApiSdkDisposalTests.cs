using System.Text.Json;
using ApiSdk.Data;

namespace ApiSdk.Tests;

/// <summary>
/// Covers <see cref="ApiSdk"/>'s own disposal contract (as opposed to
/// <see cref="SwOTADataSourceTests"/>, which covers <c>LoadAsync</c>'s SwOTA
/// dispatch/graph behaviour): once <see cref="IDisposable.Dispose"/> has run,
/// the instance must not be usable again, and specifically must not silently
/// resurrect/reuse the now-disposed owned <c>SwOTAAvailabilityClient</c> via
/// the <c>??=</c> in <c>LoadAsync</c>.
/// </summary>
public class ApiSdkDisposalTests
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private static readonly Dictionary<string, string> V3Files = new()
    {
        ["ports.json"] = """
            [{ "code": "USOME", "country": "US", "description": "Seattle" }]
            """,
        ["ships_AU.json"] = """
            [{
              "shipId": "FN", "heading": "MS Fram",
              "passengerCapacity": "200", "yearOfConstruction": "2007",
              "grossTonnage": "11,647 t", "length": "114 m", "speed": "13 knots"
            }]
            """,
        ["voyages_AU.json"] = """
            [{
              "VoyageID": "_@FNALA04-260906",
              "DepartureDate": "2026-09-06",
              "ArrivalDate": "2026-09-23",
              "DeparturePort": "USOME",
              "ArrivalPort": "USOME",
              "ShipCode": "FN",
              "Description": "Alaska",
              "Currency": "AUD",
              "categories": [
                { "Category": "MA", "MaxOccupancy": 4, "Rate_Sgl": null, "Rate_Dbl": "38995.00", "RateCode": "BESTPRICE" }
              ]
            }]
            """,
    };

    private static readonly DataSources SwOTASources = new()
    {
        Voyages = "voyages_AU.json",
        Ships = "ships_AU.json",
        CabinGrades = "unused.json",
        Ports = "ports.json",
        Format = DataSourceFormat.SwOTA,
    };

    /// <summary>Same shape as <c>SwOTADataSourceTests.FakeReader</c>: serves
    /// canned V3-shaped JSON by filename.</summary>
    private sealed class FakeReader : IFlatFileReader
    {
        private readonly IReadOnlyDictionary<string, string> _files;
        public FakeReader(IReadOnlyDictionary<string, string> files) => _files = files;

        private string Resolve(string filePath)
        {
            var name = Path.GetFileName(filePath);
            if (!_files.TryGetValue(name, out var json))
                throw new FileNotFoundException($"No canned file for {name}", filePath);
            return json;
        }

        public Task<string> ReadFileAsync(string filePath) => Task.FromResult(Resolve(filePath));

        public Task<T> ReadFileAsync<T>(string filePath) =>
            Task.FromResult(JsonSerializer.Deserialize<T>(Resolve(filePath), JsonOptions)!);

        public bool ValidatePath(string filePath) => true;
    }

    [Fact]
    public async Task LoadAsync_after_Dispose_throws_ObjectDisposedException_instead_of_reusing_the_disposed_owned_client()
    {
        // No ISwOTAAvailabilityClient injected: LoadAsync's `??=` will
        // construct (and own) a default SwOTAAvailabilityClient the first
        // time a SwOTA load runs.
        var sdk = ApiSdkFactory.CreateApiSdk(new FakeReader(V3Files));

        await sdk.LoadAsync(SwOTASources);
        Assert.True(sdk.IsLoaded);

        sdk.Dispose();

        await Assert.ThrowsAsync<ObjectDisposedException>(() => sdk.LoadAsync(SwOTASources));
    }

    [Fact]
    public void Dispose_is_idempotent()
    {
        var sdk = ApiSdkFactory.CreateApiSdk(new FakeReader(V3Files));

        sdk.Dispose();
        var exception = Record.Exception(() => sdk.Dispose());

        Assert.Null(exception);
    }
}
