using ApiSdk;
using ApiSdk.Availability;
using ApiSdk.Data;
using ApiSdk.SDKCLI.Models;
using Microsoft.Extensions.Configuration;
using System.Diagnostics;
using System.Globalization;
using System.Net.Http;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace ApiSdk.SDKCLI;

/// <summary>
/// Full-screen TUI front-end for the .NET SDK — the C# counterpart of
/// <c>utils/js/SDKCLI.js</c>. It loads the SDK object graph, then presents a
/// k9s-style menu (config, run tests, suite, browse, exit) using
/// the zero-dependency <see cref="Tui"/> toolkit.
/// </summary>
internal static class Program
{
    private static TestConfig _config = new();
    private static string _projectRoot = string.Empty;
    private static IConfiguration _configuration = null!;
    private static global::ApiSdk.ApiSdk _sdk = null!;
    private static TestDataConfig? _selectedTestSuite;
    private static DataSourceFormat? _resolvedFormat;
    private static Market? _resolvedMarket;
    private static string? _resolvedLocale;
    private static string? _resolvedCurrency; // null for V3/SwOTA (no currency concept), not just "unresolved"
    private static string? _resolvedBaseDir;  // the actual directory data was loaded from (V1 RefData dir or V3/SwOTA prod dir)

    // --- project root + config ---------------------------------------------

    private static string GetProjectRoot()
    {
        // Check if running in Docker (config.json is in /app).
        if (File.Exists("/app/config.json")) return "/app";

        // From bin/Debug/net9.0, go up 6 levels to reach the repo root.
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        return Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", ".."));
    }

