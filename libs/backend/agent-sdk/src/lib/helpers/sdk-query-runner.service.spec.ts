import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  createMockLogger,
  createFakeAsyncGenerator,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SdkQueryRunner } from './sdk-query-runner.service';
import { SdkError } from '../errors';
import type { SdkRuntimeStateService } from './sdk-runtime-state.service';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { SubagentHookHandler } from './subagent-hook-handler';
import type { CompactionConfigProvider } from './compaction-config-provider';
import type { CompactionHookHandler } from './compaction-hook-handler';
import type { PostToolUseHookHandler } from './post-tool-use-hook-handler';
import type { UserPromptSubmitHookHandler } from './user-prompt-submit-hook-handler';
import type { SdkModelService } from './sdk-model-service';
import type { Query } from './session-lifecycle-manager';
import type {
  Options as SdkQueryOptions,
  QueryFunction,
  SDKMessage,
  SDKUserMessage,
} from '../types/sdk-types/claude-sdk.types';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function createFakeQuery(tag = 'fake'): Query & { close: jest.Mock } {
  const gen = createFakeAsyncGenerator<SDKMessage>([]);
  return {
    [Symbol.asyncIterator]: () =>
      gen as unknown as AsyncIterator<SDKMessage, void>,
    next: () => gen.next(),
    return: (value?: void) => gen.return(value as unknown as SDKMessage),
    throw: (e?: unknown) => gen.throw(e),
    interrupt: jest.fn().mockResolvedValue(undefined),
    setPermissionMode: jest.fn().mockResolvedValue(undefined),
    setModel: jest.fn().mockResolvedValue(undefined),
    streamInput: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    _tag: tag,
  } as unknown as Query & { close: jest.Mock };
}

function createRuntimeState(
  opts: { status?: 'available' | 'error'; cliJsPath?: string | null } = {},
): jest.Mocked<Pick<SdkRuntimeStateService, 'getHealth' | 'getCliJsPath'>> {
  return {
    getHealth: jest.fn().mockReturnValue({
      status: opts.status ?? 'available',
      lastCheck: Date.now(),
    }),
    getCliJsPath: jest.fn().mockReturnValue(opts.cliJsPath ?? null),
  };
}

function createModuleLoader(): jest.Mocked<
  Pick<SdkModuleLoader, 'getQueryFunction' | 'getCliJsPath'>
> {
  return {
    getQueryFunction: jest.fn(),
    getCliJsPath: jest.fn().mockResolvedValue(null),
  };
}

interface RunnerHarness {
  runner: SdkQueryRunner;
  logger: MockLogger;
  runtimeState: ReturnType<typeof createRuntimeState>;
  moduleLoader: ReturnType<typeof createModuleLoader>;
  queryFn: jest.Mock;
  postToolUseHooks: { createHooks: jest.Mock };
  userPromptSubmitHooks: { createHooks: jest.Mock };
}

function makeRunner(
  opts: {
    runtimeState?: Parameters<typeof createRuntimeState>[0];
    queryFnImpl?: (params: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options: SdkQueryOptions;
    }) => Query;
  } = {},
): RunnerHarness {
  const logger = createMockLogger();
  const runtimeState = createRuntimeState(opts.runtimeState);
  const moduleLoader = createModuleLoader();
  const subagentHooks = {
    createHooks: jest.fn().mockReturnValue({}),
  } as unknown as SubagentHookHandler;
  const compactionConfig = {
    getConfig: jest
      .fn()
      .mockReturnValue({ enabled: true, contextTokenThreshold: 100_000 }),
  } as unknown as CompactionConfigProvider;
  const compactionHooks = {
    createHooks: jest.fn().mockReturnValue({}),
  } as unknown as CompactionHookHandler;
  const postToolUseHooks = {
    createHooks: jest.fn().mockReturnValue({}),
  };
  const userPromptSubmitHooks = {
    createHooks: jest.fn().mockReturnValue({}),
  };
  const authEnv: AuthEnv = {} as AuthEnv;
  const modelService = {
    resolveModelId: jest.fn((m: string) => m),
  } as unknown as SdkModelService;

  const defaultImpl = () => createFakeQuery('fresh');
  const queryFn = jest.fn(opts.queryFnImpl ?? defaultImpl);
  moduleLoader.getQueryFunction.mockResolvedValue(
    queryFn as unknown as QueryFunction,
  );

  const runner = new SdkQueryRunner(
    asLogger(logger),
    runtimeState as unknown as SdkRuntimeStateService,
    moduleLoader as unknown as SdkModuleLoader,
    subagentHooks,
    compactionConfig,
    compactionHooks,
    authEnv,
    modelService,
    postToolUseHooks as unknown as PostToolUseHookHandler,
    userPromptSubmitHooks as unknown as UserPromptSubmitHookHandler,
  );

  return {
    runner,
    logger,
    runtimeState,
    moduleLoader,
    queryFn,
    postToolUseHooks,
    userPromptSubmitHooks,
  };
}

