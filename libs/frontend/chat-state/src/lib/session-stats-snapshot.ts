import type { SessionStatsEntry } from '@ptah-extension/shared';

/**
 * Runtime check for a backend session snapshot (TASK_2026_533).
 *
 * Snapshots arrive over the webview message boundary (`session:stats`) and the
 * `chat:resume` reply, so their declared type is a contract, not a guarantee.
 * A snapshot that fails this check is rejected whole; nothing is coerced.
 *
 * Checked: a non-empty `sessionId`; `model` as a string or `null` (the
 * model-name formatter throws on anything else); the four token classes as finite
 * non-negative numbers; `totalCost` as a finite non-negative number or `null`;
 * `revision`, when present, as a non-negative safe integer (an absent revision
 * is legitimate — see {@link SessionStatsRevisionFloor}); the optional
 * figures the stats surfaces display; and the optional `contextSnapshot`
 * (string `model`, non-negative `contextTokens` and `contextWindow`), which the
 * resume path turns into the context badge.
 */
export function isValidSessionStatsSnapshot(
  value: unknown,
): value is SessionStatsEntry {
  if (!isRecord(value)) return false;
  const sessionId = value['sessionId'];
  if (typeof sessionId !== 'string' || sessionId.length === 0) return false;

  const model = value['model'];
  if (model !== undefined && model !== null && typeof model !== 'string') {
    return false;
  }

  const revision = value['revision'];
  if (revision !== undefined && !isRevision(revision)) return false;

  const tokens = value['tokens'];
  if (
    !isRecord(tokens) ||
    !isAmount(tokens['input']) ||
    !isAmount(tokens['output']) ||
    !isAmount(tokens['cacheRead']) ||
    !isAmount(tokens['cacheCreation'])
  ) {
    return false;
  }
  if (!isNullableAmount(value['totalCost'])) return false;

  return (
    isOptional(value['tokenCount'], isAmount) &&
    isOptional(value['knownCost'], isNullableAmount) &&
    isOptional(value['agentSessionCount'], isRevision) &&
    isOptional(value['durationMs'], isNullableAmount) &&
    isOptional(value['modelUsageList'], isModelUsageList) &&
    isOptional(value['contextSnapshot'], isContextSnapshot)
  );
}

/**
 * Per-session revision floor for installed snapshots, in memory only.
 *
 * Rules (TASK_2026_533, review Revision 1):
 * - A snapshot WITH a revision installs only when it is not below the floor,
 *   and raises the floor. An equal revision is the same backend publication
 *   (the counter is process-wide), so re-installing it is idempotent; this is
 *   what lets one broadcast reach every tab bound to the session.
 * - A snapshot WITHOUT a revision (a history/resume aggregate) installs only
 *   while the session has no floor. Once a live snapshot was accepted it is the
 *   complete lifetime total, and an older transcript read must not replace it.
 * - An unrevisioned install never lowers or clears the floor.
 *
 * The floor is per session; a consumer that displays per tab decides for
 * itself whether a display with nothing to regress may bypass it (see
 * `TabManagerService.acceptSessionStats`).
 *
 * The floor lives beside the displayed snapshot, never on it: a revision is
 * comparable only within one backend lifetime, and a page reload (a new
 * backend attachment) starts with no floors.
 */
export class SessionStatsRevisionFloor {
  private readonly floors = new Map<string, number>();

  /** Whether `snapshot` may be installed now; records its revision if so. */
  admit(snapshot: SessionStatsEntry): boolean {
    const floor = this.floors.get(snapshot.sessionId);
    const revision = snapshot.revision;
    if (revision === undefined) return floor === undefined;
    if (floor !== undefined && revision < floor) return false;
    this.floors.set(snapshot.sessionId, revision);
    return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNullableAmount(value: unknown): boolean {
  return value === null || isAmount(value);
}

function isRevision(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isOptional(
  value: unknown,
  check: (candidate: unknown) => boolean,
): boolean {
  return value === undefined || check(value);
}

/** The context badge formats `model` and divides by `contextWindow`. */
function isContextSnapshot(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['model'] === 'string' &&
    isAmount(value['contextTokens']) &&
    isOptional(value['contextWindow'], isAmount)
  );
}

function isModelUsageList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        isRecord(row) &&
        typeof row['model'] === 'string' &&
        isAmount(row['inputTokens']) &&
        isAmount(row['outputTokens']) &&
        isOptional(row['cacheRead'], isAmount) &&
        isOptional(row['cacheCreation'], isAmount) &&
        isNullableAmount(row['costUSD']),
    )
  );
}
