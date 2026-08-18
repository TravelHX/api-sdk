using System.Text.Json;
using ApiSdk.Availability;
using ApiSdk.Data;

namespace ApiSdk.Tests;

/// <summary>
/// Covers <see cref="DataSourceFormat.SwOTA"/> dispatch in <c>ApiSdk.LoadAsync</c>:
/// it reuses <c>V3DataSetLoader</c> (same graph as plain V3, plus a live
/// availability client wired onto each offering), and falls back to
/// <c>V1DataSetLoader</c> when the V3 source is unavailable — mirrored here via
/// the same "missing" signal <see cref="IFlatFileReader"/> already uses in
/// production: <see cref="FileNotFoundException"/>.
/// </summary>
public class SwOTADataSourceTests
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

    /// <summary>
    /// Serves canned V3-shaped JSON by filename, exactly like
    /// <c>V3DataSetLoaderTests.FakeReader</c>. Used for the "V3 source present"
    /// path.
    /// </summary>
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

    /// <summary>
    /// Simulates "the V3 source is unavailable": any read requested in a V3
    /// shape (raw type name starts with "RawProd") throws
    /// <see cref="FileNotFoundException"/>, mirroring what the real
    /// <see cref="FlatFileReader"/> throws for a genuinely missing file. Reads
    /// requested in a V1 shape succeed against canned data — this is the
    /// content <see cref="V1DataSetLoader"/> picks up on fallback.
    /// </summary>
    private sealed class V3UnavailableReader : IFlatFileReader
    {
        private readonly IReadOnlyDictionary<string, string> _v1Files;
        public V3UnavailableReader(IReadOnlyDictionary<string, string> v1Files) => _v1Files = v1Files;

        public Task<string> ReadFileAsync(string filePath) =>
            throw new NotSupportedException("Not used by these loaders.");

        public Task<T> ReadFileAsync<T>(string filePath)
        {
            var typeName = typeof(T).GenericTypeArguments.Length > 0
                ? typeof(T).GenericTypeArguments[0].Name
                : typeof(T).Name;

            if (typeName.StartsWith("RawProd", StringComparison.Ordinal))
                throw new FileNotFoundException($"V3 source unavailable for {filePath}", filePath);

            var name = Path.GetFileName(filePath);
            if (!_v1Files.TryGetValue(name, out var json))
                throw new FileNotFoundException($"No canned V1 file for {name}", filePath);

            return Task.FromResult(JsonSerializer.Deserialize<T>(json, JsonOptions)!);
        }

        public bool ValidatePath(string filePath) => true;
    }

    private sealed class StubClient : ISwOTAAvailabilityClient
    {
        public int InvocationCount { get; private set; }
        public string? LastVoyageId { get; private set; }

        public Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default)
        {
            InvocationCount++;
            LastVoyageId = voyageId;
            return Task.FromResult<int?>(11);
        }
    }

    [Fact]
    public async Task SwOTA_loads_the_graph_like_V3_when_the_V3_source_is_present()
    {
        using var sdk = ApiSdkFactory.CreateApiSdk(new FakeReader(V3Files));

        await sdk.LoadAsync(SwOTASources);

        Assert.True(sdk.IsLoaded);
        Assert.Equal(1, sdk.Stats.VoyageCount);
        Assert.Equal(1, sdk.Stats.ShipCount);
        Assert.Equal(1, sdk.Stats.DepartureCount);
        Assert.Equal(1, sdk.Stats.OfferingCount);
        // Same as plain V3: no separate cabin-grade reference.
        Assert.Equal(0, sdk.Stats.CabinGradeCount);

        var dep = sdk.GetDeparture("FNALA04-260906");
        Assert.NotNull(dep);
        Assert.Equal("FN", dep!.Ship?.Id);
    }

    [Fact]
    public async Task SwOTA_wires_the_live_client_onto_offerings()
    {
        var client = new StubClient();
        using var sdk = ApiSdkFactory.CreateApiSdk(new FakeReader(V3Files), client);

        await sdk.LoadAsync(SwOTASources);

        var offering = sdk.GetDeparture("FNALA04-260906")!.OfferingForGrade("MA");
        Assert.NotNull(offering);

        var result = await offering!.GetAvailableCabinsAsync();

        Assert.Equal(11, result);
        Assert.Equal(1, client.InvocationCount);
    }

    /// <summary>
    /// Regression test for a bug where the live client was invoked with the
    /// departure's stripped code (e.g. "FNALA04-260906") instead of the raw,
    /// unstripped VoyageID SWOTA's REST API actually requires (e.g.
    /// "_@FNALA04-260906"). The departure's own identity/keying must still use
    /// the stripped form (covered above via <c>GetDeparture("FNALA04-260906")</c>)
    /// — only the value handed to the live client must be the raw one.
    /// </summary>
    [Fact]
    public async Task SwOTA_invokes_the_live_client_with_the_raw_unstripped_VoyageID()
    {
        var client = new StubClient();
        using var sdk = ApiSdkFactory.CreateApiSdk(new FakeReader(V3Files), client);

        await sdk.LoadAsync(SwOTASources);

        var offering = sdk.GetDeparture("FNALA04-260906")!.OfferingForGrade("MA");
        Assert.NotNull(offering);

        await offering!.GetAvailableCabinsAsync();

        Assert.Equal("_@FNALA04-260906", client.LastVoyageId);
    }

    /// <summary>
    /// Fail-fast guard: "NaT" is a null-sentinel value (see
    /// <c>V3Normalization.NormalizeString</c>) that <c>StripVoyageId</c>'s
    /// cruder "_@"-prefix-only stripping does NOT catch (no "_@" prefix to
    /// strip, so it passes through as a non-empty depCode), while the properly
    /// normalized raw voyageId ends up empty. Without the guard, this would
    /// silently wire a live <see cref="Data.CabinOffering"/> with an empty
    /// voyageId, which would 404/error against the real SWOTA API on every
    /// lookup instead of failing loudly here. Mirrors the equivalent JS test
    /// in <c>swota.test.ts</c>.
    /// </summary>
    [Fact]
    public async Task SwOTA_fails_fast_when_a_VoyageID_normalizes_to_empty()
    {
        var files = new Dictionary<string, string>(V3Files)
        {
            ["voyages_AU.json"] = """
                [{
                  "VoyageID": "NaT",
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
        var client = new StubClient();
        using var sdk = ApiSdkFactory.CreateApiSdk(new FakeReader(files), client);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => sdk.LoadAsync(SwOTASources));

        Assert.Contains("empty/unmapped VoyageID", ex.Message);
    }

    [Fact]
    public async Task SwOTA_falls_back_to_V1_when_the_V3_source_is_missing()
    {
        var v1Files = new Dictionary<string, string>
        {
            ["ships_AU.json"] = """
                [{ "shipId": "SC", "heading": "MS Test Ship" }]
                """,
            ["ports.json"] = """
                [{ "code": "AAA", "description": "PORT A" }]
                """,
            ["unused.json"] = """
                [{ "code": "DS", "shipDescriptions": [{ "shipCode": "SC", "description": "Darwin Suite desc" }] }]
                """,
            ["voyages_AU.json"] = """
                [{
                  "heading": "Fallback Voyage",
                  "intro": "an intro",
                  "sellingPoints": ["point one"],
                  "durationText": "6 days",
                  "travelSuggestionCodes": ["SCABC-260101"]
                }]
                """,
        };

        using var sdk = ApiSdkFactory.CreateApiSdk(new V3UnavailableReader(v1Files));

        await sdk.LoadAsync(SwOTASources);

        Assert.True(sdk.IsLoaded);
        // V1 shape landed: one voyage with one departure derived from its
        // travelSuggestionCodes, no offerings (no SourceMarkets configured).
        Assert.Equal(1, sdk.Stats.VoyageCount);
        Assert.Equal(1, sdk.Stats.ShipCount);
        Assert.Equal(1, sdk.Stats.DepartureCount);
        Assert.Equal("Fallback Voyage", sdk.Voyages[0].Heading);
        Assert.NotNull(sdk.GetDeparture("SCABC-260101"));
    }
}
