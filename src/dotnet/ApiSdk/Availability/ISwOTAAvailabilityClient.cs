namespace ApiSdk.Availability;

/// <summary>
/// Fetches LIVE cabin availability for a single cabin offering from the
/// external SWOTA (Seaware OTA) inventory API, as opposed to the static
/// snapshot value baked into the V1 flat files. Only wired up when
/// <see cref="DataSourceFormat.SwOTA"/> is the active <see cref="DataSources.Format"/>;
/// see <see cref="Data.CabinOffering.GetAvailableCabinsAsync"/> for how the
/// result is cached per offering.
/// </summary>
public interface ISwOTAAvailabilityClient
{
    /// <summary>
    /// Look up the currently available cabin count for one (voyage, cabin
    /// grade) pair. Returns the real available-cabin count reported by SWOTA
    /// (0 meaning genuinely no cabins available in that grade) — it does NOT
    /// return null to signal failure. Business or HTTP errors (e.g. an
    /// unrecognized voyage/cabin pair, an upstream fault) are surfaced by
    /// throwing (e.g. <see cref="SwOTABusinessException"/>), never by
    /// returning null.
    /// </summary>
    /// <param name="voyageId">The RAW, unstripped VoyageID exactly as it appears
    /// in the source data (e.g. "_@FNALA04-260906") — NOT the internally-stripped
    /// departure code (e.g. "FNALA04-260906"). Passing the stripped form here
    /// reintroduces a bug that was already found and fixed once.</param>
    /// <param name="cabinCode">The cabin grade code (source-market "Category",
    /// e.g. "DS") — <see cref="Data.CabinOffering.Code"/>.</param>
    /// <param name="ct">Cancellation token for the outbound call.</param>
    Task<int?> GetAvailableCabinsAsync(string voyageId, string cabinCode, CancellationToken ct = default);
}
