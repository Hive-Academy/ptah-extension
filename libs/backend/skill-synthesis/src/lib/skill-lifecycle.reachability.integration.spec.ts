/**
 * Skill lifecycle production reachability (TASK_2026_578, acceptance 2, 4, 5).
 *
 * Production DI (`registerSkillSynthesisServices`), a real migrated SQLite
 * file, and a fake LLM lane. `skill_candidates_vec` is a plain
 * `(rowid, embedding BLOB)` table created after `openAndMigrate`, so
 * embeddings round-trip with `VEC_STATUS.available` and no sqlite-vec.
 *
 * Every proof enters through a production entry point and fails when the
 * production call that reaches its pass is removed:
 *  1. `synthesis.start()` → `curator.start` → startup reconcile
 *     (fails without `startReconciliation` in `SkillCuratorService.start`).
 *  2. The curator's 1 h `setInterval` → `runPass` → retirement, umbrella merge
 *     and the one-time backlog purge (fails without the interval, or without
 *     `runRetirementStep` / `runUmbrellaStep` / `runPurge`).
 *  3. `SKILL_CURATOR_SERVICE.acceptSuggestion` → promoted row at the
 *     collision-suffixed slug; stats and slug-keyed invocations (fails without
 *     `promotion.promoteSuggestion`, or when the row is named by
 *     `suggestion.name` instead of `materialized.slug`).
 *  4. The weekly drain → `judge-panel` stage → `below-judge-score` rejection
 *     (fails without the `rejectIfStatus` call in `applyJudgePanelGate`).
 */
import 'reflect-metadata';
import { SDK_TOKENS, type JsonlReaderService } from '@ptah-extension/agent-sdk';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import { registerSkillSynthesisServices } from './di/register';
import {
  INTERNAL_QUERY_SERVICE_TOKEN,
  SKILL_SYNTHESIS_TOKENS,
  USER_LAYER_MIRROR_SERVICE_TOKEN,
} from './di/tokens';
import {
  assistantText,
  makeQueryStub,
  resultMessage,
} from './lanes/lane-runner.test-support';
import type { SkillBacklogPurgeStateStore } from './lifecycle/skill-backlog-purge-state.store';
import { liveSignal } from './queue/skill-drain.test-support';
import type { SkillDrainService } from './queue/skill-drain.service';
import type { SkillQueueStore } from './queue/skill-queue.store';
import { SKILL_QUEUE_PAYLOAD_KEYS } from './queue/skill-queue.types';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillCuratorService } from './skill-curator.service';
import type { SkillInvocationRecorder } from './skill-invocation-recorder';
import type { SkillRegistryStore } from './skill-registry.store';
import type { SkillSuggestionStore } from './skill-suggestion.store';
import type { SkillSynthesisService } from './skill-synthesis.service';
import { UMBRELLA_SYSTEM_PROMPT } from './skill-synthesizer.service';
import {
  BACKLOG_PURGE_REASON,
  MERGED_INTO_PREFIX,
  RETIRED_UNUSED_REASON,
  type CandidateId,
  type SkillCandidateRow,
  type SkillSuggestionRow,
} from './types';
import {
  makeJsonlReader,
  makeRateLimit,
  makeReachabilityLogger,
  makeWorkspace,
  resolveReachabilityDatabaseFactory,
} from './skill-synthesis.reachability.test-support';

// Curator reports go to `~/.ptah/curator-reports`; keep them out of the real home.
jest.mock('node:os', () => {
  const actual = jest.requireActual<typeof import('node:os')>('node:os');
  const nodePath = jest.requireActual<typeof import('node:path')>('node:path');
  return {
    ...actual,
    homedir: () =>
      nodePath.join(actual.tmpdir(), 'ptah-lifecycle-reachability-home'),
  };
});

type SessionEnd = (data: { sessionId: string; workspaceRoot: string }) => void;
type QueueRow = { stage: string; status: string; reason: string | null };

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DIM = 8;
const PROOF_TIMEOUT_MS = 30_000;

