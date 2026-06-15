import 'reflect-metadata';

import { spawnSync } from 'node:child_process';
import * as os from 'os';

import type { Logger } from '@ptah-extension/vscode-core';
import type { IPlatformInfo } from '@ptah-extension/platform-core';
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
  subagentHooks: { createHooks: jest.Mock };
}

function makeRunner(
  opts: {
    runtimeState?: Parameters<typeof createRuntimeState>[0];
    queryFnImpl?: (params: {
      prompt: string | AsyncIterable<SDKUserMessage>;
      options: SdkQueryOptions;
    }) => Query;
    authEnv?: AuthEnv;
    extensionPath?: string;
  } = {},
): RunnerHarness {
  const logger = createMockLogger();
  const runtimeState = createRuntimeState(opts.runtimeState);
  const moduleLoader = createModuleLoader();
  const subagentHooks = {
    createHooks: jest.fn().mockReturnValue({}),
  };
  const compactionConfig = {
    getConfig: jest
      .fn()
      .mockReturnValue({ enabled: true, contextTokenThreshold: 100_000 }),
  } as unknown as CompactionConfigProvider;
  const compactionHooks = {
    createHooks: jest.fn().mockReturnValue({}),
  } as unknown as CompactionHookHandler;
  const authEnv: AuthEnv = opts.authEnv ?? ({} as AuthEnv);
  const modelService = {
    resolveModelId: jest.fn((m: string) => m),
  } as unknown as SdkModelService;

  const defaultImpl = () => createFakeQuery('fresh');
  const queryFn = jest.fn(opts.queryFnImpl ?? defaultImpl);
  moduleLoader.getQueryFunction.mockResolvedValue(
    queryFn as unknown as QueryFunction,
  );

  const platformInfo = {
    extensionPath: opts.extensionPath ?? '/opt/ptah/resources/app.asar',
    globalStoragePath: '/opt/ptah-storage',
  };

  const runner = new SdkQueryRunner(
    asLogger(logger),
    runtimeState as unknown as SdkRuntimeStateService,
    moduleLoader as unknown as SdkModuleLoader,
    subagentHooks as unknown as SubagentHookHandler,
    compactionConfig,
    compactionHooks,
    authEnv,
    modelService,
    platformInfo as unknown as IPlatformInfo,
  );

  return {
    runner,
    logger,
    runtimeState,
    moduleLoader,
    queryFn,
    subagentHooks,
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

  describe('runOneShot — unsafe cwd is rewritten at the chokepoint', () => {
    async function capturedCwd(installCwd: string): Promise<string> {
      const h = makeRunner({
        extensionPath: `${installCwd}/resources/app.asar`,
      });
      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: installCwd,
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
      });
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      return params.options.cwd as string;
    }

    it('rewrites the app install dir to the user home so it never reaches the SDK', async () => {
      const installDir = '/home/abdo/.local/programs/ptah';
      const cwd = await capturedCwd(installDir);
      expect(cwd).toBe(os.homedir());
      expect(cwd).not.toBe(installDir);
    });

    it('passes a real workspace cwd through untouched', async () => {
      const h = makeRunner();
      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work/project',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
      });
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      expect(params.options.cwd).toBe('/work/project');
    });

    it('rewrites an empty cwd to a safe directory', async () => {
      const h = makeRunner();
      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
      });
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      expect(params.options.cwd).toBe(os.homedir());
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

  describe('runOneShot — does not wire memory-observation hooks', () => {
    it('wires subagent hooks for the one-shot query', async () => {
      const h = makeRunner();

      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
      });

      expect(h.subagentHooks.createHooks).toHaveBeenCalledWith('/work');
    });

    it('omits PostToolUse and UserPromptSubmit hooks so internal queries never feed the curators', async () => {
      const h = makeRunner();
      h.subagentHooks.createHooks.mockReturnValue({});

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
      const hooks = (params.options.hooks ?? {}) as Record<string, unknown[]>;
      expect(hooks).not.toHaveProperty('PostToolUse');
      expect(hooks).not.toHaveProperty('UserPromptSubmit');
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

  describe('runOneShot — one-shot auth override (input.auth)', () => {
    async function capturedOptions(
      h: RunnerHarness,
      auth?: { env: AuthEnv; baseUrl?: string },
    ): Promise<SdkQueryOptions> {
      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
        auth,
      });
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      return params.options;
    }

    it('derives env / settingSources / beta flag from the override, not this.authEnv', async () => {
      const chatEnv: AuthEnv = {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9001',
        ANTHROPIC_AUTH_TOKEN: 'chat-token',
      } as AuthEnv;
      const overrideEnv: AuthEnv = {
        ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic',
        ANTHROPIC_API_KEY: 'curator-key',
      } as AuthEnv;
      const h = makeRunner({ authEnv: chatEnv });

      const options = await capturedOptions(h, { env: overrideEnv });
      const env = options.env as Record<string, string | undefined>;

      expect(env['ANTHROPIC_BASE_URL']).toBe(
        'https://api.moonshot.ai/anthropic',
      );
      expect(env['ANTHROPIC_API_KEY']).toBe('curator-key');
      expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
      expect(options.settingSources).toEqual(['user', 'project', 'local']);
      expect(env['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS']).toBe('1');
    });

    it('honours an explicit override baseUrl for the derived decisions', async () => {
      const chatEnv: AuthEnv = {
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      } as AuthEnv;
      const overrideEnv: AuthEnv = {
        ANTHROPIC_AUTH_TOKEN: 'curator-proxy-token',
      } as AuthEnv;
      const h = makeRunner({ authEnv: chatEnv });

      const options = await capturedOptions(h, {
        env: overrideEnv,
        baseUrl: 'http://127.0.0.1:51999',
      });
      const env = options.env as Record<string, string | undefined>;

      expect(options.settingSources).toEqual(['project', 'local']);
      expect(env['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS']).toBe('1');
    });

    it('builds the override identity prompt from the override env (not this.authEnv)', async () => {
      const overrideEnv: AuthEnv = {
        ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-k2-curator',
      } as AuthEnv;
      const h = makeRunner({ authEnv: {} as AuthEnv });

      const options = await capturedOptions(h, { env: overrideEnv });
      const append = (options.systemPrompt as { append?: string } | undefined)
        ?.append;

      expect(append).toContain('kimi-k2-curator');
    });

    it('is byte-identical to today when input.auth is undefined (env keys + derived values)', async () => {
      const chatEnv: AuthEnv = {
        ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic',
        ANTHROPIC_API_KEY: 'chat-key',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'kimi-chat',
      } as AuthEnv;

      const withoutAuth = await capturedOptions(
        makeRunner({ authEnv: chatEnv }),
      );
      const withoutEnv = withoutAuth.env as Record<string, string | undefined>;

      const equivalentOverride = await capturedOptions(
        makeRunner({ authEnv: {} as AuthEnv }),
        { env: chatEnv },
      );
      const equivalentEnv = equivalentOverride.env as Record<
        string,
        string | undefined
      >;

      expect(Object.keys(withoutEnv)).toEqual(Object.keys(equivalentEnv));
      expect(withoutEnv['ANTHROPIC_BASE_URL']).toBe(
        equivalentEnv['ANTHROPIC_BASE_URL'],
      );
      expect(withoutEnv['ANTHROPIC_API_KEY']).toBe(
        equivalentEnv['ANTHROPIC_API_KEY'],
      );
      expect(withoutEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS']).toBe(
        equivalentEnv['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'],
      );
      expect(withoutAuth.settingSources).toEqual(
        equivalentOverride.settingSources,
      );
      expect(
        (withoutAuth.systemPrompt as { append?: string } | undefined)?.append,
      ).toBe(
        (equivalentOverride.systemPrompt as { append?: string } | undefined)
          ?.append,
      );
    });
  });

  describe('runOneShot — curator env strip at the subprocess boundary (S-2)', () => {
    const CHAT_AUTH_KEYS = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
    ] as const;

    function buildCuratorEnvLike(curatorValues: AuthEnv): AuthEnv {
      const base: Record<string, string | undefined> = { ...process.env };
      for (const key of CHAT_AUTH_KEYS) {
        base[key] = undefined;
      }
      return { ...base, ...curatorValues } as AuthEnv;
    }

    async function capturedEnv(
      h: RunnerHarness,
      auth: { env: AuthEnv; baseUrl?: string },
    ): Promise<Record<string, string | undefined>> {
      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        isPremium: false,
        mcpServerRunning: false,
        auth,
      });
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      return params.options.env as Record<string, string | undefined>;
    }

    it('yields the 3 chat auth keys as present-with-undefined and preserves PATH through the full chain', async () => {
      const saved = {
        ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
        ANTHROPIC_AUTH_TOKEN: process.env['ANTHROPIC_AUTH_TOKEN'],
        ANTHROPIC_BASE_URL: process.env['ANTHROPIC_BASE_URL'],
      };
      process.env['ANTHROPIC_API_KEY'] = 'chat-real-key';
      process.env['ANTHROPIC_AUTH_TOKEN'] = 'chat-real-token';
      process.env['ANTHROPIC_BASE_URL'] = 'https://chat.example.test';
      try {
        const h = makeRunner({ authEnv: {} as AuthEnv });
        const env = await capturedEnv(h, {
          env: buildCuratorEnvLike({} as AuthEnv),
        });

        for (const key of CHAT_AUTH_KEYS) {
          expect(key in env).toBe(true);
          expect(env[key]).toBeUndefined();
        }
        expect(env['PATH'] ?? env['Path']).toBeDefined();
      } finally {
        process.env['ANTHROPIC_API_KEY'] = saved.ANTHROPIC_API_KEY;
        process.env['ANTHROPIC_AUTH_TOKEN'] = saved.ANTHROPIC_AUTH_TOKEN;
        process.env['ANTHROPIC_BASE_URL'] = saved.ANTHROPIC_BASE_URL;
        if (saved.ANTHROPIC_API_KEY === undefined)
          delete process.env['ANTHROPIC_API_KEY'];
        if (saved.ANTHROPIC_AUTH_TOKEN === undefined)
          delete process.env['ANTHROPIC_AUTH_TOKEN'];
        if (saved.ANTHROPIC_BASE_URL === undefined)
          delete process.env['ANTHROPIC_BASE_URL'];
      }
    });

    it('omits the undefined keys from a spawned child while PATH survives (Node boundary)', async () => {
      const saved = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'chat-real-key';
      try {
        const h = makeRunner({ authEnv: {} as AuthEnv });
        const env = await capturedEnv(h, {
          env: buildCuratorEnvLike({} as AuthEnv),
        });

        const child = spawnSync(
          process.execPath,
          [
            '-e',
            "process.stdout.write(JSON.stringify({hasKey:'ANTHROPIC_API_KEY' in process.env,hasPath:Boolean(process.env.PATH||process.env.Path)}))",
          ],
          { env, encoding: 'utf8' },
        );

        expect(child.status).toBe(0);
        const report = JSON.parse(child.stdout) as {
          hasKey: boolean;
          hasPath: boolean;
        };
        expect(report.hasKey).toBe(false);
        expect(report.hasPath).toBe(true);
      } finally {
        if (saved === undefined) delete process.env['ANTHROPIC_API_KEY'];
        else process.env['ANTHROPIC_API_KEY'] = saved;
      }
    });
  });
});
