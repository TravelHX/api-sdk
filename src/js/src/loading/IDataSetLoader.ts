import type { IFlatFileReader } from '../interfaces/IFlatFileReader';
import type { DataSources, ProgressFn } from '../interfaces/IApiSdk';
import type {
  Voyage,
  Ship,
  CabinGrade,
  CabinOffering,
  Departure,
  Port,
} from '../data';

/**
 * The fully-built object graph produced by a {@link IDataSetLoader}. These are
 * exactly the collections and lookup maps that {@link ApiSdk} commits to its
 * private fields, so a loader's output can be assigned wholesale.
 */
export interface DataSetResult {
  voyages: Voyage[];
  ships: Ship[];
  cabinGrades: CabinGrade[];
  ports: Port[];
  departures: Departure[];
  offerings: CabinOffering[];

  shipById: Map<string, Ship>;
  cabinGradeByCode: Map<string, CabinGrade>;
  portByCode: Map<string, Port>;
  departureByCode: Map<string, Departure>;
}

/**
 * Strategy for turning a set of flat files into the navigable object graph.
 * One implementation exists per flat-file {@link DataSourceFormat} ("v1",
 * "v3"). {@link ApiSdk.load} selects the right loader and assigns its result.
 *
 * This abstraction mirrors the parallel .NET implementation 1:1 (same name and
 * semantics) so the two SDKs stay aligned.
 */
export interface IDataSetLoader {
  /**
   * Read the flat files via {@link reader} and assemble the wired graph. The
   * returned collections/maps are linked in both directions so the result is
   * traversable from any entity.
   */
  load(
    reader: IFlatFileReader,
    sources: DataSources,
    onProgress: ProgressFn
  ): Promise<DataSetResult>;
}
