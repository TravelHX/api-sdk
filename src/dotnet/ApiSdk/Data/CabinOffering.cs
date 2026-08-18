using ApiSdk.Availability;

namespace ApiSdk.Data;

/// <summary>
/// Observable lifecycle of a <see cref="CabinOffering"/>'s availability figure.
/// See <see cref="CabinOffering.AvailabilityState"/>.
/// </summary>
public enum CabinAvailabilityState
{
    /// <summary>No live client configured (V1/V3 format): the static
    /// <see cref="CabinOffering.AvailableCabins"/> value is already final.
    /// Set at construction and never changes afterward.</summary>
    Static,

    /// <summary>Live client configured (SwOTA format) but
    /// <see cref="CabinOffering.GetAvailableCabinsAsync"/> hasn't been called
    /// yet. Initial state at construction for SwOTA offerings.</summary>
    NotFetched,

    /// <summary><see cref="CabinOffering.GetAvailableCabinsAsync"/> has been
    /// called and the fetch is in flight.</summary>
    Loading,

    /// <summary>The fetch completed successfully; the resolved value is
    /// available via <see cref="CabinOffering.LastKnownAvailableCabins"/>.</summary>
    Loaded,

    /// <summary>The fetch threw, after the client's own retry logic (if any)
    /// was exhausted.</summary>
    Failed,
}

/// <summary>
/// A cabin grade made available on a specific departure, with prices per
/// currency. The join between a Departure and a CabinGrade — the node where
/// pricing lives. Navigable to its departure, grade and ship.
/// </summary>
public sealed class CabinOffering
{
    private readonly Dictionary<string, Price> _prices = new();
    private readonly object _liveAvailabilityLock = new();
    private Departure _departure = null!;
    private CabinGrade? _cabinGrade;

    private readonly string? _voyageId;
    private readonly ISwOTAAvailabilityClient? _liveAvailabilityClient;
    private Task<int?>? _liveAvailabilityTask;

    // --- observable availability state --------------------------------------

    // Guarded by _liveAvailabilityLock — the same lock that already gates
    // "am I the first caller to start the fetch" below, so a state read never
    // observes a half-applied transition and the first-caller-wins race for
    // starting a fetch and the race for publishing its resulting state are
    // one and the same critical section.
    private CabinAvailabilityState _availabilityState;
    private int? _lastKnownAvailableCabins;

    /// <summary>
    /// Current point in the <see cref="CabinAvailabilityState"/> lifecycle.
    /// Thread-safe to read at any time; never blocks and never triggers a fetch.
    /// </summary>
    public CabinAvailabilityState AvailabilityState
    {
        get { lock (_liveAvailabilityLock) return _availabilityState; }
    }

    /// <summary>
    /// Synchronous, side-effect-free snapshot of whatever's currently known —
    /// safe to poll repeatedly (e.g. from a render loop). Never triggers a
    /// fetch. <c>null</c> while <see cref="CabinAvailabilityState.NotFetched"/>,
    /// <see cref="CabinAvailabilityState.Loading"/> or
    /// <see cref="CabinAvailabilityState.Failed"/>; the resolved value once
    /// <see cref="CabinAvailabilityState.Loaded"/>; the static
    /// <see cref="AvailableCabins"/> value immediately when
    /// <see cref="CabinAvailabilityState.Static"/>.
    /// </summary>
    public int? LastKnownAvailableCabins
    {
        get { lock (_liveAvailabilityLock) return _lastKnownAvailableCabins; }
    }

    /// <summary>
    /// Raised on the thread that completed the state transition (no
    /// thread-marshaling — this is a console TUI) whenever
    /// <see cref="AvailabilityState"/>/<see cref="LastKnownAvailableCabins"/>
    /// change: <c>NotFetched</c>→<c>Loading</c>, then
    /// <c>Loading</c>→<c>Loaded</c> or <c>Loading</c>→<c>Failed</c>. Never
    /// raised for <see cref="CabinAvailabilityState.Static"/> offerings.
    /// Invoked outside the internal lock, so a handler that calls back into
    /// this offering (e.g. to read <see cref="AvailabilityState"/>) can't deadlock.
    /// </summary>
    public event Action<CabinOffering>? AvailabilityChanged;

