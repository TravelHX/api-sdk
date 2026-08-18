using ApiSdk.Availability;
using Microsoft.Extensions.Configuration;

namespace ApiSdk.Tests;

/// <summary>
/// Covers <see cref="SwOTARestConfig.Bind"/>'s "no silent fallback" contract
/// (every field must come from configuration or binding throws), the
/// disk-based <c>config.json</c> + <c>config.local.json</c> layering
/// <see cref="SwOTARestConfig.LoadFromDiskOrThrow"/> relies on, and the
/// repo-root discovery <c>FindConfigDirectory</c> performs. Mirrors
/// <c>src/js/src/__tests__/swotaConfig.test.ts</c>'s coverage.
///
/// <see cref="SwOTARestConfig.LoadFromDiskOrThrow"/> itself isn't called
/// directly here, since it always resolves against
/// <see cref="AppContext.BaseDirectory"/> (the test runner's own output
/// directory) with no way to redirect it at a temp directory outside the
/// repo. Instead, the merge/layering tests build an
/// <see cref="IConfiguration"/> with the exact same
/// <c>AddJsonFile("config.json").AddJsonFile("config.local.json")</c> shape
/// <c>BuildDiskConfiguration</c> uses, pointed at a temp directory via
/// <c>SetBasePath</c>, and feed it to the same <see cref="SwOTARestConfig.Bind"/>
/// that <c>LoadFromDiskOrThrow</c> calls -- this exercises the real merge
/// semantics (.NET's configuration layering, not custom merge logic) without
/// needing to relocate the repo-root walk-up.
///
/// <c>FindConfigDirectory</c> itself, though, IS called directly (it's
/// <c>internal</c>, visible here via the <c>InternalsVisibleTo</c> in
/// ApiSdk.csproj) and takes an optional start-directory override for exactly
/// this reason -- same shape as <c>findRepoRoot(startDir)</c> in
/// <c>src/js/src/availability/swotaConfig.ts</c> -- so the repo-marker
/// false-positive fix can be tested against a disposable temp directory tree
/// instead of the real repo.
/// </summary>
public class SwOTARestConfigTests
{
    private static readonly Dictionary<string, string?> FullConfig = new()
    {
        ["SwOTA:RestBaseUrl"] = "https://swota.example.test/ota/rest/",
        ["SwOTA:Auth0:TokenUrl"] = "https://auth.example.test/oauth/token",
        ["SwOTA:Auth0:ClientId"] = "test-client-id",
        ["SwOTA:Auth0:ClientSecret"] = "test-client-secret",
        ["SwOTA:Auth0:Audience"] = "https://swota.example.test/api",
        ["SwOTA:PointOfSale:RequestorIdType"] = "5",
        ["SwOTA:PointOfSale:RequestorIdContext"] = "SEAWARE",
        ["SwOTA:PointOfSale:RequestorId"] = "0000",
        ["SwOTA:PointOfSale:BookingChannelType"] = "1",
        ["SwOTA:PointOfSale:BookingChannelCompanyName"] = "INT-AGENT",
        ["SwOTA:DefaultFareCode"] = "BESTPRICE",
        ["SwOTA:DefaultGuestQty"] = "2",
    };

