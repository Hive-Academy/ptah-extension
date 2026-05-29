import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { JsonlReaderService } from '@ptah-extension/agent-sdk';
import type { ITranscriptReader } from '@ptah-extension/memory-contracts';
import {
  CuratorRateLimitService,
  PostToolUseCallbackRegistry,
  PreToolUseCallbackRegistry,
  SessionActivityRegistry,
  SessionEndCallbackRegistry,
  SessionStartCallbackRegistry,
  UserPromptSubmitCallbackRegistry,
  StopCallbackRegistry,
  ToolFailureCallbackRegistry,
  SessionEndHookCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { MemoryTriggerService } from './memory-trigger.service';
import type { MemoryCuratorService } from '../memory-curator.service';
import type { ObservationQueueStore } from '../observation-queue.store';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeCurator(): MemoryCuratorService {
  return {
    curate: jest.fn().mockResolvedValue({
      extracted: 0,
      merged: 0,
      created: 0,
      skipped: 0,
    }),
    pushEvent: jest.fn(),
    recentEvents: jest.fn(() => []),
    lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
  } as unknown as MemoryCuratorService;
}

function makeWorkspace(
  overrides: Partial<Record<string, unknown>> = {},
): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'memory.triggers.idleMs': 0,
    'memory.triggers.turnThreshold': 0,
    'memory.triggers.bootScan': false,
    'memory.triggers.preCompact': true,
    'memory.triggers.userPromptSubmit.enabled': true,
    'memory.triggers.userPromptSubmit.cueList': [
      'remember (this|that)',
      'save to memory',
    ],
    'memory.triggers.userPromptSubmit.minPromptLength': 20,
    'memory.triggers.postToolUse.enabled': true,
    'memory.triggers.maxCuratesPerHour': 12,
    ...overrides,
  };
  return {
    getWorkspaceRoot: jest.fn(() => '/ws'),
    getWorkspaceFolders: jest.fn(() => ['/ws']),
    getConfiguration: jest.fn(
      (_section: string, key: string, def: unknown) => cfg[key] ?? def,
    ),
    setConfiguration: jest.fn().mockResolvedValue(undefined),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;
}

function makeFs(): IFileSystemProvider {
  return {} as unknown as IFileSystemProvider;
}

function makeSqlite(): SqliteConnectionService {
  return {
    db: {
      prepare: jest.fn(() => ({
        get: jest.fn(),
        run: jest.fn(),
      })),
    },
  } as unknown as SqliteConnectionService;
}

function makeJsonl(): JsonlReaderService {
  return {
    findSessionsDirectory: jest.fn().mockResolvedValue(null),
  } as unknown as JsonlReaderService;
}

interface IntegrationHarness {
  service: MemoryTriggerService;
  curator: MemoryCuratorService;
  rateLimiter: CuratorRateLimitService;
  userPromptSubmitRegistry: UserPromptSubmitCallbackRegistry;
  postToolUseRegistry: PostToolUseCallbackRegistry;
  sessionEndRegistry: SessionEndCallbackRegistry;
  activityRegistry: SessionActivityRegistry;
  stopRegistry: StopCallbackRegistry;
  toolFailureRegistry: ToolFailureCallbackRegistry;
  sessionEndHookRegistry: SessionEndHookCallbackRegistry;
}

function buildHarness(opts?: {
  workspace?: IWorkspaceProvider;
  curator?: MemoryCuratorService;
  rateLimiter?: CuratorRateLimitService;
}): IntegrationHarness {
  const logger = makeLogger();
  const curator = opts?.curator ?? makeCurator();
  const workspace = opts?.workspace ?? makeWorkspace();
  const rateLimiter =
    opts?.rateLimiter ?? new CuratorRateLimitService(makeLogger());
  const activityRegistry = new SessionActivityRegistry(makeLogger());
  const sessionEndRegistry = new SessionEndCallbackRegistry(makeLogger());
  const userPromptSubmitRegistry = new UserPromptSubmitCallbackRegistry(
    makeLogger(),
  );
  const postToolUseRegistry = new PostToolUseCallbackRegistry(makeLogger());
  const stopRegistry = new StopCallbackRegistry(makeLogger());
  const toolFailureRegistry = new ToolFailureCallbackRegistry(makeLogger());
  const sessionEndHookRegistry = new SessionEndHookCallbackRegistry(
    makeLogger(),
  );
  const preToolUseRegistry = new PreToolUseCallbackRegistry(makeLogger());
  const sessionStartRegistry = new SessionStartCallbackRegistry(makeLogger());
  const observationQueue = {
    insert: jest.fn(),
    drainForSession: jest.fn(() => []),
    markProcessed: jest.fn(),
    purgeOlderThan: jest.fn(() => 0),
    countUnprocessed: jest.fn(() => 0),
  } as unknown as ObservationQueueStore;
  const transcriptReader = {
    read: jest.fn().mockResolvedValue(''),
  } as unknown as ITranscriptReader;
  const service = new MemoryTriggerService(
    logger,
    curator,
    activityRegistry,
    sessionEndRegistry,
    workspace,
    makeFs(),
    makeSqlite(),
    makeJsonl(),
    userPromptSubmitRegistry,
    postToolUseRegistry,
    stopRegistry,
    toolFailureRegistry,
    sessionEndHookRegistry,
    rateLimiter,
    observationQueue,
    preToolUseRegistry,
    sessionStartRegistry,
    transcriptReader,
  );
  return {
    service,
    curator,
    rateLimiter,
    userPromptSubmitRegistry,
    postToolUseRegistry,
    sessionEndRegistry,
    activityRegistry,
    stopRegistry,
    toolFailureRegistry,
    sessionEndHookRegistry,
  };
}

