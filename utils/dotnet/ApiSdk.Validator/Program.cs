using ApiSdk;
using ApiSdk.Exceptions;

namespace ApiSdk.Validator;

class Program
{
    static string GetProjectRoot()
    {
        // From bin/Debug/net9.0, go up 6 levels to reach repo root
        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        return Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", ".."));
    }

    static void Main(string[] args)
    {
        Console.WriteLine("API SDK Validation Tool");
        Console.WriteLine("=======================");
        Console.WriteLine();

        var results = new List<ValidationResult>();

        // Test 1: SDK Instantiation
        results.Add(ValidateSdkInstantiation());

        // Test 2: SDK Basic Functionality
        results.Add(ValidateSdkBasicFunctionality());

        // Test 3: File Reading - Valid File
        results.Add(ValidateFileReading());

        // Test 4: File Reading - JSON Deserialization
        results.Add(ValidateJsonDeserialization());

        // Test 5: File Reading - Invalid Path
        results.Add(ValidateInvalidPath());

        // Test 6: File Reading - File Not Found
        results.Add(ValidateFileNotFound());

        // Test 7: Path Validation
        results.Add(ValidatePathValidation());

        // Print Results
        Console.WriteLine();
        Console.WriteLine("Validation Results:");
        Console.WriteLine("-------------------");
        
        foreach (var result in results)
        {
            var status = result.Passed ? "PASS" : "FAIL";
            var color = result.Passed ? ConsoleColor.Green : ConsoleColor.Red;
            Console.ForegroundColor = color;
            Console.WriteLine($"[{status}] {result.TestName}");
            Console.ResetColor();
            if (!string.IsNullOrEmpty(result.Message))
            {
                Console.WriteLine($"  {result.Message}");
            }
        }

        Console.WriteLine();
        var passedCount = results.Count(r => r.Passed);
        var totalCount = results.Count;
        Console.WriteLine($"Summary: {passedCount}/{totalCount} tests passed");

        Environment.ExitCode = passedCount == totalCount ? 0 : 1;
    }

    static ValidationResult ValidateSdkInstantiation()
    {
        try
        {
            var sdk = new global::ApiSdk.ApiSdk();
            if (sdk == null)
            {
                return new ValidationResult
                {
                    TestName = "SDK Instantiation",
                    Passed = false,
                    Message = "SDK instance is null"
                };
            }

            return new ValidationResult
            {
                TestName = "SDK Instantiation",
                Passed = true,
                Message = "SDK created successfully"
            };
        }
        catch (Exception ex)
        {
            return new ValidationResult
            {
                TestName = "SDK Instantiation",
                Passed = false,
                Message = $"Exception: {ex.Message}"
            };
        }
    }

    static ValidationResult ValidateSdkBasicFunctionality()
    {
        try
        {
            var sdk = new global::ApiSdk.ApiSdk();
            
            // Basic validation - SDK should be instantiated
            if (sdk == null)
            {
                return new ValidationResult
                {
                    TestName = "SDK Basic Functionality",
                    Passed = false,
                    Message = "SDK instance is null"
                };
            }

            // Validate FileReader is available
            if (sdk.FileReader == null)
            {
                return new ValidationResult
                {
                    TestName = "SDK Basic Functionality",
                    Passed = false,
                    Message = "FileReader is null"
                };
            }

            return new ValidationResult
            {
                TestName = "SDK Basic Functionality",
                Passed = true,
                Message = "SDK basic functionality validated"
            };
        }
        catch (Exception ex)
        {
            return new ValidationResult
            {
                TestName = "SDK Basic Functionality",
                Passed = false,
                Message = $"Exception: {ex.Message}"
            };
        }
    }

    static ValidationResult ValidateFileReading()
    {
        try
        {
            var sdk = new global::ApiSdk.ApiSdk();
            var projectRoot = GetProjectRoot();
            var testFilePath = Path.Combine(projectRoot, "data", "FlatFileSample", "flatfiles_dev", "RefData", "voyages.json");
            testFilePath = Path.GetFullPath(testFilePath);

            if (!File.Exists(testFilePath))
            {
                return new ValidationResult
                {
                    TestName = "File Reading - Valid File",
                    Passed = false,
                    Message = $"Test file not found: {testFilePath}"
                };
            }

            var content = sdk.FileReader.ReadFileAsync(testFilePath).GetAwaiter().GetResult();
            
            if (string.IsNullOrWhiteSpace(content))
            {
                return new ValidationResult
                {
                    TestName = "File Reading - Valid File",
                    Passed = false,
                    Message = "File content is empty"
                };
            }

            return new ValidationResult
            {
                TestName = "File Reading - Valid File",
                Passed = true,
                Message = $"Successfully read {content.Length} characters"
            };
        }
        catch (Exception ex)
        {
            return new ValidationResult
            {
                TestName = "File Reading - Valid File",
                Passed = false,
                Message = $"Exception: {ex.Message}"
            };
        }
    }

