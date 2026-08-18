/**
 * Client contract for fetching LIVE cabin availability from SWOTA (Seaware
 * OTA), the external inventory API that backs the `'swota'`
 * {@link DataSourceFormat}. This is the seam {@link CabinOffering} calls
 * through when it has been wired with a live client instead of a static
 * `availableCabins` snapshot (see {@link CabinOffering.getAvailableCabinsAsync}).
 */
export interface ISwotaAvailabilityClient {
  /**
   * Look up the currently available cabin count for one (voyage, cabin
   * grade) pair. Returns the real available-cabin count reported by SWOTA (0
   * meaning genuinely no cabins available in that grade) -- it does NOT
   * return null to signal failure. Business or HTTP errors (e.g. an
   * unrecognized voyage/cabin pair, an upstream fault) are surfaced by
   * throwing, never by returning null.
   *
   * @param voyageId The RAW, unstripped VoyageID exactly as it appears in the
   * source data (e.g. "_@FNALA04-260906") -- NOT the internally-stripped
   * departure code (e.g. "FNALA04-260906"). Passing the stripped form here
   * reintroduces a bug that was already found and fixed once.
   * @param cabinCode The cabin grade code (source-market "Category", i.e.
   * {@link CabinOffering.code}, e.g. "DS").
   * @returns The live available-cabin count.
   */
  getAvailableCabins(voyageId: string, cabinCode: string): Promise<number | null>;
}
