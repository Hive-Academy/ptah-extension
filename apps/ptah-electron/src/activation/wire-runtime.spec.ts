import 'reflect-metadata';

import { container as rootContainer, Lifecycle } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';

import { TOKENS } from '@ptah-extension/vscode-core';
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
  StopCallbackRegistry,
  ToolFailureCallbackRegistry,
  SessionEndHookCallbackRegistry,
  CuratorRateLimitService,
  PreToolUseCallbackRegistry,
  SessionStartCallbackRegistry,
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
    SDK_TOKENS.SDK_PRE_TOOL_USE_CALLBACK_REGISTRY,
    {
      useClass: PreToolUseCallbackRegistry,
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
