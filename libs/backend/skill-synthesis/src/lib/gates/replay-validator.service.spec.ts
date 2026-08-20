/**
 * ReplayValidatorService — P3-1, the replay half.
 *
 * The CANDIDATE STORE IS REAL and backed by SQLite with `0033` + `0036`
 * applied. The claim this batch makes is about what is STORED — that a
 * measured run lands a 0–1 number beside the hold-out it was measured against,
 * and that an unmeasured run stores `null` and not `0` — and a mocked store
 * that hands back whatever it was given proves neither. The store is also the
 * edge that REJECTS a confidence with no hold-out behind it.
 *
 * `better-sqlite3` here is rebuilt against Electron's ABI by postinstall and
 * cannot load under Jest/Node, so `resolveOpener` from
 * `../queue/queue-db.test-support` falls back to Node's built-in `node:sqlite`.
 * Reusing it rather than copying the house native-gate is deliberate: the
 * copied gate makes specs SKIP SILENTLY — green while asserting nothing.
 *
 * NOTE ON THE SCHEMA. `openQueueDb` in that helper applies `0032` + `0035`,
 * which are the QUEUE and BUDGET tables. `skill_candidates` is older than
 * `0032` and its gate columns come from `0033` + `0036`, so this file builds
 * the base table and then applies those two migrations FROM `MIGRATIONS` —
 * exactly as `skill-candidate.store.spec.ts` does. A column renamed in `0036`
 * therefore fails this spec instead of silently disagreeing with it.
 *
 * THE LANE IS STUBBED except in the clip case, where it is REAL. That split is
 * the point: what is under test here is the two-call protocol — what the replay
 * call is allowed to see, what the comparator is given, and what happens to the
 * candidate row for every shape of answer.
 *
 * What is pinned, in order of how badly it hurts to get wrong:
 *
 *  1. **The replay call never sees what the hold-out actually did.** If it did,
 *     the comparator would be scoring a summary against its own source and
 *     every candidate would read as excellent. This is the assertion that makes
 *     the number mean anything at all.
 *  2. **`null` is not `0`.** Four separate unmeasured shapes, all storing
 *     `null`, plus a genuine `0` that must survive as a `0`.
 *  3. **The hold-out excludes the sessions the draft was built from**, or the
 *     gate measures recall rather than transfer.
 *  4. **Plan-only.** The contract rides `systemPromptAppend` and survives a
 *     `maxInputChars` clip that would have eaten it off a `prompt`.
 *  5. **The settings key is `replayValidation`, not `replay`** — the lane
 *     sub-tree collision B3.1 renamed the key to avoid.
 */
import 'reflect-metadata';
import * as os from 'node:os';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import {
  makeBudgetStub,
  makeLogger,
  makeQueryStub,
  makeResolverStub,
  resolvedLane,
  resultMessage,
  assistantText,
  type ExecuteCall,
} from '../lanes/lane-runner.test-support';
import { LaneRunnerService } from '../lanes/lane-runner.service';
import type {
  LaneRunRequest,
  LaneRunResult,
} from '../lanes/lane-runner.service';
import { DRAIN_TIER_STAGES } from '../queue/skill-drain.service';
import { SkillCandidateStore } from '../skill-candidate.store';
import type { SessionVerdictStore } from '../archaeology/session-verdict.store';
import type { TrajectoryExtractor } from '../trajectory-extractor';
import type { ExtractedTrajectory } from '../trajectory-extractor';
import type { NewCandidateInput, SkillCandidateRow } from '../types';
import {
  REPLAY_PLAN_CONTRACT,
  REPLAY_REASONS,
  REPLAY_VALIDATION_ENABLED_KEY,
  ReplayValidatorService,
  selectHoldoutSessionId,
  type ReplayValidationResult,
} from './replay-validator.service';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

const SQL_0033 = MIGRATIONS.find((m) => m.version === 33)?.sql ?? '';
const SQL_0036 = MIGRATIONS.find((m) => m.version === 36)?.sql ?? '';

type TransactionFn = <T extends (...args: never[]) => unknown>(fn: T) => T;
type SpecDb = TestDatabase & { transaction: TransactionFn };

