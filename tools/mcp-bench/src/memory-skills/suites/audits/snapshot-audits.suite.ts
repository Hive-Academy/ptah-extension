/**
 * `mem.liveness.audit` and `skill.backlog.audit` (benchmark-design.md
 * :202-203, :283-288; R-M1a carve-out). LOCAL host suites over a release DB
 * snapshot: never a CI suite, because the snapshot is private user data.
 *
 * Safety:
 *   - the snapshot is read only from a COPY inside the bench host's isolated
 *     home: the plan lists it as a `file` fixture, the host's fixture seeder
 *     copies and hash-checks it before the engine boots, and the suite
 *     resolves the path with `resolveHomeFile`, which refuses anything outside
 *     the home. The original in the bench data folder is never opened;
 *   - the copy is opened `readonly` + `fileMustExist` through
 *     `withReadonlySnapshot` (`data/candidate-row-diff.ts`), which checks the
 *     expected sha256 before reading and fails if the hash changed or a
 *     sidecar appeared while reading;
 *   - only SELECT statements; ground truth is the rows themselves
 *     (`observation_queue`, `memories`, `skill_synthesis_queue`,
 *     `skill_candidates`), never the product's own counters
 *     (`memory_retention_state`, `skill_backlog_cleanup_state`, the Thoth
 *     tile).
 *
 * Schema assumption (design :203), checked against the migrations:
 * `observation_queue.session_id TEXT NOT NULL`
 * (`libs/backend/persistence-sqlite/src/lib/migrations/0016_observation_queue.ts:19`,
 * index `:32`), `memories.session_id TEXT` (`0002_memory.ts:14`, index
 * `:30`), written from the curated session's id
 * (`libs/backend/memory-curator/src/lib/memory-curator.service.ts:864-866`).
 * Migration 0051 (`0051_skill_lifecycle.ts`) touches neither table. The audit
 * also reports the share of memory rows that carry a session id, so a
 * snapshot where the join cannot hold shows it.
 *
 * Not measurable from a snapshot, reported as `null` (never as a pass): the
 * extraction-pass error share and the count of `'ran'` passes carrying an
 * error. Curator passes are kept in an in-memory ring buffer
 * (`libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts:1-15`)
 * and no table records them.
 *
 * "As of" is the newest timestamp the snapshot holds (or `options.asOf`), so
 * the result never depends on when the audit runs.
 */

import { z } from 'zod';

import {
  FROZEN_SNAPSHOT_FILE,
  FROZEN_SNAPSHOT_SHA256,
  withReadonlySnapshot,
  type ReadonlySqlite,
} from '../../data/candidate-row-diff';
import { sha256HexSchema } from '../../ground-truth/label-schemas';
import type {
  MemorySkillsHostSuite,
  MemorySkillsHostSuiteContext,
} from '../../host/memory-skills-host';
import type {
  FunnelDetails,
  LivenessDetails,
} from '../../memory-skills-suite-kinds';
import { rate } from '../../metrics/curation-metrics';
import {
  writeSuiteResult,
  type CaseRecord,
  type SuiteResultInput,
} from '../../runner/suite-result';
import {
  deltaOf,
  inputSha256,
  rateMetrics,
  resolveHomeFile,
} from '../memory/memory-suite-support';

export const LIVENESS_AUDIT_SUITE_ID = 'mem.liveness.audit';
export const BACKLOG_AUDIT_SUITE_ID = 'skill.backlog.audit';

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** Invariants (design :203, :288 and S4). */
export const UNPROCESSED_AGE_P95_LIMIT_MS = 24 * HOUR_MS;
export const SESSION_GRACE_MS = 24 * HOUR_MS;
export const QUEUE_AGE_P95_LIMIT_DAYS = 14;

/** Stages the backlog audit reads (design :284). */
export const BACKLOG_STAGES = [
  'prefilter',
  'archaeology',
  'judge-panel',
  'trigger-eval',
] as const;
export type BacklogStage = (typeof BACKLOG_STAGES)[number];