const databaseFactory = resolveReachabilityDatabaseFactory();
const describeWithDatabase = databaseFactory ? describe : describe.skip;

/** Unit vector on `axis`. */
function unitVector(axis: number): Float32Array {
  const v = new Float32Array(DIM);
  v[axis] = 1;
  return v;
}

function skillMd(name: string, body: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: Use when exercising the ${name} lifecycle fixture.`,
    `when_to_use: Use when exercising the ${name} lifecycle fixture.`,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

/** The `name:` frontmatter value of a SKILL.md — what the Skill tool's command names (A4). */
function frontmatterName(filePath: string): string | null {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const match = /^---\n[\s\S]*?^name:\s*(.+)$[\s\S]*?\n---\n/m.exec(raw);
  return match ? match[1].trim() : null;
}

/** Polls until `predicate` holds; resolves `false` when the budget runs out. */
async function settle(predicate: () => boolean, attempts = 500): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

describeWithDatabase('skill lifecycle production reachability', () => {
  let child: DependencyContainer;
  let connection: SqliteConnectionService;
  let db: SqliteDatabase;
  let logger: Logger;
  let synthesis: SkillSynthesisService;
  let store: SkillCandidateStore;
  let suggestions: SkillSuggestionStore;
  let registry: SkillRegistryStore;
  let curator: SkillCuratorService;
  let purgeState: SkillBacklogPurgeStateStore;
  let queue: SkillQueueStore;
  let drain: SkillDrainService;
  let recorder: SkillInvocationRecorder;
  let tempRoot = '';
  let workspaceRoot = '';
  let skillsRoot = '';
  let judgeCriterion = 8;
  let umbrellaId = '';

  const now = Date.now();
  const ids: {
    clustered: CandidateId[];
    orphan: CandidateId | null;
    idle45: CandidateId | null;
    idle100: CandidateId | null;
    pinned100: CandidateId | null;
    recentlyUsed: CandidateId | null;
    acceptedSuggestion: string;
  } = {
    clustered: [],
    orphan: null,
    idle45: null,
    idle100: null,
    pinned100: null,
    recentlyUsed: null,
    acceptedSuggestion: '',
  };

  const reconcileSlug = 'adopt-accepted-lifecycle-skill';
  const reconcileBody =
    '# Adopt an accepted skill\n\nLink the accepted suggestion to its materialized directory.';
  const umbrellaDraft = {
    name: 'verify-worker-changes',
    description:
      'Use when changing a worker and verifying it with the focused Nx test target.',
    body: '# Verify worker changes\n\nEdit the worker, then run the focused Nx test target.',
    references: [],
  };

  const fakeLane = makeQueryStub([]);
  fakeLane.execute.mockImplementation(
    async (config: (typeof fakeLane.calls)[number]) => {
      fakeLane.calls.push(config);
      const isUmbrella =
        config.systemPromptAppend?.includes(UMBRELLA_SYSTEM_PROMPT) === true;
      const payload = isUmbrella
        ? umbrellaDraft
        : {
            novelty: judgeCriterion,
            actionability: judgeCriterion,
            scope: judgeCriterion,
            generalization: judgeCriterion,
            triggerClarity: judgeCriterion,
          };
      const messages = [
        assistantText(JSON.stringify(payload)),
        resultMessage({
          subtype: 'success',
          structured_output: payload,
          result: JSON.stringify(payload),
        }),
      ];
      return {
        stream: (async function* () {
          for (const message of messages) yield message;
        })(),
        abort: jest.fn(),
        close: jest.fn(),
      };
    },
  );

  const candidate = (id: CandidateId | null): SkillCandidateRow | null =>
    id === null ? null : store.findById(id);

  const loggedInfo = (message: string): boolean =>
    (logger.info as jest.Mock).mock.calls.some(
      ([first]: unknown[]) => first === message,
    );

  /** A promoted, materialized, `synth`-registered skill idle since `promotedAt`. */
  const seedPromoted = (name: string, promotedAt: number): CandidateId => {
    const dir = path.join(skillsRoot, name);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'SKILL.md');
    fs.writeFileSync(filePath, skillMd(name, `# ${name}\n\nFixture body.`), 'utf8');
    const { candidate: row } = store.registerCandidate({
      name,
      description: `Fixture ${name}`,
      bodyPath: filePath,
      sourceSessionIds: [`sess-${name}`],
      trajectoryHash: `seed:${name}`,
      embedding: null,
      createdAt: promotedAt,
      workspaceRoot: null,
    });
    const promoted = store.promoteAtomically(row.id, {
      promotedAt,
      bodyPath: filePath,
      name,
    });
    registry.upsert({
      slug: name,
      kind: 'skill',
      userPath: filePath,
      originPluginId: null,
      originVersion: null,
      sourceHash: null,
      cloneStatus: 'synth',
      diverged: false,
      historyDir: null,
      lastEnhancedAt: null,
      candidateId: promoted.id,
      pendingSourceHash: null,
    });
    return promoted.id;
  };

  const seedCandidate = (
    name: string,
    embedding: Float32Array,
    createdAt: number,
  ): CandidateId =>
    store.registerCandidate({
      name,
      description: `Use when ${name.replace(/-/g, ' ')}.`,
      bodyPath: path.join(tempRoot, 'candidate-bodies', name, 'SKILL.md'),
      sourceSessionIds: [`sess-${name}`],
      trajectoryHash: `seed:${name}`,
      embedding,
      createdAt,
      workspaceRoot,
    }).candidate.id;

  const seedAcceptedSuggestion = (): string => {
    const dir = path.join(skillsRoot, reconcileSlug);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'SKILL.md');
    fs.writeFileSync(filePath, skillMd(reconcileSlug, reconcileBody), 'utf8');
    const pending = suggestions.insert(
      {
        name: reconcileSlug,
        description: 'Use when an accepted suggestion lost its candidate link.',
        body: reconcileBody,
        memberSessionIds: ['sess-accepted'],
        memberCandidateIds: [],
        clusterSize: 1,
        technologyFingerprint: 'general',
        judgeScore: 8,
      },
      'pending',
    );
    // Accepted the way the pre-578 curator accepted: no promoted candidate.
    suggestions.accept(pending.id, null);
    registry.upsert({
      slug: reconcileSlug,
      kind: 'skill',
      userPath: filePath,
      originPluginId: null,
      originVersion: null,
      sourceHash: null,
      cloneStatus: 'synth',
      diverged: false,
      historyDir: null,
      lastEnhancedAt: null,
      candidateId: null,
      pendingSourceHash: null,
    });
    return pending.id;
  };

  beforeAll(async () => {
    if (!databaseFactory) return;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-lifecycle-reach-'));
    workspaceRoot = path.join(tempRoot, 'ws');
    skillsRoot = path.join(tempRoot, 'active-skills');
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const settings = new Map<string, unknown>([
      ['skillSynthesis.enabled', true],
      ['skillSynthesis.skillsRoot', skillsRoot],
      ['skillSynthesis.candidatesDir', path.join(tempRoot, 'candidate-skills')],
      ['skillSynthesis.judgeEnabled', true],
      ['skillSynthesis.curatorEnabled', true],
      ['skillSynthesis.curatorIntervalHours', 1],
      ['skillSynthesis.retirement.dormantAfterDays', 30],
      ['skillSynthesis.retirement.retireAfterDormantDays', 30],
    ]);
    logger = makeReachabilityLogger();

    child = rootContainer.createChildContainer();
    child.register<Logger>(TOKENS.LOGGER, { useValue: logger });
    child.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, {
      useValue: path.join(tempRoot, 'lifecycle.sqlite'),
    });
    child.registerSingleton(SqliteConnectionService);
    child.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useToken: SqliteConnectionService,
    });
    child.register(PERSISTENCE_TOKENS.VEC_STATUS, {
      useValue: { available: true },
    });
    child.register<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
      useValue: makeWorkspace(workspaceRoot, settings),
    });
    child.register(SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY, {
      useValue: {
        register: (_callback: SessionEnd) => () => undefined,
      },
    });
    child.register<JsonlReaderService>(SDK_TOKENS.SDK_JSONL_READER, {
      useValue: makeJsonlReader(new Map()),
    });
    child.register(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT, {
      useValue: makeRateLimit(),
    });
    child.register(INTERNAL_QUERY_SERVICE_TOKEN, { useValue: fakeLane.query });
    child.register(USER_LAYER_MIRROR_SERVICE_TOKEN, {
      useValue: { mirrorAll: jest.fn(async () => undefined) },
    });

    connection = child.resolve(SqliteConnectionService);
    connection.configure({
      factory: databaseFactory.factory,
      vecPathResolver: null,
      vecPathPlatformResolver: null,
      vecPathFallbackResolver: null,
    });
    registerSkillSynthesisServices(child, logger);
    synthesis = child.resolve<SkillSynthesisService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
    );
    store = child.resolve<SkillCandidateStore>(
      SKILL_SYNTHESIS_TOKENS.SKILL_CANDIDATE_STORE,
    );
    suggestions = child.resolve<SkillSuggestionStore>(
      SKILL_SYNTHESIS_TOKENS.SKILL_SUGGESTION_STORE,
    );
    registry = child.resolve<SkillRegistryStore>(
      SKILL_SYNTHESIS_TOKENS.SKILL_REGISTRY_STORE,
    );
    curator = child.resolve<SkillCuratorService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_CURATOR_SERVICE,
    );
    purgeState = child.resolve<SkillBacklogPurgeStateStore>(
      SKILL_SYNTHESIS_TOKENS.SKILL_BACKLOG_PURGE_STATE_STORE,
    );
    queue = child.resolve<SkillQueueStore>(
      SKILL_SYNTHESIS_TOKENS.SKILL_QUEUE_STORE,
    );
    drain = child.resolve<SkillDrainService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE,
    );
    recorder = child.resolve<SkillInvocationRecorder>(
      SKILL_SYNTHESIS_TOKENS.SKILL_INVOCATION_RECORDER,
    );

    // Migrate first so the seed lands before `start()`; `start()` then finds
    // the connection open and skips its own `openAndMigrate`.
    await connection.openAndMigrate();
    db = connection.db;
    db.exec(
      `CREATE TABLE skill_candidates_vec (rowid INTEGER PRIMARY KEY, embedding BLOB)`,
    );

    const umbrellaAxis = unitVector(0);
    ids.clustered = ['verify-worker-alpha', 'verify-worker-beta', 'verify-worker-gamma'].map(
      (name) => seedCandidate(name, umbrellaAxis, now - DAY_MS),
    );
    ids.orphan = seedCandidate('stale-orphan-draft', unitVector(1), now - 40 * DAY_MS);
    ids.idle45 = seedPromoted('idle-forty-five-days', now - 45 * DAY_MS);
    ids.idle100 = seedPromoted('idle-hundred-days', now - 100 * DAY_MS);
    ids.pinned100 = seedPromoted('pinned-hundred-days', now - 100 * DAY_MS);
    store.setPin(ids.pinned100, true, synthesis.readSettings().maxPinnedSkills);
    ids.recentlyUsed = seedPromoted('recently-used-skill', now - 100 * DAY_MS);
    store.recordSkillEvent({
      skillSlug: 'recently-used-skill',
      sessionId: 'sess-recent-use',
      workspaceRoot,
      contextId: null,
      source: 'tool-use',
      succeeded: true,
      isError: false,
      invokedAt: now - DAY_MS,
    });
    ids.acceptedSuggestion = seedAcceptedSuggestion();
  });

  afterAll(() => {
    try {
      synthesis?.stop();
      connection?.close();
      child?.reset();
    } finally {
      jest.useRealTimers();
      if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
      fs.rmSync(path.join(os.tmpdir(), 'ptah-lifecycle-reachability-home'), {
        recursive: true,
        force: true,
      });
    }
  });

  it(
    '1. synthesis.start() reaches the startup reconcile, which links the accepted suggestion to a promoted row',
    async () => {
      expect(store.findByName(reconcileSlug)).toBeNull();
      expect(registry.getBySlug('skill', reconcileSlug)?.candidateId).toBeNull();

      // Only the interval clock is fake: the curator's 1 h pass is driven in
      // proof 2, while every other timer and `Date` stay real.
      jest.useFakeTimers({
        doNotFake: [
          'Date',
          'hrtime',
          'nextTick',
          'performance',
          'queueMicrotask',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'requestIdleCallback',
          'cancelIdleCallback',
          'setImmediate',
          'clearImmediate',
          'setTimeout',
          'clearTimeout',
        ],
      });
      await synthesis.start();

      await settle(
        () =>
          suggestions.findById(ids.acceptedSuggestion)?.promotedCandidateId !=
          null,
      );
      const linked = suggestions.findById(ids.acceptedSuggestion);
      const adopted = store.findByName(reconcileSlug);
      expect(adopted).toMatchObject({ name: reconcileSlug, status: 'promoted' });
      expect(linked?.promotedCandidateId).toBe(adopted?.id);
      expect(registry.getBySlug('skill', reconcileSlug)?.candidateId).toBe(
        adopted?.id,
      );
    },
    PROOF_TIMEOUT_MS,
  );

  it(
    '2. the 1 h curator interval reaches retirement, the umbrella merge and the backlog purge',
    async () => {
      expect(purgeState.read()).toBeNull();
      expect(loggedInfo('[skill-curator] report written')).toBe(false);

      jest.advanceTimersByTime(HOUR_MS);
      await settle(() => loggedInfo('[skill-curator] report written'));

      // Umbrella merge: one pending umbrella over the three clustered drafts,
      // each rejected `merged-into:<umbrella id>`.
      const umbrellas = suggestions
        .listByStatus('pending')
        .filter((row: SkillSuggestionRow) => row.name === umbrellaDraft.name);
      expect(umbrellas).toHaveLength(1);
      umbrellaId = umbrellas[0].id;
      expect([...umbrellas[0].memberCandidateIds].sort()).toEqual(
        [...ids.clustered].sort(),
      );
      for (const id of ids.clustered) {
        expect(candidate(id)).toMatchObject({
          status: 'rejected',
          rejectedReason: `${MERGED_INTO_PREFIX}${umbrellaId}`,
        });
      }

      // Backlog purge: the 40-day orphan is rejected and the marker written.
      expect(candidate(ids.orphan)).toMatchObject({
        status: 'rejected',
        rejectedReason: BACKLOG_PURGE_REASON,
      });
      expect(purgeState.read()).not.toBeNull();

      // Retirement: 45 days idle → dormant; 100 days → retired, directory and
      // `synth` registry row gone; pinned and recently used untouched.
      expect(candidate(ids.idle45)).toMatchObject({
        status: 'promoted',
        residency: 'dormant',
      });
      expect(candidate(ids.idle100)).toMatchObject({
        status: 'rejected',
        rejectedReason: RETIRED_UNUSED_REASON,
      });
      expect(fs.existsSync(path.join(skillsRoot, 'idle-hundred-days'))).toBe(false);
      expect(registry.getBySlug('skill', 'idle-hundred-days')).toBeNull();
      expect(candidate(ids.pinned100)).toMatchObject({
        status: 'promoted',
        residency: 'resident',
        pinned: true,
      });
      expect(
        fs.existsSync(path.join(skillsRoot, 'pinned-hundred-days', 'SKILL.md')),
      ).toBe(true);
      expect(candidate(ids.recentlyUsed)).toMatchObject({
        status: 'promoted',
        residency: 'resident',
      });
    },
    PROOF_TIMEOUT_MS,
  );

  it(
    '3. acceptSuggestion promotes at the collision-suffixed slug, raises Promoted/Active and counts invocations by that slug (A4)',
    async () => {
      expect(umbrellaId).not.toBe('');
      const baseSlug = umbrellaDraft.name;
      const suffixedSlug = `${baseSlug}-2`;
      // A directory already holds the base slug, so materialization takes `-2`.
      fs.mkdirSync(path.join(skillsRoot, baseSlug), { recursive: true });
      const before = store.getStats();

      const result = await curator.acceptSuggestion(
        umbrellaId,
        synthesis.readSettings(),
        { userInitiated: true },
      );

      expect(result.accepted).toBe(true);
      const promoted = store.findByName(suffixedSlug);
      expect(promoted).toMatchObject({ status: 'promoted', residency: 'resident' });
      expect(store.findByName(baseSlug)).toBeNull();
      expect(suggestions.findById(umbrellaId)).toMatchObject({
        status: 'accepted',
        promotedCandidateId: promoted?.id,
      });
      const after = store.getStats();
      expect(after.promoted).toBe(before.promoted + 1);
      expect(after.active).toBe(before.active + 1);

      // A4: the directory, the SKILL.md `name:` the Skill tool invokes by, and
      // the row's `name` are one slug.
      expect(result.filePath).toBe(path.join(skillsRoot, suffixedSlug, 'SKILL.md'));
      const invokedSlug = frontmatterName(result.filePath);
      expect(invokedSlug).toBe(suffixedSlug);

      const event = (slug: string, sessionId: string) =>
        recorder.recordSkillEvent({
          slug,
          sessionId,
          workspaceRoot,
          contextId: null,
          succeeded: true,
          invokedAt: Date.now(),
          source: 'tool-use',
        });
      event(invokedSlug ?? '', 'sess-suffixed-use');
      event(baseSlug, 'sess-base-use');

      expect(store.getStats().invocations).toBe(after.invocations + 1);
      const shown = store.listInvocationEvents(promoted?.id as CandidateId, 10);
      expect(shown).toHaveLength(1);
      expect(shown[0]).toMatchObject({ sessionId: 'sess-suffixed-use' });
    },
    PROOF_TIMEOUT_MS,
  );

  it(
    '4. the weekly drain runs the judge-panel stage, which rejects a candidate scored below minJudgeScore',
    async () => {
      judgeCriterion = 3;
      const fresh = seedCandidate('fresh-weekly-draft', unitVector(2), Date.now());
      const sessionId = 'sess-weekly-judge';
      queue.enqueue({
        sessionId,
        stage: 'judge-panel',
        source: 'session-end',
        workspaceRoot,
        turnCount: 4,
        payload: { [SKILL_QUEUE_PAYLOAD_KEYS.candidateId]: fresh },
      });
      const judgeRow = (): QueueRow | undefined =>
        db
          .prepare(
            `SELECT stage, status, reason FROM skill_synthesis_queue
              WHERE session_id = ? AND stage = 'judge-panel'`,
          )
          .get(sessionId) as QueueRow | undefined;

      for (let pass = 0; pass < 5 && judgeRow()?.status === 'queued'; pass++) {
        const summary = await drain.drain({
          tier: 'weekly',
          signal: liveSignal(),
          onBattery: false,
        });
        expect(summary.error).toBeUndefined();
      }

      expect(judgeRow()).toMatchObject({ status: 'done' });
      expect(judgeRow()?.reason).toMatch(/:rejected$/);
      expect(candidate(fresh)).toMatchObject({
        status: 'rejected',
        rejectedReason: 'below-judge-score',
      });
    },
    PROOF_TIMEOUT_MS,
  );
});
