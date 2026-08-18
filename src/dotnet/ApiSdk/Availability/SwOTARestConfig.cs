using Microsoft.Extensions.Configuration;

namespace ApiSdk.Availability;

/// <summary>
/// Strongly-typed binding of the <c>SwOTA</c> configuration section consumed
/// by <see cref="SwOTAAvailabilityClient"/> — REST base URL, Auth0
/// client-credentials details, the point-of-sale identification block SWOTA
/// requires on every request, and the default fare code / guest count used
/// to shape the <c>OTA_CruiseCabinAvailRQ</c> request body.
///
/// Bound via plain <see cref="IConfiguration"/> indexer reads (colon-separated
/// keys), the same style as <see cref="DataSourceFormatConfig"/> and
/// <see cref="MarketConfig"/> — deliberately NOT via
/// <c>Microsoft.Extensions.Configuration.Binder</c>'s <c>Get&lt;T&gt;()</c>,
/// to avoid adding that package on top of the concrete <c>Configuration</c>/
/// <c>Configuration.Json</c> packages this file already needed for disk-based
/// config discovery (see <see cref="LoadFromDiskOrThrow"/>).
///
/// Expected shape (see <c>config.local.json</c> at the repo root, which is
/// <c>*.local.json</c>-gitignored — this section is never meant to live in
/// the committed <c>config.json</c>):
/// <code>
/// {
///   "SwOTA": {
///     "RestBaseUrl": "...",
///     "Auth0": {
///       "TokenUrl": "...", "ClientId": "...", "ClientSecret": "...", "Audience": "..."
///     },
///     "PointOfSale": {
///       "RequestorIdType": "5", "RequestorIdContext": "SEAWARE", "RequestorId": "...",
///       "BookingChannelType": "1", "BookingChannelCompanyName": "INT-AGENT"
///     },
///     "DefaultFareCode": "BESTPRICE",
///     "DefaultGuestQty": 2
///   }
/// }
/// </code>
/// </summary>
public sealed class SwOTARestConfig
{
    /// <summary>The <see cref="IConfiguration"/> section this type binds from.</summary>
    public const string SectionKey = "SwOTA";

    /// <summary>Base REST URL, always normalized to end with a trailing slash
    /// so callers can safely concatenate a message name (e.g.
    /// <c>OTA_CruiseCategoryAvailRQ</c>) directly onto it.</summary>
    public required string RestBaseUrl { get; init; }

    public required Auth0Settings Auth0 { get; init; }

    public required PointOfSaleSettings PointOfSale { get; init; }

    /// <summary>Fare code priced in the category-availability request (e.g. "BESTPRICE").</summary>
    public required string DefaultFareCode { get; init; }

    /// <summary>Guest count used to build the <c>GuestCounts/GuestCount</c> element.</summary>
    public required int DefaultGuestQty { get; init; }

    public sealed class Auth0Settings
    {
        public required string TokenUrl { get; init; }
        public required string ClientId { get; init; }
        public required string ClientSecret { get; init; }
        public required string Audience { get; init; }
    }

    public sealed class PointOfSaleSettings
    {
        public required string RequestorIdType { get; init; }
        public required string RequestorIdContext { get; init; }
        public required string RequestorId { get; init; }
        public required string BookingChannelType { get; init; }
        public required string BookingChannelCompanyName { get; init; }
    }

    /// <summary>
    /// Bind from an already-constructed <see cref="IConfiguration"/> (e.g. one
    /// a DI host built and registered). Throws <see cref="InvalidOperationException"/>
    /// naming the first missing required key — deliberately fails loud rather
    /// than constructing a half-populated config that would only surface as a
    /// confusing null-reference or malformed request later.
    /// </summary>
    public static SwOTARestConfig Bind(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        string Require(string key) =>
            configuration[$"{SectionKey}:{key}"] is { Length: > 0 } value
                ? value
                : throw new InvalidOperationException(
                    $"Missing required configuration key '{SectionKey}:{key}'. Populate " +
                    "config.local.json at the repo root with real SWOTA/Auth0 credentials " +
                    "(see SwOTARestConfig's doc comment for the expected shape).");

        int RequireInt(string key)
        {
            var raw = Require(key);
            return int.TryParse(raw, out var parsed)
                ? parsed
                : throw new InvalidOperationException(
                    $"Configuration key '{SectionKey}:{key}' must be a valid integer, got '{raw}'. Populate " +
                    "config.local.json at the repo root with real SWOTA/Auth0 credentials " +
                    "(see SwOTARestConfig's doc comment for the expected shape).");
        }

        var restBaseUrl = Require("RestBaseUrl");

        return new SwOTARestConfig
        {
            RestBaseUrl = restBaseUrl.EndsWith('/') ? restBaseUrl : restBaseUrl + "/",
            Auth0 = new Auth0Settings
            {
                TokenUrl = Require("Auth0:TokenUrl"),
                ClientId = Require("Auth0:ClientId"),
                ClientSecret = Require("Auth0:ClientSecret"),
                Audience = Require("Auth0:Audience"),
            },
            PointOfSale = new PointOfSaleSettings
            {
                RequestorIdType = Require("PointOfSale:RequestorIdType"),
                RequestorIdContext = Require("PointOfSale:RequestorIdContext"),
                RequestorId = Require("PointOfSale:RequestorId"),
                BookingChannelType = Require("PointOfSale:BookingChannelType"),
                BookingChannelCompanyName = Require("PointOfSale:BookingChannelCompanyName"),
            },
            DefaultFareCode = Require("DefaultFareCode"),
            DefaultGuestQty = RequireInt("DefaultGuestQty"),
        };
    }

