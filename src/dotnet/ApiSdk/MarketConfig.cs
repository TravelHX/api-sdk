using System.Collections.Frozen;
using System.Collections.Immutable;
using Microsoft.Extensions.Configuration;

namespace ApiSdk;

/// <summary>Markets the SDK can resolve V1 flat-file data sources for.</summary>
public enum Market
{
    EU,
    Nordic,
    UK,
    USA,
    Australia,
}

/// <summary>
/// Resolved V1 flat-file paths for a market/locale, ready to feed into the
/// matching fields of <see cref="DataSources"/> (<c>Voyages</c>, <c>Ships</c>,
/// <c>SourceMarkets</c>). <see cref="DataSources.CabinGrades"/> and
/// <see cref="DataSources.Ports"/> are not locale-specific and are left for the
/// caller to supply directly.
/// </summary>
public sealed record MarketDataSources
{
    /// <summary>The locale actually resolved to (lowercase, e.g. "de").</summary>
    public required string Locale { get; init; }

    /// <summary>The settlement currency for <see cref="Locale"/> (uppercase ISO 4217, e.g. "EUR").</summary>
    public required string Currency { get; init; }

    public required string Voyages { get; init; }
    public required string Ships { get; init; }

    /// <summary>Always exactly one file: the source-market rates for <see cref="Currency"/>.</summary>
    public required IReadOnlyList<string> SourceMarkets { get; init; }
}

/// <summary>
/// Resolved V3 flat-file paths for a market/locale, ready to feed into the
/// matching fields of <see cref="DataSources"/> (<c>Voyages</c>, <c>Ships</c>).
/// V3 has no source-market rate files (pricing is embedded per voyage) and no
/// separate cabin-grade reference, so unlike <see cref="MarketDataSources"/>
/// there is no <c>Currency</c>/<c>SourceMarkets</c> here.
/// <see cref="DataSources.Ports"/> is a single flat file in V3 too (not
/// locale-specific) and is left for the caller to supply directly.
/// </summary>
public sealed record MarketDataSourcesV3
{
    /// <summary>The locale actually resolved to (uppercase 2-letter code, e.g. "DE").</summary>
    public required string Locale { get; init; }

    public required string Voyages { get; init; }
    public required string Ships { get; init; }
}

/// <summary>
/// Resolves a <see cref="Market"/> (and optional locale) into the
/// locale-suffixed V1 flat-file paths
/// (<c>voyages_{locale}.json</c>, <c>ships_{locale}.json</c>,
/// <c>SourceMarket_{CURRENCY}_seaware.json</c>), and — mirroring
/// <see cref="DataSourceFormatConfig"/> — reads the selected market/locale from
/// configuration/environment instead of a compiled-in default.
///
/// V3 ("prod") uses a genuinely different locale set — different available
/// countries, different casing/codes (e.g. "GB" not "uk"), and a different
/// Canada/Switzerland grouping decision — so it gets its own internal lookup
/// table and resolver (<see cref="ResolveMarketDataSourcesV3"/>) rather than
/// sharing the V1 one (<see cref="ResolveMarketDataSources"/>).
/// <see cref="ResolveMarket"/>/<see cref="ResolveLocale"/> are format-agnostic
/// and are reused as-is by both.
///
/// The two locale lookup tables and the currency table are deliberately
/// PRIVATE — see the remarks on <see cref="MarketLocales"/> for why — with
/// <see cref="GetLocales"/>, <see cref="TryNormalizeLocale"/> and
/// <see cref="GetCurrency"/> as the only way anything outside this file can
/// observe their contents.
/// </summary>
public static class MarketConfig
{
    /// <summary>The IConfiguration key the market is read from.</summary>
    public const string MarketConfigKey = "DataSources:Market";

    /// <summary>The environment variable the market falls back to.</summary>
    public const string MarketEnvVar = "DATASOURCE_MARKET";

    /// <summary>The IConfiguration key the locale override is read from.</summary>
    public const string LocaleConfigKey = "DataSources:Locale";

    /// <summary>The environment variable the locale override falls back to.</summary>
    public const string LocaleEnvVar = "DATASOURCE_LOCALE";

