/**
 * Provider State Management Types - Type-safe state for RxJS BehaviorSubject
 */

import type { ProviderId, ProviderHealth } from '@ptah-extension/shared';
import type { EnhancedAIProvider } from '../interfaces';

/**
 * Active Provider State - Complete state snapshot for provider manager
 * Used with RxJS BehaviorSubject for reactive state management
 */
export interface ActiveProviderState {
  /** Currently active provider (null if none selected) */
  readonly current: EnhancedAIProvider | null;

  /** Map of all registered providers */
  readonly available: ReadonlyMap<ProviderId, EnhancedAIProvider>;

  /** Health status for each provider */
  readonly health: ReadonlyMap<ProviderId, ProviderHealth>;

  /** Timestamp of last provider switch */
  readonly lastSwitch: {
    readonly timestamp: number;
    readonly from: ProviderId | null;
    readonly to: ProviderId | null;
    readonly reason:
      | 'user-request'
      | 'auto-fallback'
      | 'error-recovery'
      | 'initial';
  } | null;
}