    static ValidationResult ValidateJsonDeserialization()
    {
        try
        {
            var sdk = new global::ApiSdk.ApiSdk();
            var projectRoot = GetProjectRoot();
            var testFilePath = Path.Combine(projectRoot, "data", "FlatFileSample", "flatfiles_dev", "RefData", "voyages.json");
            testFilePath = Path.GetFullPath(testFilePath);

            if (!File.Exists(testFilePath))
            {
                return new ValidationResult
                {
                    TestName = "File Reading - JSON Deserialization",
                    Passed = false,
                    Message = $"Test file not found: {testFilePath}"
                };
            }

            // Define a simple model for voyages
            var voyages = sdk.FileReader.ReadFileAsync<List<Dictionary<string, object>>>(testFilePath).GetAwaiter().GetResult();
            
            if (voyages == null || voyages.Count == 0)
            {
                return new ValidationResult
                {
                    TestName = "File Reading - JSON Deserialization",
                    Passed = false,
                    Message = "Deserialized data is null or empty"
                };
            }

            return new ValidationResult
            {
                TestName = "File Reading - JSON Deserialization",
                Passed = true,
                Message = $"Successfully deserialized {voyages.Count} items"
            };
        }
        catch (Exception ex)
        {
            return new ValidationResult
            {
                TestName = "File Reading - JSON Deserialization",
                Passed = false,
                Message = $"Exception: {ex.Message}"
            };
        }
    }

    static ValidationResult ValidateInvalidPath()
    {
        try
        {
            var sdk = new global::ApiSdk.ApiSdk();
            // Use null byte which is definitely invalid
            var invalidPath = "invalid\0path.json";

            try
            {
                var content = sdk.FileReader.ReadFileAsync(invalidPath).GetAwaiter().GetResult();
                return new ValidationResult
                {
                    TestName = "File Reading - Invalid Path",
                    Passed = false,
                    Message = "Expected exception for invalid path, but none was thrown"
                };
            }
            catch (AggregateException aggEx) when (aggEx.InnerException is InvalidFilePathException)
            {
                return new ValidationResult
                {
                    TestName = "File Reading - Invalid Path",
                    Passed = true,
                    Message = "Correctly threw InvalidFilePathException"
                };
            }
            catch (InvalidFilePathException)
            {
                return new ValidationResult
                {
                    TestName = "File Reading - Invalid Path",
                    Passed = true,
                    Message = "Correctly threw InvalidFilePathException"
                };
            }
            catch (Exception ex)
            {
                return new ValidationResult
                {
                    TestName = "File Reading - Invalid Path",
                    Passed = false,
                    Message = $"Unexpected exception: {ex.GetType().Name} - {ex.Message}"
                };
            }
        }
        catch (Exception ex)
        {
            return new ValidationResult
            {
                TestName = "File Reading - Invalid Path",
                Passed = false,
                Message = $"Exception: {ex.Message}"
            };
        }
    }

    static ValidationResult ValidateFileNotFound()
    {
        try
        {
            var sdk = new global::ApiSdk.ApiSdk();
            var nonExistentPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "nonexistent_file.json");

            try
            {
                var content = sdk.FileReader.ReadFileAsync(nonExistentPath).GetAwaiter().GetResult();
                return new ValidationResult
                {
                    TestName = "File Reading - File Not Found",
                    Passed = false,
                    Message = "Expected exception for non-existent file, but none was thrown"
                };
            }
            catch (AggregateException aggEx) when (aggEx.InnerException is FileNotFoundException)
            {
                return new ValidationResult
                {
                    TestName = "File Reading - File Not Found",
                    Passed = true,
                    Message = "Correctly threw FileNotFoundException"
                };
            }
            catch (FileNotFoundException)
            {
                return new ValidationResult
                {
                    TestName = "File Reading - File Not Found",
                    Passed = true,
                    Message = "Correctly threw FileNotFoundException"
                };
            }
            catch (Exception ex)
            {
                return new ValidationResult
                {
                    TestName = "File Reading - File Not Found",
                    Passed = false,
                    Message = $"Unexpected exception: {ex.GetType().Name} - {ex.Message}"
                };
            }
        }
        catch (Exception ex)
        {
            return new ValidationResult
            {
                TestName = "File Reading - File Not Found",
                Passed = false,
                Message = $"Exception: {ex.Message}"
            };
        }
    }

    static ValidationResult ValidatePathValidation()
    {
        try
        {
            var sdk = new global::ApiSdk.ApiSdk();
            var projectRoot = GetProjectRoot();
            var testFilePath = Path.Combine(projectRoot, "data", "FlatFileSample", "flatfiles_dev", "RefData", "voyages.json");
            testFilePath = Path.GetFullPath(testFilePath);

            // Test valid path
            if (!sdk.FileReader.ValidatePath(testFilePath))
            {
                return new ValidationResult
                {
                    TestName = "Path Validation",
                    Passed = false,
                    Message = "Valid path was rejected"
                };
            }

            // Test invalid paths - use null byte which is definitely invalid
            if (sdk.FileReader.ValidatePath("invalid\0path.json"))
            {
                return new ValidationResult
                {
                    TestName = "Path Validation",
                    Passed = false,
                    Message = "Invalid path was accepted"
                };
            }

            if (sdk.FileReader.ValidatePath(null!))
            {
                return new ValidationResult
                {
                    TestName = "Path Validation",
                    Passed = false,
                    Message = "Null path was accepted"
                };
            }

            if (sdk.FileReader.ValidatePath(string.Empty))
            {
                return new ValidationResult
                {
                    TestName = "Path Validation",
                    Passed = false,
                    Message = "Empty path was accepted"
                };
            }

            return new ValidationResult
            {
                TestName = "Path Validation",
                Passed = true,
                Message = "Path validation working correctly"
            };
        }
        catch (Exception ex)
        {
            return new ValidationResult
            {
                TestName = "Path Validation",
                Passed = false,
                Message = $"Exception: {ex.Message}"
            };
        }
    }
}

class ValidationResult
{
    public string TestName { get; set; } = string.Empty;
    public bool Passed { get; set; }
    public string Message { get; set; } = string.Empty;
}
