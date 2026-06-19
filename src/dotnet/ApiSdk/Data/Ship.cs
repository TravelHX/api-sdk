namespace ApiSdk.Data;

/// <summary>
/// A ship (e.g. "SC"). Navigable to its departures, the cabin grades offered
/// aboard it, and (transitively) the voyages it sails. Construction is internal:
/// instances come from the loaded graph, not from consumer code.
/// </summary>
public sealed class Ship
{
    private readonly List<Departure> _departures = new();
    private readonly List<CabinGrade> _cabinGrades = new();

    public string Id { get; }
    public string Name { get; }
    public int? PassengerCapacity { get; }
    public int? YearOfConstruction { get; }

    internal Ship(string id, string name, int? passengerCapacity, int? yearOfConstruction)
    {
        Id = id;
        Name = name;
        PassengerCapacity = passengerCapacity;
        YearOfConstruction = yearOfConstruction;
    }

    /// <summary>Departures operated by this ship.</summary>
    public IReadOnlyList<Departure> Departures => _departures;

    /// <summary>Cabin grades actually offered aboard this ship.</summary>
    public IReadOnlyList<CabinGrade> CabinGrades => _cabinGrades;

    /// <summary>Distinct voyages this ship sails, derived from its departures.</summary>
    public IReadOnlyList<Voyage> Voyages =>
        _departures.Select(d => d.Voyage).Where(v => v is not null).Distinct().Cast<Voyage>().ToList();

    internal void AddDeparture(Departure departure) => _departures.Add(departure);

    internal void AddCabinGrade(CabinGrade grade)
    {
        if (!_cabinGrades.Contains(grade)) _cabinGrades.Add(grade);
    }
}
