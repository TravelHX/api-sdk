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

        if (!Enum.TryParse<DataSourceFormat>(raw.Trim(), ignoreCase: true, out var format)
            || !Enum.IsDefined(format))
        {
            throw new InvalidOperationException(
                $"Invalid data-source format '{raw}'. Expected 'V1' or 'V3' " +
                $"(from '{ConfigKey}' or '{EnvVar}').");
        }

        return format;
    }
}