    private static TestConfig LoadConfig()
    {
        var configPath = Path.Combine(_projectRoot, "config.json");
        if (!File.Exists(configPath))
            throw new FileNotFoundException($"Configuration file not found: {configPath}");

        var json = File.ReadAllText(configPath);
        var config = JsonSerializer.Deserialize<TestConfig>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        });
        return config ?? throw new InvalidOperationException("Failed to deserialize configuration file");
    }

    /// <summary>
    /// Builds the <see cref="IConfiguration"/> this CLI passes down to
    /// <see cref="DataSourceFormatConfig.Resolve"/> and to the
    /// <see cref="SwOTAAvailabilityClient"/> constructed below: <c>config.json</c>
    /// (committed, no secrets) then <c>config.local.json</c> (gitignored,
    /// higher priority since it's added last -- holds real SWOTA/Auth0
    /// credentials under a "SwOTA" section, see <see cref="SwOTARestConfig"/>).
    /// Both files are optional here -- <see cref="LoadConfig"/> above is the
    /// one that still hard-requires <c>config.json</c> for the CLI's own
    /// testData/output settings; this is a separate, additive read of the
    /// same directory for the DataSources/SwOTA keys only.
    /// </summary>
    private static IConfiguration BuildConfiguration() =>
        new ConfigurationBuilder()
            .SetBasePath(_projectRoot)
            .AddJsonFile("config.json", optional: true)
            .AddJsonFile("config.local.json", optional: true)
            .Build();

    // --- text helpers -------------------------------------------------------

    private static readonly Regex BlockTagRegex = new("<\\s*(p|br|div|li)[^>]*>", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AnyTagRegex = new("<[^>]+>", RegexOptions.Compiled);

    /// <summary>
    /// Itinerary <c>body</c> text is either v1 HTML (e.g.
    /// "&lt;p&gt;&lt;b&gt;...&lt;/b&gt;&lt;/p&gt;&lt;p&gt;...&lt;/p&gt;") or v3
    /// plain text. Normalize both into a flat list of plain-text paragraphs
    /// for terminal display: turn block-level tags into paragraph breaks,
    /// strip the rest of the markup, decode the small set of entities that
    /// show up in this source data, then split into paragraphs. Mirrors the
    /// JS CLI's <c>bodyParagraphs()</c> in <c>utils/js/SDKCLI.js</c>.
    /// </summary>
    private static List<string> BodyParagraphs(string? text)
    {
        if (string.IsNullOrEmpty(text)) return new List<string>();

        var plain = BlockTagRegex.Replace(text, "\n");
        plain = AnyTagRegex.Replace(plain, string.Empty);

        // Decode the other entities BEFORE '&amp;' -- decoding '&amp;' first
        // would turn a literal "&amp;lt;" into "&lt;" and then (on the same
        // pass) into "<", corrupting text that legitimately contained an
        // escaped ampersand followed by "lt;". Decoding the others first and
        // '&amp;' last avoids that double-decode artifact.
        plain = plain
            .Replace("&nbsp;", " ", StringComparison.OrdinalIgnoreCase)
            .Replace("&#39;", "'", StringComparison.OrdinalIgnoreCase)
            .Replace("&apos;", "'", StringComparison.OrdinalIgnoreCase)
            .Replace("&quot;", "\"", StringComparison.OrdinalIgnoreCase)
            .Replace("&lt;", "<", StringComparison.OrdinalIgnoreCase)
            .Replace("&gt;", ">", StringComparison.OrdinalIgnoreCase)
            .Replace("&amp;", "&", StringComparison.OrdinalIgnoreCase);

        return plain
            .Split('\n')
            .Select(p => p.Trim())
            .Where(p => p.Length > 0)
            .ToList();
    }

    /// <summary>
    /// Itinerary day numbers are free text in v1 (often already localized,
    /// e.g. "Days 10-11", "Tag 7-14") but a bare number in v3. Only prefix
    /// with "Day " when the value is nothing but digits/dashes/spaces --
    /// otherwise it already reads as a day label and a prefix would double
    /// up ("Day Day 2-3"). Mirrors the JS CLI's <c>itineraryDayLabel()</c>.
    /// </summary>
    private static readonly Regex NumericDayRegex = new(@"^[\d\s\-–—]+$", RegexOptions.Compiled);

    private static string ItineraryDayLabel(string? day)
    {
        if (string.IsNullOrWhiteSpace(day)) return "Day";
        var s = day.Trim();
        return NumericDayRegex.IsMatch(s) ? $"Day {s}" : s;
    }

    private static List<string> WrapText(string? text, int width = 76)
    {
        var words = (text ?? string.Empty)
            .Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var lines = new List<string>();
        var line = string.Empty;
        foreach (var word in words)
        {
            if (line.Length > 0 && line.Length + 1 + word.Length > width)
            {
                lines.Add(line);
                line = word;
            }
            else
            {
                line = line.Length > 0 ? $"{line} {word}" : word;
            }
        }
        if (line.Length > 0) lines.Add(line);
        return lines;
    }

    private static string? FormatPrice(double? value)
    {
        if (value is null) return null;
        return value.Value.ToString("N2", CultureInfo.GetCultureInfo("en-US"));
    }

    private static List<string> FormatPriceLines(string label, IReadOnlyDictionary<string, double> priceMap, string indent)
    {
        var currencies = priceMap.Keys.OrderBy(c => c, StringComparer.Ordinal).ToList();
        if (currencies.Count == 0) return new List<string> { $"{indent}{label} n/a" };

        var parts = currencies.Select(c => $"{c} {FormatPrice(priceMap[c])}").ToList();
        var lines = new List<string>();
        var line = string.Empty;
        const int max = 60;
        foreach (var part in parts)
        {
            if (line.Length > 0 && line.Length + 3 + part.Length > max)
            {
                lines.Add(line);
                line = part;
            }
            else
            {
                line = line.Length > 0 ? $"{line}   {part}" : part;
            }
        }
        if (line.Length > 0) lines.Add(line);

        var padded = new string(' ', label.Length + 1);
        return lines
            .Select((l, i) => $"{indent}{(i == 0 ? $"{label} " : padded)}{l}")
            .ToList();
    }

    // --- line builders for the views ---------------------------------------

    private static List<string> ConfigLines()
    {
        var t = _config.TestData;
        var o = _config.Output;
        var lines = new List<string>
        {
            $"Format:                {(_resolvedFormat is { } fmt ? fmt.ToString() : "(not resolved)")}",
            $"Market:                {(_resolvedMarket is { } m ? m.ToString() : "(not resolved)")}",
            $"Locale:                {_resolvedLocale ?? "(not resolved)"}",
            $"Currency:              {_resolvedCurrency ?? (_resolvedFormat is DataSourceFormat.V3 or DataSourceFormat.SwOTA ? "n/a (V3/SwOTA have no source-market currency)" : "(not resolved)")}",
            // The directory data was ACTUALLY loaded from for the resolved
            // format (V1's RefData dir or V3's prod dir, whichever ran) — a
            // wholly different, unrelated path from "Test data path" below.
            $"Base path:             {_resolvedBaseDir ?? "(not resolved)"}",
            $"Show call details:     {o?.ShowCallDetails ?? true}",
            $"Show response details: {o?.ShowResponseDetails ?? true}",
            $"Show timing:           {o?.ShowTiming ?? true}",
            string.Empty,
            // A SEPARATE, unrelated base path: config.json's testData.basePath,
            // used only by the "Run all automated tests"/"Specify test file
            // suite" menu items below, which predate and are independent of
            // market/locale resolution. Explicitly labeled (rather than left
            // implicit right before the relative file paths that follow) so it
            // doesn't read as if those files live under "Base path" above —
            // they don't; e.g. under V3 "Base path" points at
            // data/flatfiles_prod/... while this points at
            // data/flatfiles_dev/... regardless of which format loaded.
            $"Test data path:        {t?.BasePath ?? "(unset)"}",
            $"Test files:            {t?.Files?.Count ?? 0}",
            string.Empty,
        };
        var files = t?.Files ?? new List<TestFileConfig>();
        for (var i = 0; i < files.Count; i++)
        {
            var f = files[i];
            lines.Add($"{i + 1}. {f.Name} — {f.Description ?? string.Empty}");
            lines.Add($"     {f.Path}");
        }
        return lines;
    }

    private static List<string> SuiteLines(TestDataConfig? suite)
    {
        if (suite is null) return new List<string> { "No test suite selected." };
        var lines = new List<string>
        {
            $"Base path: {suite.BasePath}",
            $"Files: {suite.Files?.Count ?? 0}",
            string.Empty,
        };
        var files = suite.Files ?? new List<TestFileConfig>();
        for (var i = 0; i < files.Count; i++)
            lines.Add($"{i + 1}. {files[i].Name} — {files[i].Path}");
        lines.Add(string.Empty);
        lines.Add("Note: edit config.json and restart to change the suite.");
        return lines;
    }

    private static List<string> VoyageDetail(Voyage voyage, string today, int width)
    {
        // Indent prefixes below eat into the available pane width, so account for
        // them when deriving the wrap width for each nesting level.
        var headingWrapWidth = Math.Max(20, width - 4);  // "    " prefix
        var bodyWrapWidth = Math.Max(20, width - 4);     // "    " prefix
        var pointWrapWidth = Math.Max(20, width - 4);    // "  • " / "    " prefix

        var lines = new List<string>();
        if (!string.IsNullOrEmpty(voyage.DurationText)) lines.Add($"Duration: {voyage.DurationText}");
        lines.Add($"Upcoming departures: {voyage.UpcomingDepartures(today).Count}");
        lines.Add(string.Empty);
        if (voyage.Itinerary.Count > 0)
        {
            lines.Add("Itinerary:");
            foreach (var day in voyage.Itinerary)
            {
                lines.Add(string.Empty);
                var dayLabel = ItineraryDayLabel(day.Day);
                var header = string.IsNullOrEmpty(day.Location) ? dayLabel : $"{dayLabel} — {day.Location}";
                lines.Add($"  {header}");

                if (!string.IsNullOrEmpty(day.Heading))
                    foreach (var l in WrapText(day.Heading, headingWrapWidth)) lines.Add($"    {l}");

                if (!string.IsNullOrEmpty(day.Body))
                {
                    var paragraphs = BodyParagraphs(day.Body);
                    for (var i = 0; i < paragraphs.Count; i++)
                    {
                        if (i > 0) lines.Add(string.Empty);
                        foreach (var l in WrapText(paragraphs[i], bodyWrapWidth)) lines.Add($"    {l}");
                    }
                }
            }
            lines.Add(string.Empty);
        }
        else if (!string.IsNullOrEmpty(voyage.Intro))
        {
            lines.Add("Itinerary:");
            foreach (var l in WrapText(voyage.Intro, pointWrapWidth)) lines.Add($"  {l}");
            lines.Add(string.Empty);
        }
        if (voyage.SellingPoints.Count > 0)
        {
            lines.Add("Selling points:");
            foreach (var p in voyage.SellingPoints)
            {
                var wrapped = WrapText(p, pointWrapWidth);
                if (wrapped.Count == 0) continue;
                lines.Add($"  • {wrapped[0]}");
                foreach (var cont in wrapped.Skip(1)) lines.Add($"    {cont}");
            }
        }
        return lines;
    }

    private static List<string> DepartureDetail(Departure d)
    {
        var lines = new List<string>
        {
            $"Code:  {d.Code}",
            $"Ship:  {(d.Ship is not null ? $"{d.Ship.Name} ({d.Ship.Id})" : d.ShipCode)}",
        };
        if (!string.IsNullOrEmpty(d.EndDate)) lines.Add($"Dates: {d.Date} → {d.EndDate}");
        lines.Add($"Cabin grades: {d.CabinGrades.Count}");
        return lines;
    }

    private static List<string> CabinLines(Departure departure)
    {
        var ship = departure.Ship;
        var cabins = departure.Offerings
            .OrderBy(o => o.Code, StringComparer.Ordinal)
            .ToList();

        var lines = new List<string>
        {
            $"Ship:      {(ship is not null ? $"{ship.Name} ({ship.Id})" : departure.ShipCode)}",
            $"Departure: {departure.Date}{(string.IsNullOrEmpty(departure.EndDate) ? string.Empty : $" → {departure.EndDate}")}   ({departure.Code})",
            string.Empty,
        };

        if (cabins.Count == 0)
        {
            lines.Add("No cabins or pricing available for this departure.");
            return lines;
        }

        lines.Add($"Cabins ({cabins.Count}):");
        lines.Add(string.Empty);

        for (var i = 0; i < cabins.Count; i++)
        {
            var c = cabins[i];
            var num = (i + 1).ToString().PadLeft(2);
            lines.Add($"{num}. {(string.IsNullOrEmpty(c.Name) ? c.Code : $"{c.Code} - {c.Name}")}");

            var descs = c.Description;
            if (descs.Count > 0)
            {
                foreach (var d in descs)
                    foreach (var l in WrapText(d, 72))
                        lines.Add($"      {l}");
            }
            else
            {
                lines.Add("      (no cabin description available)");
            }

            switch (c.AvailabilityState)
            {
                case CabinAvailabilityState.Static:
                    if (c.LastKnownAvailableCabins is not null)
                        lines.Add($"      Available cabins: {c.LastKnownAvailableCabins}");
                    break;
                case CabinAvailabilityState.NotFetched:
                case CabinAvailabilityState.Loading:
                    lines.Add("      Available cabins: Loading…");
                    break;
                case CabinAvailabilityState.Loaded:
                    lines.Add(c.LastKnownAvailableCabins is not null
                        ? $"      Available cabins: {c.LastKnownAvailableCabins}"
                        : "      Available cabins: (unknown)");
                    break;
                case CabinAvailabilityState.Failed:
                    lines.Add("      Available cabins: (unavailable)");
                    break;
            }

            var dbl = new Dictionary<string, double>();
            var sgl = new Dictionary<string, double>();
            foreach (var p in c.Prices)
            {
                if (p.Double is not null) dbl[p.Currency] = p.Double.Value;
                if (p.Single is not null) sgl[p.Currency] = p.Single.Value;
            }
            foreach (var l in FormatPriceLines("Double (pp):", dbl, "      ")) lines.Add(l);
            foreach (var l in FormatPriceLines("Single:     ", sgl, "      ")) lines.Add(l);
            lines.Add(string.Empty);
        }
        return lines;
    }

    /// <summary>
    /// Shows the cabin pager for a departure, wiring up live SwOTA availability
    /// for any offering that hasn't been fetched yet.
    ///
    /// <see cref="Tui.RunPager(string, IReadOnlyList{string}, string?)"/> blocks
    /// on <see cref="Console.ReadKey(bool)"/> for the whole pager loop, with no
    /// timer/poll of any kind — so there's nothing already in this TUI that a
    /// background availability fetch could hook into to force a redraw. Rather
    /// than teach the console to interrupt a blocking read, this uses the
    /// small live-pager overload added alongside it
    /// (<see cref="Tui.RunPager(string, Func{IReadOnlyList{string}}, Func{bool}, string?)"/>):
    /// content is recomputed from <see cref="CabinLines"/> on demand, and a
    /// single "a redraw is waiting" flag — set from
    /// <see cref="CabinOffering.AvailabilityChanged"/>, which per its own
    /// contract fires on whatever thread completed the fetch, i.e. off the
    /// console/input thread — is test-and-cleared each poll tick.
    /// <see cref="CabinOffering.GetAvailableCabinsAsync"/> is fire-and-forget
    /// here deliberately: nothing in this screen needs the awaited result, only
    /// the side effect of the state machine advancing and the event firing.
    /// </summary>
    private static void ShowCabins(Voyage voyage, Departure d)
    {
        var pendingRedraw = 0; // 0/1 flag, flipped with Interlocked from any thread

        void OnAvailabilityChanged(CabinOffering _) => Interlocked.Exchange(ref pendingRedraw, 1);

        var live = d.Offerings.Where(o => o.AvailabilityState != CabinAvailabilityState.Static).ToList();
        foreach (var o in live)
        {
            o.AvailabilityChanged += OnAvailabilityChanged;
            if (o.AvailabilityState is CabinAvailabilityState.NotFetched or CabinAvailabilityState.Failed)
                // Fire-and-forget from this screen's perspective (nothing here
                // awaits it -- AvailabilityState/AvailabilityChanged is how the
                // screen learns about completion), but the Task itself must
                // still be observed: CabinOffering.GetAvailableCabinsAsync's
                // memoized task already funnels failures into the Failed state
                // via ApplyTerminalTransition, so nothing needs to be DONE with
                // the fault here -- this continuation exists purely so the
                // discarded Task doesn't become an UnobservedTaskException on
                // GC in some runtimes.
                //
                // Failed is included here (not just NotFetched) because it is
                // NOT a terminal state for CabinOffering.GetAvailableCabinsAsync
                // -- only Loaded is truly terminal; Failed is retryable. This is
                // the only call site that kicks off a live fetch, so without
                // this branch that retry capability would be unreachable.
                o.GetAvailableCabinsAsync().ContinueWith(
                    static t => { _ = t.Exception; },
                    TaskContinuationOptions.OnlyOnFaulted);
        }

        try
        {
            Tui.RunPager(
                title: $"{voyage.Heading} — {d.Date}",
                linesProvider: () => CabinLines(d),
                hasPendingRedraw: () => Interlocked.Exchange(ref pendingRedraw, 0) == 1,
                footer: "arrows/jk scroll · q back",
                // Once every offering in view has reached a terminal state
                // (Loaded/Failed), nothing can trigger another background
                // redraw -- stop the 80ms poll loop instead of spinning on
                // an idle screen.
                stillLive: () => live.Any(o =>
                    o.AvailabilityState is CabinAvailabilityState.NotFetched or CabinAvailabilityState.Loading));
        }
        finally
        {
            foreach (var o in live) o.AvailabilityChanged -= OnAvailabilityChanged;
        }
    }

    // --- startup load -------------------------------------------------------

    /// <summary>Thrown to unwind out of the interactive setup flow when the user backs out.</summary>
    private sealed class SetupCancelledException : Exception;

    /// <summary>
    /// Set every "what got resolved/loaded" display field to the given values —
    /// used both to commit a freshly successful resolution and, via
    /// <see cref="LoadSdkDataAsync"/>'s snapshot-then-restore pattern, to put
    /// them back exactly as they were before a cancelled/failed attempt.
    /// </summary>
    private static void SetResolvedState(DataSourceFormat? format, Market? market, string? locale, string? currency, string? baseDir)
    {
        _resolvedFormat = format;
        _resolvedMarket = market;
        _resolvedLocale = locale;
        _resolvedCurrency = currency;
        _resolvedBaseDir = baseDir;
    }

    /// <summary>
    /// Load the SDK data. Callable more than once — see the "reload" menu item
    /// in <see cref="Main"/> — so a cancelled setup or a failed load must not
    /// stomp a PRIOR successful load's state: <see cref="_sdk"/> itself already
    /// gets this right on its own (<see cref="ApiSdk.ApiSdk.LoadAsync"/> only
    /// commits its new graph after the loader succeeds, so a throw leaves the
    /// previous graph — if any — fully intact and still <c>IsLoaded</c>); this
    /// method mirrors that for the "what's resolved" display fields by
    /// snapshotting them up front and restoring the snapshot (not blanking them)
    /// on any failure path, rather than clearing to "not resolved" — the only
    /// case where clearing and restoring the snapshot look the same is the very
    /// first call, when the snapshot IS all-null.
    /// </summary>
    private static async Task LoadSdkDataAsync()
    {
        var previousFormat = _resolvedFormat;
        var previousMarket = _resolvedMarket;
        var previousLocale = _resolvedLocale;
        var previousCurrency = _resolvedCurrency;
        var previousBaseDir = _resolvedBaseDir;

        // Format/market/locale are resolved from config/env (DATASOURCE_FORMAT,
        // DATASOURCE_MARKET, DATASOURCE_LOCALE) when validly set there — a valid
        // env/config value for a given step means that step's prompt is skipped
        // (handy for scripted/non-interactive use). Anything unset or invalid
        // falls through to an interactive menu instead of throwing: this is a
        // TUI, so asking is the normal path and env vars are just a shortcut,
        // not a requirement.
        DataSources sources;
        try
        {
            var format = ResolveOrPromptFormat();
            var market = ResolveOrPromptMarket();
            var locale = ResolveOrPromptLocale(format, market);

            _resolvedFormat = format;
            _resolvedMarket = market;

            sources = format switch
            {
                DataSourceFormat.V1 => BuildV1Sources(market, locale),
                DataSourceFormat.V3 => BuildV3Sources(market, locale),
                // SwOTA needs the exact same path/source shape as V3 (prod
                // ports/ships/voyages, no cabin-grade file) -- the live-vs-static
                // cabin-availability behavior is decided inside
                // ApiSdk.LoadAsync/V3DataSetLoader from DataSources.Format, not
                // from which paths get built here. BuildV3Sources is told to
                // stamp Format = SwOTA (rather than its own V3 default) so that
                // downstream switch actually sees SwOTA and takes the live path.
                DataSourceFormat.SwOTA => BuildV3Sources(market, locale, DataSourceFormat.SwOTA),
                _ => throw new InvalidOperationException($"Unsupported data-source format '{format}'."),
            };
        }
        catch (SetupCancelledException)
        {
            // _resolvedFormat/_resolvedMarket may already have been set above
            // (format+market can resolve before locale/BuildXSources fails or
            // the user cancels) — restore the pre-attempt snapshot rather than
            // leaving that half-finished pick in place, so the config screen
            // keeps matching whatever _sdk actually has loaded (nothing, on the
            // first call; the previous successful load, on a cancelled reload).
            SetResolvedState(previousFormat, previousMarket, previousLocale, previousCurrency, previousBaseDir);

            // Without WaitKey, this message would be shown for exactly one frame:
            // Main's menu loop redraws immediately once LoadSdkDataAsync returns,
            // overwriting it before it's readable.
            Tui.Render("API SDK CLI — loading", new[]
            {
                "Setup cancelled — no data loaded.",
                string.Empty,
                "Press any key to continue…",
            });
            Tui.WaitKey();
            return;
        }
        catch (Exception ex)
        {
            SetResolvedState(previousFormat, previousMarket, previousLocale, previousCurrency, previousBaseDir);
            Tui.Render("API SDK CLI — loading", new[]
            {
                $"FAILED: {ex.Message}",
                string.Empty,
                "Press any key to continue…",
            });
            Tui.WaitKey();
            return;
        }

        var log = new List<string>();
        // Synchronous progress sink so loading lines render in order on this
        // thread (unlike Progress<T>, which marshals to the thread pool).
        var progress = new SyncProgress(msg =>
        {
            log.Add(msg);
            Tui.Render("API SDK CLI — loading", log.Skip(Math.Max(0, log.Count - 18)).ToList());
        });

        try
        {
            await _sdk.LoadAsync(sources, progress);
        }
        catch (Exception ex)
        {
            // Paths resolved fine (format/market/locale/baseDir were all valid),
            // but the SDK itself failed to load the files (e.g. malformed
            // JSON). ApiSdk.LoadAsync only commits its new graph after the
            // loader succeeds, so _sdk still has whatever it had before this
            // call — nothing, on the first load (IsLoaded stays false), or the
            // previous successful load's graph, on a failed reload (IsLoaded
            // stays true). Restore the snapshot to match either case, instead
            // of unconditionally claiming nothing is resolved.
            SetResolvedState(previousFormat, previousMarket, previousLocale, previousCurrency, previousBaseDir);
            log.Add($"FAILED: {ex.Message}");
        }

        var s = _sdk.Stats;
        var loaded = new List<string>();
        loaded.AddRange(log.Skip(Math.Max(0, log.Count - 12)));
        loaded.Add(string.Empty);
        loaded.Add($"{s.VoyageCount} voyages · {s.ShipCount} ships · {s.CabinGradeCount} cabin grades · {s.PortCount} ports");
        loaded.Add($"{s.DepartureCount} departures · {s.OfferingCount} cabin offerings");
        loaded.Add(string.Empty);
        loaded.Add("Press any key to continue…");
        Tui.Render("API SDK CLI — loaded", loaded);
        Tui.WaitKey();
    }

    /// <summary>
    /// Resolve <see cref="DataSourceFormat"/> from config/env; if unset/invalid,
    /// prompt the user to pick one via <see cref="Tui.RunList{T}"/> instead of
    /// throwing. Same "don't silently drop an explicit bad value" treatment as
    /// <see cref="ResolveOrPromptLocale"/>: <see cref="DataSourceFormatConfig.Resolve"/>
    /// throws for both "unset" and "invalid" with no way to tell which from the
    /// exception alone, so the raw config key / env var is peeked independently
    /// — if either was non-blank, Resolve() must have rejected it (its only
    /// other throw case is "unset"), and that value is surfaced in the prompt
    /// title rather than the prompt looking identical to nothing being
    /// configured at all. (<see cref="_configuration"/> is the same
    /// config.json + config.local.json-backed <see cref="IConfiguration"/>
    /// built by <see cref="BuildConfiguration"/> and threaded through to
    /// <see cref="SwOTAAvailabilityClient"/> below.) Throws
    /// <see cref="SetupCancelledException"/> if the user backs out of the prompt.
    /// </summary>
    private static DataSourceFormat ResolveOrPromptFormat()
    {
        string? invalidConfigured = null;
        try
        {
            return DataSourceFormatConfig.Resolve(_configuration);
        }
        catch (InvalidOperationException)
        {
            var rawConfig = _configuration[DataSourceFormatConfig.ConfigKey];
            var rawEnv = Environment.GetEnvironmentVariable(DataSourceFormatConfig.EnvVar);
            var raw = !string.IsNullOrWhiteSpace(rawConfig) ? rawConfig : rawEnv;
            if (!string.IsNullOrWhiteSpace(raw)) invalidConfigured = raw.Trim();
        }

        var options = new[] { DataSourceFormat.V1, DataSourceFormat.V3, DataSourceFormat.SwOTA };
        var title = invalidConfigured is not null
            ? $"{DataSourceFormatConfig.EnvVar} '{invalidConfigured}' is not valid — pick one:"
            : "Select format";
        var idx = Tui.RunList(
            title: title,
            items: options,
            renderItem: (f, _) => f switch
            {
                DataSourceFormat.V1 => "V1 (dev)",
                DataSourceFormat.V3 => "V3 (prod)",
                DataSourceFormat.SwOTA => "SwOTA (live)",
                _ => f.ToString(),
            },
            renderDetail: (f, _) => f switch
            {
                DataSourceFormat.V1 => new[]
                {
                    "Dev flat-file format: separate ships/ports/cabin-grades/",
                    "voyages files plus per-currency source-market rate files.",
                },
                DataSourceFormat.V3 => new[]
                {
                    "Prod flat-file format: pricing embedded per voyage, no",
                    "separate cabin-grade reference file.",
                },
                DataSourceFormat.SwOTA => new[]
                {
                    "Loads like V3 (prod ports/ships/voyages/cabin grades),",
                    "but each cabin offering pulls LIVE availability from",
                    "SWOTA on first access instead of a static snapshot —",
                    "see CabinOffering.GetAvailableCabinsAsync. Falls back",
                    "to V1 if the V3 source is unavailable.",
                },
                _ => Array.Empty<string>(),
            },
            footer: "arrows/jk move · enter select · q/esc cancel setup");

        if (idx == -1) throw new SetupCancelledException();
        return options[idx];
    }

    /// <summary>
    /// Resolve <see cref="Market"/> from config/env; if unset/invalid, prompt the
    /// user via <see cref="Tui.RunList{T}"/>. Same market list for both formats.
    /// Same explicit-bad-value surfacing as <see cref="ResolveOrPromptFormat"/>
    /// (see its remarks for why the raw env var is peeked directly).
    /// </summary>
    private static Market ResolveOrPromptMarket()
    {
        string? invalidConfigured = null;
        try
        {
            return MarketConfig.ResolveMarket();
        }
        catch (InvalidOperationException)
        {
            var rawEnv = Environment.GetEnvironmentVariable(MarketConfig.MarketEnvVar);
            if (!string.IsNullOrWhiteSpace(rawEnv)) invalidConfigured = rawEnv.Trim();
        }

        var options = Enum.GetValues<Market>();
        var title = invalidConfigured is not null
            ? $"{MarketConfig.MarketEnvVar} '{invalidConfigured}' is not valid — pick one:"
            : "Select market";
        var idx = Tui.RunList(
            title: title,
            items: options,
            renderItem: (m, _) => m.ToString(),
            footer: "arrows/jk move · enter select · q/esc cancel setup");

        if (idx == -1) throw new SetupCancelledException();
        return options[idx];
    }

    /// <summary>
    /// Resolve the locale for <paramref name="market"/> under <paramref name="format"/>'s
    /// locale set — <see cref="MarketConfig.GetLocales"/> returns V1's lowercase
    /// set or V3's uppercase set as appropriate; this file has no access to
    /// (and no need for) MarketConfig's underlying lookup tables, which are
    /// private. Casing normalization (V1 lowercase, V3 uppercase) is NOT
    /// re-derived here — <see cref="MarketConfig.TryNormalizeLocale"/> is the
    /// one place that decides it, this method just calls it. A config/env value
    /// is only honored if it's actually valid for THIS market+format; otherwise
    /// it's treated the same as unset — EXCEPT it is not silently swapped for
    /// the default: an explicit-but-invalid value (e.g.
    /// <c>DATASOURCE_MARKET=UK DATASOURCE_LOCALE=fr</c>, where UK's only real
    /// locale is "uk"/"GB") is surfaced in the prompt title instead of being
    /// dropped, even when the market only has one locale to offer — that's the
    /// difference between "nothing was configured" and "something wrong was
    /// configured", and the two should not look the same to the user.
    /// <see cref="MarketConfig.ResolveMarketDataSources"/> itself throws on
    /// this input; the TUI must not be more lenient than the SDK it calls. If
    /// the market has exactly one locale AND nothing invalid was configured,
    /// it's used without asking — mirrors the resolver's own "don't ask when
    /// there's only one answer" default.
    /// </summary>
    private static string ResolveOrPromptLocale(DataSourceFormat format, Market market)
    {
        var locales = MarketConfig.GetLocales(market, format); // fresh, alphabetically sorted snapshot

        string? invalidConfigured = null;
        var configured = MarketConfig.ResolveLocale();
        if (!string.IsNullOrWhiteSpace(configured))
        {
            if (MarketConfig.TryNormalizeLocale(market, configured, format, out var normalized))
                return normalized!;

            // Configured but not valid for this market+format — do NOT silently
            // fall back to the default/only locale; carry it through so the
            // prompt below can surface exactly what was wrong.
            invalidConfigured = configured.Trim();
        }

        if (locales.Count == 1 && invalidConfigured is null) return locales[0];

        var title = invalidConfigured is not null
            ? $"{MarketConfig.LocaleEnvVar} '{invalidConfigured}' is not valid for {market} — pick one:"
            : $"Select locale ({market})";

        var idx = Tui.RunList(
            title: title,
            items: locales,
            renderItem: (l, _) => l,
            footer: "arrows/jk move · enter select · q/esc cancel setup");

        if (idx == -1) throw new SetupCancelledException();
        return locales[idx];
    }

    /// <summary>
    /// Prompt for a replacement data directory when the resolved voyages/ships
    /// files aren't found on disk — the one recoverable case in setup; every
    /// other format/market/locale mismatch is just a menu re-selection, not a
    /// free-text retry loop. Throws <see cref="SetupCancelledException"/> if the
    /// user cancels (Escape) instead of supplying a path.
    /// </summary>
    private static string PromptForReplacementDirectory(string currentDir, IReadOnlyList<string> missingFileNames)
    {
        var detail = new List<string> { "Could not find:" };
        foreach (var f in missingFileNames) detail.Add($"  {f}");
        detail.Add(string.Empty);
        detail.Add($"under: {currentDir}");
        detail.Add(string.Empty);
        detail.Add("Enter a replacement directory containing these files:");

        var input = Tui.PromptText(
            "Data directory not found",
            detail: detail,
            initialValue: currentDir,
            footer: "enter confirm · esc cancel setup");

        if (input is null) throw new SetupCancelledException();

        var trimmed = input.Trim();
        if (trimmed.Length == 0) return currentDir;

        try
        {
            return Path.GetFullPath(trimmed);
        }
        catch (Exception ex) when (ex is ArgumentException or NotSupportedException or PathTooLongException)
        {
            // Malformed input (invalid characters, embedded NUL, etc.) — keep
            // the previous directory. The caller's File.Exists check will still
            // fail and re-prompt, so this self-corrects instead of crashing on
            // a bad path (Path.GetFullPath's documented exception set for a
            // malformed argument, minus SecurityException which is obsolete/
            // never thrown on .NET Core).
            return currentDir;
        }
    }

    /// <summary>
    /// V1 ("dev") sources: ref-data files live under
    /// <c>{config.json basePath}/RefData</c> (currently
    /// <c>data/flatfiles_dev/RefData</c>), locale-suffixed
    /// lowercase, plus a per-currency source-market rate file. If ANY of the
    /// files this format actually needs — voyages, ships, cabin grades, ports,
    /// the source-market rate file — aren't found there, the user is prompted
    /// for a replacement directory and resolution is retried against it.
    /// (Checking only voyages+ships and leaving the rest to fail unrecoverably
    /// once <see cref="ApiSdk.ApiSdk.LoadAsync"/> got to them was the original,
    /// narrower version of this check.)
    /// </summary>
    private static DataSources BuildV1Sources(Market market, string? locale)
    {
        var basePath = _config.TestData?.BasePath ?? string.Empty;
        var refDataDir = Path.GetFullPath(Path.Combine(_projectRoot, basePath, "RefData"));

        MarketDataSources marketSources;
        string cabinGrades;
        string ports;
        while (true)
        {
            marketSources = MarketConfig.ResolveMarketDataSources(market, locale, refDataDir);
            cabinGrades = Path.Combine(refDataDir, "cabingrades.json");
            ports = Path.Combine(refDataDir, "portlist.json");

            var required = new List<string> { marketSources.Voyages, marketSources.Ships, cabinGrades, ports };
            required.AddRange(marketSources.SourceMarkets);

            var missing = required.Where(f => !File.Exists(f)).ToList();
            if (missing.Count == 0) break;

            refDataDir = PromptForReplacementDirectory(refDataDir, missing.Select(f => Path.GetFileName(f) ?? f).ToList());
        }

        _resolvedLocale = marketSources.Locale;
        _resolvedCurrency = marketSources.Currency;
        _resolvedBaseDir = refDataDir;

        return new DataSources
        {
            Format = DataSourceFormat.V1,
            Voyages = marketSources.Voyages,
            Ships = marketSources.Ships,
            CabinGrades = cabinGrades,
            Ports = ports,
            SourceMarkets = marketSources.SourceMarkets,
        };
    }

    /// <summary>
    /// V3 ("prod") sources: unlike V1/dev, there is no config-driven basePath for
    /// this today, so the prod tree is hardcoded relative to the repo/project
    /// root the same way <c>ApiSdk.UsageCase</c> hardcodes the dev path — it's
    /// the only tree of its shape in the repo. Files sit flat under
    /// <c>data/flatfiles_prod</c> (no <c>RefData</c> subfolder,
    /// unlike V1), locale-suffixed UPPERCASE. There is no source-market rate
    /// file and no cabin-grade reference file in V3 — pricing is embedded per
    /// voyage and <see cref="ApiSdk.Loading.V3DataSetLoader"/> never reads
    /// <see cref="DataSources.CabinGrades"/>, so that field is set to a path
    /// that is never opened, and it's deliberately excluded from the
    /// existence check below along with <see cref="DataSources.SourceMarkets"/>
    /// (also unread). If voyages, ships, or ports aren't found, the user is
    /// prompted for a replacement directory, same as V1.
    /// </summary>
    /// <param name="format">
    /// The <see cref="DataSources.Format"/> to stamp on the result -- defaults
    /// to <see cref="DataSourceFormat.V3"/>, but <see cref="LoadSdkDataAsync"/>
    /// passes <see cref="DataSourceFormat.SwOTA"/> here for that format: SwOTA
    /// reads the exact same V3-shaped prod tree (nothing above this parameter
    /// changes), it just needs the returned <see cref="DataSources"/> to say
    /// SwOTA so <see cref="ApiSdk.ApiSdk.LoadAsync"/> takes the live-availability
    /// branch instead of the plain V3 one.
    /// </param>
    private static DataSources BuildV3Sources(Market market, string? locale, DataSourceFormat format = DataSourceFormat.V3)
    {
        var prodDir = Path.GetFullPath(Path.Combine(_projectRoot, "data", "flatfiles_prod"));

        MarketDataSourcesV3 marketSources;
        string ports;
        while (true)
        {
            marketSources = MarketConfig.ResolveMarketDataSourcesV3(market, locale, prodDir);
            ports = Path.Combine(prodDir, "ports.json");

            var required = new[] { marketSources.Voyages, marketSources.Ships, ports };
            var missing = required.Where(f => !File.Exists(f)).ToList();
            if (missing.Count == 0) break;

            prodDir = PromptForReplacementDirectory(prodDir, missing.Select(f => Path.GetFileName(f) ?? f).ToList());
        }

        _resolvedLocale = marketSources.Locale;
        _resolvedCurrency = null;
        _resolvedBaseDir = prodDir;

        return new DataSources
        {
            Format = format,
            Voyages = marketSources.Voyages,
            Ships = marketSources.Ships,
            CabinGrades = Path.Combine(prodDir, "unused.json"), // never read by V3DataSetLoader
            Ports = ports,
            SourceMarkets = Array.Empty<string>(),               // never read by V3DataSetLoader
        };
    }

    // --- browse flow --------------------------------------------------------

    private static void Browse()
    {
        if (!_sdk.IsLoaded || _sdk.Voyages.Count == 0)
        {
            Tui.RunPager("Browse", new[] { "No SDK data loaded." });
            return;
        }

        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        while (true)
        {
            var vi = Tui.RunList(
                title: $"Voyages ({_sdk.Stats.VoyageCount})",
                items: _sdk.Voyages,
                renderItem: (v, _) => string.IsNullOrEmpty(v.Heading) ? "(no heading)" : v.Heading,
                renderDetail: (v, width) => VoyageDetail(v, today, width),
                footer: "arrows/jk move · pgup/pgdn scroll detail · enter departures · q back");
            if (vi == -1) return;
            SelectDeparture(_sdk.Voyages[vi], today);
        }
    }

    private static void SelectDeparture(Voyage voyage, string today)
    {
        var departures = voyage.UpcomingDepartures(today);
        while (true)
        {
            if (departures.Count == 0)
            {
                Tui.RunPager(voyage.Heading, new[] { "No upcoming departures." });
                return;
            }

            var di = Tui.RunList(
                title: voyage.Heading,
                items: departures,
                renderItem: (d, _) => $"{d.Date}{(string.IsNullOrEmpty(d.EndDate) ? string.Empty : $" → {d.EndDate}")}",
                renderDetail: (d, _) => DepartureDetail(d),
                footer: "arrows/jk move · enter cabins · q back");
            if (di == -1) return;

            var d = departures[di];
            ShowCabins(voyage, d);
        }
    }

    // --- automated tests (.NET flat-file ingestion) -------------------------

    /// <summary>
    /// Runs the configured flat files through the SDK file reader, capturing
    /// per-file pass/fail and timing into pager lines (the .NET analogue of the
    /// JS "run usageCase.js" capture).
    /// </summary>
    private static async Task<List<string>> RunAllTestsAsync()
    {
        var suite = _selectedTestSuite ?? _config.TestData;
        var lines = new List<string>();

        if (suite?.Files is null || suite.Files.Count == 0)
        {
            lines.Add("No test files configured.");
            return lines;
        }

        lines.Add($"Suite base path: {suite.BasePath}");
        lines.Add($"Total files: {suite.Files.Count}");
        lines.Add(string.Empty);

        var total = Stopwatch.StartNew();
        var passed = 0;
        var failed = 0;

        foreach (var fileConfig in suite.Files)
        {
            var ok = await RunTestFileAsync(fileConfig, lines, suite);
            if (ok) passed++; else failed++;
        }

        total.Stop();

        lines.Add("========================================");
        lines.Add("Test Run Summary");
        lines.Add("========================================");
        lines.Add($"Total tests: {suite.Files.Count}");
        lines.Add($"Passed: {passed}");
        lines.Add($"Failed: {failed}");
        lines.Add($"Total duration: {total.ElapsedMilliseconds} ms");
        return lines;
    }

    private static async Task<bool> RunTestFileAsync(TestFileConfig fileConfig, List<string> lines, TestDataConfig suite)
    {
        var fullPath = Path.GetFullPath(
            Path.Combine(_projectRoot, suite.BasePath ?? string.Empty, fileConfig.Path ?? string.Empty));

        lines.Add("========================================");
        lines.Add($"Running test: {fileConfig.Name}");
        lines.Add("========================================");
        lines.Add($"File path:   {fullPath}");
        lines.Add($"Description: {fileConfig.Description ?? "No description"}");
        lines.Add(string.Empty);

        if (!File.Exists(fullPath))
        {
            lines.Add($"ERROR: File not found: {fullPath}");
            lines.Add("TEST FAILED");
            lines.Add(string.Empty);
            return false;
        }

        var showCall = _config.Output?.ShowCallDetails ?? true;
        var showResponse = _config.Output?.ShowResponseDetails ?? true;
        var showTiming = _config.Output?.ShowTiming ?? true;

        var sw = Stopwatch.StartNew();
        try
        {
            if (showCall)
            {
                lines.Add("CALL:");
                lines.Add("  Method:    ReadFileAsync");
                lines.Add($"  File path: {fullPath}");
                lines.Add($"  Timestamp: {DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}");
                lines.Add(string.Empty);
            }

            var content = await _sdk.ReadFileAsync(fullPath);
            sw.Stop();

            if (showResponse)
            {
                lines.Add("RESPONSE:");
                lines.Add("  Status:         Success");
                lines.Add($"  Content length: {content.Length} characters");
                if (showTiming) lines.Add($"  Duration:       {sw.ElapsedMilliseconds} ms");
                var preview = content.Length > 200 ? content[..200] + "..." : content;
                preview = preview.Replace("\r", " ").Replace("\n", " ");
                lines.Add($"  Content preview: {preview}");
                lines.Add(string.Empty);
            }

            try
            {
                var jsonArray = await _sdk.ReadFileAsync<List<Dictionary<string, object>>>(fullPath);
                lines.Add("PARSED DATA:");
                lines.Add("  Type:       JSON Array");
                lines.Add($"  Item count: {jsonArray.Count}");
                lines.Add(string.Empty);
            }
            catch
            {
                // Not an array — that's fine.
            }

            lines.Add("TEST PASSED");
            lines.Add(string.Empty);
            return true;
        }
        catch (Exception ex)
        {
            sw.Stop();
            lines.Add("RESPONSE:");
            lines.Add("  Status:        Error");
            lines.Add($"  Error type:    {ex.GetType().Name}");
            lines.Add($"  Error message: {ex.Message}");
            if (showTiming) lines.Add($"  Duration:      {sw.ElapsedMilliseconds} ms");
            lines.Add(string.Empty);
            lines.Add("TEST FAILED");
            lines.Add(string.Empty);
            return false;
        }
    }

    // --- main menu ----------------------------------------------------------

    /// <summary>An <see cref="IProgress{T}"/> that reports synchronously on the caller's thread.</summary>
    private sealed class SyncProgress : IProgress<string>
    {
        private readonly Action<string> _onReport;
        public SyncProgress(Action<string> onReport) => _onReport = onReport;
        public void Report(string value) => _onReport(value);
    }

    private sealed record MenuItem(string Key, string Label, string Desc);

    private static readonly MenuItem[] Menu =
    {
        // Every setup prompt's footer says "q/esc cancel setup", and a load can
        // fail outright (bad JSON, etc.) — without this entry, either of those
        // dropped you into this menu with literally no way back into setup
        // short of quitting the whole process and relaunching (with different
        // env vars, if that's what needed to change). LoadSdkDataAsync is
        // written to be safely re-callable: a cancelled/failed reload restores
        // the previous successful load's state instead of clobbering it, so
        // this is always safe to try, including as a "did the file on disk
        // change?" refresh after a successful load.
        new("reload", "0 · Reload data", "Re-run format/market/locale setup and reload the SDK graph."),
        new("config", "1 · Show configuration", "Display basePath, output flags and the configured test files."),
        new("tests", "2 · Run all automated tests", "Read each configured flat file through the SDK and report pass/fail."),
        new("suite", "3 · Specify test file suite location / name", "Show the active test suite from config.json."),
        new("browse", "4 · Browse data", "Explore voyages, departures and cabins from the loaded SDK graph."),
        new("exit", "5 · Exit", "Leave the CLI."),
    };

    private static async Task<int> Main()
    {
        try
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
        }
        catch
        {
            // Some hosts (redirected/Docker) reject setting the encoding; ignore.
        }

        try
        {
            _projectRoot = GetProjectRoot();
            _config = LoadConfig();
            _configuration = BuildConfiguration();
            // Constructing the client here does not require SWOTA credentials
            // to be configured: SwOTAAvailabilityClient(HttpClient, IConfiguration)
            // only binds/validates the "SwOTA" section lazily, the first time
            // GetAvailableCabinsAsync is actually called (i.e. only once a
            // DataSourceFormat.SwOTA load reaches a live lookup) -- V1/V3 runs
            // never touch it. HttpClient is intentionally long-lived for the
            // process, not disposed here (short-lived CLI process).
            var swOTAAvailabilityClient = new SwOTAAvailabilityClient(new HttpClient(), _configuration);
            _sdk = new global::ApiSdk.ApiSdk(swOTAAvailabilityClient: swOTAAvailabilityClient);
            _selectedTestSuite = _config.TestData;

            Tui.EnterFullscreen();
            try
            {
                await LoadSdkDataAsync();

                var running = true;
                while (running)
                {
                    var idx = Tui.RunList(
                        title: "API SDK CLI",
                        items: Menu,
                        renderItem: (m, _) => m.Label,
                        renderDetail: (m, _) => WrapText(m.Desc, 40),
                        footer: "arrows/jk move · enter select · q quit");

                    var item = idx == -1 ? Menu[^1] : Menu[idx];

                    switch (item.Key)
                    {
                        case "reload":
                            await LoadSdkDataAsync();
                            break;
                        case "config":
                            Tui.RunPager("Configuration", ConfigLines());
                            break;
                        case "tests":
                            Tui.Render("Automated Tests", new[] { "Running flat-file suite through the SDK…" });
                            var testLines = await RunAllTestsAsync();
                            Tui.RunPager("Automated Tests — .NET SDK", testLines, "arrows/jk scroll · q back");
                            break;
                        case "suite":
                            Tui.RunPager("Test Suite", SuiteLines(_selectedTestSuite));
                            break;
                        case "browse":
                            Browse();
                            break;
                        case "exit":
                            running = false;
                            break;
                    }
                }
            }
            finally
            {
                Tui.ExitFullscreen();
                // _sdk itself never ends up owning a live client in this CLI:
                // the SwOTAAvailabilityClient constructed above is always
                // handed in explicitly, so ApiSdk.Dispose() is a no-op here.
                // Still called for correctness/hygiene (and in case that ever
                // changes) even though a short-lived CLI process exiting
                // would clean up the underlying HttpClient/socket handles
                // either way. The CLI-owned client and its HttpClient are
                // intentionally left undisposed (see the comment where it's
                // constructed above) -- long-lived for the whole process,
                // torn down by process exit.
                _sdk?.Dispose();
            }

            return 0;
        }
        catch (Exception ex)
        {
            // Ensure the terminal is restored even if we failed mid-fullscreen,
            // then report the fatal error on the main screen (mirrors JS main().catch).
            Tui.ExitFullscreen();
            Console.Error.WriteLine($"FATAL ERROR: {ex.Message}");
            Console.Error.WriteLine(ex.StackTrace);
            return 1;
        }
    }
}
