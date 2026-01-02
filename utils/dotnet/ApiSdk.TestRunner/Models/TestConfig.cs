using System.Text.Json.Serialization;

namespace ApiSdk.TestRunner.Models;

public class TestConfig
{
    [JsonPropertyName("testData")]
    public TestDataConfig? TestData { get; set; }

    [JsonPropertyName("output")]
    public OutputConfig? Output { get; set; }
}

public class TestDataConfig
{
    [JsonPropertyName("basePath")]
    public string? BasePath { get; set; }

    [JsonPropertyName("files")]
    public List<TestFileConfig>? Files { get; set; }
}

public class TestFileConfig
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    [JsonPropertyName("path")]
    public string? Path { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }
}

public class OutputConfig
{
    [JsonPropertyName("showCallDetails")]
    public bool ShowCallDetails { get; set; } = true;

    [JsonPropertyName("showResponseDetails")]
    public bool ShowResponseDetails { get; set; } = true;

    [JsonPropertyName("showTiming")]
    public bool ShowTiming { get; set; } = true;
}

