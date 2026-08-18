using System.Net;
using System.Text;
using System.Xml.Linq;
using ApiSdk.Availability;

namespace ApiSdk.Tests;

/// <summary>
/// Unit tests for <see cref="SwOTAAvailabilityClient"/>'s real SWOTA REST
/// integration: Auth0 token fetch/caching, the <c>OTA_CruiseCabinAvailRQ</c>
/// request it builds, response parsing (counting real <c>CabinOption</c>
/// elements while excluding the synthetic "GTY" entry — see the class's doc
/// comment), and the 401-triggers-one-refresh-then-retry behaviour.
/// Everything is mocked via a stub <see cref="HttpMessageHandler"/> — no real
/// network/credentials involved, so this runs offline in CI.
/// </summary>
public class SwOTAAvailabilityClientTests
{
    private static readonly XNamespace OtaNs = "http://www.opentravel.org/OTA/2003/05";

    private static SwOTARestConfig TestConfig() => new()
    {
        RestBaseUrl = "https://swota.example.test/ota/rest/",
        Auth0 = new SwOTARestConfig.Auth0Settings
        {
            TokenUrl = "https://auth.example.test/oauth/token",
            ClientId = "test-client-id",
            ClientSecret = "test-client-secret",
            Audience = "https://swota.example.test/api",
        },
        PointOfSale = new SwOTARestConfig.PointOfSaleSettings
        {
            RequestorIdType = "5",
            RequestorIdContext = "SEAWARE",
            RequestorId = "0000",
            BookingChannelType = "1",
            BookingChannelCompanyName = "INT-AGENT",
        },
        DefaultFareCode = "BESTPRICE",
        DefaultGuestQty = 2,
    };

