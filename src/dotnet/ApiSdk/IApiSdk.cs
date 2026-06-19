using ApiSdk.Data;

namespace ApiSdk;

/// <summary>Absolute paths to the flat files the SDK is loaded from.</summary>
public sealed class DataSources
{
    public required string Voyages { get; init; }
    public required string Ships { get; init; }
    public required string CabinGrades { get; init; }
    public required string Ports { get; init; }

    /// <summary>One or more source-market rate files (per currency).</summary>
    public IReadOnlyList<string> SourceMarkets { get; init; } = Array.Empty<string>();
}

public sealed class SdkStats
{
    public int VoyageCount { get; init; }
    public int ShipCount { get; init; }
    public int CabinGradeCount { get; init; }
    public int PortCount { get; init; }
    public int DepartureCount { get; init; }
    public int OfferingCount { get; init; }
}

/// <summary>
/// The public contract of the SDK. Construct it with
/// <see cref="ApiSdkFactory.CreateApiSdk"/>, call <see cref="LoadAsync"/>, then
/// traverse the bidirectionally-navigable object graph. Reads are exposed as
/// async actions so callers depend on this interface, not the implementation.
/// </summary>
public interface IApiSdk
{
    /// <summary>Whether <see cref="LoadAsync"/> has completed successfully.</summary>
    bool IsLoaded { get; }

    /// <summary>Read a file's raw contents.</summary>
    Task<string> ReadFileAsync(string filePath);

    /// <summary>Read and deserialize a JSON file.</summary>
    Task<T> ReadFileAsync<T>(string filePath);

    /// <summary>Load the flat files and assemble the navigable object graph.</summary>
    Task<IApiSdk> LoadAsync(DataSources sources, IProgress<string>? progress = null);

    IReadOnlyList<Voyage> Voyages { get; }
    IReadOnlyList<Ship> Ships { get; }
    IReadOnlyList<CabinGrade> CabinGrades { get; }
    IReadOnlyList<Port> Ports { get; }
    IReadOnlyList<Departure> Departures { get; }
    IReadOnlyList<CabinOffering> Offerings { get; }

    Ship? GetShip(string id);
    CabinGrade? GetCabinGrade(string code);
    Port? GetPort(string code);
    Departure? GetDeparture(string code);

    SdkStats Stats { get; }
}
