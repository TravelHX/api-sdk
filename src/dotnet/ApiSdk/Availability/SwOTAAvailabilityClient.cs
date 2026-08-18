using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using Microsoft.Extensions.Configuration;

namespace ApiSdk.Availability;

/// <summary>
/// Live implementation of <see cref="ISwOTAAvailabilityClient"/> against the
/// SWOTA (Seaware OTA) REST API: fetches an Auth0 client-credentials bearer
/// token (cached and reused until near expiry), then POSTs an
/// <c>OTA_CruiseCabinAvailRQ</c> XML request per (voyage, cabin grade) lookup
/// and counts the real, sellable <c>CabinOption</c> elements in the response.
///
/// Request/response shape mirrors the documented message pair at
/// <c>pg.services.b2b.partner/docfx/HX/swota/development/messages/cabin-availability.md</c>.
///
/// <b>Availability-count derivation</b>: SWOTA's
/// <c>OTA_CruiseCabinAvailRQ/RS</c> returns one <c>CabinOption</c> element
/// per actual sellable cabin in the requested category — "not-available
/// cabins are NOT returned" per the docs, so the element count IS the real
/// available-cabin count (unlike the older, now-replaced
/// <c>OTA_CruiseCategoryAvailRQ</c>, which only carried a category-level
/// Available/Waitlisted status, not a quantity). The response always
/// includes a synthetic <c>CabinNumber="GTY"</c> ("Guarantee" — book without
/// a specific cabin) alongside the real numbered cabins; that entry is
/// excluded from the count. So <see cref="GetAvailableCabinsAsync"/> returns
/// the count of <c>CabinOption</c> elements whose <c>CabinNumber</c> is not
/// "GTY" (case-insensitive) — <c>0</c>, not null, when the category has no
/// real cabins (only GTY, or an empty/absent <c>CabinOptions</c> list).
/// </summary>
public sealed class SwOTAAvailabilityClient : ISwOTAAvailabilityClient, IDisposable
{
    private static readonly XNamespace OtaNs = "http://www.opentravel.org/OTA/2003/05";
    private const string CabinAvailMessage = "OTA_CruiseCabinAvailRQ";
    private const string GtyCabinNumber = "GTY";
    private const int MaxAttempts = 3;

    private readonly HttpClient _httpClient;
    private readonly bool _ownsHttpClient;
    private readonly Lazy<SwOTARestConfig> _configLazy;

    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private CachedToken? _cachedToken;

    /// <summary>Most explicit/testable constructor: caller supplies both the
    /// <see cref="HttpClient"/> (its <see cref="HttpMessageHandler"/> is the
    /// usual seam for unit tests) and an already-bound config. This instance
    /// never disposes <paramref name="httpClient"/> — the caller owns it.</summary>
    public SwOTAAvailabilityClient(HttpClient httpClient, SwOTARestConfig config)
    {
        ArgumentNullException.ThrowIfNull(httpClient);
        ArgumentNullException.ThrowIfNull(config);
        _httpClient = httpClient;
        _ownsHttpClient = false;
        _configLazy = new Lazy<SwOTARestConfig>(() => config);
    }

    /// <summary>DI-friendly constructor used by
    /// <see cref="SwOTAServiceCollectionExtensions.AddSwOTAAvailabilityClient"/>:
    /// the container supplies an <see cref="IHttpClientFactory"/>-sourced
    /// <see cref="HttpClient"/> and the host's already-registered
    /// <see cref="IConfiguration"/>; the "SwOTA" section is bound from it
    /// (see <see cref="SwOTARestConfig.Bind"/>).</summary>
    public SwOTAAvailabilityClient(HttpClient httpClient, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(httpClient);
        ArgumentNullException.ThrowIfNull(configuration);
        _httpClient = httpClient;
        _ownsHttpClient = false;
        _configLazy = new Lazy<SwOTARestConfig>(() => SwOTARestConfig.Bind(configuration));
    }

