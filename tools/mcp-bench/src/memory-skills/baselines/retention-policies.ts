/**
 * Pure retention baselines for the memory arm (benchmark-design.md 3.7,
 * design line 190): no lifecycle, age-only (the current product policy), and
 * the oracle policy — age-only with the labelled-useful rows and `hits > 0`
 * protected, the ceiling a lifecycle fix could reach, not a product path.
 *
 * Deterministic by construction: `nowMs` is always an explicit parameter
 * (never `Date.now()`), the thresholds come from the product's lifecycle
 * config (never re-typed literals), and every ordering falls back to the
 * input row order, so the same rows + `nowMs` always decide the same way.
 *
 * The policies model the retention decision of one product run in the
 * product's own order — age-delete, then archive, then per-workspace cap
 * eviction (`memory-lifecycle.service.ts:110-191`) — over the row shape the
 * seeded DB carries (design :182). Three product guards do not exist in the
 * seeded rows and so are not modelled: `quarantined_at` (no quarantined rows
 * are seeded), corpus-linked rows (`corpus_memories` is a product table), and
 * run budgets (a pure policy has no batch limits).
 */

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Tiers as the lifecycle store queries them (`memory-lifecycle.store.ts:12-48`). */
export type RetentionTier = 'core' | 'recall' | 'archival';

/** Row kinds of the seeded DB (benchmark-design.md:182). */
export type MemoryFactKind = 'fact' | 'preference' | 'event' | 'entity';

/**
 * One seeded memory row as the pure retention policies see it. `useful` is
 * the labeller's label (asked by a held-out question, design :182); `kind`
 * rides along so the suites break the false-delete/false-retain rates down
 * by kind (design :185). `archivedAtMs` is non-null exactly when the row is
 * in the archival tier.
 */
export interface RetentionPolicyRow {
  readonly id: string;
  readonly tier: RetentionTier;
  /** Grouping key for the per-workspace cap, as the row is stored. */
  readonly workspaceRoot: string;
  readonly lastUsedAtMs: number;
  readonly archivedAtMs: number | null;
  readonly pinned: boolean;
  readonly hits: number;
  readonly kind: MemoryFactKind;
  readonly useful: boolean;
}

/**
 * Thresholds the policies decide by. Defaults are read from the product's
 * lifecycle config (`memory-lifecycle-config.ts`, the `30 / 60 / 25,000`
 * defaults) instead of being copied as literals, so a settings change in the
 * product moves the baselines with it.
 */
export interface RetentionPolicySettings {
  readonly archiveAfterDays: number;
  readonly deleteAfterDays: number;
  readonly maxPerWorkspace: number;
  readonly capEvictionGraceMs: number;
}

/** What one policy run decides about the rows it was given. */
export interface RetentionDecision {
  /** Rows moved from `recall` to `archival` this step. */
  readonly archived: readonly string[];
  /** Rows removed by the age-delete rule this step. */
  readonly deleted: readonly string[];
  /** Rows removed by the per-workspace cap this step. */
  readonly evicted: readonly string[];
}

/** A retention policy: one pure decision over one row set at one instant. */
export type RetentionPolicy = (
  rows: readonly RetentionPolicyRow[],
  nowMs: number,
  settings: RetentionPolicySettings,
) => RetentionDecision;

/**
 * No-lifecycle baseline (benchmark-design.md:190): nothing is ever archived,
 * deleted or evicted. The false-retain ceiling and the false-delete floor.
 */
export const noLifecyclePolicy: RetentionPolicy = () => ({
  archived: [],
  deleted: [],
  evicted: [],
});

/**
 * Age-only policy (benchmark-design.md:190) — the current product decision,
 * re-implemented as a pure function:
 *
 * - age-delete: an archival row whose `archived_at` is older than
 *   `deleteAfterDays` is deleted (`memory-lifecycle.store.ts:12-16`);
 * - archive: a recall row whose `last_used_at` is older than
 *   `archiveAfterDays` is archived with `archived_at = now`
 *   (`memory-lifecycle.store.ts:18-25`);
 * - cap eviction: a workspace holding more than `maxPerWorkspace` removable
 *   rows is brought down to the cap — first archival rows past the
 *   `RETENTION_CAP_EVICTION_GRACE_MS` grace, ordered by `last_used_at`, then
 *   recall rows when the recall tier alone is over the cap
 *   (`memory-lifecycle.service.ts:158-191`, `memory-lifecycle.store.ts:31-48`).
 *
 * Pinned rows are never touched, exactly as the product's `pinned = 0` guards
 * say. Deterministic tie-breaks: eviction order falls back to input row order
 * on equal `last_used_at`, and workspaces are visited in first-appearance
 * order.
 */
export function ageOnlyPolicy(
  rows: readonly RetentionPolicyRow[],
  nowMs: number,
  settings: RetentionPolicySettings,
): RetentionDecision {
  return decideRetention(rows, nowMs, settings, () => false);
}

