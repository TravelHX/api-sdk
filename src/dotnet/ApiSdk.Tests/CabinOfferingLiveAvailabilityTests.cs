using System.Reflection;
using ApiSdk.Availability;
using ApiSdk.Data;

namespace ApiSdk.Tests;

/// <summary>
/// Covers <see cref="CabinOffering.GetAvailableCabinsAsync"/>: the static
/// pass-through when no live client is configured (V1/V3), and the
/// invoke-once-then-cache behaviour when one is (SwOTA). <c>CabinOffering</c>'s
/// constructor is internal, so these tests build instances via reflection —
/// same trick would be needed for any test in this assembly that wants a
/// bare offering without going through a full loader.
/// </summary>
public class CabinOfferingLiveAvailabilityTests
{
    private static CabinOffering NewOffering(
        int? availableCabins,
        string? voyageId = null,
        ISwOTAAvailabilityClient? liveClient = null)
    {
        var ctor = typeof(CabinOffering).GetConstructor(
            BindingFlags.NonPublic | BindingFlags.Instance,
            binder: null,
            types: new[] { typeof(string), typeof(string), typeof(int?), typeof(string), typeof(ISwOTAAvailabilityClient) },
            modifiers: null)!;

        return (CabinOffering)ctor.Invoke(new object?[] { "DS", "Darwin Suite", availableCabins, voyageId, liveClient });
    }

    private sealed class CountingClient : ISwOTAAvailabilityClient
    {
        public int InvocationCount { get; private set; }
        public string? LastVoyageId { get; private set; }
        public string? LastCabinCode { get; private set; }
        private readonly int? _result;

        public CountingClient(int? result) => _result = result;

        public async Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default)
        {
            Interlocked.Increment(ref _count);
            InvocationCount = _count;
            LastVoyageId = voyageId;
            LastCabinCode = cabinCode;
            await Task.Delay(1, ct); // simulate an outbound call
            return _result;
        }

