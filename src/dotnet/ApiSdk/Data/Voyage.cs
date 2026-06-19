namespace ApiSdk.Data;

/// <summary>
/// A voyage / destination product. Holds the marketing content and is navigable
/// to its departures, the ships that sail it, and its from/to ports.
/// </summary>
public sealed class Voyage
{
    private readonly List<Departure> _departures = new();
    private Port? _fromPort;
    private Port? _toPort;

    public string Heading { get; }
    public string Intro { get; }
    public IReadOnlyList<string> SellingPoints { get; }
    public string DurationText { get; }
    public IReadOnlyList<ItineraryDay> Itinerary { get; }

    /// <summary>Raw departure codes referenced by this voyage.</summary>
    public IReadOnlyList<string> TravelSuggestionCodes { get; }

    public string? FromPortCode { get; }
    public string? ToPortCode { get; }

    internal Voyage(
        string heading,
        string intro,
        IReadOnlyList<string> sellingPoints,
        string durationText,
        IReadOnlyList<string> travelSuggestionCodes,
        string? fromPortCode,
        string? toPortCode,
        IReadOnlyList<ItineraryDay> itinerary)
    {
        Heading = heading;
        Intro = intro;
        SellingPoints = sellingPoints;
        DurationText = durationText;
        TravelSuggestionCodes = travelSuggestionCodes;
        FromPortCode = fromPortCode;
        ToPortCode = toPortCode;
        Itinerary = itinerary;
    }

    /// <summary>All departures of this voyage.</summary>
    public IReadOnlyList<Departure> Departures => _departures;

    /// <summary>Upcoming departures (on/after asOf, or undated), ordered by date.</summary>
    public IReadOnlyList<Departure> UpcomingDepartures(string asOf) =>
        _departures.Where(d => d.IsUpcoming(asOf)).OrderBy(d => d.Date ?? string.Empty, StringComparer.Ordinal).ToList();

    /// <summary>Distinct ships that sail this voyage.</summary>
    public IReadOnlyList<Ship> Ships =>
        _departures.Select(d => d.Ship).Where(s => s is not null).Distinct().Cast<Ship>().ToList();

    public Port? FromPort => _fromPort;
    public Port? ToPort => _toPort;

    internal void AddDeparture(Departure departure) => _departures.Add(departure);
    internal void SetFromPort(Port port) => _fromPort = port;
    internal void SetToPort(Port port) => _toPort = port;
}
