/**
 * `mem.retention.lifecycle` (benchmark-design.md 3.7): seeded useful and
 * disposable rows, days `0..days` of product retention runs on the simulated
 * clock, and the held-out questions asked at `T + 12 h` of their day. A
 * stored row a question needs is used through `recordUse` (exposure, what the
 * product counts). The same rows, days and questions also run through the
 * pure baselines (no lifecycle, age-only, oracle).
 *
 * Expected today (recorded, not hidden): false-delete > 0 (forensics M4: the
 * age-only archive and delete never read usefulness); the verdict is `fail`.
 */

import {
  ageOnlyPolicy,
  noLifecyclePolicy,
  oracleRetentionPolicy,
  type RetentionPolicy,
  type RetentionPolicyRow,
  type RetentionPolicySettings,
} from '../../baselines/retention-policies';
import type { CurationDetails } from '../../memory-skills-suite-kinds';
import { rate, type Rate } from '../../metrics/curation-metrics';
import type { CaseRecord } from '../../runner/suite-result';
import { deltaOf, inputSha256, rateMetrics } from './memory-suite-support';
import { MEMORY_FACT_KINDS, type RetentionSeedRow } from './retention-seed';
import {
  CallLedger,
  DAY_MS,
  RETENTION_EPOCHS,
  RETENTION_GROUND_TRUTH,
  installSimulatedClock,
  runCounts,
  runNaReason,
  seedRows,
  type RetentionRunSummary,
  type RetentionSuiteInput,
  type RetentionSuiteOutput,
  type SimulatedClock,
} from './retention-support';

export const RETENTION_LIFECYCLE_SUITE_ID = 'mem.retention.lifecycle';

/** What happened to one row in one simulation (product or pure policy). */
export interface RowFate {
  /** Day the row left the store (deleted or evicted); `null` while stored. */
  readonly removedDay: number | null;
  /** Useful rows: the row's state when its question was asked. */
  readonly atQuestion: 'kept' | 'archived' | 'removed' | null;
}

type FateClass = 'kept' | 'archived' | 'removed' | 'retained';

function fateClass(row: RetentionSeedRow, fate: RowFate): FateClass {
  if (row.useful) return fate.atQuestion ?? 'removed';
  return fate.removedDay === null ? 'retained' : 'removed';
}

function questionsByDay(
  rows: readonly RetentionSeedRow[],
): Map<number, RetentionSeedRow[]> {
  const byDay = new Map<number, RetentionSeedRow[]>();
  for (const row of rows) {
    if (row.questionDay === null) continue;
    const list = byDay.get(row.questionDay) ?? [];
    list.push(row);
    byDay.set(row.questionDay, list);
  }
  return byDay;
}

/**
 * A pure policy over the same rows, days and question schedule as the
 * product run: decide at `T`, ask at `T + 12 h`, and a use moves the row back
 * to `recall` with `last_used_at` = now and one more hit, as `recordUse` does
 * (`memory.store.ts:655-690`).
 */
export function simulatePolicy(
  rows: readonly RetentionSeedRow[],
  policy: RetentionPolicy,
  settings: RetentionPolicySettings,
  days: number,
  epoch: number,
): Map<string, RowFate> {
  const state = new Map<string, RetentionPolicyRow>(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        tier: 'recall',
        workspaceRoot: 'seed',
        lastUsedAtMs: epoch - row.lastUsedAgeDays * DAY_MS,
        archivedAtMs: null,
        pinned: false,
        hits: row.hits,
        kind: row.kind,
        useful: row.useful,
      },
    ]),
  );
  const removed = new Map<string, number>();
  const atQuestion = new Map<string, RowFate['atQuestion']>();
  const asked = questionsByDay(rows);
  for (let day = 0; day <= days; day += 1) {
    const at = epoch + day * DAY_MS;
    const decision = policy([...state.values()], at, settings);
    for (const id of [...decision.deleted, ...decision.evicted]) {
      state.delete(id);
      removed.set(id, day);
    }
    for (const id of decision.archived) {
      const row = state.get(id);
      if (row !== undefined) {
        state.set(id, { ...row, tier: 'archival', archivedAtMs: at });
      }
    }
    const askedAt = at + DAY_MS / 2;
    for (const row of asked.get(day) ?? []) {
      const current = state.get(row.id);
      atQuestion.set(
        row.id,
        current === undefined
          ? 'removed'
          : current.tier === 'archival'
            ? 'archived'
            : 'kept',
      );
      if (current !== undefined) {
        state.set(row.id, {
          ...current,
          tier: current.tier === 'archival' ? 'recall' : current.tier,
          archivedAtMs: null,
          lastUsedAtMs: askedAt,
          hits: current.hits + 1,
        });
      }
    }
  }
  return new Map(
    rows.map((row) => [
      row.id,
      {
        removedDay: removed.get(row.id) ?? null,
        atQuestion: atQuestion.get(row.id) ?? null,
      },
    ]),
  );
}