    /// <summary>Applies a transition and fires <see cref="AvailabilityChanged"/>.
    /// Caller must hold <see cref="_liveAvailabilityLock"/> to set the fields,
    /// but the event itself is raised after the lock is released (see call
    /// sites) so subscribers never run inside the lock.</summary>
    private void SetState(CabinAvailabilityState state, int? lastKnown)
    {
        _availabilityState = state;
        _lastKnownAvailableCabins = lastKnown;
    }

    /// <summary>Cabin grade code (source-market "Category", e.g. "DS").</summary>
    public string Code { get; }

    /// <summary>Human label (source-market "SuperCategory", e.g. "DARWIN SUITE").</summary>
    public string Name { get; }

    /// <summary>
    /// Static availability snapshot. Under V1 this is a real value from the
    /// flat file; under V3 there is no real field so the loader substitutes
    /// MaxOccupancy as a placeholder. Left untouched by the SwOTA live-lookup
    /// addition below — see <see cref="GetAvailableCabinsAsync"/> for the
    /// live counterpart.
    /// </summary>
    public int? AvailableCabins { get; }

    /// <param name="code">Cabin grade code — see <see cref="Code"/>.</param>
    /// <param name="name">Human label — see <see cref="Name"/>.</param>
    /// <param name="availableCabins">Static snapshot — see <see cref="AvailableCabins"/>.</param>
    /// <param name="voyageId">The departure/voyage identifier this offering is
    /// sold on, passed through to <paramref name="liveAvailabilityClient"/>
    /// lookups. Null/unused unless a live client is supplied.</param>
    /// <param name="liveAvailabilityClient">When non-null (only under
    /// <see cref="DataSourceFormat.SwOTA"/>), backs
    /// <see cref="GetAvailableCabinsAsync"/> with a live lookup instead of the
    /// static <paramref name="availableCabins"/> snapshot.</param>
    internal CabinOffering(
        string code,
        string name,
        int? availableCabins,
        string? voyageId = null,
        ISwOTAAvailabilityClient? liveAvailabilityClient = null)
    {
        Code = code;
        Name = name;
        AvailableCabins = availableCabins;
        _voyageId = voyageId;
        _liveAvailabilityClient = liveAvailabilityClient;

        // No lock needed here — this runs before the instance is published to
        // any other thread/caller.
        if (liveAvailabilityClient is null)
        {
            _availabilityState = CabinAvailabilityState.Static;
            _lastKnownAvailableCabins = availableCabins;
        }
        else
        {
            _availabilityState = CabinAvailabilityState.NotFetched;
            _lastKnownAvailableCabins = null;
        }
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

    /// <summary>
    /// Live-or-static cabin availability.
    /// <list type="bullet">
    /// <item>No live client configured (V1/V3 formats): returns the static
    /// <see cref="AvailableCabins"/> value immediately, no caching needed.
    /// <see cref="AvailabilityState"/> is <see cref="CabinAvailabilityState.Static"/>
    /// already and this call is a no-op with respect to it.</item>
    /// <item>Live client configured (SwOTA format): the first call invokes the
    /// client and caches the resulting task, so concurrent first-callers await
    /// the same in-flight call; later calls return the cached, already-completed
    /// result without re-invoking the client. That same first caller —
    /// determined atomically under <see cref="_liveAvailabilityLock"/>, so
    /// concurrent racers never both "win" — synchronously flips
    /// <see cref="AvailabilityState"/> from <see cref="CabinAvailabilityState.NotFetched"/>
    /// to <see cref="CabinAvailabilityState.Loading"/> and fires
    /// <see cref="AvailabilityChanged"/> once for that transition BEFORE the
    /// live client is ever invoked (see <see cref="StartFetch"/>) — so this is
    /// true unconditionally, whether the client resolves normally, returns a
    /// task that later faults, or throws synchronously the instant it's
    /// called; there is no path by which the terminal transition can run
    /// ahead of, or collapse, the Loading one. When the underlying call
    /// resolves or throws, the state moves once more to
    /// <see cref="CabinAvailabilityState.Loaded"/> or
    /// <see cref="CabinAvailabilityState.Failed"/>, and the
    /// <see cref="Task{TResult}"/> returned/memoized here completes FIRST — so
    /// every caller (the first one and every concurrent or later one awaiting
    /// the same memoized task) is guaranteed to observe the terminal state
    /// already applied by the time its own await returns; there is no window
    /// where a caller's result is available but
    /// <see cref="AvailabilityState"/> still reads <c>Loading</c>. Only *after*
    /// that task has completed does <see cref="AvailabilityChanged"/> fire for
    /// that transition (its second and final firing) — this ordering is what
    /// lets a subscriber that synchronously blocks on this same task from
    /// within its own handler do so without deadlocking, since the task is
    /// already complete by the time any handler runs. Concurrent callers that
    /// lose the race never drive the state machine themselves — they just
    /// await the same task and observe its one set of transitions.</item>
    /// <item>A <see cref="CabinAvailabilityState.Failed"/> offering is
    /// retryable, not terminal: a later call re-invokes the client rather
    /// than staying memoized as failed forever. Only
    /// <see cref="CabinAvailabilityState.Loaded"/> is truly final.</item>
    /// </list>
    /// </summary>
    /// <param name="ct">Accepted for API consistency/future use, but not
    /// currently wired to anything: it is not observed anywhere in this
    /// method's body, so it does not cancel even the caller's own await of
    /// the returned task, let alone the underlying SWOTA fetch. The fetch is
    /// shared/memoized across every concurrent or later caller, so honoring
    /// any one caller's token on the shared client call would let that
    /// caller's cancellation poison the result for every other caller riding
    /// the same memoized task; the actual client call always runs with
    /// <see cref="CancellationToken.None"/> regardless of what's passed
    /// here.</param>
    public Task<int?> GetAvailableCabinsAsync(CancellationToken ct = default)
    {
        if (_liveAvailabilityClient is null) return Task.FromResult(AvailableCabins);

        Task<int?> task;
        var isFirstCaller = false;
        TaskCompletionSource<int?>? tcs = null;
        lock (_liveAvailabilityLock)
        {
            // A Failed offering is retryable -- only Loaded is truly terminal.
            // Without this, a transient SWOTA failure would memoize "Failed"
            // forever with no way for a later call to ever try again.
            if (_liveAvailabilityTask is null || _availabilityState == CabinAvailabilityState.Failed)
            {
                isFirstCaller = true;
                SetState(CabinAvailabilityState.Loading, null);

                // Memoize a TaskCompletionSource's Task, NOT the live client's
                // task -- the client hasn't even been invoked yet at this
                // point. This is what lets the Loading transition be fully
                // applied AND announced (via RaiseAvailabilityChanged, below,
                // once the lock is released) strictly BEFORE the client is
                // ever called (see StartFetch). Without this indirection, a
                // client that throws synchronously would let the terminal
                // Loaded/Failed transition run to completion (including firing
                // AvailabilityChanged) before this method ever releases the
                // lock or announces Loading -- reentering the lock (harmless
                // on its own, since Monitor is same-thread-reentrant) but
                // firing the terminal event BEFORE the Loading event, and
                // collapsing Loading to a state no external caller could ever
                // observe. RunContinuationsAsynchronously keeps any awaiter's
                // continuation off of whatever thread completes the fetch,
                // matching the "no thread-marshaling" behaviour the rest of
                // this type already documents for AvailabilityChanged.
                tcs = new TaskCompletionSource<int?>(TaskCreationOptions.RunContinuationsAsynchronously);
                _liveAvailabilityTask = tcs.Task;
            }
            task = _liveAvailabilityTask;
        }

        // Fired outside the lock: AvailabilityChanged is arbitrary subscriber
        // code (e.g. a TUI redraw) and must never run while holding a lock
        // other callers may be waiting on. Only after this has fully returned
        // (including swallowing any subscriber exception, see
        // RaiseAvailabilityChanged) do we ever invoke the live client -- see
        // StartFetch -- so the Loading announcement can never be raced or
        // skipped by a synchronous throw.
        if (isFirstCaller)
        {
            RaiseAvailabilityChanged();
            StartFetch(tcs!);
        }

        return task;
    }

    /// <summary>Invokes the live client -- catching a synchronous throw
    /// exactly like an asynchronous fault, so both paths drive the same
    /// Loading -> Loaded/Failed transition -- and arranges for the result to
    /// complete <paramref name="tcs"/>. Only ever called once per offering per
    /// fetch attempt, by the single first caller identified in
    /// <see cref="GetAvailableCabinsAsync"/>, and only after that caller has
    /// already released <see cref="_liveAvailabilityLock"/> and announced the
    /// Loading transition -- see the doc comment there for why that ordering
    /// matters.</summary>
    private void StartFetch(TaskCompletionSource<int?> tcs)
    {
        Task<int?> started;
        try
        {
            // CancellationToken.None, deliberately not any caller's ct — see
            // the doc comment on GetAvailableCabinsAsync.
            started = _liveAvailabilityClient!.GetAvailableCabinsAsync(_voyageId ?? string.Empty, Code, CancellationToken.None);
        }
        catch (Exception ex)
        {
            // A client that throws synchronously instead of returning a
            // faulted task still needs to drive the same Loading -> Failed
            // transition below.
            started = Task.FromException<int?>(ex);
        }

        // Deliberately not awaited: this method must return immediately
        // (nothing here needs to observe the fetch's outcome), and the
        // continuation below never lets an exception escape it -- every path
        // through it either returns normally or is caught -- so there is
        // nothing for an UnobservedTaskException to complain about.
        _ = ApplyTerminalTransition(started, tcs);
    }

    /// <summary>Awaits the underlying client call, applies the Loaded/Failed
    /// transition, completes <paramref name="tcs"/> (and therefore every
    /// caller's memoized task — see <see cref="GetAvailableCabinsAsync"/>)
    /// with the same result (or the same exception) as
    /// <paramref name="inner"/>, then fires
    /// <see cref="AvailabilityChanged"/>.
    ///
    /// The state transition is fully applied (including which terminal state
    /// was reached) BEFORE <paramref name="tcs"/> is completed, and
    /// <paramref name="tcs"/> is completed BEFORE
    /// <see cref="AvailabilityChanged"/> is raised -- so every caller (the
    /// first one and every concurrent or later one awaiting the same
    /// memoized task) is guaranteed to observe the terminal state already
    /// applied by the time its own await returns. This ordering also matters
    /// for a subscriber that itself synchronously blocks on
    /// <paramref name="tcs"/>'s task from within its own
    /// <see cref="AvailabilityChanged"/> handler (e.g. by calling
    /// <c>.Result</c>/<c>.Wait()</c> or otherwise re-entering
    /// <see cref="GetAvailableCabinsAsync"/> synchronously): because the task
    /// is already complete by the time the event fires, that handler
    /// observes an already-finished task instead of blocking on one that can
    /// only be completed by a continuation still waiting to run, which is
    /// what would deadlock. What prevents a subscriber's exception from
    /// being mis-attributed to the fetch and flipping an already-successful
    /// Loaded result back to Failed is that
    /// <see cref="RaiseAvailabilityChanged"/> swallows subscriber exceptions
    /// itself before they ever reach this method's catch block, so they can't
    /// propagate out of this method either.</summary>
    private async Task ApplyTerminalTransition(Task<int?> inner, TaskCompletionSource<int?> tcs)
    {
        try
        {
            var result = await inner.ConfigureAwait(false);
            lock (_liveAvailabilityLock)
            {
                SetState(CabinAvailabilityState.Loaded, result);
            }
            tcs.TrySetResult(result);
            RaiseAvailabilityChanged();
        }
        catch (Exception ex)
        {
            lock (_liveAvailabilityLock)
            {
                SetState(CabinAvailabilityState.Failed, null);
            }
            tcs.TrySetException(ex);
            RaiseAvailabilityChanged();
        }
    }

    /// <summary>Raises <see cref="AvailabilityChanged"/>, catching and
    /// discarding any exception a subscriber throws so it can never
    /// propagate back into fetch-state logic (see <see cref="ApplyTerminalTransition"/>,
    /// which calls this only after the Loaded/Failed transition is already
    /// fully applied) or out to a caller merely awaiting the availability
    /// result.</summary>
    private void RaiseAvailabilityChanged()
    {
        try
        {
            AvailabilityChanged?.Invoke(this);
        }
        catch
        {
            // Subscriber misbehaved (e.g. a TUI redraw handler threw). The
            // fetch itself already succeeded or failed on its own merits by
            // the time this runs -- a subscriber exception must not corrupt
            // that outcome, so it's swallowed here rather than surfaced.
        }
    }
}
