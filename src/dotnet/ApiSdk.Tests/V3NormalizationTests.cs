using ApiSdk.Loading;

namespace ApiSdk.Tests;

/// <summary>
/// Unit tests for the V3 flat-file parsing/normalization rules. These need no
/// fixture files: they exercise <see cref="V3Normalization"/> directly.
/// </summary>
public class V3NormalizationTests
{
    // --- numbers with units --------------------------------------------------

    [Theory]
    [InlineData("11,647 t", 11647d)]
    [InlineData("114 m", 114d)]
    [InlineData("13 knots", 13d)]
    [InlineData("20 m", 20d)]
    [InlineData("1,234,567 t", 1234567d)]
    public void ParseNumberWithUnit_strips_separators_and_units(string input, double expected)
    {
        Assert.Equal(expected, V3Normalization.ParseNumberWithUnit(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("No Mapping")]
    [InlineData("knots")]
    public void ParseNumberWithUnit_returns_null_for_blank_or_unparseable(string? input)
    {
        Assert.Null(V3Normalization.ParseNumberWithUnit(input));
    }

    // --- null sentinels ------------------------------------------------------

    [Theory]
    [InlineData("No Mapping")]
    [InlineData("No Market")]
    [InlineData("NaT")]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void NormalizeString_maps_sentinels_and_blanks_to_null(string? input)
    {
        Assert.Null(V3Normalization.NormalizeString(input));
    }

    [Fact]
    public void NormalizeString_trims_and_keeps_real_values()
    {
        Assert.Equal("Heimaey", V3Normalization.NormalizeString("  Heimaey  "));
    }

    [Theory]
    [InlineData("No Mapping", true)]
    [InlineData("No Market", true)]
    [InlineData("NaT", true)]
    [InlineData("Real", false)]
    public void IsNullSentinel_detects_sentinels(string input, bool expected)
    {
        Assert.Equal(expected, V3Normalization.IsNullSentinel(input));
    }

    // --- datetime formats ----------------------------------------------------

    [Theory]
    [InlineData("2026-09-07T22:00:00", "2026-09-07")]
    [InlineData("2026-09-06", "2026-09-06")]
    public void NormalizeDate_parses_iso_and_date_only(string input, string expected)
    {
        Assert.Equal(expected, V3Normalization.NormalizeDate(input));
    }

    [Theory]
    [InlineData("NaT")]
    [InlineData("not a date")]
    [InlineData("2026/09/06")]
    [InlineData(null)]
    [InlineData("")]
    public void NormalizeDate_returns_null_on_sentinel_or_garbage(string? input)
    {
        Assert.Null(V3Normalization.NormalizeDate(input));
    }

    // --- embedded rates ------------------------------------------------------

    [Theory]
    [InlineData("38995.00", 38995d)]
    [InlineData("90.00", 90d)]
    [InlineData("100", 100d)]
    public void ParseRate_parses_strings(string input, double expected)
    {
        Assert.Equal(expected, V3Normalization.ParseRate(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("No Market")]
    [InlineData("NaT")]
    [InlineData("abc")]
    public void ParseRate_returns_null_for_null_sentinel_or_garbage(string? input)
    {
        Assert.Null(V3Normalization.ParseRate(input));
    }

    // --- "_@" VoyageID stripping ---------------------------------------------

    [Theory]
    [InlineData("_@FNALA04-260906", "FNALA04-260906")]
    [InlineData("FNALA04-260906", "FNALA04-260906")]
    [InlineData(null, "")]
    [InlineData("", "")]
    public void StripVoyageId_removes_prefix(string? input, string expected)
    {
        Assert.Equal(expected, V3Normalization.StripVoyageId(input));
    }

    // --- string -> int -------------------------------------------------------

    [Theory]
    [InlineData("200", 200)]
    [InlineData("2007", 2007)]
    [InlineData("  286  ", 286)]
    public void ParseInt_parses_string_integers(string input, int expected)
    {
        Assert.Equal(expected, V3Normalization.ParseInt(input));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("No Mapping")]
    [InlineData("abc")]
    public void ParseInt_returns_null_for_blank_sentinel_or_garbage(string? input)
    {
        Assert.Null(V3Normalization.ParseInt(input));
    }
}
