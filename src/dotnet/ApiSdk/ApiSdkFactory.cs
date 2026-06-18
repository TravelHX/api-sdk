namespace ApiSdk;

/// <summary>
/// Factory returning the SDK behind its <see cref="IApiSdk"/> interface, so
/// callers depend on the contract rather than the concrete class. Mirrors the
/// JavaScript SDK's <c>createApiSdk</c>.
/// </summary>
public static class ApiSdkFactory
{
    public static IApiSdk CreateApiSdk(IFlatFileReader? reader = null) => new ApiSdk(reader);
}
