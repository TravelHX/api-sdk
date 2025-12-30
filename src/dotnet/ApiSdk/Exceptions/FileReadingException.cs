namespace ApiSdk.Exceptions;

/// <summary>
/// Base exception for file reading operations
/// </summary>
public class FileReadingException : Exception
{
    public FileReadingException(string message) : base(message)
    {
    }

    public FileReadingException(string message, Exception innerException) : base(message, innerException)
    {
    }
}

/// <summary>
/// Exception thrown when a file path is invalid
/// </summary>
public class InvalidFilePathException : FileReadingException
{
    public InvalidFilePathException(string filePath) 
        : base($"Invalid file path: {filePath}")
    {
        FilePath = filePath;
    }

    public string FilePath { get; }
}

/// <summary>
/// Exception thrown when JSON deserialization fails
/// </summary>
public class JsonDeserializationException : FileReadingException
{
    public JsonDeserializationException(string filePath, Exception innerException) 
        : base($"Failed to deserialize JSON from file: {filePath}", innerException)
    {
        FilePath = filePath;
    }

    public string FilePath { get; }
}

