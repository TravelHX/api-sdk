namespace ApiSdk.Data;

/// <summary>
/// A port (e.g. "AAL"). Navigable to the voyages that start or end here. Links
/// are often empty in the sample data (voyages have null ports); the
/// relationship is modelled regardless.
/// </summary>
public sealed class Port
{
    private readonly List<Voyage> _voyagesFrom = new();
    private readonly List<Voyage> _voyagesTo = new();

    public string Code { get; }
    public string Description { get; }

    internal Port(string code, string description)
    {
        Code = code;
        Description = description;
    }

    public IReadOnlyList<Voyage> VoyagesFrom => _voyagesFrom;
    public IReadOnlyList<Voyage> VoyagesTo => _voyagesTo;

    internal void AddVoyageFrom(Voyage voyage) => _voyagesFrom.Add(voyage);
    internal void AddVoyageTo(Voyage voyage) => _voyagesTo.Add(voyage);
}
