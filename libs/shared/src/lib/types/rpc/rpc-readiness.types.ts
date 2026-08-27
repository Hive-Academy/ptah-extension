/**
 * Backend readiness contract (TASK_2026_331 B2A).
 *
 * ## Why a typed error and not an exception
 *
 * Batch 1 moved the heavy boot behind the window, so the renderer can now issue
 * an RPC before SQLite is open. There are three ways a backend can answer that
 * call and only one of them is honest:
 *
 * - **Throw.** The renderer already renders a thrown RPC as a failure, so a
 *   perfectly healthy app that is two seconds into its boot paints an error.
 * - **Return an empty result.** Indistinguishable from "you really have no
 *   memories", so the UI caches the empty state and never retries.
 * - **Return this.** "Not yet, ask again in `retryAfterMs`." The caller can
 *   tell the difference between absent data and unavailable data, which is the
 *   whole point.
 *
 * The shape follows the {@link DbHealthResult} precedent already in
 * `rpc-persistence.types.ts`: an unavailable connection is DATA, signalled in
 * the result, not an exception.
 *
 * ## Why `ready` is the discriminant
 *
 * A boolean literal narrows in both directions with no type guard at the call
 * site (`if (result.ready) { result.sessions }`), and it cannot collide with a
 * real field: no existing RPC result has a `ready` property. {@link
 * isRpcReadinessError} exists for the callers that hold an `unknown` — the
 * frontend RPC client resolves to `unknown` before the caller casts.
 *
 * ## What is NOT in the readiness set
 *
 * `session:list` reads `SessionMetadataStore`, which is backed by
 * `PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE` and never touches SQLite. It gets
 * no guard. Its Batch 1 behaviour — a short list that grows as the deferred
 * import runs — is correct and must not be turned into a readiness error.
 */

/**
 * Coarse boot state, mirrored from the Electron host's `BootCoordinator`.
 *
 * - `warming` — the post-window boot is still running. Retry.
 * - `ready` — the boot finished. Every subsystem is available.
 * - `degraded` — the boot finished with a subsystem missing. Do NOT retry; the
 *   answer will not change without user action.
 * - `failed` — the boot rejected. Do not retry.
 */
export type BackendReadiness = 'warming' | 'ready' | 'degraded' | 'failed';

/** Every legal {@link BackendReadiness} value, for runtime narrowing. */
export const BACKEND_READINESS_VALUES = [
  'warming',
  'ready',
  'degraded',
  'failed',
] as const satisfies readonly BackendReadiness[];

/**
 * How long a caller should wait before retrying, when the backend does not say.
 *
 * Two seconds is the plan's figure. It is long enough that a retry storm cannot
 * add measurable load to a main process that is already the bottleneck, and
 * short enough that the first retry lands inside the window in which a user is
 * still looking at the surface that triggered the call.
 */
export const DEFAULT_READINESS_RETRY_AFTER_MS = 2000;

/**
 * The "not yet" answer from a SQLite-backed RPC.
 *
 * `reason` is for the log and for a developer reading a trace. It is NOT for
 * the user: a warming backend is not an error the user can act on, so a surface
 * that receives this should keep its previous state or show a neutral loading
 * state, never an error banner.
 */
export interface RpcReadinessError {
  readonly ready: false;
  readonly readiness: BackendReadiness;
  readonly retryAfterMs: number;
  readonly reason: string;
}

/**
 * Backend to renderer push when {@link BackendReadiness} transitions.
 *
 * Carries the state alone. A caller that wants to know WHAT became available
 * re-issues the call it was retrying — the readiness vocabulary is deliberately
 * coarse, because a per-subsystem contract would have to be kept in step with
 * every subsystem the boot ever gains.
 */
export interface BootReadinessChangedPayload {
  readonly readiness: BackendReadiness;
}

/** True when `value` is a {@link BackendReadiness} literal. */
export function isBackendReadiness(value: unknown): value is BackendReadiness {
  return (
    typeof value === 'string' &&
    (BACKEND_READINESS_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Narrow an RPC result to {@link RpcReadinessError}.
 *
 * Every field is checked, not just `ready`. The frontend RPC client resolves to
 * `unknown`, so this guard is the only thing standing between a malformed
 * payload and a caller that reads `retryAfterMs` off it to schedule a timer.
 */
export function isRpcReadinessError(
  value: unknown,
): value is RpcReadinessError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RpcReadinessError>;
  return (
    candidate.ready === false &&
    isBackendReadiness(candidate.readiness) &&
    typeof candidate.retryAfterMs === 'number' &&
    Number.isFinite(candidate.retryAfterMs) &&
    typeof candidate.reason === 'string'
  );
}

/**
 * Build a readiness error. The one constructor, so every handler emits the same
 * shape and the retry delay has a single default.
 */
export function rpcReadinessError(
  reason: string,
  readiness: BackendReadiness = 'warming',
  retryAfterMs: number = DEFAULT_READINESS_RETRY_AFTER_MS,
): RpcReadinessError {
  return { ready: false, readiness, retryAfterMs, reason };
}
