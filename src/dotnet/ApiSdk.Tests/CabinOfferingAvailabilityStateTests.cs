using System.Reflection;
using ApiSdk.Availability;
using ApiSdk.Data;

namespace ApiSdk.Tests;

/// <summary>
/// Covers the observable <see cref="CabinAvailabilityState"/> state machine
/// layered on top of <see cref="CabinOffering.GetAvailableCabinsAsync"/>'s
/// existing invoke-once-then-cache behaviour (see
/// <see cref="CabinOfferingLiveAvailabilityTests"/> for that base behaviour).
/// Uses the same reflection-constructor trick as that file, since
/// <c>CabinOffering</c>'s constructor is internal.
/// </summary>
public class CabinOfferingAvailabilityStateTests
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

    /// <summary>A client whose fetch only completes once the test releases
    /// <see cref="Gate"/> — lets a test observe the <c>Loading</c> state
    /// before the underlying call resolves.</summary>
    private sealed class GatedClient : ISwOTAAvailabilityClient
    {
        public TaskCompletionSource<int?> Gate { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int InvocationCount { get; private set; }

        public Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default)
        {
            Interlocked.Increment(ref _count);
            InvocationCount = _count;
            return Gate.Task;
        }

        private int _count;
    }

    /// <summary>A client that always throws, simulating a fetch whose
    /// underlying retry logic has already been exhausted.</summary>
    private sealed class ThrowingClient : ISwOTAAvailabilityClient
    {
        public async Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default)
        {
            await Task.Delay(1, ct);
            throw new InvalidOperationException("SWOTA unavailable");
        }
    }

    // --- Static offerings (V1/V3, no live client) ----------------------------

    [Fact]
    public void Static_offering_starts_in_Static_state_with_the_static_value_as_last_known()
    {
        var offering = NewOffering(availableCabins: 7);

        Assert.Equal(CabinAvailabilityState.Static, offering.AvailabilityState);
        Assert.Equal(7, offering.LastKnownAvailableCabins);
    }

    [Fact]
    public async Task Static_offering_never_fires_AvailabilityChanged_and_never_changes_state()
    {
        var offering = NewOffering(availableCabins: 7);
        var fired = false;
        offering.AvailabilityChanged += _ => fired = true;

        await offering.GetAvailableCabinsAsync();
        await offering.GetAvailableCabinsAsync();

        Assert.False(fired);
        Assert.Equal(CabinAvailabilityState.Static, offering.AvailabilityState);
        Assert.Equal(7, offering.LastKnownAvailableCabins);
    }

    // --- SwOTA offerings: initial state ---------------------------------------

    [Fact]
    public void SwOTA_offering_starts_in_NotFetched_state_with_null_last_known()
    {
        var offering = NewOffering(availableCabins: 99, voyageId: "V1", liveClient: new GatedClient());

        Assert.Equal(CabinAvailabilityState.NotFetched, offering.AvailabilityState);
        Assert.Null(offering.LastKnownAvailableCabins);
    }

    // --- Loading transition ----------------------------------------------------

    [Fact]
    public void Calling_GetAvailableCabinsAsync_transitions_to_Loading_synchronously()
    {
        var client = new GatedClient();
        var offering = NewOffering(availableCabins: 99, voyageId: "V1", liveClient: client);

        var task = offering.GetAvailableCabinsAsync(); // fetch never resolves (gate held)

        Assert.Equal(CabinAvailabilityState.Loading, offering.AvailabilityState);
        Assert.Null(offering.LastKnownAvailableCabins);

        // Release so the test doesn't leave a dangling continuation.
        client.Gate.SetResult(4);
    }

    // --- Success path ------------------------------------------------------------

    [Fact]
    public async Task Successful_fetch_transitions_to_Loaded_and_fires_AvailabilityChanged_exactly_twice()
    {
        var client = new GatedClient();
        var offering = NewOffering(availableCabins: 99, voyageId: "V1", liveClient: client);
        var seenStates = new List<CabinAvailabilityState>();
        // ApplyTerminalTransition completes the memoized task BEFORE it fires
        // AvailabilityChanged (deliberately -- see the doc comment there), so
        // by the time `await task` below resolves, the handler for the
        // terminal transition may not have run yet. Rather than reading
        // seenStates as a proxy for "the handler is done", have the handler
        // itself signal completion once it has recorded both expected
        // states, and wait on that signal explicitly.
        var handlerDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        offering.AvailabilityChanged += o =>
        {
            seenStates.Add(o.AvailabilityState);
            if (seenStates.Count == 2) handlerDone.TrySetResult();
        };

        var task = offering.GetAvailableCabinsAsync();
        Assert.Equal(CabinAvailabilityState.Loading, offering.AvailabilityState);

        client.Gate.SetResult(4);
        var result = await task;

        var signaled = await Task.WhenAny(handlerDone.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        Assert.True(signaled == handlerDone.Task,
            "Timed out waiting for the AvailabilityChanged handler to finish recording both state transitions.");

        Assert.Equal(4, result);
        Assert.Equal(CabinAvailabilityState.Loaded, offering.AvailabilityState);
        Assert.Equal(4, offering.LastKnownAvailableCabins);
        Assert.Equal(new[] { CabinAvailabilityState.Loading, CabinAvailabilityState.Loaded }, seenStates);
    }

    // --- Failure path --------------------------------------------------------------

    [Fact]
    public async Task Failed_fetch_transitions_to_Failed_and_fires_AvailabilityChanged_exactly_twice()
    {
        var client = new ThrowingClient();
        var offering = NewOffering(availableCabins: 99, voyageId: "V1", liveClient: client);
        var seenStates = new List<CabinAvailabilityState>();
        // Same race as the success-path test above: the tcs backing the
        // awaited task completes before AvailabilityChanged fires, so the
        // handler for the terminal (Failed) transition isn't guaranteed to
        // have run yet once the await below resolves. Wait for the
        // handler's own completion signal instead of relying on the fetch
        // task as a proxy for "the handler is done".
        var handlerDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        offering.AvailabilityChanged += o =>
        {
            seenStates.Add(o.AvailabilityState);
            if (seenStates.Count == 2) handlerDone.TrySetResult();
        };

        await Assert.ThrowsAsync<InvalidOperationException>(() => offering.GetAvailableCabinsAsync());

        var signaled = await Task.WhenAny(handlerDone.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        Assert.True(signaled == handlerDone.Task,
            "Timed out waiting for the AvailabilityChanged handler to finish recording both state transitions.");

        Assert.Equal(CabinAvailabilityState.Failed, offering.AvailabilityState);
        Assert.Null(offering.LastKnownAvailableCabins);
        Assert.Equal(new[] { CabinAvailabilityState.Loading, CabinAvailabilityState.Failed }, seenStates);
    }

    // --- Subscriber isolation ----------------------------------------------------

    [Fact]
    public async Task Throwing_subscriber_on_success_does_not_corrupt_the_Loaded_state()
    {
        var client = new GatedClient();
        var offering = NewOffering(availableCabins: 99, voyageId: "V1", liveClient: client);
        offering.AvailabilityChanged += _ => throw new InvalidOperationException("subscriber boom");

        var task = offering.GetAvailableCabinsAsync();
        client.Gate.SetResult(4);

        // Must resolve normally -- a throwing subscriber must not be
        // mis-attributed to the fetch itself and flip an already-successful
        // result back to Failed, nor propagate out of the awaited task.
        var result = await task;

        Assert.Equal(4, result);
        Assert.Equal(CabinAvailabilityState.Loaded, offering.AvailabilityState);
        Assert.Equal(4, offering.LastKnownAvailableCabins);
    }

    [Fact]
    public async Task Throwing_subscriber_on_failure_does_not_propagate_out_of_the_await()
    {
        var client = new ThrowingClient();
        var offering = NewOffering(availableCabins: 99, voyageId: "V1", liveClient: client);
        offering.AvailabilityChanged += _ => throw new InvalidOperationException("subscriber boom");

        // Only the fetch's own exception should surface -- the subscriber's
        // exception must be swallowed, not layered on top / substituted.
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => offering.GetAvailableCabinsAsync());

        Assert.Equal("SWOTA unavailable", ex.Message);
        Assert.Equal(CabinAvailabilityState.Failed, offering.AvailabilityState);
    }

    // --- Failed is retryable, not terminal ----------------------------------------

    /// <summary>Throws on its first invocation, then succeeds -- simulates a
    /// transient SWOTA failure followed by a successful retry.</summary>
    private sealed class FlakyThenSucceedsClient : ISwOTAAvailabilityClient
    {
        private readonly int? _result;
        private int _calls;
        public int InvocationCount => _calls;

        public FlakyThenSucceedsClient(int? result) => _result = result;

        public Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default)
        {
            Interlocked.Increment(ref _calls);
            if (_calls == 1) throw new InvalidOperationException("SWOTA unavailable");
            return Task.FromResult(_result);
        }
    }

    [Fact]
    public async Task Failed_offering_is_retried_by_a_later_call_instead_of_staying_stuck_forever()
    {
        var client = new FlakyThenSucceedsClient(result: 4);
        var offering = NewOffering(availableCabins: 99, voyageId: "V1", liveClient: client);

        await Assert.ThrowsAsync<InvalidOperationException>(() => offering.GetAvailableCabinsAsync());
        Assert.Equal(CabinAvailabilityState.Failed, offering.AvailabilityState);

        var result = await offering.GetAvailableCabinsAsync();

        Assert.Equal(4, result);
        Assert.Equal(CabinAvailabilityState.Loaded, offering.AvailabilityState);
        Assert.Equal(4, offering.LastKnownAvailableCabins);
        Assert.Equal(2, client.InvocationCount);
    }

    // --- Concurrency -----------------------------------------------------------------

    [Fact]
    public async Task Concurrent_callers_cause_only_one_Loading_and_one_terminal_transition()
    {
        var client = new GatedClient();
        var offering = NewOffering(availableCabins: 99, voyageId: "V1", liveClient: client);
        var firedCount = 0;
        // Same race as the success/failure-path tests: the memoized task
        // that t1/t2/t3 await completes before AvailabilityChanged fires
        // for the terminal transition, so `firedCount` isn't guaranteed to
        // have reached 2 yet by the time Task.WhenAll below resolves. Wait
        // for the handler's own completion signal instead.
        var handlerDone = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        offering.AvailabilityChanged += _ =>
        {
            if (Interlocked.Increment(ref firedCount) == 2) handlerDone.TrySetResult();
        };

        var t1 = offering.GetAvailableCabinsAsync();
        var t2 = offering.GetAvailableCabinsAsync();
        var t3 = offering.GetAvailableCabinsAsync();

        Assert.Equal(CabinAvailabilityState.Loading, offering.AvailabilityState);
        Assert.Equal(1, client.InvocationCount);

        client.Gate.SetResult(4);
        var results = await Task.WhenAll(t1, t2, t3);

        var signaled = await Task.WhenAny(handlerDone.Task, Task.Delay(TimeSpan.FromSeconds(5)));
        Assert.True(signaled == handlerDone.Task,
            "Timed out waiting for the AvailabilityChanged handler to fire for both the Loading and terminal transitions.");

        Assert.All(results, r => Assert.Equal(4, r));
        Assert.Equal(1, client.InvocationCount);
        Assert.Equal(CabinAvailabilityState.Loaded, offering.AvailabilityState);
        Assert.Equal(2, firedCount); // NotFetched->Loading, Loading->Loaded — exactly once each
    }
}
