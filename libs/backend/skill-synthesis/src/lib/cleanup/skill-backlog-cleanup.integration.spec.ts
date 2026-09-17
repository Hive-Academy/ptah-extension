import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { JsonlReaderService } from '@ptah-extension/agent-sdk';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  MIGRATIONS,
  type VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { SessionVerdictStore } from '../archaeology/session-verdict.store';
import { SkillCandidateStore } from '../skill-candidate.store';
import { TrajectoryExtractor } from '../trajectory-extractor';
import { ForegroundActivityTracker } from '../queue/foreground-activity.tracker';
import { SkillQueueStore } from '../queue/skill-queue.store';
import {
  asConnection,
  makeTempDbPath,
  noopLogger,
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import { SkillBacklogCleanupService } from './skill-backlog-cleanup.service';
import { SkillBacklogCleanupStore } from './skill-backlog-cleanup.store';
import { SessionTranscriptLocator } from './session-transcript-locator';

const opener = resolveOpener();
const maybe = opener ? it : it.skip;

function openDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(makeTempDbPath());
  for (const item of MIGRATIONS.filter(
    (entry): entry is typeof entry & { sql: string } =>
      entry.version <= 45 && typeof entry.sql === 'string',
  ).sort((left, right) => left.version - right.version)) {
    db.exec(item.sql);
  }
  return db;
}

