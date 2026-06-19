using ApiSdk;
using ApiSdk.Data;
using ApiSdk.SDKCLI.Models;
using System.Diagnostics;
using System.Globalization;
using System.Text.Json;

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
    private static global::ApiSdk.ApiSdk _sdk = null!;
    private static TestDataConfig? _selectedTestSuite;

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

    // --- text helpers -------------------------------------------------------

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
            $"Base path:             {t?.BasePath}",
            $"Show call details:     {o?.ShowCallDetails ?? true}",
            $"Show response details: {o?.ShowResponseDetails ?? true}",
            $"Show timing:           {o?.ShowTiming ?? true}",
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

    private static List<string> VoyageDetail(Voyage voyage, string today)
    {
        var lines = new List<string>();
        if (!string.IsNullOrEmpty(voyage.DurationText)) lines.Add($"Duration: {voyage.DurationText}");
        lines.Add($"Upcoming departures: {voyage.UpcomingDepartures(today).Count}");
        lines.Add(string.Empty);
        if (!string.IsNullOrEmpty(voyage.Intro))
        {
            lines.Add("Intro:");
            foreach (var l in WrapText(voyage.Intro, 40)) lines.Add($"  {l}");
            lines.Add(string.Empty);
        }
        if (voyage.SellingPoints.Count > 0)
        {
            lines.Add("Selling points:");
            foreach (var p in voyage.SellingPoints)
            {
                var wrapped = WrapText(p, 38);
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

            if (c.AvailableCabins is not null)
                lines.Add($"      Available cabins: {c.AvailableCabins}");

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

    // --- startup load -------------------------------------------------------

    private static async Task LoadSdkDataAsync()
    {
        var basePath = _config.TestData?.BasePath ?? string.Empty;
        var refDataDir = Path.GetFullPath(Path.Combine(_projectRoot, basePath, "RefData"));

        var sourceMarkets = new List<string>();
        try
        {
            sourceMarkets = Directory
                .EnumerateFiles(refDataDir)
                .Select(p => Path.GetFileName(p) ?? string.Empty)
                .Where(f => f.StartsWith("SourceMarket_", StringComparison.Ordinal) &&
                            f.EndsWith("_seaware.json", StringComparison.Ordinal))
                .OrderBy(f => f, StringComparer.Ordinal)
                .Select(f => Path.Combine(refDataDir, f))
                .ToList();
        }
        catch
        {
            // discovery failure handled below via empty stats
        }

        var sources = new DataSources
        {
            Voyages = Path.Combine(refDataDir, "voyages.json"),
            Ships = Path.Combine(refDataDir, "ships.json"),
            CabinGrades = Path.Combine(refDataDir, "cabingrades.json"),
            Ports = Path.Combine(refDataDir, "portlist.json"),
            SourceMarkets = sourceMarkets,
        };

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
                renderDetail: v => VoyageDetail(v, today),
                footer: "arrows/jk move · enter departures · q back");
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
                renderDetail: DepartureDetail,
                footer: "arrows/jk move · enter cabins · q back");
            if (di == -1) return;

            var d = departures[di];
            Tui.RunPager(
                title: $"{voyage.Heading} — {d.Date}",
                lines: CabinLines(d),
                footer: "arrows/jk scroll · q back");
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
        new("config", "0 · Show configuration", "Display basePath, output flags and the configured test files."),
        new("tests", "1 · Run all automated tests", "Read each configured flat file through the SDK and report pass/fail."),
        new("suite", "2 · Specify test file suite location / name", "Show the active test suite from config.json."),
        new("browse", "3 · Browse data", "Explore voyages, departures and cabins from the loaded SDK graph."),
        new("exit", "4 · Exit", "Leave the CLI."),
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
            _sdk = new global::ApiSdk.ApiSdk();
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
                        renderDetail: m => WrapText(m.Desc, 40),
                        footer: "arrows/jk move · enter select · q quit");

                    var item = idx == -1 ? Menu[^1] : Menu[idx];

                    switch (item.Key)
                    {
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
