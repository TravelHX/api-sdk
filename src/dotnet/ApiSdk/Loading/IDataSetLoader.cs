namespace ApiSdk.Loading;

/// <summary>
/// Builds the navigable object graph from a set of flat files. Each flat-file
/// format (dev, prod) has its own implementation; <see cref="ApiSdk.LoadAsync"/>
/// dispatches to the right one based on <see cref="DataSources.Format"/> and
/// assigns the returned <see cref="DataSetLoadResult"/> onto its fields.
/// </summary>
internal interface IDataSetLoader
{
    /// <summary>
    /// Read the files referenced by <paramref name="sources"/> through
    /// <paramref name="fileReader"/> and assemble the fully-wired graph.
    /// </summary>
    Task<DataSetLoadResult> LoadAsync(
        IFlatFileReader fileReader,
        DataSources sources,
        IProgress<string>? progress);
}