/** Queue statuses that end a row's stay in the queue. */
const FINISHED_STATUSES = ['done', 'skipped', 'failed', 'unscored'] as const;
const CLEANUP_REASON_PREFIX = 'backlog-cleanup:';

// ---------------------------------------------------------------- options

const nonEmpty = z.string().min(1);

const snapshotRefSchema = z.strictObject({
  /** Home-relative path of the COPY the host seeded. */
  file: nonEmpty,
  sha256: sha256HexSchema,
});

export const snapshotAuditOptionsSchema = z.strictObject({
  snapshot: snapshotRefSchema.default({
    file: `snapshots/${FROZEN_SNAPSHOT_FILE}`,
    sha256: FROZEN_SNAPSHOT_SHA256,
  }),
  /** The previous release's snapshot copy: audited the same way, as a baseline. */
  previousSnapshot: snapshotRefSchema.extend({ label: nonEmpty }).optional(),
  /** Overrides the "as of" instant; default the newest timestamp in the snapshot. */
  asOf: z.string().datetime().optional(),
  /** Complete weeks the net backlog slope averages over. */
  slopeWeeks: z.number().int().min(1).max(52).default(4),
});
export type SnapshotAuditOptions = z.infer<typeof snapshotAuditOptionsSchema>;

// ---------------------------------------------------------------- reads

const maxSchema = z.strictObject({ t: z.number().nullable() });
const countSchema = z.strictObject({ n: z.number().int().nonnegative() });
const capturedSchema = z.array(z.strictObject({ c: z.number() }));
const sessionSchema = z.array(
  z.strictObject({
    last: z.number(),
    unprocessed: z.number().int().nonnegative(),
    has_memory: z.number().int().min(0).max(1),
  }),
);
const memoriesSchema = z.strictObject({
  n: z.number().int().nonnegative(),
  with_session: z.number().int().nonnegative(),
});
const enqueuedSchema = z.array(z.strictObject({ e: z.number() }));
const candidatesSchema = z.strictObject({
  n: z.number().int().nonnegative(),
  judged: z.number().int().nonnegative(),
  cleanup: z.number().int().nonnegative(),
  cleanup_no_judge: z.number().int().nonnegative(),
});

/** Nearest-rank percentile; `null` for no values. */
export function nearestRank(
  values: readonly number[],
  share: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(share * sorted.length) - 1),
    )
  ];
}

function newestOf(db: ReadonlySqlite, sql: string): number | null {
  return maxSchema.parse(db.prepare(sql).get()).t;
}

function asOfMs(
  db: ReadonlySqlite,
  asOf: string | undefined,
  newestSql: string,
): number {
  if (asOf !== undefined) return Date.parse(asOf);
  const newest = newestOf(db, newestSql);
  if (newest === null) {
    throw new Error('the snapshot holds no timestamp to audit as of');
  }
  return newest;
}

/** What `mem.liveness.audit` reads from one snapshot. */
export interface LivenessReading {
  readonly asOfMs: number;
  readonly observations: number;
  readonly unprocessed: number;
  readonly unprocessedAgeP95Ms: number | null;
  /** Sessions whose newest observation is older than the 24 h grace. */
  readonly sessionsPastGrace: number;
  /** ... of which no memory row carries the session id. */
  readonly sessionsNoMemories: number;
  /** ... of which every observation is processed (proxy of a silent consume). */
  readonly sessionsProcessedNoMemories: number;
  readonly memories: number;
  readonly memoriesWithSession: number;
}

const LIVENESS_NEWEST_SQL = `
  SELECT MAX(t) AS t FROM (
    SELECT MAX(captured_at) AS t FROM observation_queue
    UNION ALL SELECT MAX(created_at) AS t FROM memories
  )`;

const SESSIONS_SQL = `
  SELECT MAX(o.captured_at) AS last,
         COALESCE(SUM(o.processed_at IS NULL), 0) AS unprocessed,
         EXISTS (SELECT 1 FROM memories m WHERE m.session_id = o.session_id) AS has_memory
    FROM observation_queue o
   GROUP BY o.session_id`;

