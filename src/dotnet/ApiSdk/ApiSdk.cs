using ApiSdk.Data;
using ApiSdk.Loading;

namespace ApiSdk;

/// <summary>
/// The SDK entry point and implementation of <see cref="IApiSdk"/>. It absorbs
/// the flat-file reader (exposing reads as async actions) and, once
/// <see cref="LoadAsync"/>ed, becomes a fully-wired, bidirectionally-navigable
/// object graph of voyages, ships, cabin grades, ports, departures and priced
/// cabin offerings.
///
/// Prefer <see cref="ApiSdkFactory.CreateApiSdk"/> + <see cref="IApiSdk"/> for
/// new code; the public constructor and <see cref="FileReader"/> are retained
/// for the internal validation/runner utilities.
/// </summary>
public sealed class ApiSdk : IApiSdk
{
    private readonly IFlatFileReader _fileReader;

    private IReadOnlyList<Voyage> _voyages = Array.Empty<Voyage>();
    private IReadOnlyList<Ship> _ships = Array.Empty<Ship>();
    private IReadOnlyList<CabinGrade> _cabinGrades = Array.Empty<CabinGrade>();
    private IReadOnlyList<Port> _ports = Array.Empty<Port>();
    private IReadOnlyList<Departure> _departures = Array.Empty<Departure>();
    private IReadOnlyList<CabinOffering> _offerings = Array.Empty<CabinOffering>();

    private Dictionary<string, Ship> _shipById = new();
    private Dictionary<string, CabinGrade> _cabinGradeByCode = new();
    private Dictionary<string, Port> _portByCode = new();
    private Dictionary<string, Departure> _departureByCode = new();

    private bool _isLoaded;

    public ApiSdk(IFlatFileReader? fileReader = null)
    {
        _fileReader = fileReader ?? new FlatFileReader();
    }

    /// <summary>The underlying flat-file reader (retained for compatibility).</summary>
    public IFlatFileReader FileReader => _fileReader;

    public bool IsLoaded => _isLoaded;

    // --- async read actions --------------------------------------------------

    public Task<string> ReadFileAsync(string filePath) => _fileReader.ReadFileAsync(filePath);

    public Task<T> ReadFileAsync<T>(string filePath) => _fileReader.ReadFileAsync<T>(filePath);

    // --- async load action ---------------------------------------------------

    public async Task<IApiSdk> LoadAsync(DataSources sources, IProgress<string>? progress = null)
    {
        // Thin dispatcher: pick the loader for the requested format, run it, then
        // commit the returned graph onto our fields. All graph construction lives
        // in the IDataSetLoader implementations.
        // Explicit on both formats: no catch-all default that would silently
        // mask an unrecognized value. An out-of-range format throws.
        IDataSetLoader loader = sources.Format switch
        {
            DataSourceFormat.V1 => new V1DataSetLoader(),
            DataSourceFormat.V3 => new V3DataSetLoader(),
            _ => throw new ArgumentOutOfRangeException(
                nameof(sources),
                sources.Format,
                $"Unrecognized {nameof(DataSourceFormat)} value."),
        };

        var result = await loader.LoadAsync(_fileReader, sources, progress);

        _voyages = result.Voyages;
        _ships = result.Ships;
        _cabinGrades = result.CabinGrades;
        _ports = result.Ports;
        _departures = result.Departures;
        _offerings = result.Offerings;
        _shipById = result.ShipById;
        _cabinGradeByCode = result.CabinGradeByCode;
        _portByCode = result.PortByCode;
        _departureByCode = result.DepartureByCode;
        _isLoaded = true;

        return this;
    }

    // --- data graph ----------------------------------------------------------

    public IReadOnlyList<Voyage> Voyages => _voyages;
    public IReadOnlyList<Ship> Ships => _ships;
    public IReadOnlyList<CabinGrade> CabinGrades => _cabinGrades;
    public IReadOnlyList<Port> Ports => _ports;
    public IReadOnlyList<Departure> Departures => _departures;
    public IReadOnlyList<CabinOffering> Offerings => _offerings;

    public Ship? GetShip(string id) => _shipById.TryGetValue(id, out var s) ? s : null;
    public CabinGrade? GetCabinGrade(string code) => _cabinGradeByCode.TryGetValue(code, out var g) ? g : null;
    public Port? GetPort(string code) => _portByCode.TryGetValue(code, out var p) ? p : null;
    public Departure? GetDeparture(string code) => _departureByCode.TryGetValue(code, out var d) ? d : null;

    public SdkStats Stats => new()
    {
        VoyageCount = _voyages.Count,
        ShipCount = _ships.Count,
        CabinGradeCount = _cabinGrades.Count,
        PortCount = _ports.Count,
        DepartureCount = _departures.Count,
        OfferingCount = _offerings.Count,
    };
}
