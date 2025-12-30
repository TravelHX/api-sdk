using System.Text.RegularExpressions;
using ApiSdk.Exceptions;

namespace ApiSdk;

/// <summary>
/// Utility class for validating file paths
/// </summary>
public static class PathValidator
{
    private static readonly char[] InvalidPathChars = Path.GetInvalidPathChars();
    private static readonly char[] InvalidFileNameChars = Path.GetInvalidFileNameChars();

    /// <summary>
    /// Validates that the provided file path is valid
    /// </summary>
    /// <param name="filePath">The file path to validate</param>
    /// <returns>True if the path is valid, false otherwise</returns>
    public static bool IsValidPath(string? filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return false;
        }

        // Check for invalid path characters
        if (filePath.IndexOfAny(InvalidPathChars) >= 0)
        {
            return false;
        }

        // Check for empty path segments
        var segments = filePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (segments.Any(string.IsNullOrWhiteSpace))
        {
            return false;
        }

        // Check if path is too long
        if (filePath.Length > 260) // Windows MAX_PATH limit
        {
            return false;
        }

        return true;
    }

    /// <summary>
    /// Validates the file path and throws an exception if invalid
    /// </summary>
    /// <param name="filePath">The file path to validate</param>
    /// <exception cref="InvalidFilePathException">Thrown when the file path is invalid</exception>
    public static void ValidatePathOrThrow(string? filePath)
    {
        if (!IsValidPath(filePath))
        {
            throw new InvalidFilePathException(filePath ?? string.Empty);
        }
    }

    /// <summary>
    /// Checks if a file exists at the specified path
    /// </summary>
    /// <param name="filePath">The file path to check</param>
    /// <returns>True if the file exists, false otherwise</returns>
    public static bool FileExists(string filePath)
    {
        if (!IsValidPath(filePath))
        {
            return false;
        }

        return File.Exists(filePath);
    }
}

