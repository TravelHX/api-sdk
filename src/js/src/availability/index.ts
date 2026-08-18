/**
 * Live cabin-availability client contract and implementation(s) backing the
 * `'swota'` {@link DataSourceFormat}. Consumed by {@link CabinOffering}
 * (see `../data/CabinOffering`) via {@link CabinOffering.getAvailableCabinsAsync}.
 */
export type { ISwotaAvailabilityClient } from './ISwotaAvailabilityClient';
export { SwotaAvailabilityClient } from './SwotaAvailabilityClient';
