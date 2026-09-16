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
import { liveSignal } from './queue/skill-drain.test-support';
import type { SkillDrainService } from './queue/skill-drain.service';
import type { SkillPromotionService } from './skill-promotion.service';
import type { SkillSynthesisService } from './skill-synthesis.service';
import type { CandidateId } from './types';
import { TrajectoryExtractor } from './trajectory-extractor';
import {
  chatTranscript,
  codeWorkTranscript,
  makeJsonlReader,
  makeRateLimit,
  makeReachabilityLogger,
  makeWorkspace,
  resolveReachabilityDatabaseFactory,
} from './skill-synthesis.reachability.test-support';

type SessionEnd = (data: { sessionId: string; workspaceRoot: string }) => void;
type CandidateRow = {
  id: string;
  name: string;
  status: string;
  success_count: number;
  source_session_ids: string;
  judge_status: string | null;
};
type QueueRow = { session_id: string; stage: string; status: string; reason: string | null };

const databaseFactory = resolveReachabilityDatabaseFactory();
const describeWithDatabase = databaseFactory ? describe : describe.skip;

describeWithDatabase('skill synthesis production reachability', () => {
  let child: DependencyContainer;
  let connection: SqliteConnectionService;
  let db: SqliteDatabase;
  let synthesis: SkillSynthesisService;
  let drain: SkillDrainService;
  let promotion: SkillPromotionService;
  let sessionEnd: SessionEnd | null = null;
  let candidateId = '' as CandidateId;
  let tempRoot = '';
  let workspaceA = '';
  let workspaceB = '';
  let skillsRoot = '';
  let judgeCallsBeforeAutomatic = 0;

  const synthesisDraft = {
    name: 'nx-worker-verification',
    description: 'Use when changing a worker and verifying it with Nx tests.',
    body: '# Verify a worker change\n\nEdit the worker, then run the focused Nx test target.',
  };
  const judgeVerdict = {
    novelty: 8,
    actionability: 8,
    scope: 8,
    generalization: 8,
    triggerClarity: 8,
  };
  const fakeLane = makeQueryStub([]);
  fakeLane.execute.mockImplementation(async (config: typeof fakeLane.calls[number]) => {
    fakeLane.calls.push(config);
    const isJudge = config.systemPromptAppend?.includes(
      'Evaluate the synthesized skill',
    );
    const payload = isJudge ? judgeVerdict : synthesisDraft;
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
  });

  const scalar = (sql: string, ...params: unknown[]): number => {
    const row = db.prepare(sql).get(...params) as { n: number | bigint };
    return Number(row.n);
  };

  const queueRows = (): QueueRow[] =>
    db
      .prepare(
        `SELECT session_id, stage, status, reason
           FROM skill_synthesis_queue
          ORDER BY session_id, stage`,
      )
      .all() as QueueRow[];

  const candidateRows = (): CandidateRow[] =>
    db
      .prepare(
        `SELECT id, name, status, success_count, source_session_ids, judge_status
           FROM skill_candidates
          ORDER BY created_at, id`,
      )
      .all() as CandidateRow[];

  const boundedPoll = async (predicate: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('bounded poll expired');
  };

  beforeAll(async () => {
    if (!databaseFactory) return;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-skill-reachability-'));
    workspaceA = path.join(tempRoot, 'ws-a');
    workspaceB = path.join(tempRoot, 'ws-b');
    skillsRoot = path.join(tempRoot, 'active-skills');
    const candidatesDir = path.join(tempRoot, 'candidate-skills');
    const dbPath = path.join(tempRoot, 'reachability.sqlite');
    fs.mkdirSync(workspaceA, { recursive: true });
    fs.mkdirSync(workspaceB, { recursive: true });

    const settings = new Map<string, unknown>([
      ['skillSynthesis.enabled', true],
      ['skillSynthesis.skillsRoot', skillsRoot],
      ['skillSynthesis.candidatesDir', candidatesDir],
      ['skillSynthesis.judgeEnabled', true],
      ['skillSynthesis.prefilterMinEdits', 1],
      ['skillSynthesis.prefilterMinToolUses', 2],
      ['skillSynthesis.curatorEnabled', false],
    ]);
    const transcripts = new Map([
      ['s-alpha', codeWorkTranscript(workspaceA)],
      ['s-beta', codeWorkTranscript(workspaceB)],
      ['s-chat', chatTranscript(workspaceA)],
    ]);
    const logger = makeReachabilityLogger();
    const workspace = makeWorkspace(workspaceA, settings);
    const reader = makeJsonlReader(transcripts);

    child = rootContainer.createChildContainer();
    child.register<Logger>(TOKENS.LOGGER, { useValue: logger });
    child.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, { useValue: dbPath });
    child.registerSingleton(SqliteConnectionService);
    child.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useToken: SqliteConnectionService,
    });
    child.register(PERSISTENCE_TOKENS.VEC_STATUS, {
      useValue: { available: false },
    });
    child.register<IWorkspaceProvider>(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
      useValue: workspace,
    });
    child.register(SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY, {
      useValue: {
        register: (callback: SessionEnd) => {
          sessionEnd = callback;
          return () => {
            sessionEnd = null;
          };
        },
      },
    });
    child.register<JsonlReaderService>(SDK_TOKENS.SDK_JSONL_READER, {
      useValue: reader,
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
    drain = child.resolve<SkillDrainService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_DRAIN_SERVICE,
    );
    promotion = child.resolve<SkillPromotionService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_PROMOTION_SERVICE,
    );
  });

  afterAll(() => {
    synthesis?.stop();
    connection?.close();
    child?.reset();
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('1. starts through production DI, proves root-normalized hashes, and enqueues three sessions', async () => {
    const extractor = child.resolve(TrajectoryExtractor);
    const [alpha, beta] = await Promise.all([
      extractor.extract('s-alpha', workspaceA),
      extractor.extract('s-beta', workspaceB),
    ]);
    expect(alpha?.hash).toBeDefined();
    expect(beta?.hash).toBe(alpha?.hash);

    await synthesis.start();
    db = connection.db;
    expect(sessionEnd).not.toBeNull();
    sessionEnd?.({ sessionId: 's-alpha', workspaceRoot: workspaceA });
    sessionEnd?.({ sessionId: 's-beta', workspaceRoot: workspaceB });
    sessionEnd?.({ sessionId: 's-chat', workspaceRoot: workspaceA });
    await boundedPoll(
      () =>
        scalar(
          `SELECT COUNT(*) AS n FROM skill_synthesis_queue WHERE stage = 'prefilter'`,
        ) === 3,
    );
    expect(
      scalar(`SELECT COUNT(*) AS n FROM skill_synthesis_queue WHERE stage = 'prefilter'`),
    ).toBe(3);
  });

  it('2. drains the frequent tier until no prefilter row remains queued', async () => {
    for (let pass = 0; pass < 10; pass++) {
      const before = scalar(
        `SELECT COUNT(*) AS n FROM skill_synthesis_queue
          WHERE stage = 'prefilter' AND status = 'queued'`,
      );
      if (before === 0) return;
      const summary = await drain.drain({
        tier: 'frequent',
        signal: liveSignal(),
        onBattery: false,
      });
      expect(summary.error).toBeUndefined();
      const after = scalar(
        `SELECT COUNT(*) AS n FROM skill_synthesis_queue
          WHERE stage = 'prefilter' AND status = 'queued'`,
      );
      expect(after).toBeLessThan(before);
    }
    throw new Error('prefilter drain exceeded its bounded pass count');
  });

  it('3. leaves one real candidate, reuses its normalized hash, and creates no chat-only work', () => {
    const candidates = candidateRows();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      status: 'candidate',
      success_count: 0,
      source_session_ids: JSON.stringify(['s-alpha']),
    });
    candidateId = candidates[0].id as CandidateId;

    const rows = queueRows();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ session_id: 's-alpha', stage: 'prefilter', status: 'done' }),
        expect.objectContaining({
          session_id: 's-beta',
          stage: 'prefilter',
          status: 'done',
          reason: 'reused existing candidate',
        }),
        expect.objectContaining({
          session_id: 's-chat',
          stage: 'prefilter',
          status: 'skipped',
          reason: 'no candidate from this session',
        }),
      ]),
    );
    expect(
      rows.filter(
        (row) =>
          row.session_id === 's-chat' &&
          ['archaeology', 'judge-panel', 'trigger-eval'].includes(row.stage),
      ),
    ).toHaveLength(0);
    expect(scalar(`SELECT COUNT(*) AS n FROM skill_invocations`)).toBe(0);
  });

  it('4. keeps automatic promotion below threshold without calling the judge lane', async () => {
    judgeCallsBeforeAutomatic = fakeLane.calls.filter((call) =>
      call.systemPromptAppend?.includes('Evaluate the synthesized skill'),
    ).length;
    const decision = await promotion.evaluate(candidateId, synthesis.readSettings());
    expect(decision.reason).toBe('below-threshold');
    expect(
      fakeLane.calls.filter((call) =>
        call.systemPromptAppend?.includes('Evaluate the synthesized skill'),
      ),
    ).toHaveLength(judgeCallsBeforeAutomatic);
    expect(candidateRows()[0].status).toBe('candidate');
  });

  it('5. reaches manual promotion, scores the candidate, and writes active SKILL.md', async () => {
    const decision = await synthesis.promote(candidateId, { userInitiated: true });
    expect(decision).toMatchObject({ promoted: true, reason: 'promoted' });
    const candidate = candidateRows()[0];
    expect(candidate).toMatchObject({ status: 'promoted', judge_status: 'scored' });
    expect(fs.existsSync(path.join(skillsRoot, candidate.name, 'SKILL.md'))).toBe(true);
  });
});
