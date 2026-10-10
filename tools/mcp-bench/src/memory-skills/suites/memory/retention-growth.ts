/**
 * `mem.retention.growth` (benchmark-design.md 3.7): a synthetic observation
 * load per simulated day, one product curation pass per session, and one
 * product retention run per day with the DB size after its reclaim step.
 * On the stall days (default 9, days 20-28) the replay double returns the
 * stall outcome (`'stalled'`, provider-unreachable): the M2 outage reproduced
 * deterministically.
 *
 * Expected today: stalled sessions remain visible to a later curation pass;
 * retention counts stale unprocessed rows but does not delete them.
 */

import type { CurationDetails } from '../../memory-skills-suite-kinds';
import { rate } from '../../metrics/curation-metrics';
import type { CaseRecord } from '../../runner/suite-result';
import { deltaOf, inputSha256, rateMetrics } from './memory-suite-support';
import {
  CallLedger,
  DAY_MS,
  HOUR_MS,
  RETENTION_EPOCHS,
  installSimulatedClock,
  pad,
  runCounts,
  runNaReason,
  type ObservationLoadRow,
  type RetentionRunSummary,
  type RetentionSuiteInput,
  type RetentionSuiteOutput,
} from './retention-support';

export const RETENTION_GROWTH_SUITE_ID = 'mem.retention.growth';

/**
 * Share the DB may grow over the second half of the growth simulation and
 * still count as bounded: a steady load reaches a steady state within the
 * processed-purge window, so day `days` may differ from day `days / 2` only
 * by page-allocation noise.
 */
export const GROWTH_TOLERANCE = 0.05;

function sessionIdOf(day: number, index: number): string {
  return `retention-growth-d${pad(day)}-s${index + 1}`;
}

/** The marker the replay double keys its stall on (`liveness-harness.ts`). */
function markerOf(day: number, index: number): string {
  return `LV-g${pad(day)}s${index + 1}`;
}

/** Deterministic observation load of one synthetic session. */
export function observationLoad(
  marker: string,
  count: number,
  payloadBytes: number,
): ObservationLoadRow[] {
  const prompt: ObservationLoadRow = {
    kind: 'user-prompt',
    text: `Keep this for later (${marker}): the growth fixture session asked for a durable note.`,
  };
  const unit = `${marker} tool output line. `;
  const payload = unit
    .repeat(Math.ceil(payloadBytes / unit.length))
    .slice(0, payloadBytes);
  return [
    prompt,
    ...Array.from({ length: count - 1 }, (): ObservationLoadRow => ({
      kind: 'tool-use',
      text: payload,
    })),
  ];
}

