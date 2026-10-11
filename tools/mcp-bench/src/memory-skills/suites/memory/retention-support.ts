/**
 * What the retention suites (`retention.suite.ts`, benchmark-design.md 3.7)
 * share: the product port they drive, the simulated clock, the plan options
 * and seed loading, and the run ledger.
 *
 * Clock. Each suite injects `nowMs` for simulated days `0..days` (default
 * 180): `MemoryRetentionService.run({ now })` gets the day's instant, and
 * `Date.now` is replaced by the same simulated clock for the suite's
 * duration ({@link installSimulatedClock}) because the product stamps
 * `created_at`, `last_used_at` (`MemoryStore.recordUse`), `captured_at`
 * (`ObservationQueueStore.enqueue`) and the roster's rank instant from
 * `Date.now()`. The suite restores it in its own `finally`. Day 0 of each
 * suite is a fixed instant in the 2100s, the product's own retention specs do
 * the same (`memory-retention.integration.spec.ts:59-60`): the service's
 * boot-deferral gate compares the injected clock with the real time it was
 * constructed at, so a fixed past instant would keep every run deferred.
 * Each suite has its own epoch a year apart, so a later suite in the same host
 * is never `not-due` behind an earlier suite's last run.
 *
 * Imports only Node, zod and modules the runner parent may load.
 */

import { z } from 'zod';

import { p50Latency, p95Latency } from '../../../metrics/cost-metrics';
import type {
  RetentionPolicySettings,
  RetentionTier,
} from '../../baselines/retention-policies';
import { factSchema, type Fact } from '../../ground-truth/label-schemas';
import { rate } from '../../metrics/curation-metrics';
import type { CaseRecord, SuiteResultInput } from '../../runner/suite-result';
import { parseJsonLines, resolveHomeFile } from './memory-suite-support';
import {
  buildRetentionSeed,
  checkSeed,
  DEFAULT_USAGE_DISTRIBUTION,
  retentionSeedRowSchema,
  usageDistributionSchema,
  type DistractorRecord,
  type RetentionSeedRow,
} from './retention-seed';

export const DAY_MS = 24 * 60 * 60 * 1_000;
export const HOUR_MS = 60 * 60 * 1_000;

/** Day 0 of each suite (see the module header). */
export const RETENTION_EPOCHS = {
  lifecycle: Date.UTC(2100, 0, 1),
  growth: Date.UTC(2101, 0, 1),
  roster: Date.UTC(2102, 0, 1),
} as const;

// ---------------------------------------------------------------- port

/** One retention run as the suites read it (`MemoryRetentionReport`). */
export interface RetentionRunSummary {
  readonly status: 'completed' | 'partial' | 'failed' | 'skipped';
  readonly reason: string | null;
  readonly archived: number;
  readonly deleted: number;
  readonly evicted: number;
  /** Unprocessed rows older than `stuckDays`; retention keeps them visible. */
  readonly stuckKept: number | null;
  readonly processedPurged: number;
  readonly lifecycleNote: 'disabled' | 'vec-unavailable' | null;
}

export interface SeedMemoryInsert {
  readonly workspaceRoot: string;
  readonly kind: RetentionSeedRow['kind'];
  readonly subject: string;
  readonly content: string;
  readonly salience: number;
}

export interface StoredMemoryState {
  readonly memoryId: string;
  readonly tier: RetentionTier;
}

/** One synthetic observation of the growth load. */
export interface ObservationLoadRow {
  readonly kind: 'user-prompt' | 'tool-use';
  readonly text: string;
}

/** Includes the product's handled curation outcomes plus a harness throw. */
export type CurateOutcome = 'ran' | 'stalled' | 'failed' | 'threw';