export function readLiveness(
  db: ReadonlySqlite,
  asOf?: string,
): LivenessReading {
  const at = asOfMs(db, asOf, LIVENESS_NEWEST_SQL);
  const ages = capturedSchema
    .parse(
      db
        .prepare(
          'SELECT captured_at AS c FROM observation_queue WHERE processed_at IS NULL',
        )
        .all(),
    )
    .map((row) => at - row.c);
  const sessions = sessionSchema
    .parse(db.prepare(SESSIONS_SQL).all())
    .filter((session) => session.last < at - SESSION_GRACE_MS);
  const orphaned = sessions.filter((session) => session.has_memory === 0);
  const memories = memoriesSchema.parse(
    db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(session_id IS NOT NULL AND session_id <> ''), 0) AS with_session
           FROM memories`,
      )
      .get(),
  );
  return {
    asOfMs: at,
    observations: countSchema.parse(
      db.prepare('SELECT COUNT(*) AS n FROM observation_queue').get(),
    ).n,
    unprocessed: ages.length,
    unprocessedAgeP95Ms: nearestRank(ages, 0.95),
    sessionsPastGrace: sessions.length,
    sessionsNoMemories: orphaned.length,
    sessionsProcessedNoMemories: orphaned.filter(
      (session) => session.unprocessed === 0,
    ).length,
    memories: memories.n,
    memoriesWithSession: memories.with_session,
  };
}

/** One stage of `skill.backlog.audit`. */
export interface StageReading {
  readonly stage: BacklogStage;
  readonly queued: number;
  readonly ageP95Days: number | null;
  readonly olderThan14d: number;
  /** Oldest week first. */
  readonly weeks: readonly { enqueued: number; finished: number }[];
  /** Mean of `enqueued - finished` over the weeks: the net backlog change per week. */
  readonly slopePerWeek: number;
}

export interface BacklogReading {
  readonly asOfMs: number;
  readonly stages: readonly StageReading[];
  readonly candidates: number;
  readonly judged: number;
  readonly cleanupRejected: number;
  readonly cleanupRejectedNoJudge: number;
}

const BACKLOG_NEWEST_SQL = `
  SELECT MAX(t) AS t FROM (
    SELECT MAX(enqueued_at) AS t FROM skill_synthesis_queue
    UNION ALL SELECT MAX(finished_at) AS t FROM skill_synthesis_queue
    UNION ALL SELECT MAX(created_at) AS t FROM skill_candidates
  )`;

const FINISHED_IN = FINISHED_STATUSES.map((status) => `'${status}'`).join(', ');

export function readBacklog(
  db: ReadonlySqlite,
  options: { readonly asOf?: string; readonly slopeWeeks: number },
): BacklogReading {
  const at = asOfMs(db, options.asOf, BACKLOG_NEWEST_SQL);
  const queuedStatement = db.prepare(
    "SELECT enqueued_at AS e FROM skill_synthesis_queue WHERE stage = ? AND status = 'queued'",
  );
  const enqueuedStatement = db.prepare(
    'SELECT COUNT(*) AS n FROM skill_synthesis_queue WHERE stage = ? AND enqueued_at > ? AND enqueued_at <= ?',
  );
  const finishedStatement = db.prepare(
    `SELECT COUNT(*) AS n FROM skill_synthesis_queue
      WHERE stage = ? AND status IN (${FINISHED_IN})
        AND finished_at > ? AND finished_at <= ?`,
  );
  const stages = BACKLOG_STAGES.map((stage): StageReading => {
    const ages = enqueuedSchema
      .parse(queuedStatement.all(stage))
      .map((row) => (at - row.e) / DAY_MS);
    const weeks = Array.from({ length: options.slopeWeeks }, (_, index) => {
      const end = at - (options.slopeWeeks - 1 - index) * WEEK_MS;
      const start = end - WEEK_MS;
      return {
        enqueued: countSchema.parse(enqueuedStatement.get(stage, start, end)).n,
        finished: countSchema.parse(finishedStatement.get(stage, start, end)).n,
      };
    });
    return {
      stage,
      queued: ages.length,
      ageP95Days: nearestRank(ages, 0.95),
      olderThan14d: ages.filter((age) => age > QUEUE_AGE_P95_LIMIT_DAYS).length,
      weeks,
      slopePerWeek:
        weeks.reduce((sum, week) => sum + week.enqueued - week.finished, 0) /
        weeks.length,
    };
  });
  const candidates = candidatesSchema.parse(
    db
      .prepare(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(judge_status IS NOT NULL), 0) AS judged,
                COALESCE(SUM(status = 'rejected' AND rejected_reason LIKE ?), 0) AS cleanup,
                COALESCE(SUM(status = 'rejected' AND rejected_reason LIKE ? AND judge_status IS NULL), 0) AS cleanup_no_judge
           FROM skill_candidates`,
      )
      .get(`${CLEANUP_REASON_PREFIX}%`, `${CLEANUP_REASON_PREFIX}%`),
  );
  return {
    asOfMs: at,
    stages,
    candidates: candidates.n,
    judged: candidates.judged,
    cleanupRejected: candidates.cleanup,
    cleanupRejectedNoJudge: candidates.cleanup_no_judge,
  };
}

