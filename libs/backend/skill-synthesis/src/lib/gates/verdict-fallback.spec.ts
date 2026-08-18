/**
 * The verdict-absent fallback — B3.2.2, the C2 ⇢ C3 soft edge.
 *
 * Phase 3's gates PREFER `skill_session_verdicts.routine` + `friction_map` as
 * their evidence base. When the row is absent, or present with a non-null
 * `degraded_reason`, they fall back to `ExtractedTrajectory.canonicalText` +
 * `shortDescription` and flag it, so the Activity tab can say the gate ran on
 * weaker evidence.
 *
 * **This is what lets C3 ship and pass CI whether or not C2 landed**, so the
 * central case here runs against a REAL `skill_session_verdicts` table with
 * ZERO ROWS IN IT. A stubbed store returning `null` would prove the branch
 * compiles; it would not prove the gate survives a database on which phase 2
 * never ran. `0034` is applied from `MIGRATIONS`, so the table this spec proves
 * empty is the table a user has.
 *
 * `better-sqlite3` here is built against Electron's ABI and cannot load under
 * Jest/Node, so `resolveOpener` falls back to `node:sqlite`. The house
 * native-gated pattern is deliberately NOT copied — it skips silently, which is
 * green while asserting nothing.
 *
 * THE PREDICATE IS `SessionVerdictStore.hasUsableVerdict`, and it is called,
 * not re-derived. `row !== null && row.degradedReason === null` exists once, in
 * the store. A second copy here would be a second definition to keep in step.
 *
 * ## Both directions are asserted, on purpose
 *
 * A spec that only proves "no verdict ⇒ fallback" passes against an
 * implementation that ALWAYS falls back, which is a gate that silently ignores
 * every verdict phase 2 pays to produce. A spec that only proves "usable
 * verdict ⇒ no fallback" passes against one that NEVER falls back, which
 * crashes or measures nothing on a database phase 2 never touched. Both are
 * here for that reason, and so is the assertion on WHICH TEXT reached the
 * comparator — the boolean alone is satisfiable without changing the evidence.
 */
import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import { makeLogger } from '../lanes/lane-runner.test-support';
import { resolvedLane } from '../lanes/lane-runner.test-support';
import type {
  LaneRunRequest,
  LaneRunResult,
  LaneRunnerService,
} from '../lanes/lane-runner.service';
import { SessionVerdictStore } from '../archaeology/session-verdict.store';
import { SESSION_VERDICT_DEGRADED_REASONS } from '../archaeology/session-verdict.types';
import { SkillCandidateStore } from '../skill-candidate.store';
import type { TrajectoryExtractor } from '../trajectory-extractor';
import type { ExtractedTrajectory } from '../trajectory-extractor';
import type { CandidateId, NewCandidateInput } from '../types';
import {
  ReplayValidatorService,
  resolveGateEvidence,
} from './replay-validator.service';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

const SQL_0033 = MIGRATIONS.find((m) => m.version === 33)?.sql ?? '';
const SQL_0034 = MIGRATIONS.find((m) => m.version === 34)?.sql ?? '';
const SQL_0036 = MIGRATIONS.find((m) => m.version === 36)?.sql ?? '';

type TransactionFn = <T extends (...args: never[]) => unknown>(fn: T) => T;
type SpecDb = TestDatabase & { transaction: TransactionFn };

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

/**
 * `skill_candidates` (pre-`0033` base + `0033` + `0036`) AND `0034`'s verdict
 * table. `0034` is applied but never populated in the central case — that empty
 * table IS the assertion.
 */
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
  db.exec(SQL_0034);
  return db;
}

const HOLDOUT = 'session-holdout';
const USED = 'session-used';

const ASK = 'ASK-MARKER: the release build failed on a missing native module';
const TRAJECTORY_TEXT =
  'TRAJECTORY-MARKER: rebuilt the module against the runtime ABI and re-ran the build';
const ROUTINE_STEP =
  'ROUTINE-MARKER: rebuild the native module for the host ABI';

function trajectory(): ExtractedTrajectory {
  return {
    hash: 'traj-hash',
    canonicalText: TRAJECTORY_TEXT,
    turnCount: 6,
    sessionTurnCount: 8,
    shortDescription: ASK,
    slug: 'the-release-build-failed',
    editCount: 3,
    toolUseCount: 9,
    bashTestPassed: true,
    charLength: 300,
    hasSuccessMarker: true,
  };
}

function makeTrajectories(
  value: ExtractedTrajectory | null = trajectory(),
): TrajectoryExtractor {
  return {
    extract: jest.fn(async () => value),
  } as unknown as TrajectoryExtractor;
}

