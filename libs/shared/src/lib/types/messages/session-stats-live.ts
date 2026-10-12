/**
 * `session:stats-live` wire contract — the webview side.
 *
 * The backend publishes `SessionStatsLivePayload` (`../agent-adapter.types`)
 * while a turn runs: a throttled, provisional session-stats snapshot that the
 * next `session:stats` snapshot (higher revision) replaces. It is never a
 * completion signal.
 *
 * The webview routes on a plain string id, as it does for `session:stats`, so
 * the wire type here carries `sessionId: string` rather than the branded id.
 */
import type { SessionStatsEntry } from '../rpc/rpc-session.types';

/** Main-loop latest request size carried by a provisional live payload. */
export interface SessionStatsLiveContext {
  readonly model: string;
  readonly contextTokens: number;
}

/** Parsed `session:stats-live` payload. */
export interface SessionStatsLiveWire {
  readonly sessionId: string;
  /**
   * Owner snapshot. Only its envelope (`provisional`, `revision`) is checked
   * here; deep snapshot validation is the consumer's job
   * (`isValidSessionStatsSnapshot` in chat-state, which `shared` cannot
   * import).
   */
  readonly sessionStats: SessionStatsEntry;
  /** Present only when `sessionStats.provisional === true`. */
  readonly context?: SessionStatsLiveContext;
  /**
   * Display-only live budget stage. Present only when
   * `sessionStats.provisional === true`: absent = no change, `null` = clear,
   * a value = set.
   */
  readonly liveBudgetStage?: 'handoff' | 'limit' | null;
}

type LiveBudgetStage = NonNullable<SessionStatsLiveWire['liveBudgetStage']>;

/** `undefined` when the value is not a valid live stage (field dropped). */
function parseLiveBudgetStage(
  value: unknown,
): LiveBudgetStage | null | undefined {
  if (value === null) return null;
  if (value === 'handoff' || value === 'limit') return value;
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseContext(value: unknown): SessionStatsLiveContext | null {
  if (!isPlainObject(value)) return null;
  const model = value['model'];
  const contextTokens = value['contextTokens'];
  if (typeof model !== 'string' || model.length === 0) return null;
  if (
    typeof contextTokens !== 'number' ||
    !Number.isFinite(contextTokens) ||
    contextTokens < 0
  ) {
    return null;
  }
  return { model, contextTokens };
}

/**
 * Hand-written parser for the `session:stats-live` wire payload.
 *
 * Hand-written rather than Zod for the same reason as
 * `parseSessionMcpStatusPayload`: this runs in the webview, which keeps the
 * Zod runtime out of its initial bundle.
 *
 * Returns `null` when:
 * - `sessionId` is not a non-empty string;
 * - `sessionStats` is not a plain object;
 * - `sessionStats.provisional` is present with any value other than `true`;
 * - `sessionStats.revision` is missing or not a finite number. A live payload
 *   without a revision could bypass the revision floor on a tab that shows
 *   nothing yet.
 *
 * `context` is kept only when it is valid (non-empty `model`, finite
 * non-negative `contextTokens`) AND the snapshot is provisional. Otherwise
 * only the `context` is dropped — the result has no `context` key — and the
 * payload is kept: an authoritative snapshot must never replace the context
 * the result path derived from `modelUsage`.
 *
 * `liveBudgetStage` follows the same rule: `'handoff'`, `'limit'` or `null`
 * is kept only on a provisional snapshot. Any other value, or a
 * non-provisional snapshot, drops only that field (no key in the result), so
 * the consumer sees "no change" rather than a clear.
 */
export function parseSessionStatsLivePayload(
  payload: unknown,
): SessionStatsLiveWire | null {
  if (!isPlainObject(payload)) return null;

  const sessionId = payload['sessionId'];
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;

  const sessionStats = payload['sessionStats'];
  if (!isPlainObject(sessionStats)) return null;

  const provisional = sessionStats['provisional'];
  if (provisional !== undefined && provisional !== true) return null;

  const revision = sessionStats['revision'];
  if (typeof revision !== 'number' || !Number.isFinite(revision)) return null;

  // Envelope checked above; the deep shape is validated by the consumer.
  const stats = sessionStats as unknown as SessionStatsEntry;
  if (provisional !== true) return { sessionId, sessionStats: stats };

  const context = parseContext(payload['context']);
  const liveBudgetStage = parseLiveBudgetStage(payload['liveBudgetStage']);

  return {
    sessionId,
    sessionStats: stats,
    ...(context ? { context } : {}),
    ...(liveBudgetStage === undefined ? {} : { liveBudgetStage }),
  };
}