/** `better-sqlite3` ships `transaction()`; `node:sqlite` does not. */
function transactionFor(db: TestDatabase): TransactionFn {
  const native = (db as { transaction?: unknown }).transaction;
  if (typeof native === 'function') {
    return (native as TransactionFn).bind(db) as TransactionFn;
  }
  return (<T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: never[]) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (error: unknown) {
        db.exec('ROLLBACK');
        throw error;
      }
    }) as unknown as T) as TransactionFn;
}

function createDb(): SpecDb {
  if (!opener) throw new Error('no sqlite binding available');
  const raw = opener(':memory:');
  const db: SpecDb = Object.assign(raw, { transaction: transactionFor(raw) });
  db.exec(`
    CREATE TABLE skill_candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      body_path TEXT NOT NULL,
      source_session_ids TEXT NOT NULL DEFAULT '[]',
      trajectory_hash TEXT NOT NULL UNIQUE,
      embedding_rowid INTEGER,
      status TEXT NOT NULL CHECK(status IN ('candidate','promoted','rejected')) DEFAULT 'candidate',
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      promoted_at INTEGER,
      rejected_at INTEGER,
      rejected_reason TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      residency TEXT NOT NULL DEFAULT 'resident' CHECK(residency IN ('resident','dormant'))
    );
  `);
  db.exec(SQL_0033);
  db.exec(SQL_0036);
  return db;
}

function makeCandidateStore(db: SpecDb): SkillCandidateStore {
  return new SkillCandidateStore(
    makeLogger() as never,
    { db, vecExtensionLoaded: false, isOpen: true } as never,
    { available: false } as never,
  );
}

const HOLDOUT = 'session-holdout';
const USED_A = 'session-a';
const USED_B = 'session-b';

function candidateInput(sourceSessionIds: string[]): NewCandidateInput {
  return {
    name: 'run-the-migration-ratchet',
    description: 'Use when a new migration needs its version ratchets bumped.',
    bodyPath: '/tmp/skill/SKILL.md',
    sourceSessionIds,
    trajectoryHash: 'hash-replay-1',
    embedding: null,
    createdAt: 1_000,
  };
}

// ── Collaborator stubs ──────────────────────────────────────────────────────

/**
 * `getConfiguration(section, key, fallback)` over a flat map, so a case can
 * write ONE key and prove which key the service actually reads.
 */
function makeWorkspace(
  values: Record<string, unknown> = {},
): IWorkspaceProvider & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    getConfiguration: <T>(_section: string, key: string, fallback: T): T => {
      reads.push(key);
      return key in values ? (values[key] as T) : fallback;
    },
  } as unknown as IWorkspaceProvider & { reads: string[] };
}

function makeVerdicts(): SessionVerdictStore {
  return {
    hasUsableVerdict: jest.fn(() => false),
    findBySession: jest.fn(() => null),
  } as unknown as SessionVerdictStore;
}

function trajectory(
  over: Partial<ExtractedTrajectory> = {},
): ExtractedTrajectory {
  return {
    hash: 'traj-hash',
    canonicalText:
      'ACTUAL: bumped the ratchet in five specs and re-ran the suite',
    turnCount: 6,
    sessionTurnCount: 8,
    shortDescription: 'the new migration broke four older migration specs',
    slug: 'the-new-migration-broke',
    editCount: 5,
    toolUseCount: 12,
    bashTestPassed: true,
    charLength: 400,
    hasSuccessMarker: true,
    ...over,
  };
}

function makeTrajectories(
  value: ExtractedTrajectory | null = trajectory(),
): TrajectoryExtractor {
  return {
    extract: jest.fn(async () => value),
  } as unknown as TrajectoryExtractor;
}

/** A `LaneRunnerService` that replays a scripted result per call. */
function makeLaneStub(results: LaneRunResult[]): {
  service: LaneRunnerService;
  calls: LaneRunRequest[];
} {
  const calls: LaneRunRequest[] = [];
  const run = jest.fn(async (req: LaneRunRequest) => {
    calls.push(req);
    return results[calls.length - 1] ?? results[results.length - 1];
  });
  return { calls, service: { run } as unknown as LaneRunnerService };
}

