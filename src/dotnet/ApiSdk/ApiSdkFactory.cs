using ApiSdk.Availability;

namespace ApiSdk;

/// <summary>
/// Factory returning the SDK behind its <see cref="IApiSdk"/> interface, so
/// callers depend on the contract rather than the concrete class. Mirrors the
/// JavaScript SDK's <c>createApiSdk</c>.
/// </summary>
public static class ApiSdkFactory
{
    /// <param name="reader">Flat-file reader; defaults to <see cref="FlatFileReader"/>.</param>
    /// <param name="swOTAAvailabilityClient">Live-availability client used only
    /// under <see cref="DataSourceFormat.SwOTA"/>; defaults to
    /// <see cref="SwOTAAvailabilityClient"/>. Pass a test double here to cover
    /// SwOTA behaviour without a real SWOTA integration.</param>
    public static IApiSdk CreateApiSdk(
        IFlatFileReader? reader = null,
        ISwOTAAvailabilityClient? swOTAAvailabilityClient = null) =>
        new ApiSdk(reader, swOTAAvailabilityClient);
}
