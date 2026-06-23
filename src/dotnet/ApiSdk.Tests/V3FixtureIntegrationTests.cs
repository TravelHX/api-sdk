using ApiSdk;
using Xunit;

namespace ApiSdk.Tests;

/// <summary>
/// Fixture-gated integration tests for the V3 loader. They point a V3
/// <see cref="DataSources"/> at a real V3 flat-file directory and load a
/// country (AU). The fixture directory is resolved at runtime from the
/// <c>PROD_FIXTURE_DIR</c> environment variable (the variable name is kept as
/// an existing external CI contract). The theory RUNS only when
/// <c>PROD_FIXTURE_DIR</c> is set to a path that points at a valid
/// V3-flatfiles directory; otherwise it is reported as SKIPPED rather than
/// failed. This keeps the test portable: it carries no machine-specific path
/// and runs wherever a V3 fixture is provided via that variable.
///
/// The gating uses <see cref="SkippableTheoryAttribute"/> + <see cref="Skip"/>
/// from Xunit.SkippableFact, which is honored by the VSTest adapter that
/// <c>dotnet test</c> drives (xunit.runner.visualstudio). The empty-MemberData
/// route was deliberately avoided: on this toolchain (xUnit 2.9.2 +
/// xunit.runner.visualstudio 2.8.2) an empty theory still FAILS with
/// "No data found", and the xunit.runner.json <c>skipTestWithNoData</c> flag is
/// NOT honored by the VSTest adapter (that flag is an xUnit v3 feature), so it
/// could not be used to make the gate skip-not-fail here.
/// </summary>
public class V3FixtureIntegrationTests
{
    private static readonly string? FixtureDir =
        Environment.GetEnvironmentVariable("PROD_FIXTURE_DIR");

    /// <summary>
    /// Country codes exercised by the integration theory. Always non-empty so the
    /// theory has data; the fixture-presence gate is applied at runtime via
    /// <see cref="Skip.IfNot"/> in the test body.
    /// </summary>
    public static IEnumerable<object[]> Countries()
    {
        yield return new object[] { "AU" };
    }

    private static DataSources SourcesFor(string fixtureDir, string cc) => new()
    {
        Voyages = Path.Combine(fixtureDir, $"voyages_{cc}.json"),
        Ships = Path.Combine(fixtureDir, $"ships_{cc}.json"),
        CabinGrades = "unused.json",
        Ports = Path.Combine(fixtureDir, "ports.json"),
        Format = DataSourceFormat.V3,
    };

    [SkippableTheory]
    [MemberData(nameof(Countries))]
    public async Task V3_fixture_loads_a_non_empty_graph(string cc)
    {
        // Gate: skip (not fail) when PROD_FIXTURE_DIR is unset/empty or the
        // directory it points at is absent (e.g. CI).
        Skip.IfNot(!string.IsNullOrEmpty(FixtureDir) && Directory.Exists(FixtureDir),
            "Prod fixture directory not present: PROD_FIXTURE_DIR is unset or the dir is absent " +
            $"(PROD_FIXTURE_DIR='{FixtureDir}').");

        var sdk = ApiSdkFactory.CreateApiSdk();

        await sdk.LoadAsync(SourcesFor(FixtureDir!, cc));

        Assert.True(sdk.IsLoaded);
        Assert.True(sdk.Stats.ShipCount > 0, "expected ships");
        Assert.True(sdk.Stats.PortCount > 0, "expected ports");
        Assert.True(sdk.Stats.VoyageCount > 0, "expected voyages");
        Assert.True(sdk.Stats.DepartureCount > 0, "expected departures");
        Assert.True(sdk.Stats.OfferingCount > 0, "expected offerings");

        // Spot-check graph wiring on the first departure that has a ship + offerings.
        var dep = sdk.Departures.FirstOrDefault(d => d.Ship is not null && d.Offerings.Count > 0);
        Assert.NotNull(dep);
        Assert.NotNull(dep!.Voyage);
        Assert.All(dep.Offerings, o => Assert.Same(dep, o.Departure));
    }
}
