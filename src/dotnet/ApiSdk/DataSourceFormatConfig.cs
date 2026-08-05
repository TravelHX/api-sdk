using Microsoft.Extensions.Configuration;

namespace ApiSdk;

/// <summary>
/// Resolves the <see cref="DataSourceFormat"/> for a <see cref="DataSources"/>
/// from configuration/environment instead of a compiled-in default.
///
/// Resolution order:
/// <list type="number">
/// <item>The IConfiguration key <c>DataSources:Format</c> (when an
/// <see cref="IConfiguration"/> is supplied).</item>
/// <item>The environment variable <c>DATASOURCE_FORMAT</c>.</item>
/// </list>
/// The value is parsed as the enum name ("V1" or "V3", case-insensitive). If
/// neither source provides a value, this THROWS — there is deliberately no
/// silent V1/V3 fallback, mirroring the removal of the hardcoded default on
/// <see cref="DataSources.Format"/>.
/// </summary>
public static class DataSourceFormatConfig
{
    /// <summary>The IConfiguration key the format is read from.</summary>
    public const string ConfigKey = "DataSources:Format";

    /// <summary>The environment variable the format falls back to.</summary>
    public const string EnvVar = "DATASOURCE_FORMAT";

    /// <summary>
    /// Resolve the format from <paramref name="config"/> (key
    /// <see cref="ConfigKey"/>), falling back to the <see cref="EnvVar"/>
    /// environment variable. Throws <see cref="InvalidOperationException"/> when
    /// neither is set, and <see cref="InvalidOperationException"/> when the value
    /// is present but not a valid <see cref="DataSourceFormat"/> name.
    /// </summary>
    public static DataSourceFormat Resolve(IConfiguration? config = null)
    {
        var raw = config?[ConfigKey];
        if (string.IsNullOrWhiteSpace(raw))
            raw = Environment.GetEnvironmentVariable(EnvVar);

        if (string.IsNullOrWhiteSpace(raw))
            throw new InvalidOperationException(
                $"Data-source format is not configured. Set the '{ConfigKey}' " +
                $"configuration key or the '{EnvVar}' environment variable to " +
                $"'V1' or 'V3'. There is no compiled-in default.");

        if (!TryParseEnumNameStrict<DataSourceFormat>(raw.Trim(), out var format))
        {
            throw new InvalidOperationException(
                $"Invalid data-source format '{raw}'. Expected 'V1' or 'V3' " +
                $"(from '{ConfigKey}' or '{EnvVar}').");
        }

        return format;
    }

    /// <summary>
    /// Case-insensitively match <paramref name="raw"/> against
    /// <typeparamref name="TEnum"/>'s actual member NAMES only.
    ///
    /// <see cref="Enum.TryParse{TEnum}(string, bool, out TEnum)"/> combined with
    /// <see cref="Enum.IsDefined(Type, object)"/> is NOT sufficient input
    /// validation on its own: <c>TryParse</c> also accepts the underlying
    /// numeric value as a string (so <c>"1"</c> parses to whatever member has
    /// value 1, silently picking a format from a bare number instead of
    /// rejecting it), and for comma-separated input it happily ORs the parsed
    /// values together even though this enum isn't <c>[Flags]</c>. Matching
    /// against <see cref="Enum.GetNames{TEnum}"/> directly closes both holes.
    /// (Mirrors the identical fix in <c>MarketConfig.TryParseEnumNameStrict</c> —
    /// duplicated rather than shared since these are two small, independent,
    /// self-contained config resolvers.)
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
}
