namespace ApiSdk.Data;

/// <summary>
/// A single dated departure of a voyage, identified by its tour code
/// (e.g. "SCGALEMAC-260821"). The ship is the first two letters of the code.
/// Navigable to its voyage, ship and cabin offerings.
/// </summary>
public sealed class Departure
{
    private readonly List<CabinOffering> _offerings = new();
    private string? _endDate;
    private Voyage? _voyage;
    private Ship? _ship;

    /// <summary>Full tour code, e.g. "SCGALEMAC-260821".</summary>
    public string Code { get; }

    /// <summary>Departure (start) date as yyyy-MM-dd, or null if not parseable.</summary>
    public string? Date { get; }

    /// <summary>Ship code: the first two letters of the tour code.</summary>
    public string ShipCode { get; }

    internal Departure(string code, string? date)
    {
        Code = code;
        Date = date;
        ShipCode = code.Length >= 2 ? code.Substring(0, 2) : code;
    }

    /// <summary>Return (end) date as yyyy-MM-dd, from the rate data, if known.</summary>
    public string? EndDate => _endDate;

    public Voyage? Voyage => _voyage;

    public Ship? Ship => _ship;

    /// <summary>Cabin offerings (one per cabin grade) available on this departure.</summary>
    public IReadOnlyList<CabinOffering> Offerings => _offerings;

    /// <summary>Distinct cabin grades available on this departure.</summary>
    public IReadOnlyList<CabinGrade> CabinGrades =>
        _offerings.Select(o => o.CabinGrade).Where(g => g is not null).Distinct().Cast<CabinGrade>().ToList();

    public CabinOffering? OfferingForGrade(string code) =>
        _offerings.FirstOrDefault(o => o.Code == code);

    /// <summary>True if the departure is on/after the given yyyy-MM-dd, or has no date.</summary>
    public bool IsUpcoming(string asOf) =>
        Date is null || string.CompareOrdinal(Date, asOf) >= 0;

    internal void SetVoyage(Voyage voyage) => _voyage = voyage;

    internal void SetShip(Ship? ship) => _ship = ship;

    internal void SetEndDate(string? endDate)
    {
        if (!string.IsNullOrEmpty(endDate) && string.IsNullOrEmpty(_endDate)) _endDate = endDate;
    }

    internal void AddOffering(CabinOffering offering) => _offerings.Add(offering);
}
