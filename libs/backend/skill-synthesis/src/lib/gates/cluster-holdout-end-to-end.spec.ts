/**
 * The hold-out, end to end: cluster → draft → persisted row → replay gate.
 *
 * The unit specs beside this file prove `planClusterDraft` agrees with
 * `selectHoldoutSessionId`. That agreement is worth nothing if the UMBRELLA
 * MERGE does not actually route the plan into the row it persists, or if the
 * two persisted lists cannot be turned back into the gate's two arguments. This
 * file runs the whole chain with a REAL `SkillUmbrellaMergeService` (the only
 * cluster-synthesis path since TASK_2026_578), a REAL SQLite-backed
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
import { makeLogger, resolvedLane } from '../lanes/lane-runner.test-support';
import type { LaneRunnerService } from '../lanes/lane-runner.service';
import type {
  LaneRunRequest,
  LaneRunResult,
} from '../lanes/lane-runner.service';
import { SkillCandidateStore } from '../skill-candidate.store';
import type {
  PoolMember,
  PoolPartition,
  SkillClusteringService,
} from '../skill-clustering.service';
import type {
  SkillSynthesizerService,
  UmbrellaMemberInput,
} from '../skill-synthesizer.service';
import type { SkillJudgeService } from '../skill-judge.service';
import type { SkillSuggestionStore } from '../skill-suggestion.store';
import type { SkillBacklogPurgeStateStore } from '../lifecycle/skill-backlog-purge-state.store';
import { SkillUmbrellaMergeService } from '../lifecycle/skill-umbrella-merge.service';
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
/**
 * `skill_synthesis_queue`. Applied only because `0040`'s backfill JOINs it —
 * this fixture inserts no queue row, so that UPDATE is a no-op here.
 */
const SQL_0032 = MIGRATIONS.find((m) => m.version === 32)?.sql ?? '';
/** `workspace_root` on `skill_candidates` — `registerCandidate` writes it. */
const SQL_0040 = MIGRATIONS.find((m) => m.version === 40)?.sql ?? '';

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
  db.exec(SQL_0032);
  db.exec(SQL_0040);
  return db;
}

function makeCandidateStore(db: TestDatabase): SkillCandidateStore {
  return new SkillCandidateStore(
    makeLogger() as never,
    { db, vecExtensionLoaded: false, isOpen: true } as never,
    { available: false } as never,
  );
}

// ── Umbrella-merge collaborators ────────────────────────────────────────────

function settings(
  overrides: Partial<SkillSynthesisSettings> = {},
): SkillSynthesisSettings {
  return {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
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

const allowingRateLimiter = {
  tryAcquire: jest.fn(() => ({ allowed: true })),
  snapshot: jest.fn(() => null),
};

/** The purge already ran, so the pass writes nothing but the umbrella. */
const purgeAlreadyComplete = {
  read: jest.fn(() => ({ cutoffCreatedAt: 0, completedAt: 1, rejected: 0 })),
  markComplete: jest.fn(() => false),
};

/** Every member shares one embedding: centroid ties keep discovery order. */
const SHARED_EMBEDDING = new Float32Array([1, 0, 0, 0]);

interface DraftRun {
  /** What `insert` was handed. The persisted shape under test. */
  readonly suggestion: NewSuggestionInput;
  /** The member inputs the synthesizer was actually allowed to see. */
  readonly synthesizerSaw: readonly UmbrellaMemberInput[];
  readonly body: string;
}

/**
 * Register `sessionIds.length` real candidates, partition them into one
 * cluster, and run ONE real umbrella merge pass over that cluster.
 */
async function runUmbrellaDraft(
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

  const cluster: PoolMember[] = members.map((row) => ({
    kind: 'candidate',
    row,
    embedding: SHARED_EMBEDDING,
  }));
  const partition: PoolPartition = {
    vecAvailable: true,
    truncated: false,
    clusters: [cluster],
    orphans: [],
    unembedded: 0,
  };
  const body = '1. Read the migration registry.\n2. Bump every ratchet.';
  let synthesizerSaw: readonly UmbrellaMemberInput[] = [];

  const clustering = {
    partitionPool: jest.fn(() => partition),
  } as unknown as SkillClusteringService;

  const synthesizer = {
    synthesizeUmbrella: jest.fn(async (seen: UmbrellaMemberInput[]) => {
      synthesizerSaw = seen;
      return {
        name: 'bump-the-migration-ratchet',
        description: 'Use when a new migration needs its ratchets bumped.',
        body,
        references: [],
      };
    }),
  } as unknown as SkillSynthesizerService;

  const judge = {
    judge: jest.fn(async () => ({
      status: 'scored',
      score: 8.5,
      criteria: null,
      reason: 'judge-verdict',
    })),
  } as unknown as SkillJudgeService;

  const inserted: NewSuggestionInput[] = [];
  const suggestionStore = {
    insert: jest.fn((input: NewSuggestionInput) => {
      inserted.push(input);
      return { id: 'sug-1' };
    }),
    markMerged: jest.fn(() => 0),
    findById: jest.fn(() => null),
    listMemberCandidateIds: jest.fn(() => new Set<string>()),
  } as unknown as SkillSuggestionStore;

  const umbrella = new SkillUmbrellaMergeService(
    makeLogger() as never,
    store,
    suggestionStore,
    clustering,
    synthesizer,
    judge,
    allowingRateLimiter as never,
    purgeAlreadyComplete as unknown as SkillBacklogPurgeStateStore,
  );
  const result = await umbrella.runPass(
    settings({ suggestionMinClusterSize: minClusterSize }),
    new Set<string>(),
  );

  if (inserted.length !== 1 || result.umbrellasCreated !== 1) {
    throw new Error(
      `[spec] expected exactly one umbrella suggestion, got ${inserted.length}`,
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
        nonMcpToolUseCount: 12,
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
      const draft = await runUmbrellaDraft(store, ['s-a', 's-b', 's-c'], 2);

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
      const draft = await runUmbrellaDraft(store, ['s-a', 's-b'], 2);

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
      const draft = await runUmbrellaDraft(store, ['s-a', 's-b'], 1);

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
