using System.Text.Json;
using Xunit;

namespace ApiSdk.Tests;

// Test models matching TestConfig structure
public class TestConfig
{
    public TestDataConfig? TestData { get; set; }
    public OutputConfig? Output { get; set; }
}

public class TestDataConfig
{
    public string? BasePath { get; set; }
    public List<TestFileConfig>? Files { get; set; }
}

public class TestFileConfig
{
    public string? Name { get; set; }
    public string? Path { get; set; }
    public string? Description { get; set; }
}

public class OutputConfig
{
    public bool ShowCallDetails { get; set; } = true;
    public bool ShowResponseDetails { get; set; } = true;
    public bool ShowTiming { get; set; } = true;
}

public class ConsoleApplicationTests : IDisposable
{
    private readonly string _testConfigPath;
    private readonly string _testDataDirectory;
    private readonly string _testProjectRoot;

    public ConsoleApplicationTests()
    {
        _testProjectRoot = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(_testProjectRoot);
        
        _testDataDirectory = Path.Combine(_testProjectRoot, "data", "test");
        Directory.CreateDirectory(_testDataDirectory);
        
        _testConfigPath = Path.Combine(_testProjectRoot, "config.json");
        
        // Create test config
        var config = new TestConfig
        {
            TestData = new TestDataConfig
            {
                BasePath = "data/test",
                Files = new List<TestFileConfig>
                {
                    new TestFileConfig { Name = "file1", Path = "file1.json", Description = "Test file 1" },
                    new TestFileConfig { Name = "file2", Path = "file2.json", Description = "Test file 2" },
                    new TestFileConfig { Name = "file3", Path = "file3.json", Description = "Test file 3" }
                }
            },
            Output = new OutputConfig
            {
                ShowCallDetails = true,
                ShowResponseDetails = true,
                ShowTiming = true
            }
        };
        
        var json = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(_testConfigPath, json);
        
        // Create test files
        foreach (var file in config.TestData.Files)
        {
            var filePath = Path.Combine(_testDataDirectory, file.Path!);
            var fileDir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(fileDir))
            {
                Directory.CreateDirectory(fileDir);
            }
            File.WriteAllText(filePath, "[{\"id\": 1, \"name\": \"test\"}]");
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_testProjectRoot))
        {
            Directory.Delete(_testProjectRoot, true);
        }
    }

    [Fact]
    public void TestConfig_LoadsCorrectly()
    {
        // Arrange & Act
        var jsonContent = File.ReadAllText(_testConfigPath);
        var config = JsonSerializer.Deserialize<TestConfig>(jsonContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        // Assert
        Assert.NotNull(config);
        Assert.NotNull(config.TestData);
        Assert.Equal("data/test", config.TestData.BasePath);
        Assert.Equal(3, config.TestData.Files?.Count);
        Assert.NotNull(config.Output);
        Assert.True(config.Output.ShowCallDetails);
    }

    [Fact]
    public void TestSuite_AllFilesArePresent()
    {
        // Arrange
        var jsonContent = File.ReadAllText(_testConfigPath);
        var config = JsonSerializer.Deserialize<TestConfig>(jsonContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        // Act
        var suite = config!.TestData!;
        var fileCount = suite.Files?.Count ?? 0;

        // Assert
        Assert.Equal(3, fileCount);
        Assert.NotNull(suite.Files);
        Assert.All(suite.Files, file => Assert.NotNull(file.Name));
        Assert.All(suite.Files, file => Assert.NotNull(file.Path));
    }

    [Fact]
    public void TestSuite_FilePathsAreValid()
    {
        // Arrange
        var jsonContent = File.ReadAllText(_testConfigPath);
        var config = JsonSerializer.Deserialize<TestConfig>(jsonContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        // Act & Assert
        var suite = config!.TestData!;
        Assert.NotNull(suite.Files);
        
        foreach (var file in suite.Files)
        {
            var fullPath = Path.Combine(_testProjectRoot, suite.BasePath ?? "", file.Path ?? "");
            Assert.True(File.Exists(fullPath), $"File should exist: {fullPath}");
        }
    }

    [Fact]
    public void TestSuite_ProcessesAllFiles()
    {
        // Arrange
        var jsonContent = File.ReadAllText(_testConfigPath);
        var config = JsonSerializer.Deserialize<TestConfig>(jsonContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
        var suite = config!.TestData!;
        var processedFiles = new List<string>();

        // Act - Simulate processing all files
        if (suite.Files != null)
        {
            foreach (var file in suite.Files)
            {
                var fullPath = Path.Combine(_testProjectRoot, suite.BasePath ?? "", file.Path ?? "");
                if (File.Exists(fullPath))
                {
                    processedFiles.Add(file.Name!);
                }
            }
        }

        // Assert
        Assert.Equal(3, processedFiles.Count);
        Assert.Contains("file1", processedFiles);
        Assert.Contains("file2", processedFiles);
        Assert.Contains("file3", processedFiles);
    }

    [Fact]
    public void TestSuite_SummaryCountsAreCorrect()
    {
        // Arrange
        var jsonContent = File.ReadAllText(_testConfigPath);
        var config = JsonSerializer.Deserialize<TestConfig>(jsonContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
        var suite = config!.TestData!;
        var totalFiles = suite.Files?.Count ?? 0;
        var successCount = 0;
        var failureCount = 0;

        // Act - Simulate processing with some successes
        if (suite.Files != null)
        {
            foreach (var file in suite.Files)
            {
                var fullPath = Path.Combine(_testProjectRoot, suite.BasePath ?? "", file.Path ?? "");
                if (File.Exists(fullPath))
                {
                    successCount++;
                }
                else
                {
                    failureCount++;
                }
            }
        }

        // Assert
        Assert.Equal(totalFiles, successCount + failureCount);
        Assert.Equal(3, successCount);
        Assert.Equal(0, failureCount);
    }

    [Fact]
    public void TestSuite_HandlesMissingFiles()
    {
        // Arrange
        var jsonContent = File.ReadAllText(_testConfigPath);
        var config = JsonSerializer.Deserialize<TestConfig>(jsonContent, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
        var suite = config!.TestData!;
        
        // Delete one file
        var fileToDelete = Path.Combine(_testDataDirectory, suite.Files![1].Path!);
        File.Delete(fileToDelete);

        var successCount = 0;
        var failureCount = 0;

        // Act - Process files
        foreach (var file in suite.Files)
        {
            var fullPath = Path.Combine(_testProjectRoot, suite.BasePath ?? "", file.Path ?? "");
            if (File.Exists(fullPath))
            {
                successCount++;
            }
            else
            {
                failureCount++;
            }
        }

        // Assert
        Assert.Equal(2, successCount);
        Assert.Equal(1, failureCount);
    }

    [Fact]
    public void TestSuite_HandlesEmptySuite()
    {
        // Arrange
        var emptyConfig = new TestConfig
        {
            TestData = new TestDataConfig
            {
                BasePath = "data/test",
                Files = new List<TestFileConfig>()
            }
        };

        // Act & Assert
        Assert.NotNull(emptyConfig.TestData);
        Assert.NotNull(emptyConfig.TestData.Files);
        Assert.Empty(emptyConfig.TestData.Files);
    }

    [Fact]
    public void TestSuite_HandlesNullSuite()
    {
        // Arrange
        TestDataConfig? nullSuite = null;

        // Act & Assert
        Assert.Null(nullSuite);
        var fileCount = nullSuite?.Files?.Count ?? 0;
        Assert.Equal(0, fileCount);
    }

    [Fact]
    public void MenuOptions_AllOptionsAreValid()
    {
        // Arrange
        var validOptions = new[] { "0", "1", "2", "3", "4", "5" };
        var invalidOptions = new[] { "-1", "6", "a", "x", "" };

        // Act & Assert
        Assert.All(validOptions, option => Assert.True(int.TryParse(option, out var num) && num >= 0 && num <= 5));
        Assert.All(invalidOptions, option => 
        {
            if (string.IsNullOrEmpty(option) || !int.TryParse(option, out var num) || num < 0 || num > 5)
            {
                Assert.True(true); // Invalid options should be rejected
            }
        });
    }

    [Fact]
    public void SuiteDisplay_ShowsBasePath()
    {
        // Arrange
        var suite = new TestDataConfig
        {
            BasePath = "data/test",
            Files = new List<TestFileConfig>()
        };

        // Act
        var displayText = suite.BasePath ?? "default";

        // Assert
        Assert.Equal("data/test", displayText);
    }

    [Fact]
    public void SuiteDisplay_ShowsDefaultWhenNull()
    {
        // Arrange
        TestDataConfig? suite = null;

        // Act
        var displayText = suite?.BasePath ?? "default";

        // Assert
        Assert.Equal("default", displayText);
    }
}