function messages(kind: 'edit' | 'conversation'): unknown[] {
  const assistantContent =
    kind === 'edit'
      ? [
          { type: 'text', text: 'I changed the file.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: 'a.ts' } },
        ]
      : [{ type: 'text', text: 'Here is an explanation.' }];
  return [
    { type: 'user', message: { role: 'user', content: 'Please help.' } },
    {
      type: 'assistant',
      message: { role: 'assistant', content: assistantContent },
    },
  ];
}

describe('skill backlog cleanup integration', () => {
  let db: TestDatabase;
  const tempRoots: string[] = [];

  afterEach(() => {
    db?.close();
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  maybe(
    'cleans the historical backlog once and preserves real invocation telemetry',
    async () => {
      db = openDb();
      const connection = asConnection(db);
      const candidates = new SkillCandidateStore(noopLogger, connection, {
        available: false,
      } as VecStatusService);
      const queue = new SkillQueueStore(noopLogger, connection);
      const verdicts = new SessionVerdictStore(noopLogger, connection);
      const cleanupStore = new SkillBacklogCleanupStore(connection);
      const tempRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'thoth-cleanup-integration-'),
      );
      tempRoots.push(tempRoot);
      const transcriptDirectory = path.join(tempRoot, 'sessions');
      fs.mkdirSync(transcriptDirectory);
      const lookupEvidencePath = path.join(
        transcriptDirectory,
        'lookup-evidence-session.jsonl',
      );
      fs.writeFileSync(lookupEvidencePath, '{}\n');

      const register = (
        name: string,
        sessionId: string,
        createdAt: number,
        workspaceRoot: string | null = '/workspace',
      ) =>
        candidates.registerCandidate({
          name,
          description: `${name} description`,
          bodyPath: `/tmp/${name}/SKILL.md`,
          sourceSessionIds: [sessionId],
          trajectoryHash: `${name}-hash`,
          embedding: null,
          createdAt,
          workspaceRoot,
        }).candidate;

      const edit = register('edit', 'edit-session', 10);
      const chat = register('chat', 'chat-session', 11);
      const verdict = register('verdict', 'verdict-session', 12);
      const degraded = register('degraded', 'degraded-session', 13);
      const missing = register('missing', 'missing-session', 14);
      const fallback = register('fallback', 'fallback-session', 15, null);
      const lookupEvidence = register(
        'lookup-evidence',
        'lookup-evidence-session',
        16,
        null,
      );
      const noFile = register('no-file', 'no-file-session', 17, null);
      const after = register('after', 'after-session', 1_001);

      verdicts.save({
        sessionId: 'verdict-session',
        workspaceRoot: '/workspace',
        evidenceClass: 'tests-green',
        turnCount: 2,
      });
      verdicts.recordDegraded('degraded-session', 'no-query-path', {
        workspaceRoot: '/workspace',
        turnCount: 2,
      });
      queue.enqueue({
        sessionId: 'fallback-session',
        workspaceRoot: '/fallback-workspace',
        transcriptPath: '/fixtures/fallback.jsonl',
        source: 'session-end',
        stage: 'prefilter',
        turnCount: 2,
      });

      const transcriptByPath = new Map<string, unknown[]>([
        ['/sessions/edit-session.jsonl', messages('edit')],
        ['/sessions/chat-session.jsonl', messages('conversation')],
        ['/fixtures/fallback.jsonl', messages('edit')],
        ['/sessions/after-session.jsonl', messages('edit')],
        [lookupEvidencePath, messages('edit')],
      ]);
      const reader = {
        findSessionsDirectory: jest.fn(async () => '/sessions'),
        readJsonlMessages: jest.fn(async (file: string) => {
          const value = transcriptByPath.get(file);
          if (!value) throw new Error('missing transcript');
          return value;
        }),
      } as unknown as JsonlReaderService;
      const extractor = new TrajectoryExtractor(noopLogger, reader);
      const transcriptLocator = new SessionTranscriptLocator({
        listSessionsDirectories: async () => [transcriptDirectory],
      });
      const foreground = {
        start: jest.fn(),
        msSinceLastActivity: jest.fn(() => Number.POSITIVE_INFINITY),
      } as unknown as ForegroundActivityTracker;
      const workspace = {
        getConfiguration: <T>(_section: string, key: string, fallback?: T) => {
          if (key === 'skillSynthesis.drain.bootDeferralMs') return 0 as T;
          return fallback;
        },
      } as unknown as IWorkspaceProvider;
      const service = new SkillBacklogCleanupService(
        noopLogger,
        cleanupStore,
        verdicts,
        queue,
        extractor,
        transcriptLocator,
        foreground,
        workspace,
      );

      const invocation = db.prepare(
        `INSERT INTO skill_invocations
         (id, skill_id, session_id, succeeded, invoked_at, context_id)
       VALUES (?, ?, ?, 1, 20, ?)`,
      );
      invocation.run('tracker', edit.id, 'tracker-session', null);
      invocation.run('fake-1', chat.id, 'fake-session-1', 'ctx-1');
      invocation.run('fake-2', missing.id, 'fake-session-2', 'ctx-2');

      const report = await service.run({
        signal: new AbortController().signal,
        isOnBattery: () => false,
        now: () => 1_000,
      });
      expect(report).toMatchObject({
        status: 'completed',
        examined: 8,
        keptEvidence: 3,
        keptVerdict: 1,
        keptDegradedVerdict: 1,
        rejectedNoEvidence: 1,
        rejectedTranscriptUnreadable: 2,
        rejectedNoTranscript: 1,
        keptRootUnknown: 0,
        invocationsDeleted: 2,
      });

      const byId = new Map(
        [
          edit,
          chat,
          verdict,
          degraded,
          missing,
          fallback,
          lookupEvidence,
          noFile,
          after,
        ].map((item) => {
          const current = candidates.findById(item.id);
          if (!current) throw new Error(`candidate ${item.id} disappeared`);
          return [item.name, current] as const;
        }),
      );
      expect(byId.get('edit')?.status).toBe('candidate');
      expect(byId.get('fallback')?.status).toBe('candidate');
      expect(byId.get('lookup-evidence')?.status).toBe('candidate');
      expect(byId.get('verdict')?.status).toBe('candidate');
      expect(byId.get('degraded')?.status).toBe('candidate');
      expect(byId.get('chat')).toMatchObject({
        status: 'rejected',
        rejectedReason: 'backlog-cleanup: no code evidence and no verdict',
      });
      expect(byId.get('missing')).toMatchObject({
        status: 'rejected',
        rejectedReason: 'backlog-cleanup: transcript unreadable and no verdict',
      });
      expect(byId.get('no-file')).toMatchObject({
        status: 'rejected',
        rejectedReason: 'backlog-cleanup: no transcript found for any session',
      });
      expect(byId.get('after')?.status).toBe('candidate');
      expect(
        db.prepare(`SELECT id FROM skill_invocations ORDER BY id`).all(),
      ).toEqual([{ id: 'tracker' }]);
      expect(cleanupStore.readState()).toMatchObject({
        finishedAt: 1_000,
        examined: 8,
        invocationsDeleted: 2,
      });

      await expect(
        service.run({
          signal: new AbortController().signal,
          isOnBattery: () => false,
          now: () => 2_000,
        }),
      ).resolves.toEqual({ status: 'skipped', reason: 'complete' });
    },
  );

  maybe(
    'keeps a root-unknown candidate when directory listing is unavailable',
    async () => {
      db = openDb();
      const connection = asConnection(db);
      const candidates = new SkillCandidateStore(noopLogger, connection, {
        available: false,
      } as VecStatusService);
      const queue = new SkillQueueStore(noopLogger, connection);
      const verdicts = new SessionVerdictStore(noopLogger, connection);
      const cleanupStore = new SkillBacklogCleanupStore(connection);
      const candidate = candidates.registerCandidate({
        name: 'unavailable',
        description: 'unavailable description',
        bodyPath: '/tmp/unavailable/SKILL.md',
        sourceSessionIds: ['unavailable-session'],
        trajectoryHash: 'unavailable-hash',
        embedding: null,
        createdAt: 10,
        workspaceRoot: null,
      }).candidate;
      const reader = {
        findSessionsDirectory: jest.fn(async () => null),
        readJsonlMessages: jest.fn(),
      } as unknown as JsonlReaderService;
      const service = new SkillBacklogCleanupService(
        noopLogger,
        cleanupStore,
        verdicts,
        queue,
        new TrajectoryExtractor(noopLogger, reader),
        new SessionTranscriptLocator({
          listSessionsDirectories: async () => null,
        }),
        {
          start: jest.fn(),
          msSinceLastActivity: jest.fn(() => Number.POSITIVE_INFINITY),
        } as unknown as ForegroundActivityTracker,
        {
          getConfiguration: <T>(_section: string, key: string, fallback?: T) =>
            key === 'skillSynthesis.drain.bootDeferralMs' ? (0 as T) : fallback,
        } as unknown as IWorkspaceProvider,
      );

      await expect(
        service.run({
          signal: new AbortController().signal,
          isOnBattery: () => false,
          now: () => 1_000,
        }),
      ).resolves.toMatchObject({
        status: 'completed',
        keptRootUnknown: 1,
        rejectedNoTranscript: 0,
      });
      expect(candidates.findById(candidate.id)?.status).toBe('candidate');
    },
  );
});