/**
 * Oracle policy (benchmark-design.md:190): age-only with the labelled-useful
 * rows (design :182, "useful-by-kind" read as the per-row useful label, which
 * the suites break down by kind, design :185) and every row with
 * `hits > 0` protected. A protected row is treated the way the current
 * policy treats a pinned row: it is never archived, deleted or evicted, and
 * it does not count toward the per-workspace cap — so the cap cannot squeeze
 * a useful row out through the back door either.
 */
export function oracleRetentionPolicy(
  rows: readonly RetentionPolicyRow[],
  nowMs: number,
  settings: RetentionPolicySettings,
): RetentionDecision {
  return decideRetention(rows, nowMs, settings, (row) => {
    return row.useful || row.hits > 0;
  });
}

function decideRetention(
  rows: readonly RetentionPolicyRow[],
  nowMs: number,
  settings: RetentionPolicySettings,
  isProtected: (row: RetentionPolicyRow) => boolean,
): RetentionDecision {
  const removable = (row: RetentionPolicyRow): boolean =>
    !row.pinned && !isProtected(row);

  // Age-delete first, as the product run does; a row deleted this step is
  // gone, so it is neither archived nor counted toward the cap.
  const deleted = rows
    .filter(
      (row) =>
        removable(row) &&
        row.tier === 'archival' &&
        row.archivedAtMs !== null &&
        row.archivedAtMs < nowMs - settings.deleteAfterDays * DAY_MS,
    )
    .map((row) => row.id);
  const deletedIds = new Set(deleted);

  // Archive second. A just-archived row carries `archived_at = nowMs`, which
  // the eviction grace then keeps out of the eviction candidate set this
  // step — same as the product, where the archive step runs before the cap.
  const archived = rows
    .filter(
      (row) =>
        !deletedIds.has(row.id) &&
        removable(row) &&
        row.tier === 'recall' &&
        row.lastUsedAtMs < nowMs - settings.archiveAfterDays * DAY_MS,
    )
    .map((row) => row.id);

  const archivedIds = new Set(archived);

  // Cap eviction runs over the state after the age steps, as the product's
  // single run does: deleted rows are gone and just-archived rows sit in the
  // archival tier with `archived_at = nowMs` — they count toward the cap, the
  // grace keeps them out of the archival candidate set, and they no longer
  // count as recall rows for `recallExcess`.
  const stateAfter = rows
    .filter((row) => !deletedIds.has(row.id))
    .map((row) =>
      archivedIds.has(row.id)
        ? { ...row, tier: 'archival' as const, archivedAtMs: nowMs }
        : row,
    );
  const evicted = evictOverCap(stateAfter, nowMs, settings, removable);
  return { archived, deleted, evicted };
}

/**
 * Per-workspace cap eviction over the state after the age steps. A NULL
 * `archived_at` never passes a cutoff comparison in the product SQL, so an
 * archival row without a timestamp is never an eviction candidate here
 * either.
 */
function evictOverCap(
  rows: readonly RetentionPolicyRow[],
  nowMs: number,
  settings: RetentionPolicySettings,
  removable: (row: RetentionPolicyRow) => boolean,
): readonly string[] {
  const evicted: string[] = [];
  const workspaces = new Map<string, RetentionPolicyRow[]>();
  for (const row of rows) {
    if (row.tier === 'core' || !removable(row)) continue;
    const bucket = workspaces.get(row.workspaceRoot);
    if (bucket === undefined) {
      workspaces.set(row.workspaceRoot, [row]);
    } else {
      bucket.push(row);
    }
  }

  for (const workspace of workspaces.values()) {
    const excess = workspace.length - settings.maxPerWorkspace;
    if (excess <= 0) continue;

    const archival = workspace
      .filter(
        (row) =>
          row.tier === 'archival' &&
          row.archivedAtMs !== null &&
          row.archivedAtMs < nowMs - settings.capEvictionGraceMs,
      )
      .sort(oldestUsedFirst);
    for (const row of archival.slice(0, excess)) evicted.push(row.id);

    // The recall tier is only thinned when it alone exceeds the cap, exactly
    // as `recallExcess` in the service does; archived rows keep `recall` rows
    // under the cap for free otherwise.
    const recall = workspace.filter((row) => row.tier === 'recall');
    const recallExcess = recall.length - settings.maxPerWorkspace;
    if (recallExcess > 0) {
      const byOldestUsed = [...recall].sort(oldestUsedFirst);
      for (const row of byOldestUsed.slice(0, recallExcess)) {
        evicted.push(row.id);
      }
    }
  }
  return evicted;
}

/**
 * Eviction order: `last_used_at` ascending, falling back to input row order
 * on ties (`Array.prototype.sort` is stable), the deterministic reading of
 * the store's `ORDER BY m.last_used_at`.
 */
function oldestUsedFirst(
  left: RetentionPolicyRow,
  right: RetentionPolicyRow,
): number {
  return left.lastUsedAtMs - right.lastUsedAtMs;
}
