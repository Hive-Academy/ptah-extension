/**
 * Update RPC Type Definitions
 *
 * Types for the Electron auto-update UX RPC methods:
 *   - update:get-state    — pull the current lifecycle state (race-proof hydration)
 *   - update:check-now    — trigger an immediate update check
 *   - update:download-now — start downloading an available update (manual flow)
 *   - update:install-now  — quit and install a downloaded update
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

/** Parameters for update:download-now RPC method */
export type UpdateDownloadNowParams = Record<string, never>;

/** Response from update:download-now RPC method */
export interface UpdateDownloadNowResult {
  success: boolean;
  /** Structured error code — present when success=false */
  code?: 'UPDATE_NOT_AVAILABLE' | 'DOWNLOAD_FAILED';
  error?: string;
}

/** Parameters for update:install-now RPC method */
export type UpdateInstallNowParams = Record<string, never>;

/** Response from update:install-now RPC method */
export interface UpdateInstallNowResult {
  success: boolean;
  /** Structured error code — present when success=false */
  code?: 'UPDATE_NOT_READY' | 'INSTALL_FAILED';
  error?: string;
}
