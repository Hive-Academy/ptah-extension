/**
 * Command Center reads Tribunal vendor discovery through this entry.
 * Keep the Angular panel, pages, components, and gridstack out of eager consumers.
 */
export { TribunalDiscoveryService } from './lib/services/tribunal-discovery.service';
export type {
  DiscoveredVendor,
  TribunalModelOption,
} from './lib/services/tribunal-discovery.service';