    /// <summary>Parameterless fallback used by <c>ApiSdk.cs</c> when no live
    /// client is injected (<c>_swOTAAvailabilityClient ?? new SwOTAAvailabilityClient()</c>).
    /// Owns (and disposes) its own <see cref="HttpClient"/>. Config is
    /// resolved from disk lazily — on first actual
    /// <see cref="GetAvailableCabinsAsync"/> call, not at construction — so
    /// building one of these never fails just because no SWOTA credentials
    /// happen to be configured (e.g. plain V1/V3 loads that construct a SwOTA
    /// client purely for the DataSourceFormat.SwOTA plumbing but never invoke
    /// it). See <see cref="SwOTARestConfig.LoadFromDiskOrThrow"/>.</summary>
    public SwOTAAvailabilityClient()
    {
        _httpClient = new HttpClient { Timeout = TimeSpan.FromSeconds(45) };
        _ownsHttpClient = true;
        _configLazy = new Lazy<SwOTARestConfig>(SwOTARestConfig.LoadFromDiskOrThrow);
    }

    private SwOTARestConfig Config => _configLazy.Value;

    public async Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default)
    {
        Exception? lastError = null;

        for (var attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            HttpResponseMessage? response = null;
            try
            {
                var token = await GetAccessTokenAsync(forceRefresh: false, ct).ConfigureAwait(false);
                response = await SendAvailabilityRequestAsync(voyageId, cabinCode, token, ct).ConfigureAwait(false);

                if (response.StatusCode == HttpStatusCode.Unauthorized)
                {
                    // Token looked valid client-side (not near our cached
                    // expiry) but SWOTA rejected it anyway -- invalidate the
                    // cache, fetch a fresh one, and retry exactly once before
                    // falling through to the normal success/failure handling
                    // below (this does not consume a full outer-loop attempt
                    // on its own; a still-401 response after refresh is
                    // handled by EnsureSuccessStatusCode below like any other
                    // non-transient failure).
                    response.Dispose();
                    var freshToken = await GetAccessTokenAsync(forceRefresh: true, ct).ConfigureAwait(false);
                    response = await SendAvailabilityRequestAsync(voyageId, cabinCode, freshToken, ct).ConfigureAwait(false);
                }

                if (!response.IsSuccessStatusCode)
                {
                    var isServerError = (int)response.StatusCode >= 500;
                    if (isServerError && attempt < MaxAttempts)
                    {
                        lastError = new HttpRequestException(
                            $"SWOTA returned {(int)response.StatusCode} {response.StatusCode} for voyage '{voyageId}'.");
                        response.Dispose();
                        await Task.Delay(BackoffDelay(attempt), ct).ConfigureAwait(false);
                        continue;
                    }

                    // Throws HttpRequestException with its StatusCode property
                    // set to the response's status -- IsTransient treats that
                    // as a signal to NOT retry (client error, or a 5xx whose
                    // retry budget is already exhausted above).
                    response.EnsureSuccessStatusCode();
                }

                var xml = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
                return ParseAvailableCabins(xml, cabinCode);
            }
            catch (Exception ex) when (attempt < MaxAttempts && IsTransient(ex))
            {
                lastError = ex;
                await Task.Delay(BackoffDelay(attempt), ct).ConfigureAwait(false);
            }
            finally
            {
                response?.Dispose();
            }
        }

        throw new HttpRequestException(
            $"SWOTA cabin availability lookup failed for voyage '{voyageId}', cabin '{cabinCode}' " +
            $"after {MaxAttempts} attempts.",
            lastError);
    }

    // --- request ----------------------------------------------------------

    private async Task<HttpResponseMessage> SendAvailabilityRequestAsync(string voyageId, string cabinCode, string token, CancellationToken ct)
    {
        var config = Config;
        var body = BuildRequestXml(voyageId, cabinCode, config);

        using var request = new HttpRequestMessage(HttpMethod.Post, config.RestBaseUrl + CabinAvailMessage)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/xml"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        return await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
    }

    /// <summary>Builds the <c>OTA_CruiseCabinAvailRQ</c> body per
    /// <c>docfx/HX/swota/development/messages/cabin-availability.md</c>: same
    /// POS/guest-count/fare shape as the category-availability request it
    /// replaces, plus a <c>SelectedCategory</c> naming the priced category to
    /// list cabins for.
    ///
    /// Element-for-element match with the reference bash script
    /// (<c>pg.services.b2b.partner/scripts/swota-availability.sh</c>) both
    /// this client and the JS SDK's client were modeled on — live-verified
    /// against production (varying real cabin counts observed back for
    /// voyage <c>_@FNALA04-260906</c>): two empty <c>&lt;Guest/&gt;</c>
    /// elements immediately precede <c>&lt;GuestCounts&gt;</c>, and
    /// <c>&lt;GuestCount&gt;</c> carries a <c>Code="10"</c> attribute
    /// alongside <c>Quantity</c>. Both are required by SWOTA even though
    /// they look redundant with <c>GuestCounts</c> itself -- omitting either
    /// does not reproduce the request shape that's actually been proven to
    /// work.</summary>
    internal static string BuildRequestXml(string voyageId, string cabinCode, SwOTARestConfig config)
    {
        var pos = new XElement(OtaNs + "POS",
            new XElement(OtaNs + "Source",
                new XElement(OtaNs + "RequestorID",
                    new XAttribute("Type", config.PointOfSale.RequestorIdType),
                    new XAttribute("ID_Context", config.PointOfSale.RequestorIdContext),
                    new XAttribute("ID", config.PointOfSale.RequestorId)),
                new XElement(OtaNs + "BookingChannel",
                    new XAttribute("Type", config.PointOfSale.BookingChannelType),
                    new XElement(OtaNs + "CompanyName", config.PointOfSale.BookingChannelCompanyName))));

        var root = new XElement(OtaNs + "OTA_CruiseCabinAvailRQ",
            new XAttribute("Version", "1.0"),
            pos,
            new XElement(OtaNs + "Guest"),
            new XElement(OtaNs + "Guest"),
            new XElement(OtaNs + "GuestCounts",
                new XElement(OtaNs + "GuestCount",
                    new XAttribute("Code", "10"),
                    new XAttribute("Quantity", config.DefaultGuestQty))),
            new XElement(OtaNs + "SailingInfo",
                new XElement(OtaNs + "SelectedSailing",
                    new XAttribute("VoyageID", voyageId),
                    new XElement(OtaNs + "CruiseLine")),
                new XElement(OtaNs + "SelectedCategory",
                    new XAttribute("PricedCategoryCode", cabinCode))),
            new XElement(OtaNs + "SelectedFare",
                new XAttribute("FareCode", config.DefaultFareCode)));

        return new XDocument(root).ToString(SaveOptions.DisableFormatting);
    }

    // --- response -----------------------------------------------------------

    /// <summary>See the availability-count-derivation note on this class's
    /// doc comment: counts <c>CabinOption</c> elements whose
    /// <c>CabinNumber</c> is a real cabin number (i.e. not the synthetic
    /// "GTY" guarantee entry, checked case-insensitively). Always returns a
    /// non-negative count -- <c>0</c>, never null -- since "not-available
    /// cabins are NOT returned" means an empty (or GTY-only) response
    /// unambiguously means zero real cabins, not "no data".
    ///
    /// <b>Business errors first</b>: SWOTA can return HTTP 200 with an XML
    /// body containing <c>&lt;Errors&gt;&lt;Error&gt;...&lt;/Error&gt;&lt;/Errors&gt;</c>
    /// (e.g. "Sail package not found" for a bogus/expired voyage ID) instead
    /// of a <c>CabinOptions</c> payload. Checked before counting anything --
    /// a response like that has no <c>CabinOption</c> elements at all, so
    /// without this check it would silently parse as "0 cabins available",
    /// indistinguishable from a genuinely sold-out category. Throws
    /// <see cref="SwOTABusinessException"/> instead (never retried -- see
    /// <see cref="IsTransient"/>).</summary>
    internal static int? ParseAvailableCabins(string xml, string cabinCode)
    {
        XDocument doc;
        try
        {
            doc = XDocument.Parse(xml);
        }
        catch (XmlException ex)
        {
            throw new InvalidOperationException(
                $"SWOTA cabin-availability response for cabin '{cabinCode}' was not valid XML.", ex);
        }

        var errorElement = doc.Descendants(OtaNs + "Error").FirstOrDefault();
        if (errorElement is not null)
        {
            var message = errorElement.Value is { Length: > 0 } text ? text.Trim() : "(no error message provided)";
            throw new SwOTABusinessException(
                $"SWOTA returned a business error for cabin '{cabinCode}': {message}");
        }

        return doc.Descendants(OtaNs + "CabinOption")
            .Count(e => (string?)e.Attribute("CabinNumber") is { Length: > 0 } cabinNumber
                && !string.Equals(cabinNumber, GtyCabinNumber, StringComparison.OrdinalIgnoreCase));
    }

    // --- auth ---------------------------------------------------------------

    private async Task<string> GetAccessTokenAsync(bool forceRefresh, CancellationToken ct)
    {
        if (!forceRefresh && TryGetCachedToken(out var cached)) return cached;

        await _tokenLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            // Re-check after acquiring the lock: another caller may have
            // already refreshed it while we were waiting.
            if (!forceRefresh && TryGetCachedToken(out var cachedAfterLock)) return cachedAfterLock;

            var config = Config;
            var payload = JsonSerializer.Serialize(new
            {
                client_id = config.Auth0.ClientId,
                client_secret = config.Auth0.ClientSecret,
                audience = config.Auth0.Audience,
                grant_type = "client_credentials",
            });

            using var request = new HttpRequestMessage(HttpMethod.Post, config.Auth0.TokenUrl)
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json"),
            };

            using var response = await _httpClient.SendAsync(request, ct).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            var body = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);

            using var doc = JsonDocument.Parse(body);
            if (!doc.RootElement.TryGetProperty("access_token", out var tokenEl) || tokenEl.GetString() is not { Length: > 0 } accessToken)
                throw new InvalidOperationException("Auth0 token response did not contain an 'access_token'.");

            var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var expiresEl) && expiresEl.TryGetInt32(out var seconds)
                ? seconds
                : 3600; // Auth0's typical client-credentials default when the property is somehow absent.

            _cachedToken = new CachedToken(accessToken, DateTimeOffset.UtcNow.AddSeconds(expiresIn));
            return accessToken;
        }
        finally
        {
            _tokenLock.Release();
        }
    }

    /// <summary>A token is considered usable until 30s before its reported
    /// expiry -- a small safety margin so a token that's valid when checked
    /// doesn't expire mid-flight for the request it's about to authorize.</summary>
    private bool TryGetCachedToken(out string token)
    {
        if (_cachedToken is { } cached && cached.ExpiresAt > DateTimeOffset.UtcNow.AddSeconds(30))
        {
            token = cached.AccessToken;
            return true;
        }
        token = string.Empty;
        return false;
    }

    private sealed record CachedToken(string AccessToken, DateTimeOffset ExpiresAt);

    // --- retry helpers --------------------------------------------------------

    private static TimeSpan BackoffDelay(int attempt) => TimeSpan.FromMilliseconds(300 * attempt);

    /// <summary>A client error (4xx) is not transient -- retrying it wastes
    /// time/rate-limit budget and will not succeed, so it must NOT be
    /// retried here despite <see cref="HttpRequestException"/> otherwise
    /// being treated as transient below. <see cref="HttpResponseMessage.EnsureSuccessStatusCode"/>
    /// sets <see cref="HttpRequestException.StatusCode"/> to the response's
    /// status code, which is exactly the signal that distinguishes "SWOTA
    /// answered with a non-success status" (already routed through the
    /// explicit 5xx-retry-budget check above; anything reaching here via
    /// that path is either a 4xx or a 5xx with no attempts left, so it must
    /// not be retried again) from a genuine network-level failure -- no
    /// response at all (DNS, connection refused, timeout) -- which leaves
    /// <see cref="HttpRequestException.StatusCode"/> null and IS transient.</summary>
    private static bool IsTransient(Exception ex) =>
        ex switch
        {
            HttpRequestException { StatusCode: not null } => false,
            HttpRequestException => true,
            IOException => true,
            TaskCanceledException { InnerException: TimeoutException } => true,
            _ => false,
        };

    public void Dispose()
    {
        if (_ownsHttpClient) _httpClient.Dispose();
        _tokenLock.Dispose();
    }
}
