import 'reflect-metadata';

import { container as rootContainer, Lifecycle } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS } from '@ptah-extension/vscode-core';
import type { DegradationSnapshot } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import {
  SDK_TOKENS,
  JsonlReaderService,
  SessionActivityRegistry,
  SessionEndCallbackRegistry,
  SubagentStopCallbackRegistry,
  PostToolUseCallbackRegistry,
  PostToolUseHookHandler,
  UserPromptSubmitCallbackRegistry,
  UserPromptSubmitHookHandler,
  UserPromptExpansionCallbackRegistry,
  StopCallbackRegistry,
  ToolFailureCallbackRegistry,
  SessionEndHookCallbackRegistry,
  CuratorRateLimitService,
  SessionStartCallbackRegistry,
  SessionIdResolvedCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { MEMORY_CONTRACT_TOKENS } from '@ptah-extension/memory-contracts';
import {
  MEMORY_TOKENS,
  MemoryTriggerService,
  ObservationQueueStore,
} from '@ptah-extension/memory-curator';
import {
  SKILL_SYNTHESIS_TOKENS,
  SkillTriggerService,
} from '@ptah-extension/skill-synthesis';

import {
  logBootDegradationSummary,
  reportStartupBootFailure,
} from './wire-runtime';

function buildTestContainer(): DependencyContainer {
  const c = rootContainer.createChildContainer();

  c.register(PLATFORM_TOKENS.DI_CONTAINER, { useValue: c });

  c.register(TOKENS.LOGGER, {
    useValue: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  });

  c.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: {
      getWorkspaceRoot: jest.fn(() => '/ws'),
      getWorkspaceFolders: jest.fn(() => ['/ws']),
      getConfiguration: jest.fn(
        <T>(_section: string, key: string, defaultValue?: T): T | undefined => {
          if (key.endsWith('bootScan')) {
            return false as unknown as T;
          }
          return defaultValue;
        },
      ),
      setConfiguration: jest.fn().mockResolvedValue(undefined),
      onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
      onDidChangeWorkspaceFolders: jest.fn(() => ({ dispose: jest.fn() })),
    },
  });

  c.register(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER, {
    useValue: {
      readFile: jest.fn(async () => ''),
      writeFile: jest.fn(async () => undefined),
      exists: jest.fn(async () => false),
      stat: jest.fn(async () => null),
      readDirectory: jest.fn(async () => []),
      createDirectory: jest.fn(async () => undefined),
      deletePath: jest.fn(async () => undefined),
    },
  });

  c.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
    useValue: {
      isOpen: false,
      db: {
        prepare: jest.fn(() => ({
          get: jest.fn(),
          run: jest.fn(),
          all: jest.fn(() => []),
        })),
      },
      openAndMigrate: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
    },
  });

  c.register(
    SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY,
    {
      useClass: SessionActivityRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY,
    {
      useClass: SessionEndCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_JSONL_READER,
    {
      useClass: JsonlReaderService,
    },
    { lifecycle: Lifecycle.Singleton },
  );

  c.register(
    SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY,
    {
      useClass: SubagentStopCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
    {
      useClass: PostToolUseCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_POST_TOOL_USE_HOOK_HANDLER,
    {
      useClass: PostToolUseHookHandler,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY,
    {
      useClass: UserPromptSubmitCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_HOOK_HANDLER,
    {
      useClass: UserPromptSubmitHookHandler,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_REGISTRY,
    {
      useClass: UserPromptExpansionCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_STOP_CALLBACK_REGISTRY,
    {
      useClass: StopCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_TOOL_FAILURE_CALLBACK_REGISTRY,
    {
      useClass: ToolFailureCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_SESSION_END_HOOK_CALLBACK_REGISTRY,
    {
      useClass: SessionEndHookCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_CURATOR_RATE_LIMIT,
    {
      useClass: CuratorRateLimitService,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_SESSION_START_CALLBACK_REGISTRY,
    {
      useClass: SessionStartCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(
    SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY,
    {
      useClass: SessionIdResolvedCallbackRegistry,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(MEMORY_CONTRACT_TOKENS.TRANSCRIPT_READER, {
    useValue: {
      read: jest.fn().mockResolvedValue(''),
    },
  });

  c.register(
    MEMORY_TOKENS.OBSERVATION_QUEUE_STORE,
    { useClass: ObservationQueueStore },
    { lifecycle: Lifecycle.Singleton },
  );

  c.register(MEMORY_TOKENS.MEMORY_CURATOR, {
    useValue: {
      start: jest.fn(),
      stop: jest.fn(),
      curate: jest.fn().mockResolvedValue({
        outcome: 'ran',
        success: true,
        memoriesUpserted: 0,
        topMemoryIds: [],
      }),
      pushEvent: jest.fn(),
      recentEvents: jest.fn(() => []),
      lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
    },
  });

  c.register(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE, {
    useValue: {
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn(),
      analyzeSession: jest.fn().mockResolvedValue({
        success: true,
        candidatesPromoted: 0,
      }),
      pushEvent: jest.fn(),
      recentEvents: jest.fn(() => []),
      lastRunInfo: jest.fn(() => ({ at: null, stats: null })),
    },
  });

  c.register(
    MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE,
    {
      useClass: MemoryTriggerService,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  c.register(SKILL_SYNTHESIS_TOKENS.SKILL_INVOCATION_RECORDER, {
    useValue: {
      recordSkillEvent: jest.fn(),
    },
  });
  c.register(SKILL_SYNTHESIS_TOKENS.SPEC_HARVESTER_SERVICE, {
    useValue: {
      harvest: jest.fn().mockResolvedValue(undefined),
    },
  });
  c.register(SKILL_SYNTHESIS_TOKENS.SUBAGENT_METRICS_EXTRACTOR, {
    useValue: {
      extract: jest.fn().mockResolvedValue({
        metrics: {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheCreationTokens: null,
          costUsd: null,
          durationMs: null,
          toolCount: null,
        },
        taskId: null,
      }),
    },
  });
  c.register(
    SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE,
    {
      useClass: SkillTriggerService,
    },
    { lifecycle: Lifecycle.Singleton },
  );

  return c;
}

describe('wire-runtime DI resolution (TASK_2026_127 v2-17)', () => {
  let container: DependencyContainer;

  beforeEach(() => {
    container = buildTestContainer();
  });

  afterEach(() => {
    container.clearInstances();
  });

  it('resolves SubagentStopCallbackRegistry as a singleton under SDK_SUBAGENT_STOP_CALLBACK_REGISTRY', () => {
    const a = container.resolve<SubagentStopCallbackRegistry>(
      SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY,
    );
    const b = container.resolve<SubagentStopCallbackRegistry>(
      SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY,
    );
    expect(a).toBeInstanceOf(SubagentStopCallbackRegistry);
    expect(a).toBe(b);
  });

  it('resolves PostToolUseCallbackRegistry as a singleton under SDK_POST_TOOL_USE_CALLBACK_REGISTRY', () => {
    const a = container.resolve<PostToolUseCallbackRegistry>(
      SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
    );
    const b = container.resolve<PostToolUseCallbackRegistry>(
      SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY,
    );
    expect(a).toBeInstanceOf(PostToolUseCallbackRegistry);
    expect(a).toBe(b);
  });

  it('resolves PostToolUseHookHandler as a singleton under SDK_POST_TOOL_USE_HOOK_HANDLER', () => {
    const a = container.resolve<PostToolUseHookHandler>(
      SDK_TOKENS.SDK_POST_TOOL_USE_HOOK_HANDLER,
    );
    const b = container.resolve<PostToolUseHookHandler>(
      SDK_TOKENS.SDK_POST_TOOL_USE_HOOK_HANDLER,
    );
    expect(a).toBeInstanceOf(PostToolUseHookHandler);
    expect(a).toBe(b);
  });

  it('resolves UserPromptSubmitCallbackRegistry as a singleton under SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY', () => {
    const a = container.resolve<UserPromptSubmitCallbackRegistry>(
      SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY,
    );
    const b = container.resolve<UserPromptSubmitCallbackRegistry>(
      SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY,
    );
    expect(a).toBeInstanceOf(UserPromptSubmitCallbackRegistry);
    expect(a).toBe(b);
  });

  it('resolves UserPromptSubmitHookHandler as a singleton under SDK_USER_PROMPT_SUBMIT_HOOK_HANDLER', () => {
    const a = container.resolve<UserPromptSubmitHookHandler>(
      SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_HOOK_HANDLER,
    );
    const b = container.resolve<UserPromptSubmitHookHandler>(
      SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_HOOK_HANDLER,
    );
    expect(a).toBeInstanceOf(UserPromptSubmitHookHandler);
    expect(a).toBe(b);
  });

  it('resolves CuratorRateLimitService as a singleton under SDK_CURATOR_RATE_LIMIT', () => {
    const a = container.resolve<CuratorRateLimitService>(
      SDK_TOKENS.SDK_CURATOR_RATE_LIMIT,
    );
    const b = container.resolve<CuratorRateLimitService>(
      SDK_TOKENS.SDK_CURATOR_RATE_LIMIT,
    );
    expect(a).toBeInstanceOf(CuratorRateLimitService);
    expect(a).toBe(b);
  });

  it('MemoryTriggerService starts and stops cleanly with all SDK hook-registry deps wired', () => {
    const memoryTrigger = container.resolve<MemoryTriggerService>(
      MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE,
    );
    expect(memoryTrigger).toBeInstanceOf(MemoryTriggerService);
    expect(() => memoryTrigger.start()).not.toThrow();
    expect(() => memoryTrigger.stop()).not.toThrow();
  });

  it('SkillTriggerService starts and stops cleanly with all SDK hook-registry deps wired', () => {
    const skillTrigger = container.resolve<SkillTriggerService>(
      SKILL_SYNTHESIS_TOKENS.SKILL_TRIGGER_SERVICE,
    );
    expect(skillTrigger).toBeInstanceOf(SkillTriggerService);
    expect(() => skillTrigger.start()).not.toThrow();
    expect(() => skillTrigger.stop()).not.toThrow();
  });
});

/**
 * TASK_2026_383 Batch 2 — the boot summary (task 2.1) and the startup-boot
 * swallow (task 2.2).
 *
 * These drive the two exported seams directly. `wireRuntimePreWindow` itself
 * resolves two dozen tokens and builds an Electron menu, so standing it up
 * would test the mock graph; what changed is the behaviour of two functions and
 * the handler the reservation's `.catch` is wired to, and that is what runs
 * here. The wiring itself is pinned textually by
 * `wire-runtime.boot-order.spec.ts`.
 */
describe('logBootDegradationSummary (TASK_2026_383 task 2.1)', () => {
  let summaryContainer: DependencyContainer;

  function registerSnapshot(snapshot: DegradationSnapshot): void {
    summaryContainer.register(TOKENS.DEGRADATION_REPORTER, {
      useValue: { report: jest.fn(), snapshot: jest.fn(() => snapshot) },
    });
  }

  function loggerOf(): { info: jest.Mock; warn: jest.Mock } {
    return summaryContainer.resolve(TOKENS.LOGGER) as unknown as {
      info: jest.Mock;
      warn: jest.Mock;
    };
  }

  beforeEach(() => {
    summaryContainer = buildTestContainer();
  });

  afterEach(() => {
    summaryContainer.clearInstances();
  });

  it('logs exactly one info line when the boot degraded nothing', () => {
    registerSnapshot({
      total: 0,
      entries: [],
      droppedReports: 0,
      broadcastFailures: 0,
    });

    logBootDegradationSummary(summaryContainer);

    const logger = loggerOf();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      '[Degradation] Boot summary: no capability degraded during this boot.',
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs exactly one warn line naming the top codes and their counts', () => {
    registerSnapshot({
      total: 5,
      entries: [
        {
          code: 'electron.boot.startOrJoin-failed',
          source: 'boot',
          severity: 'critical',
          count: 3,
          summary: 'The startup workspace never booted.',
        },
        {
          code: 'database.backup.no-worker',
          source: 'database',
          severity: 'critical',
          count: 2,
          summary: 'No worker factory, so no backup was taken.',
        },
      ],
      droppedReports: 0,
      broadcastFailures: 0,
    });

    logBootDegradationSummary(summaryContainer);

    const logger = loggerOf();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[Degradation] Boot summary: 5 degradations across 2 codes — ' +
        'electron.boot.startOrJoin-failed x3, database.backup.no-worker x2.',
    );
  });

  it('emits ONE line for a boot with forty degradations, not forty', () => {
    // The stated edge case: a summary that scaled with the tally would
    // reproduce exactly the invisibility this task removes.
    const entries = Array.from({ length: 40 }, (_, i) => ({
      code: `lib.site-${String(i).padStart(2, '0')}`,
      source: 'workspace' as const,
      severity: 'degraded' as const,
      count: 1,
      summary: 'fell back',
    }));
    registerSnapshot({
      total: 40,
      entries,
      droppedReports: 0,
      broadcastFailures: 0,
    });

    logBootDegradationSummary(summaryContainer);

    const logger = loggerOf();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const line = logger.warn.mock.calls[0][0] as string;
    expect(line).not.toContain('\n');
    expect(line).toContain('40 degradations across 40 codes');
    expect(line).toContain('and 35 more');
  });

  it('names the dropped reports and the pushes that never landed', () => {
    registerSnapshot({
      total: 2,
      entries: [
        {
          code: 'settings.keytar-unavailable',
          source: 'settings',
          severity: 'expected',
          count: 1,
          summary: 'No OS keyring.',
        },
      ],
      droppedReports: 1,
      broadcastFailures: 1,
    });

    logBootDegradationSummary(summaryContainer);

    expect(loggerOf().warn).toHaveBeenCalledWith(
      '[Degradation] Boot summary: 2 degradations across 1 code — ' +
        'settings.keytar-unavailable x1. 1 report dropped past the code cap. ' +
        '1 push never reached the renderer.',
    );
  });

  it('stays silent, and does not throw, with no reporter registered', () => {
    // A test host or a stripped boot registers neither; silence is the answer,
    // never a throw on the boot's terminal transition.
    expect(() => logBootDegradationSummary(summaryContainer)).not.toThrow();
    expect(loggerOf().info).not.toHaveBeenCalled();
    expect(loggerOf().warn).not.toHaveBeenCalled();
  });

  it('does not throw when the reporter itself explodes', () => {
    summaryContainer.register(TOKENS.DEGRADATION_REPORTER, {
      useValue: {
        report: jest.fn(),
        snapshot: jest.fn(() => {
          throw new Error('snapshot exploded');
        }),
      },
    });
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    expect(() => logBootDegradationSummary(summaryContainer)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      '[Ptah Electron] Degradation summary skipped (non-fatal):',
      'snapshot exploded',
    );
    warn.mockRestore();
  });
});

describe('reportStartupBootFailure (TASK_2026_383 task 2.2)', () => {
  let failureContainer: DependencyContainer;
  let report: jest.Mock;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    failureContainer = buildTestContainer();
    report = jest.fn();
    failureContainer.register(TOKENS.DEGRADATION_REPORTER, {
      useValue: { report, snapshot: jest.fn() },
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
    failureContainer.clearInstances();
  });

  it('logs AND reports exactly once when the startup startOrJoin rejects', async () => {
    // The real call site's shape: a rejecting reservation with this handler
    // attached. Before this task the handler was `() => undefined`, so a failed
    // startup boot left no trace anywhere at all.
    const booter = {
      startOrJoin: jest.fn().mockRejectedValue(new Error('SQLITE_BUSY')),
    };

    const reserved = booter.startOrJoin('/ws');
    await reserved.catch((error: unknown) => {
      reportStartupBootFailure(failureContainer, error);
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[Ptah Electron] Failed to boot heavy services for the startup workspace:',
      expect.any(Error),
    );
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      source: 'boot',
      code: 'electron.boot.startOrJoin-failed',
      severity: 'critical',
      summary:
        'The startup workspace never finished booting its heavy services.',
      detail: 'SQLITE_BUSY',
    });
  });

  it('carries a non-Error rejection through as its string form', () => {
    reportStartupBootFailure(failureContainer, 'no workspace root');

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'no workspace root' }),
    );
  });

  it('uses a string literal code, so the tally means something', () => {
    reportStartupBootFailure(failureContainer, new Error('a'));
    reportStartupBootFailure(failureContainer, new Error('b'));

    // Two different errors, ONE code. An interpolated code would produce two
    // buckets of one and a count nobody can read.
    const codes = report.mock.calls.map(
      (call) => (call[0] as { code: string }).code,
    );
    expect(new Set(codes).size).toBe(1);
  });

  it('still logs when no reporter is registered', () => {
    const bare = buildTestContainer();
    expect(() =>
      reportStartupBootFailure(bare, new Error('boom')),
    ).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
    bare.clearInstances();
  });
});