    /// <summary>
    /// The locales available for each market, lowercase (V1/dev).
    ///
    /// PRIVATE: no public collection type in .NET is truly tamper-proof against
    /// reflection/marshal-level access (there is always some sanctioned BCL
    /// accessor that reaches a collection's backing store — that's not a bug in
    /// those APIs, and reaching it isn't crossing a real security boundary;
    /// .NET has no partial-trust sandboxing), so the only fix that actually
    /// holds is not exposing the collection at all. <see cref="GetLocales"/>/
    /// <see cref="TryNormalizeLocale"/>/<see cref="GetCurrency"/> are the entire
    /// external contract; <see cref="FrozenDictionary{TKey,TValue}"/>/
    /// <see cref="FrozenSet{T}"/> here are for O(1) lookup performance, not
    /// defensive copy-proofing — they don't need to be copy-proof once private.
    /// </summary>
    private static readonly FrozenDictionary<Market, FrozenSet<string>> MarketLocales = new Dictionary<Market, FrozenSet<string>>
    {
        [Market.EU] = new[] { "de", "fr", "dk" }.ToFrozenSet(),
        [Market.Nordic] = new[] { "se", "no" }.ToFrozenSet(),
        [Market.UK] = new[] { "uk" }.ToFrozenSet(),
        [Market.USA] = new[] { "us" }.ToFrozenSet(),
        [Market.Australia] = new[] { "au" }.ToFrozenSet(),
    }.ToFrozenDictionary();

    /// <summary>
    /// The settlement currency (uppercase ISO 4217) for each V1/dev locale.
    /// PRIVATE for the same reason as <see cref="MarketLocales"/> — reachable
    /// only via <see cref="GetCurrency"/>.
    ///
    /// This is V1-ONLY despite this class also modeling V3: a V3 locale code
    /// that happens to share spelling with a V1 one by coincidence of
    /// geography (e.g. "DE") is not guaranteed to resolve the "same" entry on
    /// purpose, and V3-only codes ("GB", "CH", "CA") aren't in here at all —
    /// V3 has no currency concept, see <see cref="MarketDataSourcesV3"/>'s
    /// remarks (pricing is embedded per voyage). The case-insensitive keying
    /// is purely so <see cref="GetCurrency"/> doesn't care about the caller's
    /// casing of a V1 code; it is not a claim that this table also serves V3.
    /// </summary>
    private static readonly FrozenDictionary<string, string> LocaleCurrency = new Dictionary<string, string>
    {
        ["de"] = "EUR",
        ["fr"] = "EUR",
        ["dk"] = "DKK",
        ["se"] = "SEK",
        ["no"] = "NOK",
        ["uk"] = "GBP",
        ["us"] = "USD",
        ["au"] = "AUD",
    }.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The locales available for each market in the V3 ("prod") flat-file format,
    /// as their real on-disk uppercase 2-letter codes. A DIFFERENT set from
    /// <see cref="MarketLocales"/> (V1/dev): prod covers 10 countries vs. dev's
    /// 8, "UK" is coded "GB", and business-decision groupings that don't exist
    /// in dev apply here — Canada groups under USA, Switzerland groups under
    /// EU. PRIVATE for the same reason as <see cref="MarketLocales"/>.
    /// </summary>
    private static readonly FrozenDictionary<Market, FrozenSet<string>> MarketLocalesV3 = new Dictionary<Market, FrozenSet<string>>
    {
        [Market.EU] = new[] { "DE", "FR", "DK", "CH" }.ToFrozenSet(),
        [Market.Nordic] = new[] { "SE", "NO" }.ToFrozenSet(),
        [Market.UK] = new[] { "GB" }.ToFrozenSet(),
        [Market.USA] = new[] { "US", "CA" }.ToFrozenSet(),
        [Market.Australia] = new[] { "AU" }.ToFrozenSet(),
    }.ToFrozenDictionary();

