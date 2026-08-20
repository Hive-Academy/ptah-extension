/**
 * The hold-out, end to end: cluster → draft → persisted row → replay gate.
 *
 * The unit specs beside this file prove `planClusterDraft` agrees with
 * `selectHoldoutSessionId`. That agreement is worth nothing if the CURATOR does
 * not actually route the plan into the row it persists, or if the two persisted
 * lists cannot be turned back into the gate's two arguments. This file runs the
 * whole chain with a REAL `SkillCuratorService`, a REAL SQLite-backed
 * `SkillCandidateStore`, and a REAL `ReplayValidatorService`, and asserts the
 * one thing the batch exists for:
 *
 *  - a cluster with a member to spare ends with a NON-null
 *    `replay_holdout_session_id` on the graded row;
 *  - a cluster sitting on `suggestionMinClusterSize` ends with `null`, via
 *    `replay-no-holdout`, having been drafted from every member.
 *
 * ## HOW THE GATE'S TWO ARGUMENTS ARE RECOVERED
 *
 * `ReplayValidatorService` needs `clusterSessionIds` (the whole cluster) and
 * `candidate.sourceSessionIds` (what the draft consumed). After B3.6 the
 * suggestion row carries both, in different fields:
 *
 *  - `memberSessionIds` → the DRAFTED subset. Becomes `sourceSessionIds`.
 *  - `memberCandidateIds` → EVERY member, including the held-out one. Re-reading
 *    those candidates' own `sourceSessionIds` reconstitutes `clusterSessionIds`.
 *
 * That recovery is performed below exactly as a `cluster-synthesis` stage
 * handler would have to perform it, which is the point: if a future batch
 * narrowed `memberCandidateIds` too, this spec goes red instead of the gate
 * going quietly `null` in production.
 *
 * `better-sqlite3` is rebuilt against Electron's ABI by postinstall and cannot
 * load under Jest, so `resolveOpener` falls back to Node's built-in
 * `node:sqlite`. Reusing it rather than copying the house native-gate is
 * deliberate: the copied gate makes specs SKIP SILENTLY — green while asserting
 * nothing.
 */
