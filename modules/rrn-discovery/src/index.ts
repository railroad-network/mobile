import { NitroModules } from 'react-native-nitro-modules';
import type { StationDiscovery } from './specs/StationDiscovery.nitro';

export type {
  DiscoveredStation,
  StationDiscovery,
} from './specs/StationDiscovery.nitro';

/**
 * Creates a browser over the platform's Bonjour stack.
 *
 * A function rather than an eagerly-created singleton: constructing the hybrid
 * object touches native, so importing this module must stay free of side
 * effects — `src/network/Discovery.ts` is what decides when to reach for it.
 */
export function createStationDiscovery(): StationDiscovery {
  return NitroModules.createHybridObject<StationDiscovery>('StationDiscovery');
}
