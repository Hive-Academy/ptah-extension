/**
 * Provider Selection Result Types - Type-safe provider selection outcomes
 */

import type { ProviderId } from '@ptah-extension/shared';

/**
 * Provider Selection Result - Output of intelligent provider selection strategy
 * Contains the selected provider, confidence score, reasoning, and fallback options
 */
export interface ProviderSelectionResult {
  /** Selected provider identifier */
  readonly providerId: ProviderId;

  /** Confidence score (0-100) indicating selection certainty */
  readonly confidence: number;

  /** Human-readable reasoning explaining the selection decision */
  readonly reasoning: string;

  /** Ordered list of fallback providers in case selected provider fails */
  readonly fallbacks: readonly ProviderId[];
}
