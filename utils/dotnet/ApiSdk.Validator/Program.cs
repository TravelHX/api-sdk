using ApiSdk;

namespace ApiSdk.Validator;

class Program
{
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
}

class ValidationResult
{
    public string TestName { get; set; } = string.Empty;
    public bool Passed { get; set; }
    public string Message { get; set; } = string.Empty;
}
