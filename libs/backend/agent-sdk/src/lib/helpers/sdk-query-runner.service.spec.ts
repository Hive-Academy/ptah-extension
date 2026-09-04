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
import type { OffThreadProcessSpawner } from './off-thread-process-spawner';
import { SdkError } from '../errors';
import type { SdkRuntimeStateService } from './sdk-runtime-state.service';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { SubagentHookHandler } from './subagent-hook-handler';
import type { CompactionConfigProvider } from './compaction-config-provider';
import type { SdkModelService } from './sdk-model-service';
import type { Query } from './session-lifecycle-manager';
import type {
  Options as SdkQueryOptions,
  QueryFunction,
  SDKMessage,
  SDKUserMessage,
  SpawnOptions,
  SpawnedProcess,
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
  opts: {
    status?: 'available' | 'error';
    cliJsPath?: string | null;
    initialized?: boolean;
  } = {},
): jest.Mocked<
  Pick<SdkRuntimeStateService, 'getHealth' | 'getCliJsPath' | 'hasInitialized'>
> {
  return {
    getHealth: jest.fn().mockReturnValue({
      status: opts.status ?? 'available',
      lastCheck: Date.now(),
    }),
    getCliJsPath: jest.fn().mockReturnValue(opts.cliJsPath ?? null),
    hasInitialized: jest.fn().mockReturnValue(opts.initialized ?? true),
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

/**
 * A stand-in for `OffThreadProcessSpawner`. The real one is covered by
 * `off-thread-process-spawner.spec.ts` against real child processes; what these
 * specs pin is only that the runner HANDS the SDK a spawner at all.
 */
function createProcessSpawner(): { spawn: jest.Mock } {
  return { spawn: jest.fn() };
}

interface RunnerHarness {
  runner: SdkQueryRunner;
  logger: MockLogger;
  runtimeState: ReturnType<typeof createRuntimeState>;
  moduleLoader: ReturnType<typeof createModuleLoader>;
  queryFn: jest.Mock;
  subagentHooks: { createHooks: jest.Mock };
  processSpawner: ReturnType<typeof createProcessSpawner>;
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
  const authEnv: AuthEnv = opts.authEnv ?? ({} as AuthEnv);
  // Mirrors the one branch of ModelResolver.resolve() these specs exercise: a
  // `claude-<tier>-*` id is remapped to the tier's env override when the
  // effective env defines one. Identity otherwise. The tier remap matters
  // because the identity clarification now names the RESOLVED model, so a
  // pass-through stub would hide whether the override env reached resolution.
  const resolveModelId = (m: string, envOverride?: AuthEnv): string => {
    const env = envOverride ?? authEnv;
    const tierVar = m.startsWith('claude-sonnet-')
      ? env.ANTHROPIC_DEFAULT_SONNET_MODEL
      : m.startsWith('claude-opus-')
        ? env.ANTHROPIC_DEFAULT_OPUS_MODEL
        : m.startsWith('claude-haiku-')
          ? env.ANTHROPIC_DEFAULT_HAIKU_MODEL
          : undefined;
    return tierVar && tierVar !== m ? tierVar : m;
  };
  const modelService = {
    resolveModelId: jest.fn(resolveModelId),
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

  const processSpawner = createProcessSpawner();

  const runner = new SdkQueryRunner(
    asLogger(logger),
    runtimeState as unknown as SdkRuntimeStateService,
    moduleLoader as unknown as SdkModuleLoader,
    subagentHooks as unknown as SubagentHookHandler,
    compactionConfig,
    authEnv,
    modelService,
    platformInfo as unknown as IPlatformInfo,
    processSpawner as unknown as OffThreadProcessSpawner,
  );

  return {
    runner,
    logger,
    runtimeState,
    moduleLoader,
    queryFn,
    subagentHooks,
    processSpawner,
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

  describe('isInitialized — the pre-check headless callers need', () => {
    it('is false on a host that never initialized the SDK', () => {
      // `withEngine({ requireSdk: false })`. `runOneShot` would throw SdkError
      // here on every call, and a caller that cannot import SdkError
      // (`skill-synthesis` keeps zero SDK imports) can only read that as a
      // transport fault and retry it against a host that has no LLM at all.
      const h = makeRunner({
        runtimeState: { status: 'error', initialized: false },
      });
      expect(h.runner.isInitialized()).toBe(false);
    });

    it('is true for an initialized SDK even when its health is "error"', () => {
      // Deliberately NOT a health check: an errored SDK owns a retryable fault,
      // and answering false here would let a caller drop the work instead.
      const h = makeRunner({
        runtimeState: { status: 'error', initialized: true },
      });
      expect(h.runner.isInitialized()).toBe(true);
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
        mcpServerRunning: false,
      });
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      expect(params.options.cwd).toBe(os.homedir());
    });
  });

  describe('invokeWithLoadedQuery', () => {
    it('invokes the loaded queryFn with the prompt + options and returns its query', () => {
      const h = makeRunner();
      const freshQuery = createFakeQuery('fresh');
      h.queryFn.mockReturnValueOnce(freshQuery);

      const result = h.runner.invokeWithLoadedQuery(
        h.queryFn as unknown as QueryFunction,
        'prompt-z',
        {} as SdkQueryOptions,
      );

      expect(result.sdkQuery).toBe(freshQuery);
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
        mcpServerRunning: false,
      });

      // TASK_2026_295: the subagent handler gates registration on a parent
      // session id. Passing only cwd left every subagent of a one-shot query
      // unregistered — no steering, no stop, no resumption.
      expect(h.subagentHooks.createHooks).toHaveBeenCalledWith(
        '/work',
        expect.stringMatching(/^internal-query-\d+$/),
      );
    });

    it('omits PostToolUse and UserPromptSubmit hooks so internal queries never feed the curators', async () => {
      const h = makeRunner();
      h.subagentHooks.createHooks.mockReturnValue({});

      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
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

  describe('runOneShot — compaction hooks never wired (TASK_2026_376 finding 4)', () => {
    // `maxTurns` was the wrong axis (B6). The one-shot session id is
    // synthetic BY CONSTRUCTION for every caller, whatever its turn budget,
    // so it can never be resolved to a real transcript. A PreCompact firing
    // on a multi-turn one-shot query (e.g. the memory curator's own
    // CURATOR_MAX_TURNS = 6 run) would fan that synthetic id to
    // CompactionCallbackRegistry, whose one subscriber (the memory curator)
    // reads it as a real session id — TASK_2026_293's defect class. No hooks
    // object carries a `PreCompact`/`PostCompact` matcher on this path at all.
    it.each([
      ['maxTurns: 1', { maxTurns: 1 }],
      ['maxTurns: 6 (the curator budget)', { maxTurns: 6 }],
      ['no maxTurns given (default 25)', {}],
    ])('wires no compaction hooks — %s', async (_label, extra) => {
      const h = makeRunner();

      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        mcpServerRunning: false,
        ...extra,
      });

      expect(h.queryFn).toHaveBeenCalledTimes(1);
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      const hooks = (params.options.hooks ?? {}) as Record<string, unknown[]>;
      expect(hooks).not.toHaveProperty('PreCompact');
      expect(hooks).not.toHaveProperty('PostCompact');
      // The subagent hook stays wired — TASK_2026_295 needs the parent id
      // regardless of turn budget.
      expect(h.subagentHooks.createHooks).toHaveBeenCalledTimes(1);
    });
  });

  describe('runInteractive — delegates to invokeWithLoadedQuery', () => {
    it('loads queryFn from moduleLoader then invokes it', async () => {
      const h = makeRunner();
      const freshQuery = createFakeQuery('fresh');
      h.queryFn.mockReturnValueOnce(freshQuery);

      const result = await h.runner.runInteractive({
        mode: 'interactive',
        prompt: 'interactive-prompt',
        options: {} as SdkQueryOptions,
      });

      expect(h.moduleLoader.getQueryFunction).toHaveBeenCalledTimes(1);
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

    it('does not leak an ambient chat-session token into an API-key override', async () => {
      // `options.env` starts from `process.env`, and OAuthProxyStrategy writes
      // ANTHROPIC_AUTH_TOKEN there for the ACTIVE chat provider. A one-shot
      // that overrides to an API-key provider must not inherit it — the SDK
      // would otherwise hold credentials for two different backends at once.
      const previous = process.env['ANTHROPIC_AUTH_TOKEN'];
      process.env['ANTHROPIC_AUTH_TOKEN'] = 'codex-proxy-managed';
      try {
        const h = makeRunner({ authEnv: {} as AuthEnv });

        const options = await capturedOptions(h, {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic',
            ANTHROPIC_API_KEY: 'curator-key',
          } as AuthEnv,
        });
        const env = options.env as Record<string, string | undefined>;

        expect(env['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
        expect(env['ANTHROPIC_API_KEY']).toBe('curator-key');
      } finally {
        if (previous === undefined) {
          delete process.env['ANTHROPIC_AUTH_TOKEN'];
        } else {
          process.env['ANTHROPIC_AUTH_TOKEN'] = previous;
        }
      }
    });

    it('leaves the ambient token in place when there is no override', async () => {
      // The clearing is scoped to the override path. A normal run still
      // inherits process.env exactly as it did before.
      const previous = process.env['ANTHROPIC_AUTH_TOKEN'];
      process.env['ANTHROPIC_AUTH_TOKEN'] = 'codex-proxy-managed';
      try {
        const h = makeRunner({ authEnv: {} as AuthEnv });

        const options = await capturedOptions(h);
        const env = options.env as Record<string, string | undefined>;

        expect(env['ANTHROPIC_AUTH_TOKEN']).toBe('codex-proxy-managed');
      } finally {
        if (previous === undefined) {
          delete process.env['ANTHROPIC_AUTH_TOKEN'];
        } else {
          process.env['ANTHROPIC_AUTH_TOKEN'] = previous;
        }
      }
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

  describe('runOneShot — lane env strip at the subprocess boundary (S-2)', () => {
    const CHAT_AUTH_KEYS = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
    ] as const;

    function buildLaneEnvLike(laneValues: AuthEnv): AuthEnv {
      const base: Record<string, string | undefined> = { ...process.env };
      for (const key of CHAT_AUTH_KEYS) {
        base[key] = undefined;
      }
      return { ...base, ...laneValues } as AuthEnv;
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
          env: buildLaneEnvLike({} as AuthEnv),
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
          env: buildLaneEnvLike({} as AuthEnv),
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

  describe('the SDK spawn is routed off this thread (TASK_2026_341)', () => {
    const BLOCK_WARN = '[SdkQueryRunner] query() blocked the event loop';

    function makeSpawnOptions(): SpawnOptions {
      return {
        command: '/opt/claude',
        args: ['--version'],
        cwd: '/work/project',
        env: {},
        signal: new AbortController().signal,
      };
    }

    async function oneShotOptions(h: RunnerHarness): Promise<SdkQueryOptions> {
      await h.runner.runOneShot({
        mode: 'oneShot',
        cwd: '/work/project',
        model: 'claude-sonnet-4-20250514',
        prompt: 'hi',
        mcpServerRunning: false,
      });
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      return params.options;
    }

    it('gives the one-shot query a spawner backed by OffThreadProcessSpawner', async () => {
      const h = makeRunner();
      const handle = {} as SpawnedProcess;
      h.processSpawner.spawn.mockReturnValue(handle);

      const options = await oneShotOptions(h);
      expect(options.spawnClaudeCodeProcess).toBeDefined();

      const spawnOptions = makeSpawnOptions();
      const returned = options.spawnClaudeCodeProcess?.(spawnOptions);

      expect(returned).toBe(handle);
      expect(h.processSpawner.spawn).toHaveBeenCalledWith(
        spawnOptions,
        // `options.stderr` is handed down because the SDK only wires stderr
        // inside its own spawnLocalProcess, which a custom spawner replaces.
        expect.objectContaining({ onStderr: options.stderr }),
      );
    });

    it('gives the interactive query the same spawner', () => {
      const h = makeRunner();
      const handle = {} as SpawnedProcess;
      h.processSpawner.spawn.mockReturnValue(handle);
      const options = {} as SdkQueryOptions;

      h.runner.invokeWithLoadedQuery(
        h.queryFn as unknown as QueryFunction,
        'prompt',
        options,
      );

      expect(options.spawnClaudeCodeProcess).toBeDefined();
      const spawnOptions = makeSpawnOptions();
      expect(options.spawnClaudeCodeProcess?.(spawnOptions)).toBe(handle);
      expect(h.processSpawner.spawn).toHaveBeenCalledTimes(1);
    });

    it('never replaces a caller-supplied spawnClaudeCodeProcess', () => {
      // A host running the CLI in a VM or container has already answered this
      // question; overriding it would silently move the process back local.
      const h = makeRunner();
      const callerHandle = {} as SpawnedProcess;
      const callerSpawner = jest.fn().mockReturnValue(callerHandle);
      const options = {
        spawnClaudeCodeProcess: callerSpawner,
      } as unknown as SdkQueryOptions;

      h.runner.invokeWithLoadedQuery(
        h.queryFn as unknown as QueryFunction,
        'prompt',
        options,
      );

      expect(options.spawnClaudeCodeProcess).toBe(callerSpawner);
      expect(options.spawnClaudeCodeProcess?.(makeSpawnOptions())).toBe(
        callerHandle,
      );
      expect(h.processSpawner.spawn).not.toHaveBeenCalled();
    });

    it('warns when the synchronous part of query() stalls the loop', () => {
      const h = makeRunner({
        queryFnImpl: () => {
          const until = Date.now() + 150;
          while (Date.now() < until) {
            // Busy-wait: this is exactly the shape of a blocking spawn — no
            // yield point for anything else on the loop.
          }
          return createFakeQuery('slow');
        },
      });

      h.runner.invokeWithLoadedQuery(
        h.queryFn as unknown as QueryFunction,
        'prompt',
        {} as SdkQueryOptions,
      );

      expect(h.logger.warn).toHaveBeenCalledWith(
        BLOCK_WARN,
        expect.objectContaining({ mode: 'interactive' }),
      );
    });

    it('stays quiet when the launch returns promptly', async () => {
      const h = makeRunner();
      await oneShotOptions(h);

      expect(h.logger.warn).not.toHaveBeenCalledWith(
        BLOCK_WARN,
        expect.anything(),
      );
    });
  });
});