    private static IConfiguration BuildConfig(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    private static Dictionary<string, string?> WithOverride(string key, string? value)
    {
        var copy = new Dictionary<string, string?>(FullConfig) { [key] = value };
        return copy;
    }

    private static Dictionary<string, string?> WithoutKey(string key)
    {
        var copy = new Dictionary<string, string?>(FullConfig);
        copy.Remove(key);
        return copy;
    }

    // --- successful bind ------------------------------------------------------

    [Fact]
    public void Bind_with_all_fields_present_populates_every_field()
    {
        var config = SwOTARestConfig.Bind(BuildConfig(FullConfig));

        Assert.Equal("https://swota.example.test/ota/rest/", config.RestBaseUrl);
        Assert.Equal("https://auth.example.test/oauth/token", config.Auth0.TokenUrl);
        Assert.Equal("test-client-id", config.Auth0.ClientId);
        Assert.Equal("test-client-secret", config.Auth0.ClientSecret);
        Assert.Equal("https://swota.example.test/api", config.Auth0.Audience);
        Assert.Equal("5", config.PointOfSale.RequestorIdType);
        Assert.Equal("SEAWARE", config.PointOfSale.RequestorIdContext);
        Assert.Equal("0000", config.PointOfSale.RequestorId);
        Assert.Equal("1", config.PointOfSale.BookingChannelType);
        Assert.Equal("INT-AGENT", config.PointOfSale.BookingChannelCompanyName);
        Assert.Equal("BESTPRICE", config.DefaultFareCode);
        Assert.Equal(2, config.DefaultGuestQty);
    }

    [Fact]
    public void RestBaseUrl_missing_a_trailing_slash_gets_one_appended()
    {
        var config = SwOTARestConfig.Bind(BuildConfig(
            WithOverride("SwOTA:RestBaseUrl", "https://swota.example.test/ota/rest")));

        Assert.Equal("https://swota.example.test/ota/rest/", config.RestBaseUrl);
    }

    [Fact]
    public void RestBaseUrl_that_already_ends_with_a_slash_is_left_as_is()
    {
        var config = SwOTARestConfig.Bind(BuildConfig(
            WithOverride("SwOTA:RestBaseUrl", "https://swota.example.test/ota/rest/")));

        Assert.Equal("https://swota.example.test/ota/rest/", config.RestBaseUrl);
    }

    // --- required-key coverage --------------------------------------------------

    public static IEnumerable<object[]> RequiredKeys => new[]
    {
        new object[] { "SwOTA:RestBaseUrl" },
        new object[] { "SwOTA:Auth0:TokenUrl" },
        new object[] { "SwOTA:Auth0:ClientId" },
        new object[] { "SwOTA:Auth0:ClientSecret" },
        new object[] { "SwOTA:Auth0:Audience" },
        new object[] { "SwOTA:PointOfSale:RequestorIdType" },
        new object[] { "SwOTA:PointOfSale:RequestorIdContext" },
        new object[] { "SwOTA:PointOfSale:RequestorId" },
        new object[] { "SwOTA:PointOfSale:BookingChannelType" },
        new object[] { "SwOTA:PointOfSale:BookingChannelCompanyName" },
        new object[] { "SwOTA:DefaultFareCode" },
        new object[] { "SwOTA:DefaultGuestQty" },
    };

    [Theory]
    [MemberData(nameof(RequiredKeys))]
    public void Bind_throws_naming_the_missing_key_when_a_required_key_is_absent(string missingKey)
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => SwOTARestConfig.Bind(BuildConfig(WithoutKey(missingKey))));

