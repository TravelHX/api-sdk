using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace ApiSdk.Availability;

/// <summary>
/// DI registration helper for hosts that run an ASP.NET Core-style
/// <c>IServiceCollection</c> (e.g. a future web host wrapping this SDK) —
/// registers <see cref="SwOTAAvailabilityClient"/> as the
/// <see cref="ISwOTAAvailabilityClient"/> implementation. Mirrors
/// <c>pg.services.b2b.partner/src/Utils/SwOTA/Extensions/ServiceCollectionExtensions.cs</c>'s
/// <c>AddSwOTA</c>, minus the mTLS client-certificate handler that
/// integration needs and this one doesn't — SWOTA REST auth here is
/// bearer-token only (see <see cref="SwOTAAvailabilityClient"/>'s Auth0
/// client-credentials flow).
///
/// Not used by <c>ApiSdk.cs</c>/<c>ApiSdkFactory</c> itself — this SDK has no
/// ambient DI container of its own; those construct
/// <see cref="SwOTAAvailabilityClient"/> directly (parameterless, or with an
/// explicit config/HttpClient). This extension exists purely for hosts that
/// DO run a container and want the client registered/resolved the idiomatic
/// ASP.NET Core way instead.
///
/// Deliberately NOT the standard <c>services.AddHttpClient&lt;TInterface,
/// TImplementation&gt;()</c> "typed client" pattern: that registers
/// <typeparamref name="TImplementation" /> (i.e. <see cref="SwOTAAvailabilityClient"/>
/// itself) with a TRANSIENT lifetime by design, so every resolution gets a
/// fresh instance -- and a fresh instance means a fresh, empty Auth0
/// token cache (<c>_cachedToken</c>/<c>_tokenLock</c>), which defeats the
/// entire point of caching the token: every single availability lookup
/// would re-authenticate from scratch. Instead, this registers a NAMED
/// <see cref="HttpClient"/> (<see cref="HttpClientName"/>) purely so
/// <see cref="IHttpClientFactory"/> still owns/pools the underlying
/// <see cref="HttpMessageHandler"/>, then wraps a single
/// <see cref="IHttpClientFactory.CreateClient(string)"/>-sourced
/// <see cref="HttpClient"/> in ONE singleton <see cref="SwOTAAvailabilityClient"/>
/// so its token cache is actually reused across every call made through this
/// DI path.
/// </summary>
public static class SwOTAServiceCollectionExtensions
{
    private const string HttpClientName = "SwOTA";

    /// <summary>
    /// Registers <see cref="ISwOTAAvailabilityClient"/> as a singleton
    /// <see cref="SwOTAAvailabilityClient"/> backed by a named, pooled
    /// <see cref="HttpClient"/> — see the type-level doc comment for why this
    /// isn't the usual <c>AddHttpClient&lt;TInterface, TImplementation&gt;()</c>
    /// typed-client registration. Requires an <c>IConfiguration</c> already
    /// registered in the container (bound via
    /// <see cref="SwOTAAvailabilityClient(HttpClient, IConfiguration)"/>'s
    /// "SwOTA" section — see <see cref="SwOTARestConfig"/>).
    /// </summary>
    public static IHttpClientBuilder AddSwOTAAvailabilityClient(this IServiceCollection services)
    {
        var builder = services.AddHttpClient(HttpClientName, client =>
        {
            // A single synchronous per-cabin-offering lookup, not a
            // long-running batch job -- long enough to ride out normal SWOTA
            // latency (including an internal 401-triggered token refresh +
            // retry), short enough to fail fast instead of hanging a caller.
            client.Timeout = TimeSpan.FromSeconds(45);
        });

        services.AddSingleton<ISwOTAAvailabilityClient>(sp =>
            new SwOTAAvailabilityClient(
                sp.GetRequiredService<IHttpClientFactory>().CreateClient(HttpClientName),
                sp.GetRequiredService<IConfiguration>()));

        return builder;
    }
}