/** The product surface the three suites drive. */
export interface RetentionPort {
  /** The lifecycle thresholds the product run decides by, for the pure baselines. */
  lifecycleSettings(): RetentionPolicySettings;
  /** `MemoryStore.insertMemoryWithChunks`; `created_at`/`last_used_at` = `Date.now()`. */
  insertMemory(insert: SeedMemoryInsert): Promise<string>;
  /** `MemoryStore.recordUse` at `Date.now()`. */
  recordUse(memoryIds: readonly string[]): void;
  /** Every stored, non-quarantined row under the exact key. */
  memoryStates(workspaceRoot: string): readonly StoredMemoryState[];
  /** `MemoryRetentionService.run({ now: () => nowMs })`, gates open. */
  runRetention(nowMs: number): Promise<RetentionRunSummary>;
  /** `page_count * page_size` of the bench DB. */
  dbBytes(): number;
  /** The workspace key the observation path curates under. */
  readonly observationWorkspaceRoot: string;
  /** `ObservationQueueStore.enqueue` per row, then `flush`. */
  enqueueObservations(
    sessionId: string,
    rows: readonly ObservationLoadRow[],
  ): void;
  /** One observation pass for the session; `stalled` makes the double return the stall outcome. */
  curate(
    sessionId: string,
    marker: string,
    stalled: boolean,
  ): Promise<CurateOutcome>;
  /** Unprocessed observation rows of the session. */
  unprocessed(sessionId: string): number;
  /** Observation rows of the session in any state. */
  observationRows(sessionId: string): number;
  /** `MemoryPromptInjector.buildSessionStartBlock`. */
  buildSessionStartBlock(workspaceRoot: string): Promise<string>;
}

// ---------------------------------------------------------------- clock

/** `Date.now` replaced by a settable simulated instant. */
export interface SimulatedClock {
  set(nowMs: number): void;
  restore(): void;
}

/** Install the simulated clock; the caller restores it in `finally`. */
export function installSimulatedClock(startMs: number): SimulatedClock {
  const original = Date.now;
  let current = startMs;
  Date.now = () => current;
  return {
    set: (nowMs) => {
      current = nowMs;
    },
    restore: () => {
      Date.now = original;
    },
  };
}

// ---------------------------------------------------------------- options

const nonEmpty = z.string().min(1);

export const retentionOptionsSchema = z.strictObject({
  /** `memory-facts.v1.jsonl` in the isolated home (home-relative). */
  factsFile: nonEmpty.default('memory-skills/memory-facts.v1.jsonl'),
  /** `distractors.v1.jsonl`; its `distractor` records are the disposable rows. */
  distractorsFile: nonEmpty.default('memory-skills/distractors.v1.jsonl'),
  /** Labelled seed rows (`retentionSeedRowSchema` lines); replaces the two files above. */
  rowsFile: nonEmpty.optional(),
  seed: nonEmpty.default('TASK_2026_620:retention'),
  days: z.number().int().min(1).max(365).default(180),
  usage: z
    .strictObject({
      useful: usageDistributionSchema.optional(),
      disposable: usageDistributionSchema.optional(),
    })
    .default({}),
  growth: z
    .strictObject({
      sessionsPerDay: z.number().int().min(1).max(15).default(4),
      /** Below the trigger's 20-turn threshold, so no product timer curates them. */
      observationsPerSession: z.number().int().min(1).max(19).default(10),
      /** `tool_response_text` bytes of each tool-use observation. */
      payloadBytes: z.number().int().min(16).max(65_536).default(2_048),
      stall: z
        .strictObject({
          startDay: z.number().int().min(0).default(20),
          days: z.number().int().min(0).default(9),
        })
        .default({ startDay: 20, days: 9 }),
    })
    .default({
      sessionsPerDay: 4,
      observationsPerSession: 10,
      payloadBytes: 2_048,
      stall: { startDay: 20, days: 9 },
    }),
});
export type RetentionOptions = z.infer<typeof retentionOptionsSchema>;

const distractorLineSchema = z.object({
  kind: z.literal('distractor'),
  id: nonEmpty,
  text: nonEmpty,
});

