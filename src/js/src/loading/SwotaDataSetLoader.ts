import type { IFlatFileReader } from '../interfaces/IFlatFileReader';
import type { DataSources, ProgressFn } from '../interfaces/IApiSdk';
import type { IDataSetLoader, DataSetResult } from './IDataSetLoader';
import type { ISwotaAvailabilityClient } from '../availability/ISwotaAvailabilityClient';
import { V3DataSetLoader } from './V3DataSetLoader';
import { V1DataSetLoader } from './V1DataSetLoader';
import { FileNotFoundError } from '../errors/FileReadingErrors';

/**
 * Loads the `'swota'` format: the same static graph {@link V3DataSetLoader}
 * builds (ports, ships, voyages, departures, cabin grades, cabin offerings),
 * but with every {@link CabinOffering} wired to a live
 * {@link ISwotaAvailabilityClient} so `getAvailableCabinsAsync()` fetches
 * real-time availability from SWOTA instead of returning a static snapshot.
 *
 * Falls back to {@link V1DataSetLoader} when the v3 flat-file source is
 * unavailable — signalled by a {@link FileNotFoundError} from the reader
 * while the v3 loader runs (i.e. one of the required ports/ships/voyages
 * files is missing). Any other error propagates unchanged. Mirrors the same
 * fallback semantics implemented inline in .NET's `ApiSdk.LoadAsync` (see
 * `src/dotnet/ApiSdk/ApiSdk.cs`) — .NET has no separate `SwOTADataSetLoader`
 * class of its own.
 */
export class SwotaDataSetLoader implements IDataSetLoader {
  constructor(private readonly liveClient: ISwotaAvailabilityClient) {}

  async load(
    reader: IFlatFileReader,
    sources: DataSources,
    onProgress: ProgressFn
  ): Promise<DataSetResult> {
    try {
      return await new V3DataSetLoader(this.liveClient).load(reader, sources, onProgress);
    } catch (error) {
      if (!(error instanceof FileNotFoundError)) {
        throw error;
      }
      onProgress(
        `SwOTA: v3 source unavailable (${error.message}); falling back to v1 loader. ` +
          `Cabin availability will be the static v1 snapshot, NOT live SWOTA data.`
      );
      return new V1DataSetLoader().load(reader, sources, onProgress);
    }
  }
}