describe('MemoryTriggerService integration — full event-loop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-21T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('user-cue full loop: prompt with cue → curate fires once with transcript forwarding (R14)', async () => {
    const { service, curator, userPromptSubmitRegistry } = buildHarness();
    service.start();

    userPromptSubmitRegistry.notifyAll({
      prompt: 'please remember this important fact for me later',
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: Date.now(),
    });
    await Promise.resolve();

    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.curate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        workspaceRoot: '/ws',
      }),
    );
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'user-cue-trigger',
        sessionId: 's1',
        stats: expect.objectContaining({ cue: 'remember (this|that)' }),
      }),
    );

    service.stop();
  });

  it('rate-limit exhaustion + hour rollover: cue events at limit=2 → 3rd blocked → after 1h, 4th fires', async () => {
    const { service, curator, userPromptSubmitRegistry } = buildHarness({
      workspace: makeWorkspace({ 'memory.triggers.maxCuratesPerHour': 2 }),
    });
    service.start();

    const t0 = Date.UTC(2026, 4, 21, 10, 0, 0);
    jest.setSystemTime(new Date(t0));

    for (let i = 0; i < 3; i++) {
      userPromptSubmitRegistry.notifyAll({
        prompt: 'please remember this important fact about the project layout',
        sessionId: 's1',
        workspaceRoot: '/ws',
        timestamp: t0 + i,
      });
    }
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(curator.curate).toHaveBeenCalledTimes(2);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'rate-limited',
        stats: expect.objectContaining({ source: 'user-cue', limit: 2 }),
      }),
    );

    jest.setSystemTime(new Date(t0 + 3_600_001));
    userPromptSubmitRegistry.notifyAll({
      prompt: 'please remember this important fact about the project layout',
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: t0 + 3_600_001,
    });
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(curator.curate).toHaveBeenCalledTimes(3);

    service.stop();
  });

  it('PostToolUse commit-detect: Bash git commit fires curate; non-Bash ignored', async () => {
    const { service, curator, postToolUseRegistry } = buildHarness();
    service.start();

    postToolUseRegistry.notifyAll({
      toolName: 'Bash',
      toolInput: { command: 'git commit -m "x"' },
      toolOutput: '',
      exitCode: 0,
      success: true,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 1000,
    });
    await Promise.resolve();

    expect(curator.curate).toHaveBeenCalledTimes(1);
    expect(curator.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'commit-detect', sessionId: 's1' }),
    );

    postToolUseRegistry.notifyAll({
      toolName: 'Edit',
      toolInput: { command: 'noop' },
      toolOutput: '',
      exitCode: 0,
      success: true,
      sessionId: 's1',
      workspaceRoot: '/ws',
      timestamp: 2000,
    });
    await Promise.resolve();

    expect(curator.curate).toHaveBeenCalledTimes(1);

    service.stop();
  });

  it('SessionEnd via real registry clears in-memory state', () => {
    const { service, sessionEndRegistry, activityRegistry, curator } =
      buildHarness({
        workspace: makeWorkspace({
          'memory.triggers.idleMs': 100,
          'memory.triggers.turnThreshold': 0,
        }),
      });
    service.start();

    activityRegistry.notifyAll({
      sessionId: 's1',
      workspaceRoot: '/ws',
      role: 'user',
      timestamp: 1,
    });
    expect(jest.getTimerCount()).toBe(1);

    sessionEndRegistry.notifyAll({ sessionId: 's1', workspaceRoot: '/ws' });
    expect(jest.getTimerCount()).toBe(0);

    jest.advanceTimersByTime(500);
    expect(curator.curate).not.toHaveBeenCalled();

    service.stop();
  });
});