// ---------------------------------------------------------------- metrics

export function livenessMetrics(
  reading: LivenessReading,
): Record<string, number | null> {
  return {
    'observations.total': reading.observations,
    'observations.unprocessed': reading.unprocessed,
    unprocessedAgeP95Ms: reading.unprocessedAgeP95Ms,
    ...rateMetrics(
      'sessionsWithObservationsNoMemories',
      rate(reading.sessionsNoMemories, reading.sessionsPastGrace),
    ),
    'sessions.processedNoMemories': reading.sessionsProcessedNoMemories,
    ...rateMetrics(
      'memories.sessionIdPopulated',
      rate(reading.memoriesWithSession, reading.memories),
    ),
    extractionPassErrorShare: null,
    ranPassesWithError: null,
  };
}

export function backlogMetrics(
  reading: BacklogReading,
): Record<string, number | null> {
  const metrics: Record<string, number | null> = {};
  for (const stage of reading.stages) {
    metrics[`${stage.stage}.queued`] = stage.queued;
    metrics[`${stage.stage}.ageP95Days`] = stage.ageP95Days;
    metrics[`${stage.stage}.olderThan14d`] = stage.olderThan14d;
    metrics[`${stage.stage}.slopePerWeek`] = stage.slopePerWeek;
  }
  return {
    ...metrics,
    'queued.olderThan14d': reading.stages.reduce(
      (sum, stage) => sum + stage.olderThan14d,
      0,
    ),
    'candidates.total': reading.candidates,
    'candidates.unjudged': reading.candidates - reading.judged,
    'candidates.cleanupRejected': reading.cleanupRejected,
    ...rateMetrics(
      'candidates.judgedShare',
      rate(reading.judged, reading.candidates),
    ),
    ...rateMetrics(
      'candidates.cleanupRejectedNoJudgeShare',
      rate(reading.cleanupRejectedNoJudge, reading.candidates),
    ),
  };
}

/**
 * Recorded baselines (design :285-287): the 471 figures and the 2026-10-06
 * forensics copy. Only figures the sources state are recorded; a metric they
 * do not state is absent, never guessed.
 */
export const RECORDED_LIVENESS_BASELINES: SuiteResultInput['baselines'] = [
  {
    id: 'forensics-copy-2026-10-06',
    label:
      '2026-10-06 forensics copy, sha256 a25d702f… (forensics.md:10-15, :72)',
    metrics: {
      'observations.total': 91_783,
      'observations.unprocessed': 59_614,
    },
  },
];