describe('SdkQueryRunner', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('runOneShot — health gating', () => {
    it('throws SdkError when runtime health is not "available"', async () => {
      const h = makeRunner({ runtimeState: { status: 'error' } });

      await expect(
        h.runner.runOneShot({
          mode: 'oneShot',
          cwd: '/work',
          model: 'claude-sonnet-4-20250514',
          prompt: 'hi',
          isPremium: false,
          mcpServerRunning: false,
        }),
      ).rejects.toBeInstanceOf(SdkError);

      expect(h.queryFn).not.toHaveBeenCalled();
    });

    it('invokes queryFn with bypassPermissions when health is available', async () => {
      const h = makeRunner();

      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
      });

      expect(h.queryFn).toHaveBeenCalledTimes(1);
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      expect(params.prompt).toBe('hi');
      expect(params.options.permissionMode).toBe('bypassPermissions');
      expect(params.options.persistSession).toBe(false);
    });
  });

  describe('invokeWithLoadedQuery — warm-query branching', () => {
    it('uses the warm queryFn and reports usedWarmQuery=true on happy path', () => {
      const h = makeRunner();
      const warmQuery = createFakeQuery('warm');
      const warmFn = jest.fn().mockReturnValue(warmQuery);

      const result = h.runner.invokeWithLoadedQuery(
        h.queryFn as unknown as QueryFunction,
        'prompt-x',
        {} as SdkQueryOptions,
        { close: jest.fn(), query: warmFn },
      );

      expect(result.usedWarmQuery).toBe(true);
      expect(result.sdkQuery).toBe(warmQuery);
      expect(warmFn).toHaveBeenCalledWith('prompt-x');
      expect(h.queryFn).not.toHaveBeenCalled();
    });

    it('falls back to fresh queryFn when warm.query() throws and closes the warm handle', () => {
      const h = makeRunner();
      const freshQuery = createFakeQuery('fresh');
      h.queryFn.mockReturnValueOnce(freshQuery);
      const warmClose = jest.fn();
      const warmFn = jest.fn(() => {
        throw new Error('warm boom');
      });

      const result = h.runner.invokeWithLoadedQuery(
        h.queryFn as unknown as QueryFunction,
        'prompt-y',
        {} as SdkQueryOptions,
        { close: warmClose, query: warmFn },
      );

      expect(result.usedWarmQuery).toBe(false);
      expect(result.sdkQuery).toBe(freshQuery);
      expect(warmClose).toHaveBeenCalledTimes(1);
      expect(h.queryFn).toHaveBeenCalledTimes(1);
    });

    it('uses fresh queryFn when no warm handle is supplied', () => {
      const h = makeRunner();
      const freshQuery = createFakeQuery('fresh');
      h.queryFn.mockReturnValueOnce(freshQuery);

      const result = h.runner.invokeWithLoadedQuery(
        h.queryFn as unknown as QueryFunction,
        'prompt-z',
        {} as SdkQueryOptions,
        null,
      );

      expect(result.usedWarmQuery).toBe(false);
      expect(result.sdkQuery).toBe(freshQuery);
      expect(h.queryFn).toHaveBeenCalledTimes(1);
    });

    it('ignores a warm handle whose query field is not a function (treats as fresh)', () => {
      const h = makeRunner();
      const freshQuery = createFakeQuery('fresh');
      h.queryFn.mockReturnValueOnce(freshQuery);
      const warmClose = jest.fn();

      const result = h.runner.invokeWithLoadedQuery(
        h.queryFn as unknown as QueryFunction,
        'prompt-w',
        {} as SdkQueryOptions,
        { close: warmClose, query: undefined },
      );

      expect(result.usedWarmQuery).toBe(false);
      expect(result.sdkQuery).toBe(freshQuery);
      expect(warmClose).not.toHaveBeenCalled();
      expect(h.queryFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('runOneShot — one-shot hook merger (PostToolUse + UserPromptSubmit)', () => {
    it('invokes PostToolUseHookHandler.createHooks with (internal sessionId, cwd)', async () => {
      const h = makeRunner();

      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
      });

      expect(h.postToolUseHooks.createHooks).toHaveBeenCalledTimes(1);
      const [sessionIdArg, cwdArg] = h.postToolUseHooks.createHooks.mock
        .calls[0] as [string, string];
      expect(sessionIdArg).toMatch(/^internal-query-\d+$/);
      expect(cwdArg).toBe('/work');
    });

    it('invokes UserPromptSubmitHookHandler.createHooks with (internal sessionId, cwd)', async () => {
      const h = makeRunner();

      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
      });

      expect(h.userPromptSubmitHooks.createHooks).toHaveBeenCalledTimes(1);
      const [sessionIdArg, cwdArg] = h.userPromptSubmitHooks.createHooks.mock
        .calls[0] as [string, string];
      expect(sessionIdArg).toMatch(/^internal-query-\d+$/);
      expect(cwdArg).toBe('/work');
    });

    it('merged hook options include PostToolUse and UserPromptSubmit keys', async () => {
      const h = makeRunner();
      const postMatcher = { hooks: [jest.fn()] };
      const promptMatcher = { hooks: [jest.fn()] };
      h.postToolUseHooks.createHooks.mockReturnValue({
        PostToolUse: [postMatcher],
      });
      h.userPromptSubmitHooks.createHooks.mockReturnValue({
        UserPromptSubmit: [promptMatcher],
      });

      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
      });

      expect(h.queryFn).toHaveBeenCalledTimes(1);
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      const hooks = params.options.hooks as
        | Record<string, unknown[]>
        | undefined;
      expect(hooks).toBeDefined();
      expect(Object.keys(hooks ?? {})).toEqual(
        expect.arrayContaining(['PostToolUse', 'UserPromptSubmit']),
      );
    });
  });

  describe('runInteractive — delegates to invokeWithLoadedQuery', () => {
    it('loads queryFn from moduleLoader then routes through warm-fallback logic', async () => {
      const h = makeRunner();
      const freshQuery = createFakeQuery('fresh');
      h.queryFn.mockReturnValueOnce(freshQuery);

      const result = await h.runner.runInteractive({
        mode: 'interactive',
        prompt: 'interactive-prompt',
        options: {} as SdkQueryOptions,
        warmQuery: null,
      });

      expect(h.moduleLoader.getQueryFunction).toHaveBeenCalledTimes(1);
      expect(result.usedWarmQuery).toBe(false);
      expect(result.sdkQuery).toBe(freshQuery);
    });
  });
});
