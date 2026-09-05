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
 * Coarse label for the stage the post-window boot has reached.
 *
 * **Display-only.** `phase` exists so a boot screen can name what is happening
 * instead of showing a bare spinner. It is NOT a subsystem contract: no caller
 * may infer from `phase === 'database'` that SQLite is open, or from
 * `phase === 'index'` that the harness finished. The only value a caller may
 * act on is {@link BackendReadiness}; a caller that wants to know WHAT became
 * available re-issues the call it was retrying.
 *
 * The ordering below is the order the Electron host happens to emit today. A
 * host may skip a phase, and a renderer must degrade gracefully on a phase it
 * does not recognise rather than gating on one it expects.
 *
 * - `starting` — the boot began; nothing heavy has run yet.
 * - `database` — opening SQLite and running migrations.
 * - `harness` — reconciling the user layer into the AI tools' harness dirs.
 * - `sessions` — importing session metadata.
 * - `index` — workspace indexing / symbol work.
 * - `settled` — the boot finished. Pairs with a terminal {@link BackendReadiness}.
 */
export type BootPhase =
  | 'starting'
  | 'database'
  | 'harness'
  | 'sessions'
  | 'index'
  | 'settled';

/** Every legal {@link BootPhase} value, for runtime narrowing. */
export const BOOT_PHASE_VALUES = [
  'starting',
  'database',
  'harness',
  'sessions',
  'index',
  'settled',
] as const satisfies readonly BootPhase[];

/** True when `value` is a {@link BootPhase} literal. */
export function isBootPhase(value: unknown): value is BootPhase {
  return (
    typeof value === 'string' &&
    (BOOT_PHASE_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Backend to renderer push when the boot's observable state changes.
 *
 * `readiness` is the only field with consumer semantics. It stays deliberately
 * coarse, because a per-subsystem contract would have to be kept in step with
 * every subsystem the boot ever gains.
 *
 * `phase` and `detail` are **display-only labels**. They exist so a boot screen
 * can say something truthful while `readiness` is still `warming`; nothing may
 * branch on them beyond choosing what text to paint. Adding a phase is
 * therefore not a breaking protocol change.
 *
 * The message stays **edge-triggered**: one message per transition, emitted when
 * `readiness` or `phase` changes — never a progress tick and never one per boot
 * step. A surface holding an `RpcReadinessError` can drop its retry timer on the
 * `readiness` transition exactly as before.
 */
export interface BootReadinessChangedPayload {
  readonly readiness: BackendReadiness;
  readonly phase: BootPhase;
  /** Human-facing, display-only, e.g. "Opening a 1.0 GB database". */
  readonly detail?: string;
  /** Epoch ms of boot start, so the renderer can show elapsed time. */
  readonly startedAt: number;
}

/**
 * Result of the `boot:getReadiness` pull.
 *
 * The same shape as the push, deliberately: a renderer that missed the push
 * (Angular installs its message listener after `did-finish-load`, and a
 * renderer reload gets no replay) reads exactly what a listener would have
 * received, so one consumer path handles both.
 */
export type BootGetReadinessResult = BootReadinessChangedPayload;

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