    /// <summary>
    /// Resolve the market from <paramref name="config"/> (key
    /// <see cref="MarketConfigKey"/>), falling back to the <see cref="MarketEnvVar"/>
    /// environment variable. Throws <see cref="InvalidOperationException"/> when
    /// neither is set, and <see cref="InvalidOperationException"/> when the value
    /// is present but not a valid <see cref="Market"/> name.
    /// </summary>
    public static Market ResolveMarket(IConfiguration? config = null)
    {
        var raw = config?[MarketConfigKey];
        if (string.IsNullOrWhiteSpace(raw))
            raw = Environment.GetEnvironmentVariable(MarketEnvVar);

        if (string.IsNullOrWhiteSpace(raw))
            throw new InvalidOperationException(
                $"Market is not configured. Set the '{MarketConfigKey}' configuration " +
                $"key or the '{MarketEnvVar}' environment variable to one of: " +
                $"{string.Join(", ", Enum.GetNames<Market>())}. There is no compiled-in default.");

        if (!TryParseEnumNameStrict<Market>(raw.Trim(), out var market))
        {
            throw new InvalidOperationException(
                $"Invalid market '{raw}'. Expected one of: {string.Join(", ", Enum.GetNames<Market>())} " +
                $"(from '{MarketConfigKey}' or '{MarketEnvVar}').");
        }

        return market;
    }

    /// <summary>
    /// Case-insensitively match <paramref name="raw"/> against
    /// <typeparamref name="TEnum"/>'s actual member NAMES only.
    ///
    /// <see cref="Enum.TryParse{TEnum}(string, bool, out TEnum)"/> combined with
    /// <see cref="Enum.IsDefined(Type, object)"/> is NOT sufficient input
    /// validation on its own: <c>TryParse</c> also accepts the underlying
    /// numeric value as a string (so <c>"3"</c> parses to whatever member has
    /// value 3), and for comma-separated input it happily ORs the parsed values
    /// together even when the enum isn't <c>[Flags]</c> — e.g. for
    /// <see cref="Market"/> (EU=0, Nordic=1, UK=2, USA=3, Australia=4),
    /// <c>"Nordic,UK"</c> parses to 1|2=3, and <c>Enum.IsDefined(3)</c> then
    /// reports "defined" purely because 3 happens to also be USA's value — so
    /// an operator typo silently resolves to the wrong market. Matching against
    /// <see cref="Enum.GetNames{TEnum}"/> directly closes both holes.
    /// </summary>
    private static bool TryParseEnumNameStrict<TEnum>(string raw, out TEnum value) where TEnum : struct, Enum
    {
        foreach (var name in Enum.GetNames<TEnum>())
        {
            if (string.Equals(name, raw, StringComparison.OrdinalIgnoreCase))
            {
                value = Enum.Parse<TEnum>(name); // exact-case parse of a known-good member name
                return true;
            }
        }

        value = default;
        return false;
    }

    /// <summary>
    /// Resolve the locale override from <paramref name="config"/> (key
    /// <see cref="LocaleConfigKey"/>), falling back to the <see cref="LocaleEnvVar"/>
    /// environment variable. Unlike <see cref="ResolveMarket"/> this does NOT throw
    /// when unset — a locale is only required for markets with more than one
    /// locale, and <see cref="ResolveMarketDataSources"/> is what enforces that.
    /// </summary>
    public static string? ResolveLocale(IConfiguration? config = null)
    {
        var raw = config?[LocaleConfigKey];
        if (string.IsNullOrWhiteSpace(raw))
            raw = Environment.GetEnvironmentVariable(LocaleEnvVar);

        return string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();
    }

    /// <summary>
    /// The locales available for <paramref name="market"/> under <paramref name="format"/>,
    /// as a fresh, alphabetically ordered, independently-owned snapshot — the
    /// one supported way to enumerate them from outside this file (e.g. for a
    /// UI picker; see <c>ApiSdk.SDKCLI/Program.cs</c>'s locale menu). A set has
    /// no ordering guarantee, so sorting is done here rather than leaving every
    /// caller to reinvent "what order do I show these in". Throws
    /// <see cref="InvalidOperationException"/> if <paramref name="market"/> has
    /// no entry for <paramref name="format"/> (a <see cref="Market"/> member
    /// added without updating the matching table — a bug, not a runtime input
    /// to handle gracefully).
    /// </summary>
    public static IReadOnlyList<string> GetLocales(Market market, DataSourceFormat format)
    {
        var table = format == DataSourceFormat.V3 ? MarketLocalesV3 : MarketLocales;
        if (!table.TryGetValue(market, out var locales))
        {
            throw new InvalidOperationException(
                $"No locale table entry for market '{market}' under format '{format}'. This means a " +
                $"{nameof(Market)} member was added without a matching table entry.");
        }

        return locales.OrderBy(l => l, StringComparer.Ordinal).ToArray();
    }