interface ProductLifecycleRun {
  readonly fates: Map<string, RowFate>;
  readonly runs: RetentionRunSummary[];
  readonly bytes: { day: number; bytes: number }[];
}

async function simulateProductLifecycle(
  input: RetentionSuiteInput,
  clock: SimulatedClock,
  ledger: CallLedger,
): Promise<ProductLifecycleRun> {
  const { port, seed, workspaceRoot } = input;
  const epoch = RETENTION_EPOCHS.lifecycle;
  const ids = await seedRows(port, clock, ledger, seed, workspaceRoot, epoch);
  const asked = questionsByDay(seed);
  const removed = new Map<string, number>();
  const atQuestion = new Map<string, RowFate['atQuestion']>();
  const runs: RetentionRunSummary[] = [];
  const bytes: { day: number; bytes: number }[] = [];
  for (let day = 0; day <= input.options.days; day += 1) {
    const at = epoch + day * DAY_MS;
    clock.set(at);
    runs.push(await ledger.timedRun(() => port.runRetention(at)));
    bytes.push({ day, bytes: port.dbBytes() });
    const stored = new Map(
      port.memoryStates(workspaceRoot).map((state) => [state.memoryId, state]),
    );
    for (const row of seed) {
      const memoryId = ids.get(row.id) ?? '';
      if (!removed.has(row.id) && !stored.has(memoryId)) {
        removed.set(row.id, day);
      }
    }
    clock.set(at + DAY_MS / 2);
    for (const row of asked.get(day) ?? []) {
      const memoryId = ids.get(row.id) ?? '';
      const state = stored.get(memoryId);
      atQuestion.set(
        row.id,
        state === undefined
          ? 'removed'
          : state.tier === 'archival'
            ? 'archived'
            : 'kept',
      );
      if (state !== undefined) {
        port.recordUse([memoryId]);
        ledger.calls += 1;
      }
    }
  }
  return {
    fates: new Map(
      seed.map((row) => [
        row.id,
        {
          removedDay: removed.get(row.id) ?? null,
          atQuestion: atQuestion.get(row.id) ?? null,
        },
      ]),
    ),
    runs,
    bytes,
  };
}

/** The 3.7 lifecycle metrics of one simulation. */
export interface LifecycleSummary {
  readonly falseDelete: Rate;
  readonly falseRetain: Rate;
  readonly archivedThenNeeded: Rate;
  readonly byKind: Record<string, { falseDelete: Rate; falseRetain: Rate }>;
  /** Positive class "removed": tp disposable removed, fp useful lost, fn disposable kept, tn useful kept. */
  readonly removedConfusion: { tp: number; fp: number; fn: number; tn: number };
}

