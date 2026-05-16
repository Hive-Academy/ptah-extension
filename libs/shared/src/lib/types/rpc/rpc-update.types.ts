/**
 * Update RPC Type Definitions
 *
 * Types for update:check-now and update:install-now RPC methods.
 * Electron auto-update UX.
 */

/** Parameters for update:check-now RPC method */
export type UpdateCheckNowParams = Record<string, never>;

/** Response from update:check-now RPC method */
export interface UpdateCheckNowResult {
  success: boolean;
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
