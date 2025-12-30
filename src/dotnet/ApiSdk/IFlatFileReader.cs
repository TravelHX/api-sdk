namespace ApiSdk;

/// <summary>
/// Interface for reading flat file JSON data
/// </summary>
public interface IFlatFileReader
{
    /// <summary>
    /// Reads a JSON file from the specified path and returns the content as a string
    /// </summary>
    /// <param name="filePath">The path to the JSON file</param>
    /// <returns>The file content as a string</returns>
    /// <exception cref="ArgumentException">Thrown when the file path is invalid</exception>
    /// <exception cref="FileNotFoundException">Thrown when the file does not exist</exception>
    /// <exception cref="UnauthorizedAccessException">Thrown when access to the file is denied</exception>
    /// <exception cref="IOException">Thrown when an I/O error occurs</exception>
    Task<string> ReadFileAsync(string filePath);

    /// <summary>
    /// Reads a JSON file from the specified path and deserializes it to the specified type
    /// </summary>
    /// <typeparam name="T">The type to deserialize the JSON to</typeparam>
    /// <param name="filePath">The path to the JSON file</param>
    /// <returns>The deserialized object</returns>
    /// <exception cref="ArgumentException">Thrown when the file path is invalid</exception>
    /// <exception cref="FileNotFoundException">Thrown when the file does not exist</exception>
    /// <exception cref="JsonException">Thrown when JSON deserialization fails</exception>
    Task<T> ReadFileAsync<T>(string filePath);

    /// <summary>
    /// Validates that the provided file path is valid
    /// </summary>
    /// <param name="filePath">The file path to validate</param>
    /// <returns>True if the path is valid, false otherwise</returns>
    bool ValidatePath(string filePath);
}

