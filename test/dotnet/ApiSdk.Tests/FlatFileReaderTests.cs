using ApiSdk;
using ApiSdk.Exceptions;
using System.Text.Json;

namespace ApiSdk.Tests;

public class FlatFileReaderTests : IDisposable
{
    private readonly string _testDirectory;
    private readonly FlatFileReader _reader;

    public FlatFileReaderTests()
    {
        _testDirectory = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString());
        Directory.CreateDirectory(_testDirectory);
        _reader = new FlatFileReader();
    }

    public void Dispose()
    {
        if (Directory.Exists(_testDirectory))
        {
            Directory.Delete(_testDirectory, true);
        }
    }

    [Fact]
    public async Task ReadFileAsync_ValidFile_ReturnsContent()
    {
        // Arrange
        var filePath = Path.Combine(_testDirectory, "test.json");
        var expectedContent = "{\"test\": \"value\"}";
        await File.WriteAllTextAsync(filePath, expectedContent);

        // Act
        var result = await _reader.ReadFileAsync(filePath);

        // Assert
        Assert.Equal(expectedContent, result);
    }

    [Fact]
    public async Task ReadFileAsync_InvalidPath_ThrowsInvalidFilePathException()
    {
        // Arrange
        var invalidPath = "\0invalid\0path";

        // Act & Assert
        await Assert.ThrowsAsync<InvalidFilePathException>(() => _reader.ReadFileAsync(invalidPath));
    }

    [Fact]
    public async Task ReadFileAsync_NullPath_ThrowsInvalidFilePathException()
    {
        // Act & Assert
        await Assert.ThrowsAsync<InvalidFilePathException>(() => _reader.ReadFileAsync(null!));
    }

    [Fact]
    public async Task ReadFileAsync_EmptyPath_ThrowsInvalidFilePathException()
    {
        // Act & Assert
        await Assert.ThrowsAsync<InvalidFilePathException>(() => _reader.ReadFileAsync(string.Empty));
    }

    [Fact]
    public async Task ReadFileAsync_FileNotFound_ThrowsFileNotFoundException()
    {
        // Arrange
        var filePath = Path.Combine(_testDirectory, "nonexistent.json");

        // Act & Assert
        var exception = await Assert.ThrowsAsync<FileNotFoundException>(() => _reader.ReadFileAsync(filePath));
        Assert.Contains("nonexistent.json", exception.Message);
    }

    [Fact]
    public async Task ReadFileAsync_ValidJson_DeserializesCorrectly()
    {
        // Arrange
        var filePath = Path.Combine(_testDirectory, "test.json");
        var jsonContent = "{\"name\": \"Test\", \"value\": 123}";
        await File.WriteAllTextAsync(filePath, jsonContent);

        // Act
        var result = await _reader.ReadFileAsync<TestModel>(filePath);

        // Assert
        Assert.NotNull(result);
        Assert.Equal("Test", result.Name);
        Assert.Equal(123, result.Value);
    }

    [Fact]
    public async Task ReadFileAsync_InvalidJson_ThrowsJsonDeserializationException()
    {
        // Arrange
        var filePath = Path.Combine(_testDirectory, "invalid.json");
        var invalidJson = "{ invalid json }";
        await File.WriteAllTextAsync(filePath, invalidJson);

        // Act & Assert
        var exception = await Assert.ThrowsAsync<JsonDeserializationException>(() => _reader.ReadFileAsync<TestModel>(filePath));
        Assert.Equal(filePath, exception.FilePath);
    }

    [Fact]
    public async Task ReadFileAsync_EmptyFile_ThrowsJsonDeserializationException()
    {
        // Arrange
        var filePath = Path.Combine(_testDirectory, "empty.json");
        await File.WriteAllTextAsync(filePath, string.Empty);

        // Act & Assert
        var exception = await Assert.ThrowsAsync<JsonDeserializationException>(() => _reader.ReadFileAsync<TestModel>(filePath));
        Assert.Equal(filePath, exception.FilePath);
    }

    [Fact]
    public async Task ReadFileAsync_ArrayJson_DeserializesCorrectly()
    {
        // Arrange
        var filePath = Path.Combine(_testDirectory, "array.json");
        var jsonContent = "[{\"name\": \"Item1\", \"value\": 1}, {\"name\": \"Item2\", \"value\": 2}]";
        await File.WriteAllTextAsync(filePath, jsonContent);

        // Act
        var result = await _reader.ReadFileAsync<List<TestModel>>(filePath);

        // Assert
        Assert.NotNull(result);
        Assert.Equal(2, result.Count);
        Assert.Equal("Item1", result[0].Name);
        Assert.Equal("Item2", result[1].Name);
    }

    [Fact]
    public void ValidatePath_ValidPath_ReturnsTrue()
    {
        // Arrange
        var validPath = Path.Combine(_testDirectory, "test.json");

        // Act
        var result = _reader.ValidatePath(validPath);

        // Assert
        Assert.True(result);
    }

    [Fact]
    public void ValidatePath_InvalidPath_ReturnsFalse()
    {
        // Arrange
        var invalidPath = "\0invalid\0path";

        // Act
        var result = _reader.ValidatePath(invalidPath);

        // Assert
        Assert.False(result);
    }

    [Fact]
    public void ValidatePath_NullPath_ReturnsFalse()
    {
        // Act
        var result = _reader.ValidatePath(null!);

        // Assert
        Assert.False(result);
    }

    [Fact]
    public void ValidatePath_EmptyPath_ReturnsFalse()
    {
        // Act
        var result = _reader.ValidatePath(string.Empty);

        // Assert
        Assert.False(result);
    }

    private class TestModel
    {
        public string Name { get; set; } = string.Empty;
        public int Value { get; set; }
    }
}