        Assert.Contains(missingKey, ex.Message);
    }

    [Theory]
    [MemberData(nameof(RequiredKeys))]
    public void Bind_throws_naming_the_missing_key_when_a_required_key_is_empty(string missingKey)
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => SwOTARestConfig.Bind(BuildConfig(WithOverride(missingKey, ""))));

        Assert.Contains(missingKey, ex.Message);
    }

    // --- DefaultGuestQty must parse as an int -----------------------------------

    [Fact]
    public void Bind_throws_when_DefaultGuestQty_is_not_a_valid_int()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => SwOTARestConfig.Bind(BuildConfig(WithOverride("SwOTA:DefaultGuestQty", "not-a-number"))));

        Assert.Contains("SwOTA:DefaultGuestQty", ex.Message);
    }

    [Fact]
    public void ArgumentNullException_when_configuration_itself_is_null()
    {
        Assert.Throws<ArgumentNullException>(() => SwOTARestConfig.Bind(null!));
    }

    // --- config.json + config.local.json merge/override behaviour --------------

    private static readonly string BaseConfigJson = """
        {
          "SwOTA": {
            "RestBaseUrl": "https://swota.example.test/ota/rest/",
            "Auth0": {
              "TokenUrl": "https://auth.example.test/oauth/token",
              "ClientId": "base-client-id",
              "ClientSecret": "base-secret",
              "Audience": "https://swota.example.test/api"
            },
            "PointOfSale": {
              "RequestorIdType": "5",
              "RequestorIdContext": "SEAWARE",
              "RequestorId": "0000",
              "BookingChannelType": "1",
              "BookingChannelCompanyName": "INT-AGENT"
            },
            "DefaultFareCode": "BESTPRICE",
            "DefaultGuestQty": 2
          }
        }
        """;

    private static IConfiguration BuildLayeredConfig(string tempDir, string? localJson)
    {
        File.WriteAllText(Path.Combine(tempDir, "config.json"), BaseConfigJson);
        if (localJson is not null)
            File.WriteAllText(Path.Combine(tempDir, "config.local.json"), localJson);

        // Same shape as SwOTARestConfig.BuildDiskConfiguration: config.json
        // then config.local.json, the latter taking priority since it's added
        // last -- .NET's configuration layering merges per leaf key, not per
        // top-level section, so an override of one nested field naturally
        // leaves sibling fields (and sibling sections) intact.
        return new ConfigurationBuilder()
            .SetBasePath(tempDir)
            .AddJsonFile("config.json", optional: true)
            .AddJsonFile("config.local.json", optional: true)
            .Build();
    }

    [Fact]
    public void Local_override_of_a_single_nested_field_still_merges_the_rest_of_its_section_from_base()
    {
        var tempDir = Directory.CreateTempSubdirectory("swota-config-test-").FullName;
        try
        {
            var localJson = """{ "SwOTA": { "Auth0": { "ClientSecret": "local-only-secret" } } }""";
            var config = SwOTARestConfig.Bind(BuildLayeredConfig(tempDir, localJson));

            Assert.Equal("local-only-secret", config.Auth0.ClientSecret);
            // Siblings within Auth0 must survive, sourced from config.json.
            Assert.Equal("https://auth.example.test/oauth/token", config.Auth0.TokenUrl);
            Assert.Equal("base-client-id", config.Auth0.ClientId);
            Assert.Equal("https://swota.example.test/api", config.Auth0.Audience);
            // A whole untouched sibling section must also survive intact.
            Assert.Equal("0000", config.PointOfSale.RequestorId);
            Assert.Equal("INT-AGENT", config.PointOfSale.BookingChannelCompanyName);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void Local_override_of_a_whole_nested_section_leaves_other_sections_from_base()
    {
        var tempDir = Directory.CreateTempSubdirectory("swota-config-test-").FullName;
        try
        {
            var localJson = """
                {
                  "SwOTA": {
                    "PointOfSale": {
                      "RequestorIdType": "5",
                      "RequestorIdContext": "SEAWARE",
                      "RequestorId": "9999",
                      "BookingChannelType": "1",
                      "BookingChannelCompanyName": "INT-AGENT"
                    }
                  }
                }
                """;
            var config = SwOTARestConfig.Bind(BuildLayeredConfig(tempDir, localJson));

            Assert.Equal("9999", config.PointOfSale.RequestorId);
            // Untouched Auth0 section should come entirely from config.json.
            Assert.Equal("base-client-id", config.Auth0.ClientId);
            Assert.Equal("base-secret", config.Auth0.ClientSecret);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void No_config_local_json_falls_back_entirely_to_config_json()
    {
        var tempDir = Directory.CreateTempSubdirectory("swota-config-test-").FullName;
        try
        {
            var config = SwOTARestConfig.Bind(BuildLayeredConfig(tempDir, localJson: null));

            Assert.Equal("base-client-id", config.Auth0.ClientId);
            Assert.Equal("base-secret", config.Auth0.ClientSecret);
            Assert.Equal("0000", config.PointOfSale.RequestorId);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    // --- FindConfigDirectory's repo-marker false-positive fix ------------------

    private const string RepoMarkerRelativePath = "utils/dotnet/ApiSdk.SDKCLI/ApiSdk.SDKCLI.csproj";

    /// <summary>
    /// Writes <see cref="RepoMarkerRelativePath"/> (and its parent
    /// directories) under <paramref name="dir"/>, so <c>dir</c> looks like a
    /// genuine repo root to <c>FindConfigDirectory</c>'s second-marker check.
    /// </summary>
    private static void WriteRepoMarker(string dir)
    {
        var markerPath = Path.Combine(dir, RepoMarkerRelativePath.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(markerPath)!);
        File.WriteAllText(markerPath, "<Project />");
    }

    [Fact]
    public void FindConfigDirectory_rejects_a_directory_that_has_config_json_but_no_repo_marker()
    {
        // Regression test: an ancestor directory with its own unrelated
        // "config.json" (a common filename) must NOT be mistaken for this
        // repo's root just because config.json exists there -- see
        // FindConfigDirectory/RepoMarkerRelativePath's doc comments, and the
        // parallel fix in src/js/src/availability/swotaConfig.ts's
        // findRepoRoot.
        var tempDir = Directory.CreateTempSubdirectory("swota-marker-test-").FullName;
        try
        {
            // config.json present, but no utils/dotnet/ApiSdk.SDKCLI/ApiSdk.SDKCLI.csproj
            // anywhere under tempDir -- a false-positive candidate.
            File.WriteAllText(Path.Combine(tempDir, "config.json"), "{}");

            var result = SwOTARestConfig.FindConfigDirectory(tempDir);

            Assert.Null(result);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void FindConfigDirectory_accepts_a_directory_that_has_both_config_json_and_the_repo_marker()
    {
        var tempDir = Directory.CreateTempSubdirectory("swota-marker-test-").FullName;
        try
        {
            File.WriteAllText(Path.Combine(tempDir, "config.json"), "{}");
            WriteRepoMarker(tempDir);

            var result = SwOTARestConfig.FindConfigDirectory(tempDir);

            Assert.Equal(tempDir, result);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void FindConfigDirectory_accepts_a_directory_that_has_both_config_local_json_and_the_repo_marker()
    {
        var tempDir = Directory.CreateTempSubdirectory("swota-marker-test-").FullName;
        try
        {
            File.WriteAllText(Path.Combine(tempDir, "config.local.json"), "{}");
            WriteRepoMarker(tempDir);

            var result = SwOTARestConfig.FindConfigDirectory(tempDir);

            Assert.Equal(tempDir, result);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void FindConfigDirectory_skips_a_false_positive_child_and_finds_the_real_root_above_it()
    {
        // tempDir/unrelated-project has its own config.json but no marker;
        // tempDir itself has both. The walk-up should skip the false
        // positive and keep going until it finds the real root.
        var tempDir = Directory.CreateTempSubdirectory("swota-marker-test-").FullName;
        try
        {
            File.WriteAllText(Path.Combine(tempDir, "config.json"), "{}");
            WriteRepoMarker(tempDir);

            var unrelatedProjectDir = Path.Combine(tempDir, "unrelated-project");
            Directory.CreateDirectory(unrelatedProjectDir);
            File.WriteAllText(Path.Combine(unrelatedProjectDir, "config.json"), "{}");

            var result = SwOTARestConfig.FindConfigDirectory(unrelatedProjectDir);

            Assert.Equal(tempDir, result);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public void FindConfigDirectory_returns_null_when_neither_config_file_nor_marker_exist_within_the_walk_bound()
    {
        var tempDir = Directory.CreateTempSubdirectory("swota-marker-test-").FullName;
        try
        {
            var result = SwOTARestConfig.FindConfigDirectory(tempDir);

            Assert.Null(result);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }
}
