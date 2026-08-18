namespace ApiSdk.Availability;

/// <summary>
/// Thrown when SWOTA responds with HTTP 200 but the XML body is a business/
/// validation error -- <c>&lt;Errors&gt;&lt;Error&gt;...&lt;/Error&gt;&lt;/Errors&gt;</c>
/// (e.g. "Sail package not found" for a bogus/expired voyage ID) instead of
/// the expected <c>CabinOptions</c> payload. Distinct from the HTTP-layer
/// failures <see cref="SwOTAAvailabilityClient"/> otherwise surfaces via
/// <see cref="System.Net.Http.HttpRequestException"/>: a 200-with-<c>Errors</c>
/// response is not a transport/status failure, so it's never retried (see
/// <see cref="SwOTAAvailabilityClient"/>'s retry-eligibility check) and must
/// never be silently parsed as "zero cabins available" -- that would be
/// indistinguishable from a genuinely sold-out category.
/// </summary>
public sealed class SwOTABusinessException : Exception
{
    public SwOTABusinessException(string message) : base(message)
    {
    }

    public SwOTABusinessException(string message, Exception innerException) : base(message, innerException)
    {
    }
}
