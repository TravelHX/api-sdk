using ApiSdk.Data;

namespace ApiSdk.Loading;

/// <summary>
/// The fully-built object graph produced by an <see cref="IDataSetLoader"/>.
/// Mirrors exactly the private fields that <see cref="ApiSdk"/> commits after a
/// load: the entity collections plus the by-code/by-id lookup dictionaries.
/// The dispatcher (<see cref="ApiSdk.LoadAsync"/>) simply assigns these onto its
/// fields, so the loaders own all graph construction.
/// </summary>
internal sealed class DataSetLoadResult
{
    public required IReadOnlyList<Voyage> Voyages { get; init; }
    public required IReadOnlyList<Ship> Ships { get; init; }
    public required IReadOnlyList<CabinGrade> CabinGrades { get; init; }
    public required IReadOnlyList<Port> Ports { get; init; }
    public required IReadOnlyList<Departure> Departures { get; init; }
    public required IReadOnlyList<CabinOffering> Offerings { get; init; }

    public required Dictionary<string, Ship> ShipById { get; init; }
    public required Dictionary<string, CabinGrade> CabinGradeByCode { get; init; }
    public required Dictionary<string, Port> PortByCode { get; init; }
    public required Dictionary<string, Departure> DepartureByCode { get; init; }
}
