/**
 * `emitFatalError` — structured NDJSON error channel on stderr.
 *
 * cli-shift.md Phase 2 / HANDOFF-ptah-cli.md P1 Fix 4. Supervisors that monitor
 * stderr (per cli-shift.md) get a deterministic, machine-readable line for
 * fatal orchestration failures. This is SEPARATE from the JSON-RPC `task.error`
 * notification on stdout — both channels coexist:
 *
 *   - stdout (JSON-RPC NDJSON):  `{"jsonrpc":"2.0","method":"task.error", ...}`
 *   - stderr (this helper):      `{"error":"sdk_init_failed","message":"..."}`
 *
 * Dependency-free by design — no `chalk`, no `pino`, no formatter. One direct
 * write to `process.stderr` per call. Codes align with `PtahErrorCode` so
 * callers get autocomplete without the helper drifting from the JSON-RPC
 * spec's error code enum.
 */

import type { PtahErrorCode } from '../jsonrpc/types.js';

/**
 * Subset of `PtahErrorCode` codes that supervisors care about over stderr.
 * Authored as a const-object union (NOT an enum) so it compiles to a plain
 * string literal type and stays in sync with the canonical `PtahErrorCode`.
 *
 * Keep this list narrow: only fatal / non-recoverable codes belong here.
 * Recoverable codes (e.g. `rate_limited`, `provider_unavailable`) are
 * surface-level and stay on stdout JSON-RPC only.
 */
export const FatalErrorCode = {
  SdkInitFailed: 'sdk_init_failed',
  InternalFailure: 'internal_failure',
  DbLock: 'db_lock',
  WorkspaceMissing: 'workspace_missing',
  AuthRequired: 'auth_required',
  LicenseRequired: 'license_required',
} as const satisfies Readonly<Record<string, PtahErrorCode>>;

/** String-literal union of fatal error codes accepted by `emitFatalError`. */
export type FatalErrorCodeValue =
  (typeof FatalErrorCode)[keyof typeof FatalErrorCode];

/**
 * Emit a single NDJSON line to `process.stderr` describing a fatal failure.
 *
 * Shape: `{ "error": "<code>", "message": "<human>", ...details }\n`
 *
 * No buffering, no ANSI, no colors. The message MUST end with a newline so
 * line-delimited parsers see exactly one record per call. Never throws — any
 * write failure is silently swallowed (stderr-on-stderr would be useless).
 */
export function emitFatalError(
  code: FatalErrorCodeValue,
  message: string,
  details?: Record<string, unknown>,
): void {
  const payload: Record<string, unknown> = { error: code, message };
  if (details) {
    for (const [k, v] of Object.entries(details)) {
      // Don't allow callers to clobber the canonical `error` / `message` keys.
      if (k === 'error' || k === 'message') continue;
      payload[k] = v;
    }
  }
  try {
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  } catch {
    /* swallow — stderr write failure cannot be reported anywhere safer */
  }
}
