namespace ApiSdk.Data;

/// <summary>
/// A cabin grade made available on a specific departure, with prices per
/// currency. The join between a Departure and a CabinGrade — the node where
/// pricing lives. Navigable to its departure, grade and ship.
/// </summary>
public sealed class CabinOffering
{
    private readonly Dictionary<string, Price> _prices = new();
    private Departure _departure = null!;
    private CabinGrade? _cabinGrade;

    /// <summary>Cabin grade code (source-market "Category", e.g. "DS").</summary>
    public string Code { get; }

    /// <summary>Human label (source-market "SuperCategory", e.g. "DARWIN SUITE").</summary>
    public string Name { get; }

    public int? AvailableCabins { get; }

    internal CabinOffering(string code, string name, int? availableCabins)
    {
        Code = code;
        Name = name;
        AvailableCabins = availableCabins;
    }

    public Departure Departure => _departure;

    /// <summary>The cabin grade (null if the category is absent from cabingrades).</summary>
    public CabinGrade? CabinGrade => _cabinGrade;

    /// <summary>The ship this offering sails on, via its departure.</summary>
    public Ship? Ship => _departure.Ship;

    /// <summary>All prices, one per currency, ordered by currency code.</summary>
    public IReadOnlyList<Price> Prices =>
        _prices.Values.OrderBy(p => p.Currency, StringComparer.Ordinal).ToList();

    public Price? PriceFor(string currency) =>
        _prices.TryGetValue(currency, out var price) ? price : null;

    /// <summary>Cabin description resolved for this offering's ship.</summary>
    public IReadOnlyList<string> Description =>
        _cabinGrade?.DescriptionsForShip(_departure.ShipCode) ?? Array.Empty<string>();

    internal void SetDeparture(Departure departure) => _departure = departure;

    internal void SetCabinGrade(CabinGrade grade) => _cabinGrade = grade;

    internal void AddPrice(string currency, double? single, double? @double) =>
        _prices[currency] = new Price(currency, single, @double);
}