export const RECORDED_BACKLOG_BASELINES: SuiteResultInput['baselines'] = [
  {
    id: '471',
    label: 'TASK_2026_471 figures (forensics.md:162, :280)',
    metrics: { 'prefilter.queued': 605, 'candidates.total': 2_433 },
  },
  {
    id: 'forensics-copy-2026-10-06',
    label:
      '2026-10-06 forensics copy, sha256 a25d702f… (forensics.md:151, :171, :280)',
    metrics: {
      'prefilter.queued': 1_193,
      'archaeology.queued': 132,
      'judge-panel.queued': 152,
      'trigger-eval.queued': 152,
      'queued.olderThan14d': 677,
      'candidates.total': 2_587,
      'candidates.unjudged': 2_347,
      'candidates.cleanupRejected': 1_869,
      ...rateMetrics('candidates.judgedShare', rate(2_587 - 2_347, 2_587)),
    },
  },
];

// ---------------------------------------------------------------- suites

interface AuditInput {
  readonly home: string;
  readonly options: SnapshotAuditOptions;
}

interface AuditOutput {
  readonly result: SuiteResultInput;
  readonly cases: CaseRecord[];
}

interface SnapshotRead<T> {
  readonly reading: T;
  readonly sha256: string;
  readonly latencyMs: number;
}

async function auditSnapshot<T>(
  home: string,
  ref: { readonly file: string; readonly sha256: string },
  read: (db: ReadonlySqlite) => T,
): Promise<SnapshotRead<T>> {
  const path = resolveHomeFile(home, ref.file);
  const started = performance.now();
  const { result, sha256 } = await withReadonlySnapshot(path, read, ref.sha256);
  return { reading: result, sha256, latencyMs: performance.now() - started };
}

function withPrevious(
  recorded: SuiteResultInput['baselines'],
  previous: { label: string; metrics: Record<string, number | null> } | null,
  productMetrics: Record<string, number | null>,
): Pick<SuiteResultInput, 'baselines' | 'deltas'> {
  const baselines = [
    ...recorded,
    ...(previous === null
      ? []
      : [
          {
            id: 'previous-release',
            label: previous.label,
            metrics: previous.metrics,
          },
        ]),
  ];
  return {
    baselines,
    deltas: Object.fromEntries(
      baselines.map((baseline) => [
        baseline.id,
        deltaOf(productMetrics, baseline.metrics),
      ]),
    ),
  };
}

function invariantCase(
  caseId: string,
  input: unknown,
  expected: string,
  observed: string,
  pass: boolean,
  latencyMs: number,
): CaseRecord {
  return {
    caseId,
    inputSha256: inputSha256(input),
    expected,
    observed,
    outcome: pass ? 'pass' : 'fail',
    cassetteKey: null,
    latencyMs,
    error: null,
  };
}

function cost(
  cases: readonly CaseRecord[],
  calls: number,
  latencies: readonly number[],
): SuiteResultInput['cost'] {
  const sorted = [...latencies];
  return {
    calls,
    latency_ms: {
      p50: nearestRank(sorted, 0.5),
      p95: nearestRank(sorted, 0.95),
    },
    error_rate: rate(
      cases.filter((record) => record.error != null).length,
      cases.length,
    ).value,
    tokens: {},
  };
}

function hours(ms: number | null): string {
  return ms === null ? 'none' : `${(ms / HOUR_MS).toFixed(1)} h`;
}

