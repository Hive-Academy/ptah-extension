/**
 * Batch 20.2 spec for `mem.liveness.audit` and `skill.backlog.audit`. Every
 * case reads a SMALL SYNTHETIC SQLite database built in a temp directory from
 * the product's own migrations (`MIGRATIONS`, static SQL and `run` steps, no
 * vec), so the audit SQL is checked against the real schema. The private
 * snapshot is never opened here.
 */
import 'reflect-metadata';
jest.mock('vscode', () => ({}), { virtual: true });

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';

import {
  funnelDetailsSchema,
  livenessDetailsSchema,
} from '../../memory-skills-suite-kinds';
import { readSuiteResult } from '../../runner/suite-result';
import {
  BACKLOG_AUDIT_SUITE_ID,
  LIVENESS_AUDIT_SUITE_ID,
  SNAPSHOT_AUDIT_SUITES,
  nearestRank,
  readBacklog,
  readLiveness,
  runBacklogAudit,
  runLivenessAudit,
  snapshotAuditOptionsSchema,
} from './snapshot-audits.suite';
import type { ReadonlySqlite } from '../../data/candidate-row-diff';

interface Db {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}
type DbCtor = new (
  file: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => Db;
const Database = require('better-sqlite3') as DbCtor;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The newest timestamp the synthetic databases hold. */
const AS_OF = Date.UTC(2026, 9, 6, 12);

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** A fresh database with every product migration applied (vec skipped). */
function migratedDb(path: string): Db {
  const db = new Database(path);
  for (const migration of MIGRATIONS) {
    if (migration.sql !== undefined) db.exec(migration.sql);
    else migration.run?.(db as never);
  }
  return db;
}

function insertObservation(
  db: Db,
  sessionId: string,
  capturedAt: number,
  processedAt: number | null,
): void {
  db.prepare(
    `INSERT INTO observation_queue (session_id, workspace_root, kind, user_prompt, captured_at, processed_at)
     VALUES (?, '/ws', 'user-prompt', 'synthetic', ?, ?)`,
  ).run(sessionId, capturedAt, processedAt);
}

function insertMemory(db: Db, id: string, sessionId: string | null): void {
  db.prepare(
    `INSERT INTO memories (id, session_id, workspace_root, tier, kind, subject, content,
       source_message_ids, salience, decay_rate, hits, pinned, created_at, updated_at, last_used_at)
     VALUES (?, ?, '/ws', 'recall', 'fact', NULL, 'synthetic', '[]', 0.5, 0.01, 0, 0, ?, ?, ?)`,
  ).run(id, sessionId, AS_OF - 10 * DAY, AS_OF - 10 * DAY, AS_OF - 10 * DAY);
}

function insertQueueRow(
  db: Db,
  id: string,
  stage: string,
  status: string,
  enqueuedAt: number,
  finishedAt: number | null,
): void {
  db.prepare(
    `INSERT INTO skill_synthesis_queue (id, session_id, workspace_root, source, stage, status, enqueued_at, finished_at)
     VALUES (?, ?, '/ws', 'synthetic', ?, ?, ?, ?)`,
  ).run(id, `session-${id}`, stage, status, enqueuedAt, finishedAt);
}

function insertCandidate(
  db: Db,
  id: string,
  status: 'candidate' | 'promoted' | 'rejected',
  judgeStatus: string | null,
  rejectedReason: string | null,
): void {
  db.prepare(
    `INSERT INTO skill_candidates (id, name, description, body_path, source_session_ids,
       trajectory_hash, status, created_at, rejected_reason, judge_status)
     VALUES (?, ?, 'synthetic', '/x/SKILL.md', '[]', ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `skill-${id}`,
    `hash-${id}`,
    status,
    AS_OF - 40 * DAY,
    rejectedReason,
    judgeStatus,
  );
}

/**
 * Liveness world, as of AS_OF:
 * - A: 2 unprocessed observations 30 h and 40 h old, no memory;
 * - B: processed 30 h ago, one memory row;
 * - C: 1 unprocessed observation 0 h old (inside the 24 h grace), no memory;
 * - D: processed 50 h ago, no memory (the silent-consume proxy).
 * Plus one memory row with no session id.
 * Backlog world:
 * - prefilter queued 1 d, 20 d and 30 d old; 3 enqueued and 1 finished in
 *   the last week, 0 and 2 in the week before;
 * - archaeology: nothing queued, 1 finished this week;
 * - candidates: 4 rows: 1 judged, 2 rejected by backlog cleanup without a
 *   judge row, 1 rejected for another reason.
 */
function buildWorld(path: string): void {
  const db = migratedDb(path);
  try {
    insertObservation(db, 'A', AS_OF - 30 * HOUR, null);
    insertObservation(db, 'A', AS_OF - 40 * HOUR, null);
    insertObservation(db, 'B', AS_OF - 30 * HOUR, AS_OF - 29 * HOUR);
    insertObservation(db, 'C', AS_OF, null);
    insertObservation(db, 'D', AS_OF - 50 * HOUR, AS_OF - 49 * HOUR);
    insertMemory(db, 'm-b', 'B');
    insertMemory(db, 'm-none', null);

    insertQueueRow(db, 'p1', 'prefilter', 'queued', AS_OF - 1 * DAY, null);
    insertQueueRow(db, 'p2', 'prefilter', 'queued', AS_OF - 20 * DAY, null);
    insertQueueRow(db, 'p3', 'prefilter', 'queued', AS_OF - 30 * DAY, null);
    insertQueueRow(
      db,
      'p4',
      'prefilter',
      'done',
      AS_OF - 2 * DAY,
      AS_OF - 1 * DAY,
    );
    insertQueueRow(
      db,
      'p5',
      'prefilter',
      'done',
      AS_OF - 9 * DAY,
      AS_OF - 8 * DAY,
    );
    insertQueueRow(
      db,
      'p6',
      'prefilter',
      'skipped',
      AS_OF - 10 * DAY,
      AS_OF - 9 * DAY,
    );
    insertQueueRow(
      db,
      'a1',
      'archaeology',
      'done',
      AS_OF - 40 * DAY,
      AS_OF - 3 * DAY,
    );

    insertCandidate(db, 'c1', 'candidate', 'scored', null);
    insertCandidate(
      db,
      'c2',
      'rejected',
      null,
      'backlog-cleanup: no transcript found for any session',
    );
    insertCandidate(
      db,
      'c3',
      'rejected',
      null,
      'backlog-cleanup: transcript unreadable and no verdict',
    );
    insertCandidate(db, 'c4', 'rejected', null, 'manual');
  } finally {
    db.close();
  }
}

function withDb<T>(path: string, read: (db: ReadonlySqlite) => T): T {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return read(db as unknown as ReadonlySqlite);
  } finally {
    db.close();
  }
}

function rateKeys(metrics: Record<string, number | null>): string[] {
  return Object.keys(metrics)
    .filter((key) => key.endsWith('.num'))
    .map((key) => key.slice(0, -'.num'.length));
}

/** Every `<name>` with `.num`/`.den` equals `num / den` (or `null` when `den` is 0). */
function expectExactRates(metrics: Record<string, number | null>): void {
  for (const key of rateKeys(metrics)) {
    const num = metrics[`${key}.num`];
    const den = metrics[`${key}.den`];
    if (
      num === null ||
      num === undefined ||
      den === null ||
      den === undefined
    ) {
      throw new Error(`${key} lacks num/den`);
    }
    expect(metrics[key]).toBe(den === 0 ? null : num / den);
  }
}

describe('snapshot audits (synthetic SQLite)', () => {
  let root: string;
  let home: string;
  let file: string;
  let sha: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ptah-620-audit-'));
    home = join(root, 'home');
    mkdirSync(join(home, 'snapshots'), { recursive: true });
    file = join(home, 'snapshots', 'synthetic.sqlite');
    buildWorld(file);
    sha = sha256(file);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const options = (extra: Record<string, unknown> = {}) =>
    snapshotAuditOptionsSchema.parse({
      snapshot: { file: 'snapshots/synthetic.sqlite', sha256: sha },
      ...extra,
    });

  it('pins the schema assumption: observation_queue.session_id NOT NULL, memories.session_id present', () => {
    const columns = (table: string) =>
      withDb(file, (db) => db.prepare(`PRAGMA table_info(${table})`).all()) as {
        name: string;
        notnull: number;
      }[];
    expect(
      columns('observation_queue').find((c) => c.name === 'session_id'),
    ).toMatchObject({ notnull: 1 });
    expect(
      columns('memories').find((c) => c.name === 'session_id'),
    ).toMatchObject({ notnull: 0 });
  });

  it('reads the liveness figures from the rows, as of the newest timestamp', () => {
    const reading = withDb(file, (db) => readLiveness(db));
    expect(reading).toEqual({
      asOfMs: AS_OF,
      observations: 5,
      unprocessed: 3,
      // ages 0 h, 30 h, 40 h: nearest rank ceil(0.95 * 3) = 3rd
      unprocessedAgeP95Ms: 40 * HOUR,
      sessionsPastGrace: 3,
      sessionsNoMemories: 2,
      sessionsProcessedNoMemories: 1,
      memories: 2,
      memoriesWithSession: 1,
    });
  });

  it('fails mem.liveness.audit on the synthetic stall and records every rate as num/den', async () => {
    const { result, cases } = await runLivenessAudit({
      home,
      options: options(),
    });
    expect(result.verdict).toBe('fail');
    expect(cases.map((c) => [c.caseId, c.outcome])).toEqual([
      ['invariant/unprocessed-age-p95', 'fail'],
      ['invariant/sessions-no-memories', 'fail'],
    ]);
    const details = livenessDetailsSchema.parse(result.details);
    expect(details).toMatchObject({
      source: 'snapshot-audit',
      snapshotSha256: sha,
      unprocessedAgeP95Ms: 40 * HOUR,
      sessionsWithObservationsNoMemories: 2,
      ranPassesWithError: null,
    });
    expect(result.metrics['sessionsWithObservationsNoMemories']).toBe(2 / 3);
    expect(result.metrics['extractionPassErrorShare']).toBeNull();
    expect(rateKeys(result.metrics)).toEqual([
      'sessionsWithObservationsNoMemories',
      'memories.sessionIdPopulated',
    ]);
    expectExactRates(result.metrics);
    expect(result.baselines.map((b) => b.id)).toEqual([
      'forensics-copy-2026-10-06',
    ]);
    expect(result.deltas['forensics-copy-2026-10-06']).toEqual({
      'observations.total': 5 - 91_783,
      'observations.unprocessed': 3 - 59_614,
    });
    expect(result.groundTruth.frozenAt).toBe(new Date(AS_OF).toISOString());
    expect(result.modelCalls).toBe(0);
  });

  it('passes mem.liveness.audit when every old session has a memory and nothing is stale', async () => {
    const clean = join(home, 'snapshots', 'clean.sqlite');
    const db = migratedDb(clean);
    insertObservation(db, 'E', AS_OF - 30 * HOUR, AS_OF - 29 * HOUR);
    insertObservation(db, 'F', AS_OF - 2 * HOUR, null);
    insertMemory(db, 'm-e', 'E');
    db.close();
    const { result } = await runLivenessAudit({
      home,
      options: snapshotAuditOptionsSchema.parse({
        snapshot: { file: 'snapshots/clean.sqlite', sha256: sha256(clean) },
        asOf: new Date(AS_OF).toISOString(),
      }),
    });
    expect(result.verdict).toBe('pass');
  });

  it('reads per-stage age, weekly net slope and candidate shares', () => {
    // Default "as of": the newest queue/candidate timestamp (p1 enqueued, p4 finished).
    expect(
      withDb(file, (db) => readBacklog(db, { slopeWeeks: 2 })).asOfMs,
    ).toBe(AS_OF - DAY);
    const reading = withDb(file, (db) =>
      readBacklog(db, { asOf: new Date(AS_OF).toISOString(), slopeWeeks: 2 }),
    );
    expect(reading.asOfMs).toBe(AS_OF);
    const prefilter = reading.stages.find((s) => s.stage === 'prefilter');
    expect(prefilter).toEqual({
      stage: 'prefilter',
      queued: 3,
      ageP95Days: 30,
      olderThan14d: 2,
      // oldest week first: (AS_OF-2w, AS_OF-1w] then (AS_OF-1w, AS_OF]
      weeks: [
        { enqueued: 2, finished: 2 },
        { enqueued: 2, finished: 1 },
      ],
      slopePerWeek: (2 - 2 + (2 - 1)) / 2,
    });
    expect(reading.stages.find((s) => s.stage === 'archaeology')).toEqual({
      stage: 'archaeology',
      queued: 0,
      ageP95Days: null,
      olderThan14d: 0,
      weeks: [
        { enqueued: 0, finished: 0 },
        { enqueued: 0, finished: 1 },
      ],
      slopePerWeek: -0.5,
    });
    expect(reading).toMatchObject({
      candidates: 4,
      judged: 1,
      cleanupRejected: 2,
      cleanupRejectedNoJudge: 2,
    });
  });

  it('fails skill.backlog.audit on the aged, growing prefilter stage', async () => {
    const { result, cases } = await runBacklogAudit({
      home,
      options: options({ slopeWeeks: 2, asOf: new Date(AS_OF).toISOString() }),
    });
    expect(result.verdict).toBe('fail');
    const outcome = Object.fromEntries(cases.map((c) => [c.caseId, c.outcome]));
    expect(outcome).toEqual({
      'invariant/prefilter/age-p95': 'fail',
      'invariant/prefilter/net-slope': 'fail',
      'invariant/archaeology/age-p95': 'pass',
      'invariant/archaeology/net-slope': 'pass',
      'invariant/judge-panel/age-p95': 'pass',
      'invariant/judge-panel/net-slope': 'pass',
      'invariant/trigger-eval/age-p95': 'pass',
      'invariant/trigger-eval/net-slope': 'pass',
    });
    const details = funnelDetailsSchema.parse(result.details);
    expect(details.stages[0]).toMatchObject({
      stage: 'backlog-drain',
      in: 4,
      out: 4,
    });
    expect(details.backlog?.at(-1)).toEqual({
      stage: 'candidates',
      ageP95Days: null,
      slopePerWeek: null,
      judgedShare: 1 / 4,
    });
    expect(result.metrics['candidates.judgedShare']).toBe(1 / 4);
    expect(result.metrics['candidates.cleanupRejectedNoJudgeShare']).toBe(
      2 / 4,
    );
    expect(rateKeys(result.metrics)).toEqual([
      'candidates.judgedShare',
      'candidates.cleanupRejectedNoJudgeShare',
    ]);
    expectExactRates(result.metrics);
    for (const baseline of result.baselines) expectExactRates(baseline.metrics);
    expect(result.baselines.map((b) => b.id)).toEqual([
      '471',
      'forensics-copy-2026-10-06',
    ]);
    expect(result.baselines[1].metrics['candidates.judgedShare']).toBe(
      240 / 2_587,
    );
    expect(result.deltas['471']).toEqual({
      'prefilter.queued': 3 - 605,
      'candidates.total': 4 - 2_433,
    });
  });

  it('audits a previous release snapshot copy as the previous-release baseline', async () => {
    const previous = join(home, 'snapshots', 'previous.sqlite');
    const db = migratedDb(previous);
    insertQueueRow(db, 'q1', 'prefilter', 'queued', AS_OF - 3 * DAY, null);
    insertObservation(db, 'P', AS_OF - 3 * DAY, null);
    db.close();
    const ref = {
      file: 'snapshots/previous.sqlite',
      sha256: sha256(previous),
      label: '0.9.0',
    };
    const backlog = await runBacklogAudit({
      home,
      options: options({
        slopeWeeks: 2,
        asOf: new Date(AS_OF).toISOString(),
        previousSnapshot: ref,
      }),
    });
    const prior = backlog.result.baselines.find(
      (b) => b.id === 'previous-release',
    );
    expect(prior?.label).toBe('previous release snapshot 0.9.0');
    expect(prior?.metrics['prefilter.queued']).toBe(1);
    expect(
      backlog.result.deltas['previous-release']?.['prefilter.queued'],
    ).toBe(2);
    expect(backlog.result.cost.calls).toBe(2);
    const liveness = await runLivenessAudit({
      home,
      options: options({ previousSnapshot: ref }),
    });
    expect(
      liveness.result.baselines.find((b) => b.id === 'previous-release')
        ?.metrics['observations.unprocessed'],
    ).toBe(1);
  });

  it('never changes the snapshot copy and leaves no sidecar', async () => {
    await runLivenessAudit({ home, options: options() });
    await runBacklogAudit({ home, options: options() });
    expect(sha256(file)).toBe(sha);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      expect(existsSync(`${file}${suffix}`)).toBe(false);
    }
  });

  it('refuses a snapshot whose hash is not the expected one', async () => {
    await expect(
      runLivenessAudit({
        home,
        options: snapshotAuditOptionsSchema.parse({
          snapshot: {
            file: 'snapshots/synthetic.sqlite',
            sha256: '0'.repeat(64),
          },
        }),
      }),
    ).rejects.toThrow(/is not the frozen value/);
  });

  it('refuses a snapshot path outside the isolated home (never the original in place)', async () => {
    for (const bad of [file, '../outside.sqlite']) {
      await expect(
        runLivenessAudit({
          home,
          options: snapshotAuditOptionsSchema.parse({
            snapshot: { file: bad, sha256: sha },
          }),
        }),
      ).rejects.toThrow(/home-relative|leaves the isolated home/);
    }
  });

  it('defaults to the frozen 2026-10-06 copy under the home', () => {
    expect(snapshotAuditOptionsSchema.parse({}).snapshot).toEqual({
      file: 'snapshots/ptah-20261006-pre-retention.sqlite',
      sha256:
        '82cd16ac39b60699c241286eda2db59b25be70c6aa85480db0be8ae7b77d575a',
    });
  });

  it('writes both suites through the host wrapper with the 620 result contract', async () => {
    const runDir = join(root, 'run');
    for (const suite of SNAPSHOT_AUDIT_SUITES) {
      await suite.run({
        runId: 'ms-audit',
        runDir,
        options: {
          snapshot: { file: 'snapshots/synthetic.sqlite', sha256: sha },
        },
        workspaceRoot: root,
        isolation: {
          home,
          userDataPath: join(home, 'ud'),
          dbPath: join(home, 'db.sqlite'),
        },
        container: undefined as never,
        doubles: undefined as never,
        ci: false,
      });
    }
    expect(readSuiteResult(runDir, LIVENESS_AUDIT_SUITE_ID).result.kind).toBe(
      'liveness',
    );
    const backlog = readSuiteResult(runDir, BACKLOG_AUDIT_SUITE_ID);
    expect(backlog.result.kind).toBe('funnel');
    expect(backlog.cases).toHaveLength(8);
  });

  it('nearestRank picks the ceil(share * n)-th value', () => {
    expect(nearestRank([], 0.95)).toBeNull();
    expect(nearestRank([5, 1, 3], 0.5)).toBe(3);
    expect(nearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });
});
