namespace ApiSdk.Tests;

/// <summary>
/// Unit tests for <see cref="MarketConfig"/>'s market/locale resolution. These
/// exercise <see cref="MarketConfig.ResolveMarketDataSources"/> directly (no
/// IConfiguration/environment involved) plus the config/env reader helpers,
/// mirroring the coverage style used for the sibling
/// <c>DataSourceFormatConfig</c>-style "explicit, no silent default" resolvers.
/// </summary>
public class MarketConfigTests
{
    private const string BaseDir = "/data/RefData";

    // --- single-locale markets default the locale -----------------------------

    [Theory]
    [InlineData(Market.UK, "uk")]
    [InlineData(Market.USA, "us")]
    [InlineData(Market.Australia, "au")]
    public void ResolveMarketDataSources_defaults_locale_for_single_locale_markets(Market market, string expectedLocale)
    {
        var result = MarketConfig.ResolveMarketDataSources(market, locale: null, BaseDir);

        Assert.Equal(expectedLocale, result.Locale);
    }

    // --- multi-locale markets require an explicit locale -----------------------

    [Theory]
    [InlineData(Market.EU)]
    [InlineData(Market.Nordic)]
    public void ResolveMarketDataSources_throws_when_multi_locale_market_has_no_locale(Market market)
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => MarketConfig.ResolveMarketDataSources(market, locale: null, BaseDir));

        Assert.Contains(market.ToString(), ex.Message);
    }

    [Fact]
    public void ResolveMarketDataSources_throws_when_locale_is_blank_for_multi_locale_market()
    {
        Assert.Throws<InvalidOperationException>(
            () => MarketConfig.ResolveMarketDataSources(Market.EU, locale: "   ", BaseDir));
    }

    // --- invalid locale for a market throws -------------------------------------

    [Theory]
    [InlineData(Market.EU, "us")]
    [InlineData(Market.Nordic, "de")]
    [InlineData(Market.UK, "fr")]
    public void ResolveMarketDataSources_throws_for_locale_not_in_market(Market market, string invalidLocale)
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => MarketConfig.ResolveMarketDataSources(market, invalidLocale, BaseDir));

        Assert.Contains(invalidLocale, ex.Message);
    }

    // --- correct path/currency resolution ---------------------------------------

    [Fact]
    public void ResolveMarketDataSources_resolves_paths_and_currency_for_eu_de()
    {
        var result = MarketConfig.ResolveMarketDataSources(Market.EU, "de", BaseDir);

        Assert.Equal("de", result.Locale);
        Assert.Equal("EUR", result.Currency);
        Assert.Equal(Path.Combine(BaseDir, "voyages_de.json"), result.Voyages);
        Assert.Equal(Path.Combine(BaseDir, "ships_de.json"), result.Ships);
        Assert.Equal(new[] { Path.Combine(BaseDir, "SourceMarket_EUR_seaware.json") }, result.SourceMarkets);
    }

    [Fact]
    public void ResolveMarketDataSources_resolves_paths_and_currency_for_nordic_no()
    {
        var result = MarketConfig.ResolveMarketDataSources(Market.Nordic, "no", BaseDir);

        Assert.Equal("no", result.Locale);
        Assert.Equal("NOK", result.Currency);
        Assert.Equal(Path.Combine(BaseDir, "voyages_no.json"), result.Voyages);
        Assert.Equal(Path.Combine(BaseDir, "ships_no.json"), result.Ships);
        Assert.Equal(new[] { Path.Combine(BaseDir, "SourceMarket_NOK_seaware.json") }, result.SourceMarkets);
    }

    [Fact]
    public void ResolveMarketDataSources_resolves_paths_and_currency_for_uk()
    {
        var result = MarketConfig.ResolveMarketDataSources(Market.UK, locale: null, BaseDir);

        Assert.Equal("uk", result.Locale);
        Assert.Equal("GBP", result.Currency);
        Assert.Equal(Path.Combine(BaseDir, "voyages_uk.json"), result.Voyages);
        Assert.Equal(Path.Combine(BaseDir, "ships_uk.json"), result.Ships);
        Assert.Equal(new[] { Path.Combine(BaseDir, "SourceMarket_GBP_seaware.json") }, result.SourceMarkets);
    }

    [Fact]
    public void ResolveMarketDataSources_is_case_insensitive_and_trims_locale()
    {
        var result = MarketConfig.ResolveMarketDataSources(Market.EU, "  DE  ", BaseDir);

        Assert.Equal("de", result.Locale);
    }

    // =============================================================================
    // V3 ("prod") resolver — different locale set from V1: 10 countries, uppercase
    // 2-letter codes, "GB" not "uk", Canada under USA and Switzerland under EU.
    // =============================================================================

    // --- single-locale markets default the locale -----------------------------

    [Theory]
    [InlineData(Market.UK, "GB")]
    [InlineData(Market.Australia, "AU")]
    public void ResolveMarketDataSourcesV3_defaults_locale_for_single_locale_markets(Market market, string expectedLocale)
    {
        var result = MarketConfig.ResolveMarketDataSourcesV3(market, locale: null, BaseDir);

        Assert.Equal(expectedLocale, result.Locale);
    }

    // --- multi-locale markets require an explicit locale -----------------------

    [Theory]
    [InlineData(Market.EU)]
    [InlineData(Market.Nordic)]
    [InlineData(Market.USA)]
    public void ResolveMarketDataSourcesV3_throws_when_multi_locale_market_has_no_locale(Market market)
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => MarketConfig.ResolveMarketDataSourcesV3(market, locale: null, BaseDir));

        Assert.Contains(market.ToString(), ex.Message);
    }

    [Fact]
    public void ResolveMarketDataSourcesV3_throws_when_locale_is_blank_for_multi_locale_market()
    {
        Assert.Throws<InvalidOperationException>(
            () => MarketConfig.ResolveMarketDataSourcesV3(Market.EU, locale: "   ", BaseDir));
    }

    // --- invalid locale for a market throws -------------------------------------

    [Theory]
    [InlineData(Market.EU, "US")]
    [InlineData(Market.Nordic, "DE")]
    [InlineData(Market.UK, "FR")]
    [InlineData(Market.USA, "DE")]
    public void ResolveMarketDataSourcesV3_throws_for_locale_not_in_market(Market market, string invalidLocale)
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => MarketConfig.ResolveMarketDataSourcesV3(market, invalidLocale, BaseDir));

        Assert.Contains(invalidLocale, ex.Message);
    }

    // --- correct path resolution, including the EU/USA groupings ----------------

    [Theory]
    [InlineData("DE")]
    [InlineData("FR")]
    [InlineData("DK")]
    [InlineData("CH")]
    public void ResolveMarketDataSourcesV3_resolves_paths_for_eu_locales(string locale)
    {
        var result = MarketConfig.ResolveMarketDataSourcesV3(Market.EU, locale, BaseDir);

        Assert.Equal(locale, result.Locale);
        Assert.Equal(Path.Combine(BaseDir, $"voyages_{locale}.json"), result.Voyages);
        Assert.Equal(Path.Combine(BaseDir, $"ships_{locale}.json"), result.Ships);
    }

    [Theory]
    [InlineData("US")]
    [InlineData("CA")]
    public void ResolveMarketDataSourcesV3_resolves_paths_for_usa_locales(string locale)
    {
        var result = MarketConfig.ResolveMarketDataSourcesV3(Market.USA, locale, BaseDir);

        Assert.Equal(locale, result.Locale);
        Assert.Equal(Path.Combine(BaseDir, $"voyages_{locale}.json"), result.Voyages);
        Assert.Equal(Path.Combine(BaseDir, $"ships_{locale}.json"), result.Ships);
    }

    [Fact]
    public void ResolveMarketDataSourcesV3_resolves_paths_for_uk_gb_code()
    {
        var result = MarketConfig.ResolveMarketDataSourcesV3(Market.UK, locale: null, BaseDir);

        Assert.Equal("GB", result.Locale);
        Assert.Equal(Path.Combine(BaseDir, "voyages_GB.json"), result.Voyages);
        Assert.Equal(Path.Combine(BaseDir, "ships_GB.json"), result.Ships);
    }

    [Fact]
    public void ResolveMarketDataSourcesV3_is_case_insensitive_and_trims_locale()
    {
        var result = MarketConfig.ResolveMarketDataSourcesV3(Market.EU, "  ch  ", BaseDir);

        Assert.Equal("CH", result.Locale);
    }

    // --- config/env resolution for market ---------------------------------------

    [Fact]
    public void ResolveMarket_throws_when_neither_config_nor_env_set()
    {
        WithoutEnv(MarketConfig.MarketEnvVar, () =>
        {
            Assert.Throws<InvalidOperationException>(() => MarketConfig.ResolveMarket(config: null));
        });
    }

    [Fact]
    public void ResolveMarket_reads_from_environment_variable()
    {
        WithEnv(MarketConfig.MarketEnvVar, "UK", () =>
        {
            Assert.Equal(Market.UK, MarketConfig.ResolveMarket(config: null));
        });
    }

    [Fact]
    public void ResolveMarket_throws_for_unrecognized_value()
    {
        WithEnv(MarketConfig.MarketEnvVar, "Mars", () =>
        {
            Assert.Throws<InvalidOperationException>(() => MarketConfig.ResolveMarket(config: null));
        });
    }

    // Regression coverage: Enum.TryParse + Enum.IsDefined alone accept numeric
    // strings and, for a non-[Flags] enum, comma-combined names that happen to
    // OR together into another member's real value. Market is EU=0, Nordic=1,
    // UK=2, USA=3, Australia=4, so "3" and "Nordic,UK" (1|2) must NOT silently
    // resolve to USA.
    [Theory]
    [InlineData("3")]
    [InlineData("1")]
    [InlineData("0")]
    [InlineData("Nordic,UK")]
    [InlineData("Nordic, UK")]
    [InlineData("EU,Nordic")]
    public void ResolveMarket_throws_for_numeric_or_flag_style_value(string value)
    {
        WithEnv(MarketConfig.MarketEnvVar, value, () =>
        {
            Assert.Throws<InvalidOperationException>(() => MarketConfig.ResolveMarket(config: null));
        });
    }

    // --- config/env resolution for locale ----------------------------------------

    [Fact]
    public void ResolveLocale_returns_null_when_unset()
    {
        WithoutEnv(MarketConfig.LocaleEnvVar, () =>
        {
            Assert.Null(MarketConfig.ResolveLocale(config: null));
        });
    }

    [Fact]
    public void ResolveLocale_reads_from_environment_variable()
    {
        WithEnv(MarketConfig.LocaleEnvVar, "fr", () =>
        {
            Assert.Equal("fr", MarketConfig.ResolveLocale(config: null));
        });
    }

    // --- the lookup tables are private; GetLocales/TryNormalizeLocale/GetCurrency
    // --- are the only supported way to observe their contents -------------------
    //
    // MarketLocales/MarketLocalesV3/LocaleCurrency are PRIVATE: there is no
    // public field/property for a caller to reach past in the first place. The
    // tests below verify that public surface — GetLocales/TryNormalizeLocale/
    // GetCurrency, not the tables — behaves correctly.

    [Fact]
    public void GetLocales_returns_all_locales_for_a_market_sorted()
    {
        Assert.Equal(new[] { "de", "dk", "fr" }, MarketConfig.GetLocales(Market.EU, DataSourceFormat.V1));
        Assert.Equal(new[] { "CH", "DE", "DK", "FR" }, MarketConfig.GetLocales(Market.EU, DataSourceFormat.V3));
    }

    [Fact]
    public void GetLocales_returns_an_independent_snapshot_each_call()
    {
        // Two calls must not return the same mutable backing list/array — each
        // caller (e.g. the locale picker menu) owns its own copy.
        var first = MarketConfig.GetLocales(Market.EU, DataSourceFormat.V1);
        var second = MarketConfig.GetLocales(Market.EU, DataSourceFormat.V1);

        Assert.Equal(first, second);
        Assert.NotSame(first, second);
    }

    [Theory]
    [InlineData(Market.EU, "de", true, "de")]
    [InlineData(Market.EU, "DE", true, "de")] // case-insensitive, normalized to V1's lowercase
    [InlineData(Market.EU, "  de  ", true, "de")] // trimmed
    [InlineData(Market.EU, "us", false, null)]
    [InlineData(Market.EU, "", false, null)]
    [InlineData(Market.EU, null, false, null)]
    public void TryNormalizeLocale_matches_ResolveMarketDataSources_acceptance_for_v1(
        Market market, string? locale, bool expectedResult, string? expectedNormalized)
    {
        var result = MarketConfig.TryNormalizeLocale(market, locale, DataSourceFormat.V1, out var normalized);

        Assert.Equal(expectedResult, result);
        Assert.Equal(expectedNormalized, normalized);
    }

    [Theory]
    [InlineData(Market.UK, "GB", true, "GB")]
    [InlineData(Market.UK, "gb", true, "GB")] // case-insensitive, normalized to V3's uppercase
    [InlineData(Market.UK, "uk", false, null)] // that's the V1 code, not V3's
    public void TryNormalizeLocale_matches_ResolveMarketDataSourcesV3_acceptance(
        Market market, string locale, bool expectedResult, string? expectedNormalized)
    {
        var result = MarketConfig.TryNormalizeLocale(market, locale, DataSourceFormat.V3, out var normalized);

        Assert.Equal(expectedResult, result);
        Assert.Equal(expectedNormalized, normalized);
    }

    [Theory]
    [InlineData("de", "EUR")]
    [InlineData("DE", "EUR")] // case-insensitive
    [InlineData("De", "EUR")]
    [InlineData("uk", "GBP")]
    [InlineData("UK", "GBP")]
    public void GetCurrency_is_case_insensitive(string locale, string expectedCurrency)
    {
        Assert.Equal(expectedCurrency, MarketConfig.GetCurrency(locale));
    }

    [Fact]
    public void GetCurrency_trims_whitespace()
    {
        Assert.Equal("EUR", MarketConfig.GetCurrency("  de  "));
    }

    [Fact]
    public void GetCurrency_throws_for_unrecognized_locale()
    {
        Assert.Throws<InvalidOperationException>(() => MarketConfig.GetCurrency("xx"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void GetCurrency_throws_InvalidOperationException_not_ArgumentException_for_null_or_blank(string? locale)
    {
        // Matches every other "not found" case in this class rather than giving
        // null/blank a different failure mode (it used to throw
        // ArgumentNullException via the dictionary indexer for a null argument).
        Assert.Throws<InvalidOperationException>(() => MarketConfig.GetCurrency(locale));
    }

    [Fact]
    public void GetCurrency_throws_for_V3_only_locales()
    {
        // LocaleCurrency is V1-only despite MarketConfig also modeling V3 — a
        // V3-only code (not a V1/V3 spelling coincidence like "DE") must not
        // resolve to anything.
        Assert.Throws<InvalidOperationException>(() => MarketConfig.GetCurrency("GB"));
        Assert.Throws<InvalidOperationException>(() => MarketConfig.GetCurrency("CH"));
        Assert.Throws<InvalidOperationException>(() => MarketConfig.GetCurrency("CA"));
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