export async function runLivenessAudit(
  input: AuditInput,
): Promise<AuditOutput> {
  const { options } = input;
  const current = await auditSnapshot(input.home, options.snapshot, (db) =>
    readLiveness(db, options.asOf),
  );
  const previous =
    options.previousSnapshot === undefined
      ? null
      : await auditSnapshot(input.home, options.previousSnapshot, (db) =>
          readLiveness(db),
        );
  const { reading } = current;
  const ageOk =
    reading.unprocessedAgeP95Ms === null ||
    reading.unprocessedAgeP95Ms <= UNPROCESSED_AGE_P95_LIMIT_MS;
  const orphanOk = reading.sessionsNoMemories === 0;
  const subject = { sha256: current.sha256, asOfMs: reading.asOfMs };
  const cases = [
    invariantCase(
      'invariant/unprocessed-age-p95',
      { ...subject, invariant: 'unprocessed-age-p95' },
      `unprocessed observation age p95 <= ${hours(UNPROCESSED_AGE_P95_LIMIT_MS)}`,
      `p95 ${hours(reading.unprocessedAgeP95Ms)} over ${reading.unprocessed} unprocessed of ${reading.observations} observations`,
      ageOk,
      current.latencyMs,
    ),
    invariantCase(
      'invariant/sessions-no-memories',
      { ...subject, invariant: 'sessions-no-memories' },
      'every session with observations older than 24 h has a memory row',
      `${reading.sessionsNoMemories} of ${reading.sessionsPastGrace} sessions have none ` +
        `(${reading.sessionsProcessedNoMemories} of them fully processed)`,
      orphanOk,
      current.latencyMs,
    ),
  ];
  const productMetrics = livenessMetrics(reading);
  const details: LivenessDetails = {
    source: 'snapshot-audit',
    rescan: null,
    snapshotSha256: current.sha256,
    unprocessedAgeP95Ms: reading.unprocessedAgeP95Ms,
    sessionsWithObservationsNoMemories: reading.sessionsNoMemories,
    ranPassesWithError: null,
    faults: [],
  };
  return {
    cases,
    result: {
      suiteId: LIVENESS_AUDIT_SUITE_ID,
      kind: 'liveness',
      details,
      claim: {
        source: 'code',
        ref: 'libs/backend/persistence-sqlite/src/lib/migrations/0016_observation_queue.ts:1-9',
        text: 'Observations are curated; rows are marked processed only after a successful curator run.',
      },
      groundTruth: {
        id: `snapshot-${current.sha256.slice(0, 12)}`,
        version: 'v1',
        method: 'generated',
        frozenAt: new Date(reading.asOfMs).toISOString(),
      },
      ...withPrevious(
        RECORDED_LIVENESS_BASELINES,
        previous === null || options.previousSnapshot === undefined
          ? null
          : {
              label: `previous release snapshot ${options.previousSnapshot.label}`,
              metrics: livenessMetrics(previous.reading),
            },
        productMetrics,
      ),
      cost: cost(
        cases,
        previous === null ? 1 : 2,
        previous === null
          ? [current.latencyMs]
          : [current.latencyMs, previous.latencyMs],
      ),
      modelCalls: 0,
      verdict: ageOk && orphanOk ? 'pass' : 'fail',
      metrics: { ...productMetrics, asOfMs: reading.asOfMs },
      cassetteVersion: null,
    },
  };
}