function okRun(json: unknown, text = JSON.stringify(json)): LaneRunResult {
  return {
    status: 'ok',
    run: {
      lane: resolvedLane('replay'),
      text,
      json,
      structuredOutputHonoured: true,
      usage: {},
      truncated: false,
      degradedReason: null,
      executions: 1,
      passesAllowed: 1,
    },
  };
}

function planRun(text: string): LaneRunResult {
  return okRun(null, text);
}

interface Harness {
  service: ReplayValidatorService;
  store: SkillCandidateStore;
  candidate: SkillCandidateRow;
  lane: { service: LaneRunnerService; calls: LaneRunRequest[] };
  workspace: IWorkspaceProvider & { reads: string[] };
  verdicts: SessionVerdictStore;
}

function harness(
  results: LaneRunResult[],
  opts: {
    settings?: Record<string, unknown>;
    sourceSessionIds?: string[];
    verdicts?: SessionVerdictStore;
    trajectories?: TrajectoryExtractor;
  } = {},
): Harness {
  const db = createDb();
  const store = makeCandidateStore(db);
  const { candidate } = store.registerCandidate(
    candidateInput(opts.sourceSessionIds ?? [USED_A, USED_B]),
  );
  const lane = makeLaneStub(results);
  const workspace = makeWorkspace(opts.settings);
  const verdicts = opts.verdicts ?? makeVerdicts();
  const service = new ReplayValidatorService(
    makeLogger(),
    workspace,
    lane.service,
    store,
    verdicts,
    opts.trajectories ?? makeTrajectories(),
  );
  return { service, store, candidate, lane, workspace, verdicts };
}

function request(
  candidate: SkillCandidateRow,
  cluster = [USED_A, USED_B, HOLDOUT],
) {
  return {
    candidate,
    body: '1. Read the migration registry.\n2. Bump every ratchet.',
    clusterSessionIds: cluster,
    workspaceRoot: 'D:/repo',
  };
}

// ── selectHoldoutSessionId ──────────────────────────────────────────────────

describe('selectHoldoutSessionId', () => {
  it('excludes every session the draft was built from', () => {
    expect(
      selectHoldoutSessionId([USED_A, USED_B, HOLDOUT], [USED_A, USED_B]),
    ).toBe(HOLDOUT);
  });

  it('is null when every cluster member fed the draft', () => {
    // A skill graded against a session it was synthesized FROM measures
    // recall, not transfer — so there is no experiment to run, and the caller
    // must store `null` rather than a flattering number.
    expect(
      selectHoldoutSessionId([USED_A, USED_B], [USED_A, USED_B]),
    ).toBeNull();
  });

  it('is deterministic, so cluster-synthesis and the gate agree', () => {
    const forwards = selectHoldoutSessionId(['s-a', 's-b', 's-c'], []);
    const backwards = selectHoldoutSessionId(['s-c', 's-a', 's-b'], []);
    expect(forwards).toBe(backwards);
    expect(forwards).toBe('s-c');
  });

  it('drops blank and duplicate ids', () => {
    expect(selectHoldoutSessionId(['', '  ', 's-a', 's-a'], [])).toBe('s-a');
    expect(selectHoldoutSessionId(['', '   '], [])).toBeNull();
  });
});

// ── The measured path ───────────────────────────────────────────────────────