    private static HttpResponseMessage TokenResponse(string accessToken, int expiresIn = 3600) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(
            $$"""{"access_token":"{{accessToken}}","expires_in":{{expiresIn}},"token_type":"Bearer"}""",
            Encoding.UTF8, "application/json"),
    };

    /// <summary>Builds an <c>OTA_CruiseCabinAvailRS</c> response containing
    /// one <c>CabinOption</c> per given cabin number (in a fixed "Status=36,
    /// available" shape matching the docfx sample) -- pass "GTY" among the
    /// numbers to include the synthetic guarantee entry.</summary>
    private static HttpResponseMessage AvailResponse(params string[] cabinNumbers)
    {
        var options = string.Concat(cabinNumbers.Select(n =>
            $"""<vx:CabinOption CabinCategoryCode="A" CabinCategoryStatusCode="36" CabinNumber="{n}" CabinRanking="1" DeclineIndicator="false" HeldIndicator="false" MaxOccupancy="2" Status="36"><vx:Remark>Cabin description</vx:Remark></vx:CabinOption>"""));

        var xml = $"""
            <vx:OTA_CruiseCabinAvailRS xmlns:vx="http://www.opentravel.org/OTA/2003/05" Version="1.999">
              <vx:Success/>
              <vx:CabinOptions>
                {options}
              </vx:CabinOptions>
            </vx:OTA_CruiseCabinAvailRS>
            """;

        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(xml, Encoding.UTF8, "application/xml"),
        };
    }

    private static HttpResponseMessage EmptyAvailResponse()
    {
        const string xml = """
            <vx:OTA_CruiseCabinAvailRS xmlns:vx="http://www.opentravel.org/OTA/2003/05" Version="1.999">
              <vx:Success/>
              <vx:CabinOptions/>
            </vx:OTA_CruiseCabinAvailRS>
            """;

        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(xml, Encoding.UTF8, "application/xml"),
        };
    }

    /// <summary>An HTTP 200 response whose body is a SWOTA business/validation
    /// error (<c>&lt;Errors&gt;&lt;Error&gt;...&lt;/Error&gt;&lt;/Errors&gt;</c>)
    /// rather than a <c>CabinOptions</c> payload -- e.g. what SWOTA returns
    /// for a bogus/expired voyage ID ("Sail package not found").</summary>
    private static HttpResponseMessage BusinessErrorResponse(string message = "Sail package not found")
    {
        var xml = $"""
            <vx:OTA_CruiseCabinAvailRS xmlns:vx="http://www.opentravel.org/OTA/2003/05" Version="1.999">
              <vx:Errors>
                <vx:Error Type="3" ShortText="SAIL_PACKAGE_NOT_FOUND">{message}</vx:Error>
              </vx:Errors>
            </vx:OTA_CruiseCabinAvailRS>
            """;

        return new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(xml, Encoding.UTF8, "application/xml"),
        };
    }

    /// <summary>Replays a fixed, ordered sequence of responses regardless of
    /// which URL each request targets — the client's control flow (token,
    /// then availability, with an optional refresh-token/retry pair on 401)
    /// is deterministic, so ordering is enough and keeps the stub simple.
    /// Records every request (and its body, read eagerly since the content
    /// stream isn't safe to re-read later) for assertions.</summary>
    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Queue<HttpResponseMessage> _responses;
        public List<HttpRequestMessage> Requests { get; } = new();
        public List<string> RequestBodies { get; } = new();

        public StubHandler(params HttpResponseMessage[] responses) => _responses = new Queue<HttpResponseMessage>(responses);

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            RequestBodies.Add(request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken));

            if (_responses.Count == 0)
                throw new InvalidOperationException($"No more stubbed responses (request #{Requests.Count} to {request.RequestUri}).");

            return _responses.Dequeue();
        }
    }

    private static SwOTAAvailabilityClient NewClient(StubHandler handler, SwOTARestConfig? config = null) =>
        new(new HttpClient(handler), config ?? TestConfig());

    // --- token fetch + caching ------------------------------------------------

    [Fact]
    public async Task Token_is_fetched_once_and_reused_across_calls()
    {
        var handler = new StubHandler(
            TokenResponse("token-A"),
            AvailResponse("1002", "GTY"),
            AvailResponse("1002", "GTY"));
        var client = NewClient(handler);

        var first = await client.GetAvailableCabinsAsync("VOY1", "DS");
        var second = await client.GetAvailableCabinsAsync("VOY2", "DS");

        Assert.Equal(1, first);
        Assert.Equal(1, second);

        var tokenRequests = handler.Requests.Count(r => r.RequestUri!.ToString() == "https://auth.example.test/oauth/token");
        Assert.Equal(1, tokenRequests);
        Assert.Equal(3, handler.Requests.Count); // 1 token + 2 availability
    }

    [Fact]
    public async Task Token_request_posts_client_credentials_grant_as_json()
    {
        var handler = new StubHandler(TokenResponse("token-A"), AvailResponse("1002", "GTY"));
        var client = NewClient(handler);

        await client.GetAvailableCabinsAsync("VOY1", "DS");

        var tokenBody = handler.RequestBodies[0];
        Assert.Contains("\"client_id\":\"test-client-id\"", tokenBody);
        Assert.Contains("\"client_secret\":\"test-client-secret\"", tokenBody);
        Assert.Contains("\"audience\":\"https://swota.example.test/api\"", tokenBody);
        Assert.Contains("\"grant_type\":\"client_credentials\"", tokenBody);
    }

    // --- request XML shape -----------------------------------------------------

    [Fact]
    public async Task Availability_request_is_built_with_POS_guest_sailing_and_category_info()
    {
        var handler = new StubHandler(TokenResponse("token-A"), AvailResponse("1002", "GTY"));
        var client = NewClient(handler);

        await client.GetAvailableCabinsAsync("FNALA04-260906", "DS");

        var availRequest = handler.Requests[1];
        Assert.Equal("https://swota.example.test/ota/rest/OTA_CruiseCabinAvailRQ", availRequest.RequestUri!.ToString());
        Assert.Equal("Bearer", availRequest.Headers.Authorization!.Scheme);
        Assert.Equal("token-A", availRequest.Headers.Authorization!.Parameter);

        var doc = XDocument.Parse(handler.RequestBodies[1]);
        var root = doc.Root!;
        Assert.Equal(OtaNs + "OTA_CruiseCabinAvailRQ", root.Name);
        Assert.Equal("1.0", (string?)root.Attribute("Version"));

        var requestorId = root.Descendants(OtaNs + "RequestorID").Single();
        Assert.Equal("5", (string?)requestorId.Attribute("Type"));
        Assert.Equal("SEAWARE", (string?)requestorId.Attribute("ID_Context"));
        Assert.Equal("0000", (string?)requestorId.Attribute("ID"));

        var bookingChannel = root.Descendants(OtaNs + "BookingChannel").Single();
        Assert.Equal("1", (string?)bookingChannel.Attribute("Type"));
        Assert.Equal("INT-AGENT", bookingChannel.Element(OtaNs + "CompanyName")?.Value);

        // Two empty <Guest/> elements must precede <GuestCounts>, matching the
        // reference bash script's exact request shape (see
        // pg.services.b2b.partner/scripts/swota-availability.sh) — this is the
        // shape live-verified against production, not the older shape this
        // client used to send.
        var guestElements = root.Elements(OtaNs + "Guest").ToList();
        Assert.Equal(2, guestElements.Count);
        Assert.All(guestElements, g => Assert.False(g.HasElements || !string.IsNullOrEmpty(g.Value)));

        var guestCount = root.Descendants(OtaNs + "GuestCount").Single();
        Assert.Equal("10", (string?)guestCount.Attribute("Code"));
        Assert.Equal("2", (string?)guestCount.Attribute("Quantity"));

        var selectedSailing = root.Descendants(OtaNs + "SelectedSailing").Single();
        Assert.Equal("FNALA04-260906", (string?)selectedSailing.Attribute("VoyageID"));

        var selectedCategory = root.Descendants(OtaNs + "SelectedCategory").Single();
        Assert.Equal("DS", (string?)selectedCategory.Attribute("PricedCategoryCode"));

        var selectedFare = root.Descendants(OtaNs + "SelectedFare").Single();
        Assert.Equal("BESTPRICE", (string?)selectedFare.Attribute("FareCode"));
    }

    // --- response parsing / cabin-count derivation -----------------------------

    [Fact]
    public async Task Real_cabin_options_are_counted_excluding_the_GTY_entry()
    {
        var handler = new StubHandler(TokenResponse("token-A"), AvailResponse("1002", "1003", "1004", "GTY"));
        var client = NewClient(handler);

        var result = await client.GetAvailableCabinsAsync("VOY1", "DS");

        Assert.Equal(3, result);
    }

    [Fact]
    public async Task GTY_only_response_counts_as_zero()
    {
        var handler = new StubHandler(TokenResponse("token-A"), AvailResponse("GTY"));
        var client = NewClient(handler);

        var result = await client.GetAvailableCabinsAsync("VOY1", "DS");

        Assert.Equal(0, result);
    }

    [Fact]
    public async Task Empty_CabinOptions_counts_as_zero()
    {
        var handler = new StubHandler(TokenResponse("token-A"), EmptyAvailResponse());
        var client = NewClient(handler);

        var result = await client.GetAvailableCabinsAsync("VOY1", "DS");

        Assert.Equal(0, result);
    }

    [Fact]
    public async Task GTY_exclusion_is_case_insensitive()
    {
        var handler = new StubHandler(TokenResponse("token-A"), AvailResponse("1002", "gty"));
        var client = NewClient(handler);

        var result = await client.GetAvailableCabinsAsync("VOY1", "DS");

        Assert.Equal(1, result);
    }

    // --- business errors (200 OK with <Errors>) --------------------------------

    [Fact]
    public async Task Response_containing_Errors_throws_a_business_exception_instead_of_returning_zero()
    {
        var handler = new StubHandler(TokenResponse("token-A"), BusinessErrorResponse("Sail package not found"));
        var client = NewClient(handler);

        var ex = await Assert.ThrowsAsync<SwOTABusinessException>(
            () => client.GetAvailableCabinsAsync("BOGUS-VOYAGE", "DS"));

        Assert.Contains("Sail package not found", ex.Message);
    }

    [Fact]
    public async Task Business_error_is_not_retried()
    {
        var handler = new StubHandler(TokenResponse("token-A"), BusinessErrorResponse());
        var client = NewClient(handler);

        await Assert.ThrowsAsync<SwOTABusinessException>(
            () => client.GetAvailableCabinsAsync("BOGUS-VOYAGE", "DS"));

        var availRequests = handler.Requests.Count(r =>
            r.RequestUri!.ToString().EndsWith("OTA_CruiseCabinAvailRQ", StringComparison.Ordinal));
        Assert.Equal(1, availRequests); // not retried up to MaxAttempts
    }

    // --- 4xx handling -------------------------------------------------------------

    [Fact]
    public async Task Client_error_response_is_not_retried()
    {
        var handler = new StubHandler(
            TokenResponse("token-A"),
            new HttpResponseMessage(HttpStatusCode.BadRequest) { Content = new StringContent("malformed request") });
        var client = NewClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAvailableCabinsAsync("VOY1", "DS"));

        var availRequests = handler.Requests.Count(r =>
            r.RequestUri!.ToString().EndsWith("OTA_CruiseCabinAvailRQ", StringComparison.Ordinal));
        Assert.Equal(1, availRequests); // a 4xx is a client error, not transient -- must not be retried
    }

    // --- 401 handling ------------------------------------------------------------

    [Fact]
    public async Task Unauthorized_response_triggers_one_token_refresh_and_retry()
    {
        var handler = new StubHandler(
            TokenResponse("token-A"),
            new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("expired") },
            TokenResponse("token-B"),
            AvailResponse("1002", "GTY"));
        var client = NewClient(handler);

        var result = await client.GetAvailableCabinsAsync("VOY1", "DS");

        Assert.Equal(1, result);

        var tokenRequests = handler.Requests.Where(r => r.RequestUri!.ToString() == "https://auth.example.test/oauth/token").ToList();
        Assert.Equal(2, tokenRequests.Count);

        var availRequests = handler.Requests.Where(r => r.RequestUri!.ToString().EndsWith("OTA_CruiseCabinAvailRQ", StringComparison.Ordinal)).ToList();
        Assert.Equal(2, availRequests.Count);
        Assert.Equal("token-A", availRequests[0].Headers.Authorization!.Parameter);
        Assert.Equal("token-B", availRequests[1].Headers.Authorization!.Parameter);
    }

    [Fact]
    public async Task After_a_401_refresh_the_new_token_is_cached_for_the_next_call()
    {
        var handler = new StubHandler(
            TokenResponse("token-A"),
            new HttpResponseMessage(HttpStatusCode.Unauthorized) { Content = new StringContent("expired") },
            TokenResponse("token-B"),
            AvailResponse("1002", "GTY"),
            AvailResponse("1002", "GTY"));
        var client = NewClient(handler);

        await client.GetAvailableCabinsAsync("VOY1", "DS");
        await client.GetAvailableCabinsAsync("VOY2", "DS");

        var tokenRequests = handler.Requests.Count(r => r.RequestUri!.ToString() == "https://auth.example.test/oauth/token");
        Assert.Equal(2, tokenRequests); // one initial + one refresh; NOT a third for the second availability call
    }
}