    /// <summary>
    /// Normalize <paramref name="locale"/> to the casing <paramref name="format"/>
    /// expects (V1 lowercase, V3 uppercase) and confirm it's valid for
    /// <paramref name="market"/>, in one step. This is the ONE place that
    /// decides V1-lowercase vs. V3-uppercase — callers (e.g. the TUI's locale
    /// prompt in <c>ApiSdk.SDKCLI/Program.cs</c>) must route through this
    /// rather than re-deriving the casing rule themselves. Returns
    /// <see langword="false"/> (with <paramref name="normalized"/>
    /// <see langword="null"/>) if <paramref name="locale"/> is blank or not
    /// valid for this market+format — this supersedes what used to be a
    /// separate <c>IsValidLocale</c> bool-only check, which had no production
    /// caller and forced everyone who actually needed the normalized string
    /// (i.e. every real caller) to re-derive it anyway.
    /// </summary>
    public static bool TryNormalizeLocale(Market market, string? locale, DataSourceFormat format, out string? normalized)
    {
        if (string.IsNullOrWhiteSpace(locale))
        {
            normalized = null;
            return false;
        }

        var candidate = NormalizeLocale(locale, format);
        var table = format == DataSourceFormat.V3 ? MarketLocalesV3 : MarketLocales;
        if (table.TryGetValue(market, out var locales) && locales.Contains(candidate))
        {
            normalized = candidate;
            return true;
        }

        normalized = null;
        return false;
    }

    /// <summary>
    /// The settlement currency for a V1/dev <paramref name="locale"/> (any
    /// case, whitespace trimmed). Throws <see cref="InvalidOperationException"/> —
    /// not <see cref="ArgumentNullException"/>/<see cref="ArgumentException"/> —
    /// for a null/blank/unrecognized locale alike, matching every other
    /// "not found" case in this class rather than giving null a different
    /// failure mode than "just wrong". There is no V3 equivalent of this
    /// lookup (see <see cref="LocaleCurrency"/>'s remarks).
    /// </summary>
    public static string GetCurrency(string? locale)
    {
        if (!string.IsNullOrWhiteSpace(locale) && LocaleCurrency.TryGetValue(locale.Trim(), out var currency))
            return currency;

        throw new InvalidOperationException($"No currency mapping for locale '{locale}'.");
    }

    /// <summary>V1 locales are stored/compared lowercase, V3 uppercase.</summary>
    private static string NormalizeLocale(string locale, DataSourceFormat format) =>
        format == DataSourceFormat.V3 ? locale.Trim().ToUpperInvariant() : locale.Trim().ToLowerInvariant();