    /// <summary>
    /// Convenience path for <see cref="SwOTAAvailabilityClient"/>'s parameterless
    /// constructor (the one <c>ApiSdk.cs</c> falls back to when no client is
    /// injected): builds a throwaway <see cref="IConfiguration"/> straight off
    /// disk — <c>config.json</c> then <c>config.local.json</c> (higher
    /// priority, since it's added last), searched for starting at
    /// <see cref="AppContext.BaseDirectory"/> and walking up parent
    /// directories (bounded) the same way <c>ApiSdk.SDKCLI.Program.GetProjectRoot</c>
    /// does for its own config discovery, since this file lives in a plain
    /// library with no ambient DI container / IConfiguration to reuse.
    /// Deliberately NOT called from the constructor itself — only when the
    /// live client is actually invoked — so constructing a
    /// <c>SwOTAAvailabilityClient()</c> never fails just because no SWOTA
    /// credentials happen to be configured (e.g. under plain V1/V3 test runs
    /// that construct one but never call it).
    /// </summary>
    internal static SwOTARestConfig LoadFromDiskOrThrow() => Bind(BuildDiskConfiguration());

    private static IConfiguration BuildDiskConfiguration()
    {
        var root = FindConfigDirectory() ?? Directory.GetCurrentDirectory();
        return new ConfigurationBuilder()
            .SetBasePath(root)
            .AddJsonFile("config.json", optional: true)
            .AddJsonFile("config.local.json", optional: true)
            .Build();
    }

    /// <summary>
    /// A path that only exists at THIS repo's root, checked alongside
    /// config.json/config.local.json so the walk-up below can't accidentally
    /// bind to an unrelated ancestor project's own config.json (e.g. when
    /// this library is consumed as a NuGet package, <see cref="AppContext.BaseDirectory"/>
    /// is the HOST application's bin directory, and "config.json" is a common
    /// enough filename that some ancestor of the host app could have its own
    /// unrelated top-level config.json). <c>utils/dotnet/ApiSdk.SDKCLI/ApiSdk.SDKCLI.csproj</c>
    /// is this same repo's CLI project file, so requiring both together is a
    /// much stronger repo-identity check than config.json's presence alone —
    /// same reasoning, and the same second-marker fix, as
    /// <c>REPO_MARKER_RELATIVE_PATH</c> / <c>findRepoRoot</c> in
    /// <c>src/js/src/availability/swotaConfig.ts</c>, mirrored here for the
    /// .NET side.
    /// </summary>
    private static readonly string RepoMarkerRelativePath =
        Path.Combine("utils", "dotnet", "ApiSdk.SDKCLI", "ApiSdk.SDKCLI.csproj");

    /// <summary>
    /// Walks up from <paramref name="startDir"/> (defaults to
    /// <see cref="AppContext.BaseDirectory"/>; overridable for tests) looking
    /// for the repo root, identified by the presence of both config.json (or
    /// config.local.json) AND <see cref="RepoMarkerRelativePath"/> — see that
    /// field's doc comment for why the second marker is required. The loop
    /// re-checks <c>dir is not null</c> at the top of every iteration
    /// (including right after <c>dir = dir.Parent!</c> runs), so walking off
    /// the top of the tree — where <see cref="DirectoryInfo.Parent"/> is
    /// <see langword="null"/> — ends the loop on the next condition check
    /// rather than dereferencing a null <see cref="DirectoryInfo"/>.
    /// </summary>
    internal static string? FindConfigDirectory(string? startDir = null)
    {
        var dir = new DirectoryInfo(startDir ?? AppContext.BaseDirectory);
        for (var i = 0; i < 8 && dir is not null; i++, dir = dir.Parent!)
        {
            var hasConfigFile =
                File.Exists(Path.Combine(dir.FullName, "config.json")) ||
                File.Exists(Path.Combine(dir.FullName, "config.local.json"));
            var hasRepoMarker = File.Exists(Path.Combine(dir.FullName, RepoMarkerRelativePath));

            if (hasConfigFile && hasRepoMarker)
                return dir.FullName;
        }
        return null;
    }
}