/** The seed rows the plan asks for, validated. */
export function loadRetentionSeed(
  home: string,
  options: RetentionOptions,
): RetentionSeedRow[] {
  if (options.rowsFile !== undefined) {
    return checkSeed(
      parseJsonLines(resolveHomeFile(home, options.rowsFile)).map((line) =>
        retentionSeedRowSchema.parse(line),
      ),
      options.days,
    );
  }
  const facts: Fact[] = parseJsonLines(
    resolveHomeFile(home, options.factsFile),
  ).map((line) => factSchema.parse(line));
  const distractors: DistractorRecord[] = parseJsonLines(
    resolveHomeFile(home, options.distractorsFile),
  ).flatMap((line) => {
    const parsed = distractorLineSchema.safeParse(line);
    return parsed.success
      ? [{ id: parsed.data.id, text: parsed.data.text }]
      : [];
  });
  return buildRetentionSeed({
    facts,
    distractors,
    seed: options.seed,
    days: options.days,
    usage: {
      useful: options.usage.useful ?? DEFAULT_USAGE_DISTRIBUTION,
      disposable: options.usage.disposable ?? DEFAULT_USAGE_DISTRIBUTION,
    },
  });
}

// ---------------------------------------------------------------- shared

export const RETENTION_GROUND_TRUTH = {
  id: 'gt-memory-retention',
  version: 'v1',
  method: 'seeded',
} as const;

export interface RetentionSuiteInput {
  readonly port: RetentionPort;
  readonly options: RetentionOptions;
  readonly seed: readonly RetentionSeedRow[];
  /** Exact key the suite's rows are stored under; never printed. */
  readonly workspaceRoot: string;
}

export interface RetentionSuiteOutput {
  readonly result: SuiteResultInput;
  readonly cases: CaseRecord[];
}

/** Product calls and the per-run latencies the `cost` block reports. */
export class CallLedger {
  calls = 0;
  readonly runMs: number[] = [];

  async timedRun<T>(work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await work();
    } finally {
      this.runMs.push(performance.now() - started);
      this.calls += 1;
    }
  }

  cost(cases: readonly CaseRecord[]): SuiteResultInput['cost'] {
    const errored = cases.filter((record) => record.error != null).length;
    return {
      calls: this.calls,
      latency_ms: {
        p50: p50Latency(this.runMs) ?? null,
        p95: p95Latency(this.runMs) ?? null,
      },
      error_rate: rate(errored, cases.length).value,
      tokens: {},
    };
  }
}

/** Why a retention run makes the measurement not a measurement of the policy. */
export function runNaReason(
  runs: readonly RetentionRunSummary[],
): string | undefined {
  const broken = runs.find(
    (run) => run.status === 'skipped' || run.status === 'failed',
  );
  if (broken !== undefined) {
    return `retention-run-${broken.status}: ${broken.reason ?? 'no reason'}`;
  }
  const noted = runs.find((run) => run.lifecycleNote !== null);
  return noted === undefined
    ? undefined
    : `lifecycle-${noted.lifecycleNote ?? ''}`;
}

export function runCounts(
  runs: readonly RetentionRunSummary[],
): Record<string, number> {
  const count = (status: RetentionRunSummary['status']): number =>
    runs.filter((run) => run.status === status).length;
  return {
    'runs.completed': count('completed'),
    'runs.partial': count('partial'),
    'runs.failed': count('failed'),
    'runs.skipped': count('skipped'),
  };
}

export function pad(day: number): string {
  return String(day).padStart(3, '0');
}

export async function seedRows(
  port: RetentionPort,
  clock: SimulatedClock,
  ledger: CallLedger,
  rows: readonly RetentionSeedRow[],
  workspaceRoot: string,
  epoch: number,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const row of rows) {
    // created_at and last_used_at are the product's Date.now(); recordUse
    // stamps the same instant, so every seeded hit leaves last_used_at there.
    clock.set(epoch - row.lastUsedAgeDays * DAY_MS);
    const memoryId = await port.insertMemory({
      workspaceRoot,
      kind: row.kind,
      subject: row.subject,
      content: row.content,
      salience: row.salience,
    });
    ledger.calls += 1;
    for (let hit = 0; hit < row.hits; hit += 1) {
      port.recordUse([memoryId]);
      ledger.calls += 1;
    }
    ids.set(row.id, memoryId);
  }
  return ids;
}
