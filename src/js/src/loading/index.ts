/**
 * Data-set loading strategies. {@link ApiSdk.load} selects one by
 * {@link DataSources.format} and assigns its {@link DataSetResult}.
 */
export type { IDataSetLoader, DataSetResult } from './IDataSetLoader';
export { V1DataSetLoader } from './V1DataSetLoader';
export { V3DataSetLoader } from './V3DataSetLoader';
export { SwotaDataSetLoader } from './SwotaDataSetLoader';
export { resolveDataSourceFormat, DATASOURCE_FORMAT_ENV } from './formatConfig';
export type { Market, MarketDataSources, MarketDataSourcesV3 } from './marketConfig';
export {
  MARKET_LOCALES,
  LOCALE_CURRENCY,
  MARKET_LOCALES_V3,
  DATASOURCE_MARKET_ENV,
  DATASOURCE_LOCALE_ENV,
  resolveMarket,
  resolveLocale,
  resolveMarketDataSources,
  resolveMarketDataSourcesV3,
} from './marketConfig';