        private int _count;
    }

    [Fact]
    public async Task No_live_client_returns_the_static_value_immediately()
    {
        var offering = NewOffering(availableCabins: 7);

        var result = await offering.GetAvailableCabinsAsync();

        Assert.Equal(7, result);
    }

    [Fact]
    public async Task No_live_client_returns_null_when_static_value_is_null()
    {
        var offering = NewOffering(availableCabins: null);

        var result = await offering.GetAvailableCabinsAsync();

        Assert.Null(result);
    }

    [Fact]
    public async Task With_live_client_first_call_invokes_it_with_voyageId_and_code()
    {
        var client = new CountingClient(result: 4);
        var offering = NewOffering(availableCabins: 99, voyageId: "FNALA04-260906", liveClient: client);

        var result = await offering.GetAvailableCabinsAsync();

        Assert.Equal(4, result);
        Assert.Equal(1, client.InvocationCount);
        Assert.Equal("FNALA04-260906", client.LastVoyageId);
        Assert.Equal("DS", client.LastCabinCode);
    }

    [Fact]
    public async Task With_live_client_second_call_after_completion_does_not_reinvoke()
    {
        var client = new CountingClient(result: 4);
        var offering = NewOffering(availableCabins: 99, voyageId: "FNALA04-260906", liveClient: client);

        var first = await offering.GetAvailableCabinsAsync();
        var second = await offering.GetAvailableCabinsAsync();

        Assert.Equal(4, first);
        Assert.Equal(4, second);
        Assert.Equal(1, client.InvocationCount);
    }

    [Fact]
    public async Task With_live_client_concurrent_first_callers_share_the_same_in_flight_call()
    {
        var client = new CountingClient(result: 4);
        var offering = NewOffering(availableCabins: 99, voyageId: "FNALA04-260906", liveClient: client);

        var results = await Task.WhenAll(
            offering.GetAvailableCabinsAsync(),
            offering.GetAvailableCabinsAsync(),
            offering.GetAvailableCabinsAsync());

        Assert.All(results, r => Assert.Equal(4, r));
        Assert.Equal(1, client.InvocationCount);
    }

    // --- CancellationToken isolation -----------------------------------------------

    private sealed class CancellationRecordingClient : ISwOTAAvailabilityClient
    {
        private readonly int? _result;
        public CancellationRecordingClient(int? result) => _result = result;
        public CancellationToken? ReceivedToken { get; private set; }

        public Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default)
        {
            ReceivedToken = ct;
            return Task.FromResult(_result);
        }
    }

    [Fact]
    public async Task A_callers_own_cancellation_token_is_not_forwarded_to_the_shared_underlying_fetch()
    {
        var client = new CancellationRecordingClient(result: 4);
        var offering = NewOffering(availableCabins: 99, voyageId: "FNALA04-260906", liveClient: client);
        using var cts = new CancellationTokenSource();
        cts.Cancel(); // this caller's own token is already cancelled

        // Must resolve normally: the shared/memoized fetch is not tied to any
        // one caller's token, so it must not fault just because the first
        // caller happens to pass an already-cancelled one.
        var result = await offering.GetAvailableCabinsAsync(cts.Token);

        Assert.Equal(4, result);
        Assert.NotNull(client.ReceivedToken);
        Assert.False(client.ReceivedToken!.Value.CanBeCanceled);
    }

    // --- synchronous-throw client (regression: Loading must stay observable) ------

    /// <summary>A client whose <c>GetAvailableCabinsAsync</c> is a plain,
    /// non-<c>async</c> method that throws directly, before returning any
    /// <see cref="Task"/> at all -- as opposed to returning a faulted task.
    /// Reproduces the case where <c>CabinOffering</c> used to wrap the
    /// exception via <c>Task.FromException</c> and then run the whole
    /// Loaded/Failed transition (including firing <c>AvailabilityChanged</c>)
    /// synchronously, inside the same call, before ever releasing the lock or
    /// announcing the Loading transition -- collapsing Loading to a state no
    /// caller could ever observe.</summary>
    private sealed class SynchronousThrowClient : ISwOTAAvailabilityClient
    {
        public Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default) =>
            throw new InvalidOperationException("boom: synchronous throw, no Task ever returned");
    }

    [Fact]
    public async Task Synchronous_throw_from_the_client_still_fires_Loading_before_Failed_and_never_hangs()
    {
        var client = new SynchronousThrowClient();
        var offering = NewOffering(availableCabins: 99, voyageId: "FNALA04-260906", liveClient: client);

        var observedStates = new List<CabinAvailabilityState>();
        offering.AvailabilityChanged += o => observedStates.Add(o.AvailabilityState);

        // For a client that throws synchronously (zero wall-clock time), the
        // entire Loading -> Failed sequence runs to completion, in order,
        // before this call even returns -- there's no window in which an
        // external caller could observe "Loading" surviving past the call,
        // because nothing async ever happens. What matters (and what used to
        // be broken -- see SynchronousThrowClient's doc comment) is that
        // Loading is still fully applied and announced BEFORE Failed, not
        // skipped/collapsed or fired out of order.
        var task = offering.GetAvailableCabinsAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => task);

        Assert.Equal(CabinAvailabilityState.Failed, offering.AvailabilityState);
        Assert.Equal(
            new[] { CabinAvailabilityState.Loading, CabinAvailabilityState.Failed },
            observedStates);
    }

    // --- genuinely in-flight fetch (Loading really is observable pre-return) ------

    /// <summary>A client whose fetch only completes when the test explicitly
    /// lets it -- unlike <see cref="CountingClient"/>'s fixed
    /// <c>Task.Delay(1)</c>, this makes "the fetch is still in flight when we
    /// read <see cref="CabinOffering.AvailabilityState"/>" deterministic
    /// instead of timing-dependent.</summary>
    private sealed class ManuallyCompletedClient : ISwOTAAvailabilityClient
    {
        private readonly TaskCompletionSource<int?> _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default) => _tcs.Task;
        public void Complete(int? result) => _tcs.SetResult(result);
        public void Fail(Exception ex) => _tcs.SetException(ex);
    }

    [Fact]
    public async Task Loading_is_observable_synchronously_before_the_call_returns_while_a_fetch_is_genuinely_in_flight()
    {
        var client = new ManuallyCompletedClient();
        var offering = NewOffering(availableCabins: 99, voyageId: "FNALA04-260906", liveClient: client);

        var task = offering.GetAvailableCabinsAsync();

        // The fetch is deliberately held open (ManuallyCompletedClient never
        // completes until told to), so this read is not racing anything --
        // per the class's own doc comment, the Loading transition is
        // "observable before this method even returns".
        Assert.Equal(CabinAvailabilityState.Loading, offering.AvailabilityState);

        client.Complete(5);
        var result = await task;

        Assert.Equal(5, result);
        Assert.Equal(CabinAvailabilityState.Loaded, offering.AvailabilityState);
    }

    // --- deadlock regression: subscriber blocks synchronously on the memoized task ---

    /// <summary>Reproduces the deadlock a reviewer found via stress testing:
    /// if <c>ApplyTerminalTransition</c> ever raises
    /// <see cref="CabinOffering.AvailabilityChanged"/> BEFORE completing the
    /// <c>TaskCompletionSource</c> backing <see cref="CabinOffering.GetAvailableCabinsAsync()"/>'s
    /// memoized task, then a subscriber that synchronously blocks on that
    /// same task from inside its handler (e.g. via <c>.GetAwaiter().GetResult()</c>,
    /// <c>.Result</c>, or <c>.Wait()</c> -- as a naive TUI redraw handler
    /// might) deadlocks permanently: the only code that could ever complete
    /// the task is later in the very call the handler is currently blocking
    /// inside of. This is a genuine circular wait, not a thread-pool
    /// exhaustion issue, so it cannot resolve on its own no matter how long
    /// it's given -- hence the bounded <c>Task.WhenAny</c> race below instead
    /// of an unbounded blocking wait, which would hang the test process
    /// itself if this regressed.
    ///
    /// The handler deliberately only probes on the Loaded/Failed (terminal)
    /// notification, not on the earlier Loading one: <c>GetAvailableCabinsAsync</c>
    /// fires Loading synchronously, on the caller's own thread, strictly
    /// BEFORE the underlying fetch is even started (see its doc comment) --
    /// so the memoized task can never possibly be complete yet at that point,
    /// by design, independent of anything <c>ApplyTerminalTransition</c>
    /// does. Blocking on it during Loading would deadlock unconditionally
    /// and prove nothing about the bug under test; this test is only about
    /// the ordering between completing the task and announcing the terminal
    /// state.</summary>
    [Fact]
    public async Task Subscriber_that_synchronously_blocks_on_the_memoized_task_from_within_AvailabilityChanged_does_not_deadlock()
    {
        var client = new CountingClient(result: 4);
        var offering = NewOffering(availableCabins: 99, voyageId: "FNALA04-260906", liveClient: client);

        int? observedFromHandler = null;
        offering.AvailabilityChanged += o =>
        {
            if (o.AvailabilityState == CabinAvailabilityState.Loading) return;

            // Synchronously blocks on the very task GetAvailableCabinsAsync()
            // memoizes. This only returns if the task was ALREADY complete
            // by the time this handler ran.
            observedFromHandler = o.GetAvailableCabinsAsync().GetAwaiter().GetResult();
        };

        var fetchTask = offering.GetAvailableCabinsAsync();
        var winner = await Task.WhenAny(fetchTask, Task.Delay(TimeSpan.FromSeconds(5)));

        Assert.Same(fetchTask, winner); // did not time out waiting on a deadlocked handler
        Assert.Equal(4, await fetchTask);
        Assert.Equal(4, observedFromHandler);
    }
}