    /// <summary>
    /// Resolve the voyages/ships/source-market flat-file paths for
    /// <paramref name="market"/> under <paramref name="baseDir"/>.
    ///
    /// If the market has more than one locale, <paramref name="locale"/> is
    /// REQUIRED — a null/blank locale throws, there is no silent "pick the first
    /// locale" default. If the market has exactly one locale, <paramref name="locale"/>
    /// defaults to it when null/blank. A locale that doesn't belong to the given
    /// market (whichever way it was resolved) also throws.
    /// </summary>
    public static MarketDataSources ResolveMarketDataSources(Market market, string? locale, string baseDir)
    {
        if (string.IsNullOrWhiteSpace(baseDir))
            throw new ArgumentException("Base directory must be provided.", nameof(baseDir));

        if (!MarketLocales.TryGetValue(market, out var locales))
            throw new InvalidOperationException(
                $"No V1 locale table entry for market '{market}'. This means a {nameof(Market)} " +
                $"member was added without a matching locale table entry.");

        string resolvedLocale;
        if (string.IsNullOrWhiteSpace(locale))
        {
            if (locales.Count != 1)
            {
                throw new InvalidOperationException(
                    $"Market '{market}' has multiple locales ({FormatLocales(locales)}); " +
                    "a locale must be specified explicitly. There is no silent default.");
            }
            resolvedLocale = locales.Single();
        }
        else
        {
            resolvedLocale = NormalizeLocale(locale, DataSourceFormat.V1);
            if (!locales.Contains(resolvedLocale))
            {
                throw new InvalidOperationException(
                    $"Locale '{locale}' is not valid for market '{market}'. Expected one of: " +
                    $"{FormatLocales(locales)}.");
            }
        }

        var currency = GetCurrency(resolvedLocale);

        return new MarketDataSources
        {
            Locale = resolvedLocale,
            Currency = currency,
            Voyages = Path.Combine(baseDir, $"voyages_{resolvedLocale}.json"),
            Ships = Path.Combine(baseDir, $"ships_{resolvedLocale}.json"),
            // ImmutableArray.Create, not `new[] {...}` behind IReadOnlyList<string>
            // — `new[] {...}` is exactly the "looks read-only, isn't" pattern
            // this file otherwise avoids. Unlike the module-level tables above,
            // this is a freshly-allocated, non-static, per-call value: there is
            // no shared state for a cast-and-mutate (or marshal-and-mutate) to
            // corrupt even in principle, so ImmutableArray's guarantees are
            // exactly as strong here as they're ever going to get — the
            // remaining gap only mattered for the process-static tables.
            SourceMarkets = ImmutableArray.Create(Path.Combine(baseDir, $"SourceMarket_{currency}_seaware.json")),
        };
    }

    /// <summary>Sorted, comma-joined locales for error messages — deterministic output, not iteration order.</summary>
    private static string FormatLocales(FrozenSet<string> locales) =>
        string.Join(", ", locales.OrderBy(l => l, StringComparer.Ordinal));

    /// <summary>
    /// Resolve the voyages/ships flat-file paths for <paramref name="market"/>
    /// under <paramref name="baseDir"/>, using the V3 ("prod") locale set —
    /// uppercase 2-letter codes, no source-market/currency concept.
    ///
    /// Same "explicit required" convention as <see cref="ResolveMarketDataSources"/>:
    /// if the market has more than one V3 locale, <paramref name="locale"/> is
    /// REQUIRED — a null/blank locale throws, there is no silent "pick the first
    /// locale" default. If the market has exactly one V3 locale, <paramref name="locale"/>
    /// defaults to it when null/blank. A locale that doesn't belong to the given
    /// market (whichever way it was resolved) also throws.
    /// </summary>
    public static MarketDataSourcesV3 ResolveMarketDataSourcesV3(Market market, string? locale, string baseDir)
    {
        if (string.IsNullOrWhiteSpace(baseDir))
            throw new ArgumentException("Base directory must be provided.", nameof(baseDir));

        if (!MarketLocalesV3.TryGetValue(market, out var locales))
            throw new InvalidOperationException(
                $"No V3 locale table entry for market '{market}'. This means a {nameof(Market)} " +
                $"member was added without a matching locale table entry.");

        string resolvedLocale;
        if (string.IsNullOrWhiteSpace(locale))
        {
            if (locales.Count != 1)
            {
                throw new InvalidOperationException(
                    $"Market '{market}' has multiple V3 locales ({FormatLocales(locales)}); " +
                    "a locale must be specified explicitly. There is no silent default.");
            }
            resolvedLocale = locales.Single();
        }
        else
        {
            resolvedLocale = NormalizeLocale(locale, DataSourceFormat.V3);
            if (!locales.Contains(resolvedLocale))
            {
                throw new InvalidOperationException(
                    $"Locale '{locale}' is not valid for V3 market '{market}'. Expected one of: " +
                    $"{FormatLocales(locales)}.");
            }
        }

        return new MarketDataSourcesV3
        {
            Locale = resolvedLocale,
            Voyages = Path.Combine(baseDir, $"voyages_{resolvedLocale}.json"),
            Ships = Path.Combine(baseDir, $"ships_{resolvedLocale}.json"),
        };
    }
}
