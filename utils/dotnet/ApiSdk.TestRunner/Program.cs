using ApiSdk;
using ApiSdk.TestRunner.Models;
using System.Diagnostics;
using System.Text.Json;

namespace ApiSdk.TestRunner;

class Program
{
    private static TestConfig? _config;
    private static string? _projectRoot;
    private static global::ApiSdk.ApiSdk? _sdk;

    static string GetProjectRoot()
    {
        // Check if running in Docker (config.json is in /app)
        var dockerConfigPath = "/app/config.json";
        if (File.Exists(dockerConfigPath))
        {
            return "/app";
        }
        
        // From bin/Debug/net9.0, go up 6 levels to reach repo root
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        return Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", ".."));
    }

    static TestConfig LoadConfig()
    {
        var configPath = Path.Combine(_projectRoot!, "config.json");
        
        if (!File.Exists(configPath))
        {
            throw new FileNotFoundException($"Configuration file not found: {configPath}");
        }

        var jsonContent = File.ReadAllText(configPath);
        var config = JsonSerializer.Deserialize<TestConfig>(jsonContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        if (config == null)
        {
            throw new InvalidOperationException("Failed to deserialize configuration file");
        }

        return config;
    }

    static void PrintHeader()
    {
        Console.Clear();
        Console.WriteLine("========================================");
        Console.WriteLine("API SDK Interactive Test Runner");
        Console.WriteLine("========================================");
        Console.WriteLine();
    }

    static void PrintMenu()
    {
        Console.WriteLine("Available Commands:");
        Console.WriteLine("  1 - Run all tests");
        Console.WriteLine("  2 - Run specific test file");
        Console.WriteLine("  3 - List available test files");
        Console.WriteLine("  4 - Show configuration");
        Console.WriteLine("  5 - Exit");
        Console.WriteLine();
        Console.Write("Enter command (1-5): ");
    }

    static void ListTestFiles()
    {
        Console.WriteLine();
        Console.WriteLine("Available Test Files:");
        Console.WriteLine("---------------------");
        
        if (_config?.TestData?.Files == null || _config.TestData.Files.Count == 0)
        {
            Console.WriteLine("No test files configured.");
            return;
        }

        for (int i = 0; i < _config.TestData.Files.Count; i++)
        {
            var file = _config.TestData.Files[i];
            Console.WriteLine($"  {i + 1}. {file.Name} - {file.Description ?? "No description"}");
            Console.WriteLine($"     Path: {file.Path}");
        }
        Console.WriteLine();
    }

    static void ShowConfiguration()
    {
        Console.WriteLine();
        Console.WriteLine("Current Configuration:");
        Console.WriteLine("---------------------");
        Console.WriteLine($"Base Path: {_config?.TestData?.BasePath}");
        Console.WriteLine($"Show Call Details: {_config?.Output?.ShowCallDetails ?? true}");
        Console.WriteLine($"Show Response Details: {_config?.Output?.ShowResponseDetails ?? true}");
        Console.WriteLine($"Show Timing: {_config?.Output?.ShowTiming ?? true}");
        Console.WriteLine($"Number of Test Files: {_config?.TestData?.Files?.Count ?? 0}");
        Console.WriteLine();
    }

    static async Task RunTestFile(TestFileConfig fileConfig)
    {
        if (_sdk == null || _config?.TestData == null)
        {
            Console.WriteLine("ERROR: SDK or configuration not initialized");
            return;
        }

        var fullPath = Path.Combine(_projectRoot!, _config.TestData.BasePath ?? "", fileConfig.Path ?? "");
        fullPath = Path.GetFullPath(fullPath);

        Console.WriteLine();
        Console.WriteLine($"========================================");
        Console.WriteLine($"Running Test: {fileConfig.Name}");
        Console.WriteLine($"========================================");
        Console.WriteLine($"File Path: {fullPath}");
        Console.WriteLine($"Description: {fileConfig.Description ?? "No description"}");
        Console.WriteLine();

        if (!File.Exists(fullPath))
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine($"ERROR: File not found: {fullPath}");
            Console.ResetColor();
            Console.WriteLine();
            return;
        }

        var stopwatch = Stopwatch.StartNew();

        try
        {
            // Show call details
            if (_config.Output?.ShowCallDetails ?? true)
            {
                Console.ForegroundColor = ConsoleColor.Cyan;
                Console.WriteLine("CALL:");
                Console.ResetColor();
                Console.WriteLine($"  Method: ReadFileAsync");
                Console.WriteLine($"  File Path: {fullPath}");
                Console.WriteLine($"  Timestamp: {DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}");
                Console.WriteLine();
            }

            // Read file as string
            var content = await _sdk.FileReader.ReadFileAsync(fullPath);
            stopwatch.Stop();

            // Show response details
            if (_config.Output?.ShowResponseDetails ?? true)
            {
                Console.ForegroundColor = ConsoleColor.Green;
                Console.WriteLine("RESPONSE:");
                Console.ResetColor();
                Console.WriteLine($"  Status: Success");
                Console.WriteLine($"  Content Length: {content.Length} characters");
                
                if (_config.Output?.ShowTiming ?? true)
                {
                    Console.WriteLine($"  Duration: {stopwatch.ElapsedMilliseconds} ms");
                }
                
                // Show preview of content (first 200 characters)
                var preview = content.Length > 200 ? content.Substring(0, 200) + "..." : content;
                Console.WriteLine($"  Content Preview: {preview}");
                Console.WriteLine();
            }

            // Try to deserialize as JSON array to show item count
            try
            {
                var jsonArray = await _sdk.FileReader.ReadFileAsync<List<Dictionary<string, object>>>(fullPath);
                Console.ForegroundColor = ConsoleColor.Yellow;
                Console.WriteLine("PARSED DATA:");
                Console.ResetColor();
                Console.WriteLine($"  Type: JSON Array");
                Console.WriteLine($"  Item Count: {jsonArray.Count}");
                Console.WriteLine();
            }
            catch
            {
                // Not an array, that's okay
            }

            Console.ForegroundColor = ConsoleColor.Green;
            Console.WriteLine("TEST PASSED");
            Console.ResetColor();
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("RESPONSE:");
            Console.ResetColor();
            Console.WriteLine($"  Status: Error");
            Console.WriteLine($"  Error Type: {ex.GetType().Name}");
            Console.WriteLine($"  Error Message: {ex.Message}");
            
            if (_config.Output?.ShowTiming ?? true)
            {
                Console.WriteLine($"  Duration: {stopwatch.ElapsedMilliseconds} ms");
            }
            Console.WriteLine();

            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("TEST FAILED");
            Console.ResetColor();
        }

        Console.WriteLine();
    }