export function summarizeLifecycle(
  rows: readonly RetentionSeedRow[],
  fates: ReadonlyMap<string, RowFate>,
): LifecycleSummary {
  const fateOf = (row: RetentionSeedRow): RowFate => {
    const fate = fates.get(row.id);
    if (fate === undefined) throw new Error(`no fate for seed row ${row.id}`);
    return fate;
  };
  const useful = rows.filter((row) => row.useful);
  const disposable = rows.filter((row) => !row.useful);
  const lost = (row: RetentionSeedRow): boolean =>
    fateOf(row).atQuestion === 'removed';
  const retained = (row: RetentionSeedRow): boolean =>
    fateOf(row).removedDay === null;
  const byKind: LifecycleSummary['byKind'] = {};
  for (const kind of MEMORY_FACT_KINDS) {
    const usefulOfKind = useful.filter((row) => row.kind === kind);
    const disposableOfKind = disposable.filter((row) => row.kind === kind);
    if (usefulOfKind.length + disposableOfKind.length === 0) continue;
    byKind[kind] = {
      falseDelete: rate(usefulOfKind.filter(lost).length, usefulOfKind.length),
      falseRetain: rate(
        disposableOfKind.filter(retained).length,
        disposableOfKind.length,
      ),
    };
  }
  const usefulLost = useful.filter(lost).length;
  const disposableKept = disposable.filter(retained).length;
  return {
    falseDelete: rate(usefulLost, useful.length),
    falseRetain: rate(disposableKept, disposable.length),
    archivedThenNeeded: rate(
      useful.filter((row) => fateOf(row).atQuestion === 'archived').length,
      useful.length,
    ),
    byKind,
    removedConfusion: {
      tp: disposable.length - disposableKept,
      fp: usefulLost,
      fn: disposableKept,
      tn: useful.length - usefulLost,
    },
  };
}

function lifecycleMetrics(
  summary: LifecycleSummary,
): Record<string, number | null> {
  const metrics: Record<string, number | null> = {
    ...rateMetrics('falseDelete', summary.falseDelete),
    ...rateMetrics('falseRetain', summary.falseRetain),
    ...rateMetrics('archivedThenNeeded', summary.archivedThenNeeded),
  };
  for (const [kind, counts] of Object.entries(summary.byKind)) {
    Object.assign(
      metrics,
      rateMetrics(`byKind.${kind}.falseDelete`, counts.falseDelete),
      rateMetrics(`byKind.${kind}.falseRetain`, counts.falseRetain),
    );
  }
  return metrics;
}

function describeFate(row: RetentionSeedRow, fate: RowFate): string {
  const removed =
    fate.removedDay === null
      ? 'still stored'
      : `removed on day ${fate.removedDay}`;
  return row.useful
    ? `${fate.atQuestion ?? 'not asked'} on question day ${row.questionDay}; ${removed}`
    : removed;
}

const LIFECYCLE_BASELINES: readonly {
  id: string;
  label: string;
  policy: RetentionPolicy;
}[] = [
  {
    id: 'no-lifecycle',
    label: 'no lifecycle (nothing archived or deleted)',
    policy: noLifecyclePolicy,
  },
  {
    id: 'age-only',
    label: 'age-only, pure (the current decision re-implemented)',
    policy: ageOnlyPolicy,
  },
  {
    id: 'oracle',
    label:
      'oracle: age-only with useful and hits>0 rows protected (ceiling, not a product path)',
    policy: oracleRetentionPolicy,
  },
];