export async function runBacklogAudit(input: AuditInput): Promise<AuditOutput> {
  const { options } = input;
  const current = await auditSnapshot(input.home, options.snapshot, (db) =>
    readBacklog(db, { asOf: options.asOf, slopeWeeks: options.slopeWeeks }),
  );
  const previous =
    options.previousSnapshot === undefined
      ? null
      : await auditSnapshot(input.home, options.previousSnapshot, (db) =>
          readBacklog(db, { slopeWeeks: options.slopeWeeks }),
        );
  const { reading } = current;
  const subject = {
    sha256: current.sha256,
    asOfMs: reading.asOfMs,
    slopeWeeks: options.slopeWeeks,
  };
  const invariants: FunnelDetails['stages'][number]['invariants'] = [];
  const cases: CaseRecord[] = [];
  for (const stage of reading.stages) {
    const ageOk =
      stage.ageP95Days === null || stage.ageP95Days <= QUEUE_AGE_P95_LIMIT_DAYS;
    const slopeOk = stage.slopePerWeek <= 0;
    invariants.push(
      {
        id: `age-p95-le-14d:${stage.stage}`,
        pass: ageOk,
        violations: stage.olderThan14d,
        exampleIds: [],
      },
      {
        id: `net-slope-le-0:${stage.stage}`,
        pass: slopeOk,
        violations: slopeOk ? 0 : 1,
        exampleIds: [],
      },
    );
    cases.push(
      invariantCase(
        `invariant/${stage.stage}/age-p95`,
        { ...subject, stage: stage.stage, invariant: 'age-p95' },
        `queued age p95 <= ${QUEUE_AGE_P95_LIMIT_DAYS} days`,
        stage.ageP95Days === null
          ? 'no queued rows'
          : `p95 ${stage.ageP95Days.toFixed(1)} days over ${stage.queued} queued (${stage.olderThan14d} older than 14 days)`,
        ageOk,
        current.latencyMs,
      ),
      invariantCase(
        `invariant/${stage.stage}/net-slope`,
        { ...subject, stage: stage.stage, invariant: 'net-slope' },
        `net backlog change <= 0 per week over ${options.slopeWeeks} weeks`,
        `${stage.slopePerWeek} per week (enqueued/finished by week: ${stage.weeks
          .map((week) => `${week.enqueued}/${week.finished}`)
          .join(', ')})`,
        slopeOk,
        current.latencyMs,
      ),
    );
  }
  const productMetrics = backlogMetrics(reading);
  const judgedShare = rate(reading.judged, reading.candidates);
  const details: FunnelDetails = {
    fixtureId: `snapshot-${current.sha256.slice(0, 12)}`,
    stages: [
      {
        stage: 'backlog-drain',
        in: reading.stages.reduce(
          (sum, stage) =>
            sum + stage.weeks.reduce((total, week) => total + week.enqueued, 0),
          0,
        ),
        out: reading.stages.reduce(
          (sum, stage) =>
            sum + stage.weeks.reduce((total, week) => total + week.finished, 0),
          0,
        ),
        invariants,
      },
    ],
    backlog: [
      ...reading.stages.map((stage) => ({
        stage: stage.stage,
        ageP95Days: stage.ageP95Days,
        slopePerWeek: stage.slopePerWeek,
        judgedShare: null,
      })),
      // Judged share is a candidate-level figure, not a queue stage's.
      {
        stage: 'candidates',
        ageP95Days: null,
        slopePerWeek: null,
        judgedShare: judgedShare.value,
      },
    ],
  };
  return {
    cases,
    result: {
      suiteId: BACKLOG_AUDIT_SUITE_ID,
      kind: 'funnel',
      details,
      claim: {
        source: 'ledger',
        ref: 'feature-evidence: skills unblock and one-time backlog cleanup (461, PR #526; 578, PR #626)',
        text: 'The skills queue drains: no stage ages past 14 days and no stage backlog grows.',
      },
      groundTruth: {
        id: `snapshot-${current.sha256.slice(0, 12)}`,
        version: 'v1',
        method: 'generated',
        frozenAt: new Date(reading.asOfMs).toISOString(),
      },
      ...withPrevious(
        RECORDED_BACKLOG_BASELINES,
        previous === null || options.previousSnapshot === undefined
          ? null
          : {
              label: `previous release snapshot ${options.previousSnapshot.label}`,
              metrics: backlogMetrics(previous.reading),
            },
        productMetrics,
      ),
      cost: cost(
        cases,
        previous === null ? 1 : 2,
        previous === null
          ? [current.latencyMs]
          : [current.latencyMs, previous.latencyMs],
      ),
      modelCalls: 0,
      verdict: cases.every((record) => record.outcome === 'pass')
        ? 'pass'
        : 'fail',
      metrics: { ...productMetrics, asOfMs: reading.asOfMs },
      cassetteVersion: null,
    },
  };
}

type AuditRun = (input: AuditInput) => Promise<AuditOutput>;

function auditSuite(id: string, run: AuditRun): MemorySkillsHostSuite {
  return {
    id,
    async run(context: MemorySkillsHostSuiteContext) {
      const options = snapshotAuditOptionsSchema.parse(context.options ?? {});
      const { result, cases } = await run({
        home: context.isolation.home,
        options,
      });
      writeSuiteResult(context.runDir, result, cases);
    },
  };
}

/** Registered in the host entry's `HOST_SUITES`; local runs only. */
export const SNAPSHOT_AUDIT_SUITES: readonly MemorySkillsHostSuite[] = [
  auditSuite(LIVENESS_AUDIT_SUITE_ID, runLivenessAudit),
  auditSuite(BACKLOG_AUDIT_SUITE_ID, runBacklogAudit),
];