    static async Task RunAllTests()
    {
        if (_config?.TestData?.Files == null || _config.TestData.Files.Count == 0)
        {
            Console.WriteLine("No test files configured.");
            return;
        }

        Console.WriteLine();
        Console.WriteLine($"Running {_config.TestData.Files.Count} test file(s)...");
        Console.WriteLine();

        var totalStartTime = Stopwatch.StartNew();
        var passed = 0;
        var failed = 0;

        foreach (var fileConfig in _config.TestData.Files)
        {
            try
            {
                await RunTestFile(fileConfig);
                passed++;
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"Failed to run test for {fileConfig.Name}: {ex.Message}");
                Console.ResetColor();
                failed++;
            }
        }

        totalStartTime.Stop();

        Console.WriteLine("========================================");
        Console.WriteLine("Test Run Summary");
        Console.WriteLine("========================================");
        Console.WriteLine($"Total Tests: {_config.TestData.Files.Count}");
        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine($"Passed: {passed}");
        Console.ResetColor();
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine($"Failed: {failed}");
        Console.ResetColor();
        Console.WriteLine($"Total Duration: {totalStartTime.ElapsedMilliseconds} ms");
        Console.WriteLine();
    }

    static async Task RunSpecificTest()
    {
        ListTestFiles();
        Console.Write("Enter test file number: ");

        if (!int.TryParse(Console.ReadLine(), out int fileNumber) || fileNumber < 1)
        {
            Console.WriteLine("Invalid file number.");
            return;
        }

        if (_config?.TestData?.Files == null || fileNumber > _config.TestData.Files.Count)
        {
            Console.WriteLine("Invalid file number.");
            return;
        }

        var fileConfig = _config.TestData.Files[fileNumber - 1];
        await RunTestFile(fileConfig);
    }

    static async Task Main(string[] args)
    {
        try
        {
            _projectRoot = GetProjectRoot();
            _config = LoadConfig();
            _sdk = new global::ApiSdk.ApiSdk();

            bool running = true;

            while (running)
            {
                PrintHeader();
                PrintMenu();

                var input = Console.ReadLine()?.Trim();

                switch (input)
                {
                    case "1":
                        await RunAllTests();
                        Console.WriteLine("Press any key to continue...");
                        Console.ReadKey();
                        break;

                    case "2":
                        await RunSpecificTest();
                        Console.WriteLine("Press any key to continue...");
                        Console.ReadKey();
                        break;

                    case "3":
                        ListTestFiles();
                        Console.WriteLine("Press any key to continue...");
                        Console.ReadKey();
                        break;

                    case "4":
                        ShowConfiguration();
                        Console.WriteLine("Press any key to continue...");
                        Console.ReadKey();
                        break;

                    case "5":
                        running = false;
                        Console.WriteLine("Exiting...");
                        break;

                    default:
                        Console.WriteLine("Invalid command. Please try again.");
                        Thread.Sleep(1000);
                        break;
                }
            }
        }
        catch (Exception ex)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine($"FATAL ERROR: {ex.Message}");
            Console.WriteLine(ex.StackTrace);
            Console.ResetColor();
            Environment.ExitCode = 1;
        }
    }
}
