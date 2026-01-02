namespace ApiSdk;

public class ApiSdk
{
    private readonly IFlatFileReader _fileReader;

    public ApiSdk(IFlatFileReader? fileReader = null)
    {
        _fileReader = fileReader ?? new FlatFileReader();
    }

    /// <summary>
    /// Gets the file reader instance
    /// </summary>
    public IFlatFileReader FileReader => _fileReader;
}