function makeWorkspace(): IWorkspaceProvider {
  return {
    getConfiguration: <T>(_s: string, _k: string, fallback: T): T => fallback,
  } as unknown as IWorkspaceProvider;
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

function makeLaneStub(): {
  service: LaneRunnerService;
  calls: LaneRunRequest[];
} {
  const calls: LaneRunRequest[] = [];
  const results: LaneRunResult[] = [
    okRun(null, '1. rebuild the native module'),
    okRun({ alignment: 0.7 }),
  ];
  const run = jest.fn(async (req: LaneRunRequest) => {
    calls.push(req);
    return results[calls.length - 1] ?? results[results.length - 1];
  });
  return { calls, service: { run } as unknown as LaneRunnerService };
}

function candidateInput(): NewCandidateInput {
  return {
    name: 'rebuild-native-modules-for-the-host-abi',
    description: 'Use when a native module fails to load in the release build.',
    bodyPath: '/tmp/skill/SKILL.md',
    sourceSessionIds: [USED],
    trajectoryHash: 'hash-fallback-1',
    embedding: null,
    createdAt: 1_000,
  };
}

interface Harness {
  service: ReplayValidatorService;
  store: SkillCandidateStore;
  verdicts: SessionVerdictStore;
  lane: { service: LaneRunnerService; calls: LaneRunRequest[] };
  candidateId: CandidateId;
  validate: () => Promise<
    Awaited<ReturnType<ReplayValidatorService['validate']>>
  >;
}

function harness(): Harness {
  const db = createDb();
  const connection = { db, vecExtensionLoaded: false, isOpen: true };
  const store = new SkillCandidateStore(
    makeLogger() as never,
    connection as never,
    { available: false } as never,
  );
  const verdicts = new SessionVerdictStore(
    makeLogger() as never,
    connection as never,
  );
  const { candidate } = store.registerCandidate(candidateInput());
  const lane = makeLaneStub();
  const service = new ReplayValidatorService(
    makeLogger(),
    makeWorkspace(),
    lane.service,
    store,
    verdicts,
    makeTrajectories(),
  );
  return {
    service,
    store,
    verdicts,
    lane,
    candidateId: candidate.id,
    validate: () =>
      service.validate({
        candidate,
        body: '1. Identify the runtime ABI.\n2. Rebuild.',
        clusterSessionIds: [USED, HOLDOUT],
        workspaceRoot: 'D:/repo',
      }),
  };
}

/** A complete verdict for the hold-out — the case that must NOT fall back. */
function saveUsableVerdict(verdicts: SessionVerdictStore): void {
  verdicts.save({
    sessionId: HOLDOUT,
    workspaceRoot: 'D:/repo',
    intent: 'get the release build to load its native module',
    outcome: 'the module was rebuilt for the host ABI and the build went green',
    evidenceClass: 'tests-green',
    frictionMap: [
      { turnIndex: 3, kind: 'retry', note: 'rebuilt for the wrong ABI' },
    ],
    routine: {
      summary: 'rebuild a native module for the host runtime',
      steps: [ROUTINE_STEP],
      citations: [3],
    },
    turnCount: 8,
    lane: 'archaeologist',
    model: 'a-tier-alias',
    passes: 2,
    degradedReason: null,
  });
}

// ── The C2-absent case: the verdict table exists and is EMPTY ───────────────

describe('the verdict-absent fallback — with skill_session_verdicts empty', () => {
  maybe(
    'the table really is empty, and the store says "never analyzed"',
    () => {
      const h = harness();
      expect(h.verdicts.findBySession(HOLDOUT)).toBeNull();
      expect(h.verdicts.hasUsableVerdict(HOLDOUT)).toBe(false);
    },
  );

  maybe(
    'the gate still measures, and flags that it ran on weaker evidence',
    async () => {
      const h = harness();

      const result = await h.validate();

      expect(result.status).toBe('measured');
      expect(result.confidence).toBe(0.7);
      expect(result.verdictFallback).toBe(true);
      expect(h.store.findById(h.candidateId)?.replayConfidence).toBe(0.7);
    },
  );

  maybe('the comparator is given the trajectory text', async () => {
    // The boolean alone is satisfiable without changing the evidence, so the
    // TEXT is what is asserted.
    const h = harness();

    await h.validate();

    const comparator = h.lane.calls[1];
    expect(comparator.prompt).toContain('TRAJECTORY-MARKER');
    expect(comparator.prompt).toContain(ASK);
  });
});

// ── The degraded-row case ───────────────────────────────────────────────────

describe('the verdict-absent fallback — with a DEGRADED verdict row', () => {
  maybe('falls back on a row whose degraded_reason is non-null', async () => {
    const h = harness();
    h.verdicts.recordDegraded(
      HOLDOUT,
      SESSION_VERDICT_DEGRADED_REASONS.NO_QUERY_PATH,
      {
        workspaceRoot: 'D:/repo',
        turnCount: 8,
        lane: 'archaeologist',
        model: null,
        passes: 0,
      },
    );
    // The row EXISTS. "Analyzed, no verdict, here is why" is not "never
    // analyzed", and the fallback must fire on both.
    expect(h.verdicts.findBySession(HOLDOUT)).not.toBeNull();
    expect(h.verdicts.hasUsableVerdict(HOLDOUT)).toBe(false);

    const result = await h.validate();

    expect(result.verdictFallback).toBe(true);
    expect(h.lane.calls[1].prompt).toContain('TRAJECTORY-MARKER');
  });
});

// ── The other direction: a usable verdict must be USED ──────────────────────

describe('the verdict-absent fallback — with a USABLE verdict row', () => {
  maybe('does not fall back', async () => {
    const h = harness();
    saveUsableVerdict(h.verdicts);
    expect(h.verdicts.hasUsableVerdict(HOLDOUT)).toBe(true);

    const result = await h.validate();

    expect(result.status).toBe('measured');
    expect(result.verdictFallback).toBe(false);
  });

  maybe(
    'gives the comparator the ROUTINE, not the raw trajectory',
    async () => {
      const h = harness();
      saveUsableVerdict(h.verdicts);

      await h.validate();

      const comparator = h.lane.calls[1];
      expect(comparator.prompt).toContain('ROUTINE-MARKER');
      expect(comparator.prompt).not.toContain('TRAJECTORY-MARKER');
    },
  );

  maybe(
    'still takes the ASK from the opening message, never from the routine',
    async () => {
      // The verdict's `intent` is an ANALYZED goal, explicitly not a first-message
      // echo. The replay call is asked to plan from what the USER said.
      const h = harness();
      saveUsableVerdict(h.verdicts);

      await h.validate();

      const plan = h.lane.calls[0];
      expect(plan.prompt).toContain(ASK);
      expect(plan.prompt).not.toContain('ROUTINE-MARKER');
      expect(plan.prompt).not.toContain('TRAJECTORY-MARKER');
    },
  );
});

// ── The pure resolver, exercised directly ──────────────────────────────────

describe('resolveGateEvidence', () => {
  const traj = trajectory();

  it('prefers the verdict when one is supplied', () => {
    const evidence = resolveGateEvidence(
      HOLDOUT,
      {
        sessionId: HOLDOUT,
        workspaceRoot: '',
        intent: 'i',
        outcome: 'o',
        evidenceClass: 'tests-green',
        frictionMap: [],
        routine: { summary: 's', steps: [ROUTINE_STEP], citations: [1] },
        turnCount: 4,
        lane: null,
        model: null,
        passes: 1,
        degradedReason: null,
        createdAt: 0,
        updatedAt: 0,
      },
      traj,
    );

    expect(evidence?.fallback).toBe(false);
    expect(evidence?.actual).toContain(ROUTINE_STEP);
    expect(evidence?.ask).toBe(ASK);
  });

  it('falls back to canonicalText with no verdict', () => {
    const evidence = resolveGateEvidence(HOLDOUT, null, traj);
    expect(evidence?.fallback).toBe(true);
    expect(evidence?.actual).toBe(TRAJECTORY_TEXT);
  });

  it('is null when neither source has anything', () => {
    expect(resolveGateEvidence(HOLDOUT, null, null)).toBeNull();
  });

  it('uses the verdict intent for the ask only when there is no trajectory', () => {
    const evidence = resolveGateEvidence(
      HOLDOUT,
      {
        sessionId: HOLDOUT,
        workspaceRoot: '',
        intent: 'INTENT-MARKER',
        outcome: 'o',
        evidenceClass: null,
        frictionMap: [],
        routine: null,
        turnCount: 4,
        lane: null,
        model: null,
        passes: 1,
        degradedReason: null,
        createdAt: 0,
        updatedAt: 0,
      },
      null,
    );

    expect(evidence?.ask).toBe('INTENT-MARKER');
    expect(evidence?.fallback).toBe(false);
  });

  it('falls back when a usable verdict carries nothing to compare against', () => {
    // A comparison against a blank scores 0, and a 0 means "the plan was
    // wrong" — a fabricated result. Weaker evidence beats invented evidence.
    const evidence = resolveGateEvidence(
      HOLDOUT,
      {
        sessionId: HOLDOUT,
        workspaceRoot: '',
        intent: 'i',
        outcome: null,
        evidenceClass: null,
        frictionMap: [],
        routine: null,
        turnCount: 4,
        lane: null,
        model: null,
        passes: 1,
        degradedReason: null,
        createdAt: 0,
        updatedAt: 0,
      },
      traj,
    );

    expect(evidence?.fallback).toBe(true);
    expect(evidence?.actual).toBe(TRAJECTORY_TEXT);
  });
});
