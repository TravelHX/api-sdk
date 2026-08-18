using ApiSdk.Availability;
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
    private readonly ISwOTAAvailabilityClient? _swOTAAvailabilityClient;

    // Only set when LoadAsync itself had to construct a default live client
    // (i.e. no client was supplied to the constructor) -- that's the one
    // case where THIS instance, not some caller, owns the HttpClient behind
    // it and is therefore responsible for disposing it. Reused across
    // repeated SwOTA loads on the same instance (e.g. a TUI "reload") rather
    // than constructing (and leaking) a fresh HttpClient every time.
    private SwOTAAvailabilityClient? _ownedSwOTAAvailabilityClient;

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
    private bool _disposed;

    /// <param name="fileReader">Flat-file reader; defaults to <see cref="FlatFileReader"/>.</param>
    /// <param name="swOTAAvailabilityClient">Live-availability client for the
    /// <see cref="DataSourceFormat.SwOTA"/> format; defaults to
    /// <see cref="SwOTAAvailabilityClient"/>. Ignored for V1/V3.</param>
    public ApiSdk(IFlatFileReader? fileReader = null, ISwOTAAvailabilityClient? swOTAAvailabilityClient = null)
    {
        _fileReader = fileReader ?? new FlatFileReader();
        _swOTAAvailabilityClient = swOTAAvailabilityClient;
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
        ObjectDisposedException.ThrowIf(_disposed, this);

        // Thin dispatcher: pick the loader for the requested format, run it, then
        // commit the returned graph onto our fields. All graph construction lives
        // in the IDataSetLoader implementations.
        // Explicit on every format: no catch-all default that would silently
        // mask an unrecognized value. An out-of-range format throws.
        DataSetLoadResult result;

        if (sources.Format == DataSourceFormat.SwOTA)
        {
            // SwOTA loads everything (ports/ships/voyages/departures/cabin
            // grades/offerings) exactly like V3 — the V3 loader is reused,
            // just with a live-availability client wired onto each offering —
            // falling back to V1 when the V3 source is unavailable/missing.
            // "Missing" reuses the existing signal IFlatFileReader already
            // throws for an absent file: FileNotFoundException.
            var liveClient = _swOTAAvailabilityClient ?? (_ownedSwOTAAvailabilityClient ??= new SwOTAAvailabilityClient());
            try
            {
                result = await new V3DataSetLoader(liveClient).LoadAsync(_fileReader, sources, progress);
            }
            catch (FileNotFoundException)
            {
                // Explicit about the consequence, not just the mechanism: a
                // caller who picked "live" is silently getting static V1 data
                // with NO live-availability capability at all (V1 offerings
                // are never wired to a live client — see CabinOffering's
                // constructor) unless this is surfaced somewhere the user
                // actually sees it.
                progress?.Report(
                    "SwOTA: V3 source unavailable, falling back to V1. " +
                    "Cabin availability will be the static V1 snapshot, NOT live SWOTA data.");
                result = await new V1DataSetLoader().LoadAsync(_fileReader, sources, progress);
            }
        }
        else
        {
            IDataSetLoader loader = sources.Format switch
            {
                DataSourceFormat.V1 => new V1DataSetLoader(),
                DataSourceFormat.V3 => new V3DataSetLoader(),
                _ => throw new ArgumentOutOfRangeException(
                    nameof(sources),
                    sources.Format,
                    $"Unrecognized {nameof(DataSourceFormat)} value."),
            };

            result = await loader.LoadAsync(_fileReader, sources, progress);
        }

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

    /// <summary>
    /// Disposes the live SWOTA client this instance constructed for itself
    /// (only relevant if a <see cref="DataSourceFormat.SwOTA"/> load ever ran
    /// without a caller-supplied <see cref="ISwOTAAvailabilityClient"/> — see
    /// <see cref="_ownedSwOTAAvailabilityClient"/>), releasing the
    /// <see cref="System.Net.Http.HttpClient"/> it owns. A no-op if no such
    /// client was ever constructed, or if a caller supplied its own client to
    /// the constructor — that one is never disposed here, since the caller
    /// still owns it and may reuse it elsewhere.
    ///
    /// Also flips <see cref="_disposed"/> so a subsequent <see cref="LoadAsync"/>
    /// call throws <see cref="ObjectDisposedException"/> instead of silently
    /// reusing (or, via the <c>??=</c> in <see cref="LoadAsync"/>, failing to
    /// recognize as disposed and reusing) the now-disposed owned client, and
    /// nulls the field out for good hygiene once disposed.
    /// </summary>
    public void Dispose()
    {
        _ownedSwOTAAvailabilityClient?.Dispose();
        _ownedSwOTAAvailabilityClient = null;
        _disposed = true;
    }
}
