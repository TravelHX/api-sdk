namespace ApiSdk.Data;

/// <summary>
/// A cabin grade (e.g. "DS"). Descriptions vary per ship, so they are keyed by
/// ship code. Navigable to its offerings, the ships it appears on, and
/// (transitively) departures.
/// </summary>
public sealed class CabinGrade
{
    private readonly Dictionary<string, List<string>> _descriptionsByShip;
    private readonly List<CabinOffering> _offerings = new();
    private readonly List<Ship> _ships = new();

    public string Code { get; }

    internal CabinGrade(string code, Dictionary<string, List<string>> descriptionsByShip)
    {
        Code = code;
        _descriptionsByShip = descriptionsByShip;
    }

    /// <summary>Priced offerings of this grade across all departures.</summary>
    public IReadOnlyList<CabinOffering> Offerings => _offerings;

    /// <summary>Ships this grade is actually offered on.</summary>
    public IReadOnlyList<Ship> Ships => _ships;

    /// <summary>Distinct departures on which this grade is offered.</summary>
    public IReadOnlyList<Departure> Departures =>
        _offerings.Select(o => o.Departure).Distinct().ToList();

    /// <summary>
    /// Descriptions for this grade on a given ship, falling back to the distinct
    /// descriptions across all ships when the exact ship has none.
    /// </summary>
    public IReadOnlyList<string> DescriptionsForShip(string shipCode)
    {
        if (_descriptionsByShip.TryGetValue(shipCode, out var exact) && exact.Count > 0)
            return exact.ToList();

        var all = new List<string>();
        foreach (var list in _descriptionsByShip.Values)
            foreach (var d in list)
                if (!all.Contains(d)) all.Add(d);
        return all;
    }

    internal void AddOffering(CabinOffering offering) => _offerings.Add(offering);

    internal void AddShip(Ship ship)
    {
        if (!_ships.Contains(ship)) _ships.Add(ship);
    }
}