export async function runRetentionGrowth(
  input: RetentionSuiteInput,
): Promise<RetentionSuiteOutput> {
  const { port, options } = input;
  const { growth } = options;
  const stallEnd = growth.stall.startDay + growth.stall.days;
  const inStall = (day: number): boolean =>
    day >= growth.stall.startDay && day < stallEnd;
  const ledger = new CallLedger();
  const epoch = RETENTION_EPOCHS.growth;
  const clock = installSimulatedClock(epoch);
  const cases: CaseRecord[] = [];
  const bytes: { day: number; bytes: number }[] = [];
  const runs: RetentionRunSummary[] = [];
  const pending = new Set<string>();
  const sessions: string[] = [];
  const outcomes = { ran: 0, stalled: 0, failed: 0, threw: 0 };
  let unprocessedDeleted = 0;
  const unprocessedOf = (ids: Iterable<string>): number => {
    let total = 0;
    for (const id of ids) total += port.unprocessed(id);
    return total;
  };
  try {
    for (let day = 0; day <= options.days; day += 1) {
      const at = epoch + day * DAY_MS;
      clock.set(at);
      const before = unprocessedOf(pending);
      const run = await ledger.timedRun(() => port.runRetention(at));
      runs.push(run);
      const after = unprocessedOf(pending);
      // Retention never writes processed_at (memory-retention.service.ts:29-30),
      // so every unprocessed row that left during the run was deleted.
      const deleted = before - after;
      if (deleted < 0) {
        throw new Error(
          `day ${day}: unprocessed observations grew during a retention run`,
        );
      }
      unprocessedDeleted += deleted;
      const dayBytes = port.dbBytes();
      bytes.push({ day, bytes: dayBytes });

      clock.set(at + HOUR_MS);
      const today: { id: string; marker: string }[] = [];
      for (let index = 0; index < growth.sessionsPerDay; index += 1) {
        const id = sessionIdOf(day, index);
        const marker = markerOf(day, index);
        port.enqueueObservations(
          id,
          observationLoad(
            marker,
            growth.observationsPerSession,
            growth.payloadBytes,
          ),
        );
        sessions.push(id);
        today.push({ id, marker });
      }
      clock.set(at + 2 * HOUR_MS);
      const stalled = inStall(day);
      const dayOutcomes = { ran: 0, stalled: 0, failed: 0, threw: 0 };
      for (const session of today) {
        const outcome = await port.curate(session.id, session.marker, stalled);
        ledger.calls += 1;
        dayOutcomes[outcome] += 1;
        outcomes[outcome] += 1;
        if (port.unprocessed(session.id) > 0) pending.add(session.id);
      }
      for (const id of [...pending]) {
        if (port.unprocessed(id) === 0) pending.delete(id);
      }
      const runOk = run.status === 'completed' || run.status === 'partial';
      cases.push({
        caseId: `day/${pad(day)}`,
        inputSha256: inputSha256({ day, growth, stalled }),
        expected: 'retention run completes; 0 unprocessed observations deleted',
        observed:
          `retention ${run.status}${run.reason === null ? '' : ` (${run.reason})`}; ` +
          `${deleted} unprocessed deleted; passes ${dayOutcomes.ran} ran, ` +
          `${dayOutcomes.stalled} stalled, ${dayOutcomes.failed} failed, ` +
          `${dayOutcomes.threw} threw` +
          `${stalled ? ' (stall day)' : ''}; ${dayBytes} bytes`,
        outcome: deleted === 0 && runOk ? 'pass' : 'fail',
        cassetteKey: null,
        latencyMs: ledger.runMs[ledger.runMs.length - 1] ?? 0,
        error: null,
      });
    }
  } finally {
    clock.restore();
  }

  const enqueued =
    (options.days + 1) * growth.sessionsPerDay * growth.observationsPerSession;
  const rowsAtEnd = sessions.reduce(
    (sum, id) => sum + port.observationRows(id),
    0,
  );
  const mid = bytes[Math.floor(options.days / 2)]?.bytes ?? 0;
  const last = bytes[bytes.length - 1]?.bytes ?? 0;
  const bounded = last <= mid * (1 + GROWTH_TOLERANCE);
  const deletedRate = rate(unprocessedDeleted, enqueued);
  const productMetrics: Record<string, number | null> = {
    ...rateMetrics('unprocessedDeleted', deletedRate),
    unprocessedObservationsDeleted: unprocessedDeleted,
    observationRowsAtEnd: rowsAtEnd,
  };
  const noRetention = {
    ...rateMetrics('unprocessedDeleted', rate(0, enqueued)),
    unprocessedObservationsDeleted: 0,
    observationRowsAtEnd: enqueued,
  };
  const naReason =
    runNaReason(runs) ??
    (outcomes.threw > 0
      ? `curate-threw: ${outcomes.threw}`
      : outcomes.ran === 0
        ? 'no-pass-ran'
        : undefined);
  const pass = unprocessedDeleted === 0 && bounded;
  const zero = { tp: 0, fp: 0, fn: 0 };
  const details: CurationDetails = {
    operation: 'retention',
    policy: 'current',
    simulatedDays: options.days,
    // The growth suite seeds no labelled memory rows: no delete/retain decision is scored here.
    falseDelete: zero,
    falseRetain: zero,
    byKind: {},
    archivedThenNeeded: 0,
    unprocessedObservationsDeleted: unprocessedDeleted,
    dbBytesByDay: bytes,
  };
  return {
    cases,
    result: {
      suiteId: RETENTION_GROWTH_SUITE_ID,
      kind: 'curation',
      details,
      claim: {
        source: 'ledger',
        ref: 'feature-evidence: retention job, stale-row visibility, vacuum (440, TASK_2026_621); libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:1-30',
        text: 'DB growth is bounded; no useful memory is lost.',
      },
      groundTruth: {
        id: 'retention-growth-load',
        version: 'v1',
        method: 'generated',
      },
      baselines: [
        {
          id: 'no-retention',
          label: 'no retention (nothing purged, retained or deleted)',
          metrics: noRetention,
        },
      ],
      deltas: { 'no-retention': deltaOf(productMetrics, noRetention) },
      cost: ledger.cost(cases),
      modelCalls: 0,
      verdict: naReason !== undefined ? 'na' : pass ? 'pass' : 'fail',
      ...(naReason === undefined ? {} : { naReason }),
      metrics: {
        ...productMetrics,
        observationsEnqueued: enqueued,
        'dbBytes.day0': bytes[0]?.bytes ?? null,
        'dbBytes.mid': mid,
        'dbBytes.final': last,
        'dbBytes.max': bytes.reduce(
          (max, entry) => Math.max(max, entry.bytes),
          0,
        ),
        bounded: bounded ? 1 : 0,
        'passes.ran': outcomes.ran,
        'passes.stalled': outcomes.stalled,
        'passes.failed': outcomes.failed,
        'passes.threw': outcomes.threw,
        stallDays: growth.stall.days,
        ...runCounts(runs),
      },
      cassetteVersion: null,
    },
  };
}
