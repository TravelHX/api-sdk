using System.Text.Json;
using System.Text.Json.Serialization;

namespace ApiSdk.Data;

// Raw JSON shapes (internal). System.Text.Json maps these case-insensitively;
// underscore-bearing keys use [JsonPropertyName]. The public OOP entities in
// this namespace wrap these into a navigable object graph.

internal sealed class RawItineraryDay
{
    public string? Day { get; set; }
    public string? Location { get; set; }
    public string? Heading { get; set; }
}

internal sealed class RawVoyage
{
    public string? Url { get; set; }
    public string? Heading { get; set; }
    public string? Intro { get; set; }
    public List<string?>? SellingPoints { get; set; }
    public string? DurationText { get; set; }
    public List<string?>? TravelSuggestionCodes { get; set; }
    public string? FromPort { get; set; }
    public string? ToPort { get; set; }
    public List<RawItineraryDay>? Itinerary { get; set; }
}

internal sealed class RawShip
{
    public string? ShipId { get; set; }
    public string? Heading { get; set; }
    public JsonElement? PassengerCapacity { get; set; }
    public JsonElement? YearOfConstruction { get; set; }
}

internal sealed class RawShipDescription
{
    public string? ShipCode { get; set; }
    public int? MaxCapacity { get; set; }
    public string? Description { get; set; }
}

internal sealed class RawCabinGrade
{
    public string? Code { get; set; }
    public List<RawShipDescription>? ShipDescriptions { get; set; }
}

internal sealed class RawPort
{
    public string? Code { get; set; }
    public string? Description { get; set; }
}

internal sealed class RawSourceMarketRow
{
    [JsonPropertyName("TourCode")] public string? TourCode { get; set; }
    [JsonPropertyName("Category")] public string? Category { get; set; }
    [JsonPropertyName("SuperCategory")] public string? SuperCategory { get; set; }
    [JsonPropertyName("Currency")] public string? Currency { get; set; }
    [JsonPropertyName("Rate_Sgl")] public string? RateSgl { get; set; }
    [JsonPropertyName("Rate_Dbl")] public string? RateDbl { get; set; }
    [JsonPropertyName("AvailableCabins")] public int? AvailableCabins { get; set; }
    [JsonPropertyName("TourStartDate")] public string? TourStartDate { get; set; }
    [JsonPropertyName("TourEndDate")] public string? TourEndDate { get; set; }
}

/// <summary>A double/single price in a single currency.</summary>
public sealed record Price(string Currency, double? Single, double? Double);

/// <summary>A read-only view of one itinerary day.</summary>
public sealed record ItineraryDay(string? Day, string? Location, string? Heading);
