using System.Text.Json;
using ApiSdk.Exceptions;

namespace ApiSdk;

/// <summary>
/// Implementation of IFlatFileReader for reading JSON files from the file system
/// </summary>
public class FlatFileReader : IFlatFileReader
{
    private readonly JsonSerializerOptions _jsonOptions;

    /// <summary>
    /// Initializes a new instance of the FlatFileReader class
    /// </summary>
    /// <param name="jsonOptions">Optional JSON serializer options. If null, default options will be used.</param>
    public FlatFileReader(JsonSerializerOptions? jsonOptions = null)
    {
        _jsonOptions = jsonOptions ?? new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true
        };
    }

    /// <summary>
    /// Reads a JSON file from the specified path and returns the content as a string
    /// </summary>
    /// <param name="filePath">The path to the JSON file</param>
    /// <returns>The file content as a string</returns>
    /// <exception cref="InvalidFilePathException">Thrown when the file path is invalid</exception>
    /// <exception cref="FileNotFoundException">Thrown when the file does not exist</exception>
    /// <exception cref="UnauthorizedAccessException">Thrown when access to the file is denied</exception>
    /// <exception cref="IOException">Thrown when an I/O error occurs</exception>
    public async Task<string> ReadFileAsync(string filePath)
    {
        // Validate path
        PathValidator.ValidatePathOrThrow(filePath);

        // Check if file exists
        if (!PathValidator.FileExists(filePath))
        {
            throw new FileNotFoundException($"File not found: {filePath}", filePath);
        }

        try
        {
            return await File.ReadAllTextAsync(filePath);
        }
        catch (UnauthorizedAccessException)
        {
            throw;
        }
        catch (DirectoryNotFoundException ex)
        {
            throw new FileNotFoundException($"Directory not found for file: {filePath}", ex);
        }
        catch (IOException ex)
        {
            throw new IOException($"Failed to read file: {filePath}", ex);
        }
    }

    /// <summary>
    /// Reads a JSON file from the specified path and deserializes it to the specified type
    /// </summary>
    /// <typeparam name="T">The type to deserialize the JSON to</typeparam>
    /// <param name="filePath">The path to the JSON file</param>
    /// <returns>The deserialized object</returns>
    /// <exception cref="InvalidFilePathException">Thrown when the file path is invalid</exception>
    /// <exception cref="FileNotFoundException">Thrown when the file does not exist</exception>
    /// <exception cref="JsonDeserializationException">Thrown when JSON deserialization fails</exception>
    public async Task<T> ReadFileAsync<T>(string filePath)
    {
        // Validate path
        PathValidator.ValidatePathOrThrow(filePath);

        // Check if file exists
        if (!PathValidator.FileExists(filePath))
        {
            throw new FileNotFoundException($"File not found: {filePath}", filePath);
        }

        try
        {
            var jsonContent = await File.ReadAllTextAsync(filePath);
            
            if (string.IsNullOrWhiteSpace(jsonContent))
            {
                throw new JsonDeserializationException(filePath, new ArgumentException("File content is empty"));
            }

            var result = JsonSerializer.Deserialize<T>(jsonContent, _jsonOptions);
            
            if (result == null)
            {
                throw new JsonDeserializationException(filePath, new InvalidOperationException("Deserialization returned null"));
            }

            return result;
        }
        catch (JsonException ex)
        {
            throw new JsonDeserializationException(filePath, ex);
        }
        catch (UnauthorizedAccessException)
        {
            throw;
        }
        catch (DirectoryNotFoundException ex)
        {
            throw new FileNotFoundException($"Directory not found for file: {filePath}", ex);
        }
        catch (IOException ex)
        {
            throw new IOException($"Failed to read file: {filePath}", ex);
        }
        catch (Exception ex) when (!(ex is FileReadingException))
        {
            throw new JsonDeserializationException(filePath, ex);
        }
    }

    /// <summary>
    /// Validates that the provided file path is valid
    /// </summary>
    /// <param name="filePath">The file path to validate</param>
    /// <returns>True if the path is valid, false otherwise</returns>
    public bool ValidatePath(string filePath)
    {
        return PathValidator.IsValidPath(filePath);
    }
}

