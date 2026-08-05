namespace ApiSdk.Tests;

/// <summary>
/// Unit tests for <see cref="DataSourceFormatConfig"/>'s env/config resolution,
/// mirroring the coverage style used for the sibling <see cref="MarketConfig"/>
/// resolvers (<c>MarketConfigTests.ResolveMarket_*</c>) — including the
/// numeric/flag-style rejection regression coverage, since
/// <c>TryParseEnumNameStrict</c> is duplicated byte-for-byte between the two
/// files and both needed the same fix at the same time.
/// </summary>
public class DataSourceFormatConfigTests
{
    [Fact]
    public void Resolve_throws_when_neither_config_nor_env_set()
    {
        WithoutEnv(DataSourceFormatConfig.EnvVar, () =>
        {
            Assert.Throws<InvalidOperationException>(() => DataSourceFormatConfig.Resolve(config: null));
        });
    }

    [Theory]
    [InlineData("V1", DataSourceFormat.V1)]
    [InlineData("v1", DataSourceFormat.V1)]
    [InlineData("V3", DataSourceFormat.V3)]
    [InlineData("v3", DataSourceFormat.V3)]
    public void Resolve_reads_from_environment_variable_case_insensitively(string value, DataSourceFormat expected)
    {
        WithEnv(DataSourceFormatConfig.EnvVar, value, () =>
        {
            Assert.Equal(expected, DataSourceFormatConfig.Resolve(config: null));
        });
    }

    [Fact]
    public void Resolve_throws_for_unrecognized_value()
    {
        WithEnv(DataSourceFormatConfig.EnvVar, "V2", () =>
        {
            Assert.Throws<InvalidOperationException>(() => DataSourceFormatConfig.Resolve(config: null));
        });
    }

    // Regression coverage: Enum.TryParse + Enum.IsDefined alone accept numeric
    // strings (including signed forms) and, for a non-[Flags] enum,
    // comma-combined names that happen to OR together into another member's
    // real value. DataSourceFormat is V1=0, V3=1, so "1", "+1" and "01" must
    // NOT silently resolve to V3 — "+1" in particular used to do exactly that
    // before TryParseEnumNameStrict replaced the bare TryParse/IsDefined check.
    [Theory]
    [InlineData("0")]
    [InlineData("1")]
    [InlineData("+1")]
    [InlineData("01")]
    [InlineData("V1,V3")]
    public void Resolve_throws_for_numeric_or_flag_style_value(string value)
    {
        WithEnv(DataSourceFormatConfig.EnvVar, value, () =>
        {
            Assert.Throws<InvalidOperationException>(() => DataSourceFormatConfig.Resolve(config: null));
        });
    }

    // --- helpers -------------------------------------------------------------

    private static void WithEnv(string variable, string value, Action action)
    {
        var previous = Environment.GetEnvironmentVariable(variable);
        Environment.SetEnvironmentVariable(variable, value);
        try
        {
            action();
        }
        finally
        {
            Environment.SetEnvironmentVariable(variable, previous);
        }
    }

    private static void WithoutEnv(string variable, Action action)
    {
        var previous = Environment.GetEnvironmentVariable(variable);
        Environment.SetEnvironmentVariable(variable, null);
        try
        {
            action();
        }
        finally
        {
            Environment.SetEnvironmentVariable(variable, previous);
        }
    }
}