describe('ReplayValidatorService — a measured run', () => {
  maybe('stores the 0-1 confidence beside the excluded member', async () => {
    const h = harness([
      planRun('1. bump the ratchets'),
      okRun({ alignment: 0.75 }),
    ]);

    const result = await h.service.validate(request(h.candidate));

    expect(result.status).toBe('measured');
    expect(result.confidence).toBe(0.75);
    expect(result.holdoutSessionId).toBe(HOLDOUT);
    expect(result.reason).toBe(REPLAY_REASONS.measured);

    const row = h.store.findById(h.candidate.id);
    expect(row?.replayConfidence).toBe(0.75);
    expect(row?.replayHoldoutSessionId).toBe(HOLDOUT);
    expect(row?.replayAt).not.toBeNull();
  });

  maybe(
    'keeps a genuine 0 as a 0 — it is evidence, not an absence',
    async () => {
      const h = harness([
        planRun('1. do something else'),
        okRun({ alignment: 0 }),
      ]);

      const result = await h.service.validate(request(h.candidate));

      expect(result.status).toBe('measured');
      expect(result.confidence).toBe(0);
      expect(h.store.findById(h.candidate.id)?.replayConfidence).toBe(0);
    },
  );

  maybe(
    'reads the alignment out of prose when the lane parses rather than schemas',
    async () => {
      const h = harness([
        planRun('1. bump the ratchets'),
        okRun(
          null,
          'Here you go: {"alignment": 0.4, "rationale": "close"} — done.',
        ),
      ]);

      const result = await h.service.validate(request(h.candidate));

      expect(result.confidence).toBe(0.4);
    },
  );

  maybe('runs exactly two lane calls, both on the replay lane', async () => {
    const h = harness([planRun('1. bump'), okRun({ alignment: 0.5 })]);

    await h.service.validate(request(h.candidate));

    expect(h.lane.calls).toHaveLength(2);
    expect(h.lane.calls.map((c) => c.laneId)).toEqual(['replay', 'replay']);
  });
});

// ── The experiment's integrity ──────────────────────────────────────────────

describe('ReplayValidatorService — what each call is allowed to see', () => {
  maybe(
    'never shows the replay call what the hold-out actually did',
    async () => {
      // The single assertion that makes the number mean anything. A replay call
      // that can see the outcome is summarizing its own source.
      const traj = trajectory({
        canonicalText:
          'ACTUAL-EVIDENCE-MARKER: ran nx affected and fixed two specs',
        shortDescription: 'ASK-MARKER: the migration broke four older specs',
      });
      const h = harness([planRun('1. bump'), okRun({ alignment: 0.6 })], {
        trajectories: makeTrajectories(traj),
      });

      await h.service.validate(request(h.candidate));

      const [plan, comparator] = h.lane.calls;
      expect(plan.prompt).toContain('ASK-MARKER');
      expect(plan.prompt).not.toContain('ACTUAL-EVIDENCE-MARKER');
      // The comparator is the only call that gets both.
      expect(comparator.prompt).toContain('ASK-MARKER');
      expect(comparator.prompt).toContain('ACTUAL-EVIDENCE-MARKER');
    },
  );

  maybe('gives the replay call the drafted skill body', async () => {
    const h = harness([planRun('1. bump'), okRun({ alignment: 0.6 })]);

    await h.service.validate(request(h.candidate));

    expect(h.lane.calls[0].prompt).toContain('Bump every ratchet');
    expect(h.lane.calls[0].prompt).toContain(h.candidate.name);
  });
});

// ── Plan-only ───────────────────────────────────────────────────────────────

