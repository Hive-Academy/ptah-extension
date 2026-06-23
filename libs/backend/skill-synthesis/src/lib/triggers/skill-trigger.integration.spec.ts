import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { JsonlReaderService } from '@ptah-extension/agent-sdk';
import {
  CuratorRateLimitService,
  PostToolUseCallbackRegistry,
  SessionActivityRegistry,
  SessionEndCallbackRegistry,
  StopCallbackRegistry,
  SubagentStopCallbackRegistry,
  UserPromptExpansionCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { SkillTriggerService } from './skill-trigger.service';
import type { SkillSynthesisService } from '../skill-synthesis.service';
import type { SkillInvocationRecorder } from '../skill-invocation-recorder';

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeSynthesis(): SkillSynthesisService {
  return {
    analyzeSession: jest.fn().mockResolvedValue(null),
    pushEvent: jest.fn(),
    recentEvents: jest.fn(() => []),
    getEligibilityHistogram: jest.fn(() => ({
      prefilterTooThin: 0,
      prefilterRejected: 0,
      accepted: 0,
    })),
    lastRunSummary: jest.fn(() => ({
      lastAnalyzeRunAt: null,
      lastCuratorPassAt: null,
    })),
  } as unknown as SkillSynthesisService;
}

function makeWorkspace(
  overrides: Partial<Record<string, unknown>> = {},
): IWorkspaceProvider {
  const cfg: Record<string, unknown> = {
    'skillSynthesis.triggers.sessionEnd': true,
    'skillSynthesis.triggers.idleMs': 0,
    'skillSynthesis.triggers.bootScan': false,
    'skillSynthesis.triggers.subagentStop.enabled': true,
    'skillSynthesis.triggers.postToolUse.enabled': true,
    'skillSynthesis.triggers.postToolUse.minEditCount': 3,
    'skillSynthesis.triggers.maxAnalyzesPerHour': 6,
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
  service: SkillTriggerService;
  synthesis: SkillSynthesisService;
  rateLimiter: CuratorRateLimitService;
  subagentStopRegistry: SubagentStopCallbackRegistry;
  postToolUseRegistry: PostToolUseCallbackRegistry;
  sessionEndRegistry: SessionEndCallbackRegistry;
  activityRegistry: SessionActivityRegistry;
  stopRegistry: StopCallbackRegistry;
}

function buildHarness(opts?: {
  workspace?: IWorkspaceProvider;
  synthesis?: SkillSynthesisService;
  rateLimiter?: CuratorRateLimitService;
}): IntegrationHarness {
  const logger = makeLogger();
  const synthesis = opts?.synthesis ?? makeSynthesis();
  const workspace = opts?.workspace ?? makeWorkspace();
  const rateLimiter =
    opts?.rateLimiter ?? new CuratorRateLimitService(makeLogger());
  const activityRegistry = new SessionActivityRegistry(makeLogger());
  const sessionEndRegistry = new SessionEndCallbackRegistry(makeLogger());
  const subagentStopRegistry = new SubagentStopCallbackRegistry(makeLogger());
  const postToolUseRegistry = new PostToolUseCallbackRegistry(makeLogger());
  const userPromptExpansionRegistry = new UserPromptExpansionCallbackRegistry(
    makeLogger(),
  );
  const stopRegistry = new StopCallbackRegistry(makeLogger());
  const recorder = {
    recordSkillEvent: jest.fn(),
  } as unknown as SkillInvocationRecorder;
  const service = new SkillTriggerService(
    logger,
    synthesis,
    activityRegistry,
    sessionEndRegistry,
    workspace,
    makeFs(),
    makeSqlite(),
    makeJsonl(),
    subagentStopRegistry,
    postToolUseRegistry,
    rateLimiter,
    userPromptExpansionRegistry,
    recorder,
    stopRegistry,
  );
  return {
    service,
    synthesis,
    rateLimiter,
    subagentStopRegistry,
    postToolUseRegistry,
    sessionEndRegistry,
    activityRegistry,
    stopRegistry,
  };
}

function postToolUseEdit(sessionId: string, timestamp: number) {
  return {
    toolName: 'Edit',
    toolInput: { command: 'noop' },
    toolOutput: '',
    exitCode: 0 as const,
    success: true,
    sessionId,
    workspaceRoot: '/ws',
    timestamp,
  };
}

function postToolUseBashTest(sessionId: string, timestamp: number) {
  return {
    toolName: 'Bash',
    toolInput: { command: 'npm test' },
    toolOutput: '',
    exitCode: 0 as const,
    success: true,
    sessionId,
    workspaceRoot: '/ws',
    timestamp,
  };
}

describe('SkillTriggerService integration — full event-loop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-21T12:00:00Z'));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('SubagentStop full loop: notifyAll → analyzeSession with subagent sessionId + subagent-stop event', async () => {
    const { service, synthesis, subagentStopRegistry } = buildHarness();
    service.start();

    subagentStopRegistry.notifyAll({
      subagentSessionId: '12345678-1234-5678-1234-567812345678',
      parentSessionId: 'parent-1',
      workspaceRoot: '/ws',
      agentId: 'agent-1',
      agentType: 'general-purpose',
      transcriptPath: '/tmp/agents/12345678-1234-5678-1234-567812345678.jsonl',
      timestamp: 1000,
    });
    await Promise.resolve();

    expect(synthesis.analyzeSession).toHaveBeenCalledTimes(1);
    expect(synthesis.analyzeSession).toHaveBeenCalledWith(
      '12345678-1234-5678-1234-567812345678',
      '/ws',
      {
        force: false,
        transcriptPath:
          '/tmp/agents/12345678-1234-5678-1234-567812345678.jsonl',
        source: 'subagent-stop',
      },
    );
    expect(synthesis.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'subagent-stop',
        sessionId: '12345678-1234-5678-1234-567812345678',
      }),
    );

    service.stop();
  });

  it('Edit-then-test FSM full loop: 3 Edits + Bash npm test fires once, FSM resets, next test does not fire', async () => {
    const { service, synthesis, postToolUseRegistry } = buildHarness();
    service.start();

    for (let i = 0; i < 3; i++) {
      postToolUseRegistry.notifyAll(postToolUseEdit('s1', 1000 + i));
    }
    postToolUseRegistry.notifyAll(postToolUseBashTest('s1', 2000));
    await Promise.resolve();

    expect(synthesis.analyzeSession).toHaveBeenCalledTimes(1);
    expect(synthesis.analyzeSession).toHaveBeenCalledWith('s1', '/ws', {
      force: false,
      transcriptPath: undefined,
      source: 'edit-then-test',
    });
    expect(synthesis.pushEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'edit-then-test',
        sessionId: 's1',
        stats: { editCount: 3 },
      }),
    );

    postToolUseRegistry.notifyAll(postToolUseBashTest('s1', 2100));
    await Promise.resolve();

    expect(synthesis.analyzeSession).toHaveBeenCalledTimes(1);

    service.stop();
  });

  it('SessionEnd clears FSM (R3): 3 Edits → SessionEnd → Bash test → no analyze', async () => {
    const { service, synthesis, postToolUseRegistry, sessionEndRegistry } =
      buildHarness();
    service.start();

    for (let i = 0; i < 3; i++) {
      postToolUseRegistry.notifyAll(postToolUseEdit('A', 1000 + i));
    }
    sessionEndRegistry.notifyAll({ sessionId: 'A', workspaceRoot: '/ws' });
    postToolUseRegistry.notifyAll(postToolUseBashTest('A', 2000));
    await Promise.resolve();

    expect(synthesis.analyzeSession).not.toHaveBeenCalled();

    service.stop();
  });
});
