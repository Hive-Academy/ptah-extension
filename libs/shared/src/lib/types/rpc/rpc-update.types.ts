/**
 * Update RPC Type Definitions
 *
 * Types for the desktop update banner RPC methods:
 *   - update:get-state — pull the current lifecycle state (race-proof hydration)
 *   - update:check-now — trigger an immediate GitHub Releases check
 */

import type { UpdateLifecycleState } from '../messages/update';

/** Parameters for update:get-state RPC method */
export type UpdateGetStateParams = Record<string, never>;

/** Response from update:get-state RPC method — the current lifecycle state. */
export interface UpdateGetStateResult {
  state: UpdateLifecycleState;
}

/** Parameters for update:check-now RPC method */
export type UpdateCheckNowParams = Record<string, never>;

/** Response from update:check-now RPC method */
export interface UpdateCheckNowResult {
  success: boolean;
  error?: string;
}
