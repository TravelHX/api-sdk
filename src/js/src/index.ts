/**
 * Public API of @api-sdk/js.
 *
 * The SDK is consumed exclusively through its interface: construct it with
 * createApiSdk() (which returns an IApiSdk) and traverse the loaded graph via
 * the read-only entity *types*. The concrete classes (ApiSdk, FlatFileReader,
 * PathValidator and the entity constructors) are intentionally NOT exported —
 * consumers depend on the contract, never the implementation, and there is no
 * way to construct the SDK except through the factory.
 */

// The only entry point — returns the SDK behind its IApiSdk interface.
export { createApiSdk } from './api-sdk';

// SDK contract + supporting types.
export type { IApiSdk, DataSources, ProgressFn, SdkStats } from './interfaces/IApiSdk';
export type { IFlatFileReader } from './interfaces/IFlatFileReader';

// Read-only entity types exposed by the graph (types only — not constructable).
export type {
  Voyage,
  Ship,
  Departure,
  CabinGrade,
  CabinOffering,
  Port,
  Price,
  ItineraryDay,
} from './data';

// Error contract thrown by the interface's read actions (for catch handling).
export * from './errors/FileReadingErrors';
