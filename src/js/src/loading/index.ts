/**
 * Data-set loading strategies. {@link ApiSdk.load} selects one by
 * {@link DataSources.format} and assigns its {@link DataSetResult}.
 */
export type { IDataSetLoader, DataSetResult } from './IDataSetLoader';
export { V1DataSetLoader } from './V1DataSetLoader';
export { V3DataSetLoader } from './V3DataSetLoader';
export { resolveDataSourceFormat, DATASOURCE_FORMAT_ENV } from './formatConfig';
