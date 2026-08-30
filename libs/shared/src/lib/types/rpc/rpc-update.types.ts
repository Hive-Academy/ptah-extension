/**
 * Update RPC Type Definitions
 *
 * Types for the desktop update dialog RPC methods:
 *   - update:get-state — pull the current lifecycle state (race-proof hydration)
 *   - update:check-now — trigger an immediate GitHub Releases check
 *   - update:mark-downloaded — record that the user downloaded a version
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

/**
 * Parameters for update:mark-downloaded RPC method.
 *
 * `version` is the release the user chose to download — the bare version, not
 * the `electron-v` tag.
 */
export interface UpdateMarkDownloadedParams {
  version: string;
}

/** Response from update:mark-downloaded RPC method */
export interface UpdateMarkDownloadedResult {
  success: boolean;
}