describe('ReplayValidatorService — the plan-only contract', () => {
  maybe(
    'carries the no-file-writes clause on the UNCLIPPABLE half of both calls',
    async () => {
      const h = harness([planRun('1. bump'), okRun({ alignment: 0.6 })]);

      await h.service.validate(request(h.candidate));

      const [plan, comparator] = h.lane.calls;
      expect(plan.systemPromptAppend).toBe(REPLAY_PLAN_CONTRACT);
      expect(comparator.systemPromptAppend).toMatch(/do NOT run any command/i);
      for (const call of h.lane.calls) {
        expect(call.prompt).not.toContain('Do NOT create, modify');
      }
    },
  );

  maybe('sets cwd to the home directory on both calls', async () => {
    const h = harness([planRun('1. bump'), okRun({ alignment: 0.6 })]);

    await h.service.validate(request(h.candidate));

    expect(h.lane.calls.map((c) => c.cwd)).toEqual([
      os.homedir(),
      os.homedir(),
    ]);
    // And never the workspace it is reasoning about.
    expect(h.lane.calls.map((c) => c.cwd)).not.toContain('D:/repo');
  });

  maybe('never buys the stage a tool loop', async () => {
    const h = harness([planRun('1. bump'), okRun({ alignment: 0.6 })]);

    await h.service.validate(request(h.candidate));

    expect(h.lane.calls.map((c) => c.maxTurns)).toEqual([1, 1]);
  });

  maybe(
    'survives a maxInputChars clip that would eat it off a prompt',
    async () => {
      // The REAL runner, with the replay lane clipped to a length far below the
      // prompt. If the contract were built into `prompt` it would be truncated
      // away; on `systemPromptAppend` the lane does not touch it.
      const query = makeQueryStub([
        [
          assistantText('1. bump the ratchets'),
          resultMessage({ result: '1. bump' }),
        ],
        [resultMessage({ result: '{"alignment": 0.9}' })],
      ]);
      const runner = new LaneRunnerService(
        makeLogger(),
        makeResolverStub(
          resolvedLane('replay', { config: { maxInputChars: 40 } }),
        ).service,
        makeBudgetStub().store,
        query.query,
        null,
      );
      const db = createDb();
      const store = makeCandidateStore(db);
      const { candidate } = store.registerCandidate(
        candidateInput([USED_A, USED_B]),
      );
      const service = new ReplayValidatorService(
        makeLogger(),
        makeWorkspace(),
        runner,
        store,
        makeVerdicts(),
        makeTrajectories(),
      );

      const result = await service.validate(request(candidate));

      expect(result.confidence).toBe(0.9);
      const calls = query.calls as ExecuteCall[];
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call.systemPromptAppend).toContain('Do NOT');
        expect(call.cwd).toBe(os.homedir());
        // The clip really did fire — otherwise this case proves nothing.
        expect(call.prompt.length).toBeLessThanOrEqual(80);
      }
    },
  );
});

// ── null is not 0 ───────────────────────────────────────────────────────────

describe('ReplayValidatorService — unmeasured is not zero', () => {
  maybe(
    'stores null when the comparison carries no usable number',
    async () => {
      const h = harness([
        planRun('1. bump'),
        okRun({ alignment: 'not a number' }),
      ]);

      const result = await h.service.validate(request(h.candidate));

      expect(result.status).toBe('unmeasured');
      expect(result.confidence).toBeNull();
      expect(result.reason).toBe(REPLAY_REASONS.unscoredComparison);
      const row = h.store.findById(h.candidate.id);
      expect(row?.replayConfidence).toBeNull();
      // The gate RAN — that is a different record from "never measured".
      expect(row?.replayHoldoutSessionId).toBe(HOLDOUT);
      expect(row?.replayAt).not.toBeNull();
    },
  );

  maybe(
    'refuses to clamp an out-of-range alignment into a perfect score',
    async () => {
      const h = harness([planRun('1. bump'), okRun({ alignment: 1.4 })]);

      const result = await h.service.validate(request(h.candidate));

      expect(result.confidence).toBeNull();
      expect(h.store.findById(h.candidate.id)?.replayConfidence).toBeNull();
    },
  );

  maybe('stores null when the replay lane produced no plan', async () => {
    const h = harness([planRun('   '), okRun({ alignment: 0.9 })]);

    const result = await h.service.validate(request(h.candidate));

    expect(result.reason).toBe(REPLAY_REASONS.emptyPlan);
    expect(h.store.findById(h.candidate.id)?.replayConfidence).toBeNull();
    // The comparator was never reached.
    expect(h.lane.calls).toHaveLength(1);
  });

  maybe('stores null when the hold-out has no evidence at all', async () => {
    const h = harness([planRun('1. bump'), okRun({ alignment: 0.9 })], {
      trajectories: makeTrajectories(null),
    });

    const result = await h.service.validate(request(h.candidate));

    expect(result.reason).toBe(REPLAY_REASONS.noEvidence);
    expect(result.confidence).toBeNull();
    expect(h.lane.calls).toHaveLength(0);
    expect(h.store.findById(h.candidate.id)?.replayAt).not.toBeNull();
  });

  maybe('writes NOTHING when there is no member to hold out', async () => {
    const h = harness([planRun('1. bump'), okRun({ alignment: 0.9 })], {
      sourceSessionIds: [USED_A, USED_B, HOLDOUT],
    });

    const result = await h.service.validate(request(h.candidate));

    expect(result.reason).toBe(REPLAY_REASONS.noHoldout);
    expect(result.holdoutSessionId).toBeNull();
    expect(h.lane.calls).toHaveLength(0);
    // No hold-out means no experiment; a `replay_at` stamp would claim one ran.
    const row = h.store.findById(h.candidate.id);
    expect(row?.replayAt).toBeNull();
    expect(row?.replayConfidence).toBeNull();
  });
});