import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import {
  makeBudgetStub,
  makeLogger,
  makeResolverStub,
  resolvedLane,
} from '../lanes/lane-runner.test-support';
import { LaneRunnerService } from '../lanes/lane-runner.service';
import type {
  LaneRunRequest,
  LaneRunResult,
} from '../lanes/lane-runner.service';
import { SkillCandidateStore } from '../skill-candidate.store';
import { SkillCuratorService } from '../skill-curator.service';
import type { SkillCandidateCluster } from '../skill-clustering.service';
import type { ClusterMemberInput } from '../skill-synthesizer.service';
import type { SessionVerdictStore } from '../archaeology/session-verdict.store';
import type {
  ExtractedTrajectory,
  TrajectoryExtractor,
} from '../trajectory-extractor';
import type {
  CandidateId,
  NewSuggestionInput,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from '../types';
import {
  REPLAY_REASONS,
  ReplayValidatorService,
} from './replay-validator.service';
import { clusterSessionIdsOf } from './cluster-holdout';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

const SQL_0033 = MIGRATIONS.find((m) => m.version === 33)?.sql ?? '';
const SQL_0036 = MIGRATIONS.find((m) => m.version === 36)?.sql ?? '';

// ── The real database ───────────────────────────────────────────────────────

/**
 * `openQueueDb` applies `0032` + `0035` — the QUEUE and BUDGET tables — and
 * never creates `skill_candidates`, which predates `0032`. So the base table is
 * built here and `0033` + `0036` are applied FROM `MIGRATIONS`, exactly as
 * `skill-candidate.store.spec.ts` and `replay-validator.service.spec.ts` do. A
 * column renamed in `0036` therefore fails this spec rather than silently
 * disagreeing with it.
 */
function createDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(':memory:');
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

function makeCandidateStore(db: TestDatabase): SkillCandidateStore {
  return new SkillCandidateStore(
    makeLogger() as never,
    { db, vecExtensionLoaded: false, isOpen: true } as never,
    { available: false } as never,
  );
}

// ── Curator collaborators ───────────────────────────────────────────────────

function settings(
  overrides: Partial<SkillSynthesisSettings> = {},
): SkillSynthesisSettings {
  return {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    eligibilityMinTurns: 5,
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinChars: 800,
    prefilterMinToolUses: 2,
    judgeEnabled: false,
    minJudgeScore: 6.0,
    judgeModel: 'claude-haiku-4-5-20251001',
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 1,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
    ...overrides,
  };
}

/** A curator whose host registered no LLM. The overlap pass never runs here. */
function hostlessLaneRunner(): LaneRunnerService {
  return new LaneRunnerService(
    makeLogger(),
    makeResolverStub(resolvedLane('synthesis')).service,
    makeBudgetStub().store,
    null,
    null,
  );
}

const noopMdGenerator = {
  promoteToActive: jest.fn(() => ({
    slug: 'x',
    dir: '/d',
    filePath: '/d/SKILL.md',
  })),
  candidatesRoot: jest.fn(() => '/c'),
  activeRoot: jest.fn(() => '/a'),
  writeCandidate: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillCuratorService>[10];

const allowingRateLimiter = {
  tryAcquire: jest.fn(() => ({ allowed: true })),
  snapshot: jest.fn(() => null),
} as unknown as ConstructorParameters<typeof SkillCuratorService>[3];

interface DraftRun {
  /** What `insertPending` was handed. The persisted shape under test. */
  readonly suggestion: NewSuggestionInput;
  /** The member descriptions the synthesizer was actually allowed to see. */
  readonly synthesizerSaw: readonly ClusterMemberInput[];
  readonly body: string;
}

/**
 * Register `sessionIds.length` real candidates, cluster them, and run ONE real
 * curator suggestion pass over that cluster.
 */
async function runCuratorDraft(
  store: SkillCandidateStore,
  sessionIds: readonly string[],
  minClusterSize: number,
): Promise<DraftRun> {
  const members: SkillCandidateRow[] = sessionIds.map(
    (sessionId, i) =>
      store.registerCandidate({
        name: `bump-the-migration-ratchet-${i}`,
        description: `Use when migration ${i} needs its ratchets bumped.`,
        bodyPath: '',
        sourceSessionIds: [sessionId],
        trajectoryHash: `traj-${sessionId}`,
        embedding: null,
        createdAt: 1_000 + i,
      }).candidate,
  );

  const cluster: SkillCandidateCluster = { members };
  const body = '1. Read the migration registry.\n2. Bump every ratchet.';
  let synthesizerSaw: readonly ClusterMemberInput[] = [];

  const clustering = {
    clusterCandidates: jest.fn(() => [cluster]),
  } as unknown as ConstructorParameters<typeof SkillCuratorService>[7];

  const synthesizer = {
    synthesizeFromCluster: jest.fn(async (seen: ClusterMemberInput[]) => {
      synthesizerSaw = seen;
      return {
        name: 'bump-the-migration-ratchet',
        description: 'Use when a new migration needs its ratchets bumped.',
        body,
      };
    }),
  } as unknown as ConstructorParameters<typeof SkillCuratorService>[8];

  const judge = {
    judge: jest.fn(async () => ({
      status: 'scored',
      score: 8.5,
      criteria: null,
      reason: 'judge-verdict',
    })),
  } as unknown as ConstructorParameters<typeof SkillCuratorService>[9];

  const inserted: NewSuggestionInput[] = [];
  const suggestionStore = {
    hasExistingForCluster: jest.fn(() => false),
    insertPending: jest.fn((input: NewSuggestionInput) => {
      inserted.push(input);
      return { id: 'sug-1' };
    }),
    listByStatus: jest.fn(() => []),
  } as unknown as ConstructorParameters<typeof SkillCuratorService>[6];

  const curator = new SkillCuratorService(
    makeLogger() as never,
    store,
    hostlessLaneRunner(),
    allowingRateLimiter,
    null,
    null,
    suggestionStore,
    clustering,
    synthesizer,
    judge,
    noopMdGenerator,
  );
  curator.start(settings({ suggestionMinClusterSize: minClusterSize }));
  await curator.runManual();
  curator.stop();

  if (inserted.length !== 1) {
    throw new Error(
      `[spec] expected exactly one suggestion, got ${inserted.length}`,
    );
  }
  return { suggestion: inserted[0], synthesizerSaw, body };
}

// ── Replay-gate collaborators ───────────────────────────────────────────────

function makeWorkspace(): IWorkspaceProvider {
  return {
    getConfiguration: <T>(_s: string, _k: string, fallback: T): T => fallback,
  } as unknown as IWorkspaceProvider;
}

function makeVerdicts(): SessionVerdictStore {
  return {
    hasUsableVerdict: jest.fn(() => false),
    findBySession: jest.fn(() => null),
  } as unknown as SessionVerdictStore;
}

function makeTrajectories(): TrajectoryExtractor {
  return {
    extract: jest.fn(
      async (sessionId: string): Promise<ExtractedTrajectory> => ({
        hash: `traj-${sessionId}`,
        canonicalText: `ACTUAL(${sessionId}): bumped five ratchets and re-ran the suite`,
        turnCount: 6,
        sessionTurnCount: 8,
        shortDescription: `ASK(${sessionId}): the new migration broke four older specs`,
        slug: 'the-new-migration-broke',
        editCount: 5,
        toolUseCount: 12,
        bashTestPassed: true,
        charLength: 400,
        hasSuccessMarker: true,
      }),
    ),
  } as unknown as TrajectoryExtractor;
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

function makeReplayLane(results: LaneRunResult[]): {
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

function makeReplayGate(
  store: SkillCandidateStore,
  lane: LaneRunnerService,
): ReplayValidatorService {
  return new ReplayValidatorService(
    makeLogger(),
    makeWorkspace(),
    lane,
    store,
    makeVerdicts(),
    makeTrajectories(),
  );
}

/**
 * Turn a persisted suggestion back into the two arguments the replay gate
 * takes, and register the drafted skill as the candidate that will be graded —
 * exactly what a `cluster-synthesis` stage handler has to do.
 */
function gradedCandidateFor(
  store: SkillCandidateStore,
  suggestion: NewSuggestionInput,
): { candidate: SkillCandidateRow; clusterSessionIds: string[] } {
  const clusterMembers = suggestion.memberCandidateIds.map((id) => {
    const row = store.findById(id as CandidateId);
    if (!row) throw new Error(`[spec] cluster member ${id} vanished`);
    return row;
  });
  const { candidate } = store.registerCandidate({
    name: suggestion.name,
    description: suggestion.description,
    bodyPath: '',
    // The DRAFTED subset — the `used` half of the gate's subtraction.
    sourceSessionIds: suggestion.memberSessionIds,
    trajectoryHash: `cluster-${suggestion.name}`,
    embedding: null,
    createdAt: 5_000,
  });
  return {
    candidate,
    // The FULL cluster, recovered from the members the row still names.
    clusterSessionIds: clusterSessionIdsOf(clusterMembers),
  };
}

// ── The chain ───────────────────────────────────────────────────────────────

describe('hold-out end to end: cluster → draft → row → replay gate', () => {
  maybe(
    'a cluster with a member to spare yields a NON-null replay_holdout_session_id',
    async () => {
      const store = makeCandidateStore(createDb());
      const draft = await runCuratorDraft(store, ['s-a', 's-b', 's-c'], 2);

      // 1. The draft never saw the held-out member.
      expect(draft.synthesizerSaw).toHaveLength(2);
      expect(
        draft.synthesizerSaw.map((m) => m.description).join(' '),
      ).not.toContain('migration 2');

      // 2. The persisted row splits the two lists.
      expect(draft.suggestion.memberSessionIds).toEqual(['s-a', 's-b']);
      expect(draft.suggestion.memberCandidateIds).toHaveLength(3);
      expect(draft.suggestion.clusterSize).toBe(3);

      // 3. The gate's arguments are recoverable from that row.
      const { candidate, clusterSessionIds } = gradedCandidateFor(
        store,
        draft.suggestion,
      );
      expect([...clusterSessionIds].sort()).toEqual(['s-a', 's-b', 's-c']);

      // 4. The gate measures against the session nobody drafted from.
      const lane = makeReplayLane([
        okRun(null, '1. Read the registry.\n2. Bump the ratchets.'),
        okRun({ alignment: 0.72, rationale: 'same route' }),
      ]);
      const result = await makeReplayGate(store, lane.service).validate({
        candidate,
        body: draft.body,
        clusterSessionIds,
        workspaceRoot: 'D:/repo',
      });

      expect(result.status).toBe('measured');
      expect(result.reason).toBe(REPLAY_REASONS.measured);
      expect(result.holdoutSessionId).toBe('s-c');

      const row = store.findById(candidate.id);
      expect(row?.replayHoldoutSessionId).toBe('s-c');
      expect(row?.replayConfidence).toBe(0.72);

      // 5. And the replay call still never saw what the hold-out actually did.
      expect(lane.calls[0].prompt).toContain('ASK(s-c)');
      expect(lane.calls[0].prompt).not.toContain('ACTUAL(s-c)');
    },
  );

  maybe(
    'a cluster at suggestionMinClusterSize yields a null replay_holdout_session_id',
    async () => {
      const store = makeCandidateStore(createDb());
      const draft = await runCuratorDraft(store, ['s-a', 's-b'], 2);

      // Drafted from EVERY member: the floor is never traded for a number.
      expect(draft.synthesizerSaw).toHaveLength(2);
      expect(draft.suggestion.memberSessionIds).toEqual(['s-a', 's-b']);
      expect(draft.suggestion.clusterSize).toBe(2);

      const { candidate, clusterSessionIds } = gradedCandidateFor(
        store,
        draft.suggestion,
      );
      expect([...clusterSessionIds].sort()).toEqual(['s-a', 's-b']);

      const lane = makeReplayLane([
        okRun(null, 'a plan nobody should be asked for'),
        okRun({ alignment: 1 }),
      ]);
      const result = await makeReplayGate(store, lane.service).validate({
        candidate,
        body: draft.body,
        clusterSessionIds,
        workspaceRoot: 'D:/repo',
      });

      expect(result.status).toBe('unmeasured');
      expect(result.reason).toBe(REPLAY_REASONS.noHoldout);
      expect(result.holdoutSessionId).toBeNull();
      // Nothing ran, so nothing was spent and nothing was stamped.
      expect(lane.calls).toHaveLength(0);

      const row = store.findById(candidate.id);
      // `null` means NEVER MEASURED (B3.1). It must not read as a `0`.
      expect(row?.replayHoldoutSessionId).toBeNull();
      expect(row?.replayConfidence).toBeNull();
      expect(row?.replayAt).toBeNull();
    },
  );

  maybe(
    'lowering the floor to 1 makes the SAME two-member cluster measurable',
    async () => {
      const store = makeCandidateStore(createDb());
      const draft = await runCuratorDraft(store, ['s-a', 's-b'], 1);

      expect(draft.synthesizerSaw).toHaveLength(1);
      expect(draft.suggestion.memberSessionIds).toEqual(['s-a']);

      const { candidate, clusterSessionIds } = gradedCandidateFor(
        store,
        draft.suggestion,
      );
      const lane = makeReplayLane([
        okRun(null, '1. Bump the ratchets.'),
        okRun({ alignment: 0 }),
      ]);
      const result = await makeReplayGate(store, lane.service).validate({
        candidate,
        body: draft.body,
        clusterSessionIds,
        workspaceRoot: 'D:/repo',
      });

      expect(result.holdoutSessionId).toBe('s-b');
      const row = store.findById(candidate.id);
      expect(row?.replayHoldoutSessionId).toBe('s-b');
      // A measured 0 is EVIDENCE AGAINST the draft, not "unmeasured".
      expect(row?.replayConfidence).toBe(0);
    },
  );
});