export async function runRetentionLifecycle(
  input: RetentionSuiteInput,
): Promise<RetentionSuiteOutput> {
  const ledger = new CallLedger();
  const clock = installSimulatedClock(RETENTION_EPOCHS.lifecycle);
  let product: ProductLifecycleRun;
  try {
    product = await simulateProductLifecycle(input, clock, ledger);
  } finally {
    clock.restore();
  }
  const settings = input.port.lifecycleSettings();
  const baselines = LIFECYCLE_BASELINES.map((baseline) => ({
    ...baseline,
    fates: simulatePolicy(
      input.seed,
      baseline.policy,
      settings,
      input.options.days,
      RETENTION_EPOCHS.lifecycle,
    ),
  }));
  const ageOnly = baselines.find((baseline) => baseline.id === 'age-only');
  if (ageOnly === undefined) throw new Error('age-only baseline missing');

  const fateOf = (
    fates: ReadonlyMap<string, RowFate>,
    row: RetentionSeedRow,
  ): RowFate => {
    const fate = fates.get(row.id);
    if (fate === undefined) throw new Error(`no fate for seed row ${row.id}`);
    return fate;
  };
  const passes = (row: RetentionSeedRow, fate: RowFate): boolean =>
    row.useful ? fate.atQuestion !== 'removed' : fate.removedDay !== null;
  const cases: CaseRecord[] = input.seed.map((row) => {
    const fate = fateOf(product.fates, row);
    return {
      caseId: `row/${row.id}`,
      inputSha256: inputSha256({ row, days: input.options.days }),
      expected: row.useful
        ? `stored when asked on day ${row.questionDay}`
        : `removed by day ${input.options.days}`,
      observed: describeFate(row, fate),
      outcome: passes(row, fate) ? 'pass' : 'fail',
      baselineOutcomes: Object.fromEntries(
        baselines.map((baseline) => [
          baseline.id,
          passes(row, fateOf(baseline.fates, row)) ? 'pass' : 'fail',
        ]),
      ),
      cassetteKey: null,
      latencyMs: 0,
      error: null,
    };
  });

  const summary = summarizeLifecycle(input.seed, product.fates);
  const agreement = rate(
    input.seed.filter(
      (row) =>
        fateClass(row, fateOf(product.fates, row)) ===
        fateClass(row, fateOf(ageOnly.fates, row)),
    ).length,
    input.seed.length,
  );
  const productMetrics = lifecycleMetrics(summary);
  const baselineEntries = baselines.map((baseline) => ({
    id: baseline.id,
    label: baseline.label,
    metrics: lifecycleMetrics(summarizeLifecycle(input.seed, baseline.fates)),
  }));
  const naReason = runNaReason(product.runs);
  const pass = summary.falseDelete.num === 0 && summary.falseRetain.num === 0;
  const { removedConfusion } = summary;
  const details: CurationDetails = {
    operation: 'retention',
    policy: 'current',
    simulatedDays: input.options.days,
    falseDelete: removedConfusion,
    // Positive class "retained": tp useful kept, fp disposable kept, fn useful lost, tn disposable removed.
    falseRetain: {
      tp: removedConfusion.tn,
      fp: removedConfusion.fn,
      fn: removedConfusion.fp,
      tn: removedConfusion.tp,
    },
    byKind: Object.fromEntries(
      Object.entries(summary.byKind).map(([kind, counts]) => [
        kind,
        {
          falseDelete: counts.falseDelete.num,
          falseRetain: counts.falseRetain.num,
        },
      ]),
    ),
    archivedThenNeeded: summary.archivedThenNeeded.num,
    unprocessedObservationsDeleted: 0,
    dbBytesByDay: product.bytes,
  };
  return {
    cases,
    result: {
      suiteId: RETENTION_LIFECYCLE_SUITE_ID,
      kind: 'curation',
      details,
      claim: {
        source: 'ledger',
        ref: 'feature-evidence: memory age lifecycle (443, PR #521); libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.ts:80-191',
        text: 'Old unused rows leave; rows that are still useful stay.',
      },
      groundTruth: RETENTION_GROUND_TRUTH,
      baselines: baselineEntries,
      deltas: Object.fromEntries(
        baselineEntries.map((entry) => [
          entry.id,
          deltaOf(productMetrics, entry.metrics),
        ]),
      ),
      cost: ledger.cost(cases),
      modelCalls: 0,
      verdict: naReason !== undefined ? 'na' : pass ? 'pass' : 'fail',
      ...(naReason === undefined ? {} : { naReason }),
      metrics: {
        ...productMetrics,
        ...rateMetrics('ageOnlyAgreement', agreement),
        ...runCounts(product.runs),
        rows: input.seed.length,
        usefulRows: input.seed.filter((row) => row.useful).length,
      },
      cassetteVersion: null,
    },
  };
}