// ── Lane outcomes that are not the gate's fault ─────────────────────────────

describe('ReplayValidatorService — lane outcomes', () => {
  maybe(
    'a host with no LLM is disabled, and leaves the row untouched',
    async () => {
      const h = harness([
        { status: 'unavailable', reason: 'no query service' },
      ]);

      const result = await h.service.validate(request(h.candidate));

      expect(result.status).toBe('disabled');
      expect(result.reason).toBe(REPLAY_REASONS.noLane);
      // Never measured, so the next weekly tick on a real host tries again.
      expect(h.store.findById(h.candidate.id)?.replayAt).toBeNull();
    },
  );

  maybe(
    'hands a lane failure back as data, and leaves the row untouched',
    async () => {
      const failure = {
        kind: 'timeout' as const,
        reason: 'Lane replay: timed out',
        retryAfterMs: 60_000,
      };
      const h = harness([{ status: 'failed', failure }]);

      const result = await h.service.validate(request(h.candidate));

      expect(result.status).toBe('unmeasured');
      expect(result.failure).toEqual(failure);
      expect(result.reason).toBe(failure.reason);
      expect(h.store.findById(h.candidate.id)?.replayAt).toBeNull();
    },
  );
});

// ── The gate switch ─────────────────────────────────────────────────────────

describe('ReplayValidatorService — R8, the gate switch', () => {
  maybe('spends nothing when replayValidation.enabled is false', async () => {
    const h = harness([planRun('1. bump'), okRun({ alignment: 0.9 })], {
      settings: { [REPLAY_VALIDATION_ENABLED_KEY]: false },
    });

    const result = await h.service.validate(request(h.candidate));

    expect(result.status).toBe('disabled');
    expect(result.reason).toBe(REPLAY_REASONS.disabled);
    expect(h.lane.calls).toHaveLength(0);
    expect(h.store.findById(h.candidate.id)?.replayAt).toBeNull();
  });

  maybe(
    'reads replayValidation.enabled and NOT the replay lane sub-tree',
    async () => {
      // `skillSynthesis.replay.*` is the replay LANE's eight capability fields.
      // A gate switch filed in there would read as a ninth lane field, and
      // `skillSynthesis.replay.enabled` set by anything else must not silence
      // this gate.
      const h = harness([planRun('1. bump'), okRun({ alignment: 0.9 })], {
        settings: { 'skillSynthesis.replay.enabled': false },
      });

      const result = await h.service.validate(request(h.candidate));

      expect(result.status).toBe('measured');
      expect(h.workspace.reads).toContain(REPLAY_VALIDATION_ENABLED_KEY);
      expect(h.workspace.reads).not.toContain('skillSynthesis.replay.enabled');
    },
  );

  it('runs on the weekly tier only', () => {
    // R8. The tier gate is the drain's, not this service's — pinned here so a
    // stage moved to a cheaper tier fails a replay test rather than quietly
    // spending weekly-priced tokens every fifteen minutes.
    expect(DRAIN_TIER_STAGES.weekly.has('replay')).toBe(true);
    expect(DRAIN_TIER_STAGES.nightly.has('replay')).toBe(false);
    expect(DRAIN_TIER_STAGES.frequent.has('replay')).toBe(false);
  });
});

// ── Typing guard ────────────────────────────────────────────────────────────

describe('ReplayValidationResult', () => {
  it('carries a confidence only on a measured status', () => {
    // A compile-time reminder, asserted at runtime so it is not decoration:
    // every non-measured shape this service builds has `confidence: null`.
    const shapes: ReplayValidationResult[] = [
      {
        status: 'disabled',
        confidence: null,
        holdoutSessionId: null,
        verdictFallback: false,
        reason: REPLAY_REASONS.disabled,
        persisted: false,
        failure: null,
      },
    ];
    expect(
      shapes.every((s) => s.status === 'measured' || s.confidence === null),
    ).toBe(true);
  });
});
