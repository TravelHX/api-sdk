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
    public string? Body { get; set; }
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

// --- V3 (originally "prod") flat-file shapes -----------------------------
// The V3 format is a different JSON schema: pricing is embedded per voyage
// (no separate source-market files), ships carry numbers-with-units, and there
// is no separate cabin-grade reference. These raw shapes feed V3DataSetLoader.

internal sealed class RawProdPort
{
    public string? Code { get; set; }
    public string? Country { get; set; }
    public string? Description { get; set; }
}

internal sealed class RawProdShip
{
    public string? ShipId { get; set; }
    public string? Heading { get; set; }
    public string? PassengerCapacity { get; set; }
    public string? YearOfConstruction { get; set; }
    public string? GrossTonnage { get; set; }
    public string? Length { get; set; }
    public string? Speed { get; set; }
}

internal sealed class RawProdItineraryDay
{
    public int? Day { get; set; }
    public string? Location { get; set; }
    public string? Heading { get; set; }
    public string? Body { get; set; }
    public List<string?>? MediaContent { get; set; }
}

internal sealed class RawProdCategory
{
    [JsonPropertyName("Category")] public string? Category { get; set; }
    [JsonPropertyName("MaxOccupancy")] public int? MaxOccupancy { get; set; }
    [JsonPropertyName("Rate_Sgl")] public string? RateSgl { get; set; }
    [JsonPropertyName("Rate_Dbl")] public string? RateDbl { get; set; }
    [JsonPropertyName("RateCode")] public string? RateCode { get; set; }
}

internal sealed class RawProdVoyage
{
    [JsonPropertyName("VoyageID")] public string? VoyageId { get; set; }
    [JsonPropertyName("DepartureDate")] public string? DepartureDate { get; set; }
    [JsonPropertyName("ArrivalDate")] public string? ArrivalDate { get; set; }
    [JsonPropertyName("EmbarkationTime")] public string? EmbarkationTime { get; set; }
    [JsonPropertyName("DisembarkationTime")] public string? DisembarkationTime { get; set; }
    [JsonPropertyName("DeparturePort")] public string? DeparturePort { get; set; }
    [JsonPropertyName("ArrivalPort")] public string? ArrivalPort { get; set; }
    [JsonPropertyName("ShipCode")] public string? ShipCode { get; set; }
    [JsonPropertyName("Description")] public string? Description { get; set; }
    [JsonPropertyName("Region")] public string? Region { get; set; }
    [JsonPropertyName("Currency")] public string? Currency { get; set; }
    [JsonPropertyName("itinerary")] public List<RawProdItineraryDay>? Itinerary { get; set; }
    [JsonPropertyName("categories")] public List<RawProdCategory>? Categories { get; set; }
}

/// <summary>A double/single price in a single currency.</summary>
public sealed record Price(string Currency, double? Single, double? Double);

/// <summary>A read-only view of one itinerary day.</summary>
// Body is an init-only property, NOT a positional parameter, so adding it
// doesn't change this record's constructor arity/Deconstruct signature for
// consumers on a package version that predates it (binary/source break risk
// for anyone pinned to this NuGet package's version).
public sealed record ItineraryDay(string? Day, string? Location, string? Heading)
{
    public string? Body { get; init; }
}
