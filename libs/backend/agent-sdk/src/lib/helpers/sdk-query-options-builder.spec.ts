/**
 * Unit specs for `SdkQueryOptionsBuilder.mergeMcpOverride` —
 *
 * Scope: only the private `mergeMcpOverride(base, override)` helper. The full
 * `build()` flow is exercised by integration tests in this same suite path
 * (`session-lifecycle-manager.spec.ts`, etc.) and by other layers higher in
 * the chain (`sdk-agent-adapter.spec.ts`, `chat-rpc.handlers.spec.ts`).
 *
 * The helper itself is `this`-free — the implementation only branches on
 * `override` and returns either the original `base` reference or a new
 * shallow-merged record. We invoke it via index access on a freshly
 * constructed builder; no DI container is needed because the helper does not
 * touch any injected collaborator.
 *
 * Test names mirror the plan's § 2 T2 Test Plan verbatim.
 */

import 'reflect-metadata';

import { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import { ModelNotAvailableError } from '../errors';
import type {
  McpHttpServerConfig,
  HookEvent,
  HookCallbackMatcher,
} from '../types/sdk-types/claude-sdk.types';
import type {
  AISessionConfig,
  AuthEnv,
  McpHttpServerOverride,
} from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Test harness — minimal builder instance with all collaborators stubbed.
// `mergeMcpOverride` does not touch `this`, so passing `null`-ish stubs is
// safe for THIS spec only. Do NOT copy this harness for tests that exercise
// `build()` — those need the full DI graph.
// ---------------------------------------------------------------------------

interface BuilderWithMerge {
  mergeMcpOverride(
    base: Record<string, McpHttpServerConfig>,
    override: Record<string, McpHttpServerOverride> | undefined,
  ): Record<string, McpHttpServerConfig>;
}

function makeBuilder(): BuilderWithMerge {
  // The constructor signature is irrelevant for this helper — the method is
  // `this`-free. Bypass DI entirely with a constructed instance whose
  // collaborator slots are unused.
  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;
  const instance = new ctor(
    /* logger              */ undefined,
    /* permissionHandler   */ undefined,
    /* subagentHookHandler */ undefined,
    /* compactionConfig    */ undefined,
    /* compactionHooks     */ undefined,
    /* worktreeHooks       */ undefined,
    /* authEnv             */ undefined,
    /* modelService        */ undefined,
  );
  return instance as unknown as BuilderWithMerge;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('SdkQueryOptionsBuilder.mergeMcpOverride', () => {
  it('returns base unchanged (toBe identity) when override is undefined', () => {
    const builder = makeBuilder();
    const base: Record<string, McpHttpServerConfig> = {
      ptah: { type: 'http', url: 'http://localhost:1/foo' },
    };
    const result = builder.mergeMcpOverride(base, undefined);
    // Reference identity matters — the existing chat path must remain a
    // strict no-op when no override is supplied.
    expect(result).toBe(base);
  });

  it('returns base unchanged when override is empty object', () => {
    const builder = makeBuilder();
    const base: Record<string, McpHttpServerConfig> = {
      ptah: { type: 'http', url: 'http://localhost:1/foo' },
    };
    const result = builder.mergeMcpOverride(base, {});
    expect(result).toBe(base);
  });

  it('merges override entries over base — caller wins on key collision', () => {
    const builder = makeBuilder();
    const base: Record<string, McpHttpServerConfig> = {
      ptah: { type: 'http', url: 'http://localhost:1/registry' },
    };
    const override: Record<string, McpHttpServerOverride> = {
      ptah: { type: 'http', url: 'http://override.example/proxy' },
    };
    const result = builder.mergeMcpOverride(base, override);
    expect(result).not.toBe(base); // a new object is produced
    expect(result['ptah']).toEqual({
      type: 'http',
      url: 'http://override.example/proxy',
    });
  });

  it('preserves base entries that are not overridden', () => {
    const builder = makeBuilder();
    const base: Record<string, McpHttpServerConfig> = {
      ptah: { type: 'http', url: 'http://localhost:1/registry' },
      other: { type: 'http', url: 'http://localhost:2/other' },
    };
    const override: Record<string, McpHttpServerOverride> = {
      added: {
        type: 'http',
        url: 'http://override.example/added',
        headers: { 'X-Trace': 'on' },
      },
    };
    const result = builder.mergeMcpOverride(base, override);
    expect(result['ptah']).toEqual({
      type: 'http',
      url: 'http://localhost:1/registry',
    });
    expect(result['other']).toEqual({
      type: 'http',
      url: 'http://localhost:2/other',
    });
    expect(result['added']).toEqual({
      type: 'http',
      url: 'http://override.example/added',
      headers: { 'X-Trace': 'on' },
    });
  });
});

// ---------------------------------------------------------------------------
// build() — file checkpointing + agentProgressSummaries wiring
// ---------------------------------------------------------------------------
//
// Asserts the wiring contract for subagent visibility and file checkpointing:
//   - When `enableFileCheckpointing` is on (default), the SDK CLI flag
//     `--replay-user-messages` is forwarded via `extraArgs` so the SDK emits
//     `checkpointUuid` on user-message stream events. Without that flag,
//     `Query.rewindFiles()` silently no-ops because there is no UUID.
//   - When the caller opts out (`enableFileCheckpointing: false`), `extraArgs`
//     is absent (the conditional spread emits no key).
//   - `agentProgressSummaries: true` is always set — subagent visibility now
//     flows via this SDK Option + task_* system messages (task_started,
//     task_progress, task_updated, task_notification) handled by
//     SdkMessageTransformer. Replaces the phantom `forwardSubagentText` field
//     that was silently ignored by the SDK.

describe('SdkQueryOptionsBuilder.build — file checkpointing wiring', () => {
  function makeFullBuilder(): SdkQueryOptionsBuilder {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as const;

    const permissionHandler = {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    };

    const subagentHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };

    const compactionConfigProvider = {
      getConfig: jest
        .fn()
        .mockReturnValue({ enabled: false, contextTokenThreshold: 200_000 }),
    };

    const compactionHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };

    const worktreeHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };

    // Empty AuthEnv → triggers Anthropic-direct path (no provider validation).
    const authEnv: AuthEnv = {} as AuthEnv;

    const modelService = {
      resolveModelId: jest
        .fn()
        .mockImplementation((m: string) => m || 'claude-sonnet-4'),
    };

    const memoryPromptInjector = {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    };

    const postToolUseHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };

    const userPromptSubmitHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };

    const ctor = SdkQueryOptionsBuilder as unknown as new (
      ...args: unknown[]
    ) => SdkQueryOptionsBuilder;
    return new ctor(
      logger,
      permissionHandler,
      subagentHookHandler,
      compactionConfigProvider,
      compactionHookHandler,
      worktreeHookHandler,
      authEnv,
      modelService,
      memoryPromptInjector,
      postToolUseHookHandler,
      userPromptSubmitHookHandler,
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
    );
  }

  async function buildWith(
    overrides: { enableFileCheckpointing?: boolean } = {},
  ) {
    const builder = makeFullBuilder();
    const sessionConfig: AISessionConfig = {
      model: 'claude-sonnet-4',
      projectPath: 'D:/tmp/ws',
    } as AISessionConfig;
    // Empty async iterable — `build()` does not iterate it, just attaches.
    const userMessageStream = (async function* () {
      // Intentionally empty.
    })();
    const cfg = await builder.build({
      userMessageStream,
      abortController: new AbortController(),
      sessionConfig,
      ...overrides,
    });
    return cfg.options;
  }

  it("sets extraArgs['replay-user-messages'] = null when checkpointing is on by default", async () => {
    const opts = await buildWith();
    expect(opts.enableFileCheckpointing).toBe(true);
    expect(opts.extraArgs).toEqual({ 'replay-user-messages': null });
  });

  it('omits extraArgs when checkpointing is explicitly disabled', async () => {
    const opts = await buildWith({ enableFileCheckpointing: false });
    expect(opts.enableFileCheckpointing).toBe(false);
    expect(opts.extraArgs).toBeUndefined();
  });

  it('always sets agentProgressSummaries: true (subagent visibility via SDK task_* events)', async () => {
    const opts = await buildWith();
    expect(opts.agentProgressSummaries).toBe(true);

    const optsOff = await buildWith({ enableFileCheckpointing: false });
    expect(optsOff.agentProgressSummaries).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// build() — CLAUDE_CODE_MAX_CONTEXT_TOKENS override for proxied providers.
// The SDK only auto-detects the context window for first-party Anthropic; behind
// a translation proxy it defaults to 200k, mis-timing auto-compaction. We pin the
// real window when known, only for non-Anthropic base URLs.
// ---------------------------------------------------------------------------

describe('SdkQueryOptionsBuilder.build — context-window override', () => {
  function makeBuilder(baseUrl: string | undefined): SdkQueryOptionsBuilder {
    const noopHooks = { createHooks: jest.fn().mockReturnValue({}) };
    const ctor = SdkQueryOptionsBuilder as unknown as new (
      ...args: unknown[]
    ) => SdkQueryOptionsBuilder;
    return new ctor(
      { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      {
        createCallback: jest
          .fn()
          .mockReturnValue(() => ({ behavior: 'allow' })),
      },
      noopHooks,
      {
        getConfig: jest
          .fn()
          .mockReturnValue({ enabled: true, contextTokenThreshold: 100_000 }),
      },
      noopHooks,
      noopHooks,
      (baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {}) as AuthEnv,
      {
        resolveModelId: jest.fn().mockImplementation((m: string) => m),
        hasCachedModels: jest.fn().mockReturnValue(false),
        getSupportedModels: jest.fn(),
      },
      {
        buildBlock: jest.fn().mockResolvedValue(''),
        buildSessionStartBlock: jest.fn().mockResolvedValue(''),
        buildCorpusBlock: jest.fn().mockResolvedValue(''),
      },
      noopHooks,
      noopHooks,
      noopHooks,
      noopHooks,
      noopHooks,
      noopHooks,
      noopHooks,
      noopHooks,
      noopHooks,
      noopHooks,
    );
  }

  async function buildEnv(
    baseUrl: string | undefined,
    model: string,
  ): Promise<Record<string, string | undefined>> {
    const userMessageStream = (async function* () {
      // Intentionally empty.
    })();
    const cfg = await makeBuilder(baseUrl).build({
      userMessageStream,
      abortController: new AbortController(),
      sessionConfig: { model, projectPath: 'D:/tmp/ws' } as AISessionConfig,
    });
    return cfg.options.env as Record<string, string | undefined>;
  }

  const savedEnv = process.env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'];
  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'];
    } else {
      process.env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] = savedEnv;
    }
  });
  beforeEach(() => {
    delete process.env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'];
  });

  it('pins the model window for a non-Anthropic base URL when known', async () => {
    const env = await buildEnv('http://127.0.0.1:4000', 'claude-sonnet-4-5');
    expect(env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('200000');
  });

  it('does NOT set the override for a first-party Anthropic base URL', async () => {
    const env = await buildEnv(
      'https://api.anthropic.com',
      'claude-sonnet-4-5',
    );
    expect(env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBeUndefined();
  });

  it('does NOT set the override when the model window is unknown', async () => {
    const env = await buildEnv('http://127.0.0.1:4000', 'mystery-model-xyz');
    expect(env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBeUndefined();
  });

  it('respects an explicit CLAUDE_CODE_MAX_CONTEXT_TOKENS already in the env', async () => {
    process.env['CLAUDE_CODE_MAX_CONTEXT_TOKENS'] = '512000';
    const env = await buildEnv('http://127.0.0.1:4000', 'claude-sonnet-4-5');
    expect(env['CLAUDE_CODE_MAX_CONTEXT_TOKENS']).toBe('512000');
  });
});

// ---------------------------------------------------------------------------
// build() — system prompt prepend order: sessionStart → corpusPrime → memoryRecall → preset
// ---------------------------------------------------------------------------
//
// Verifies the chokepoint composition rule from TASK_2026_136 Batch D.
// The corpus slot is intentionally empty in Batch D — it is wired by Batch C1.

describe('SdkQueryOptionsBuilder.buildSystemPrompt — prepend order', () => {
  interface InjectorStub {
    buildBlock: jest.Mock<Promise<string>, [string, string?]>;
    buildSessionStartBlock: jest.Mock<Promise<string>, [string?]>;
    buildCorpusBlock: jest.Mock<Promise<string>, [string, number?]>;
  }

  function makeBuilderForPrepend(
    injector: InjectorStub,
  ): SdkQueryOptionsBuilder {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as const;
    const permissionHandler = {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    };
    const subagentHookHandler = {
      createHooks: jest.fn().mockReturnValue({}),
    };
    const compactionConfigProvider = {
      getConfig: jest.fn().mockReturnValue({
        enabled: false,
        contextTokenThreshold: 200_000,
      }),
    };
    const compactionHookHandler = {
      createHooks: jest.fn().mockReturnValue({}),
    };
    const worktreeHookHandler = {
      createHooks: jest.fn().mockReturnValue({}),
    };
    const authEnv: AuthEnv = {} as AuthEnv;
    const modelService = {
      resolveModelId: jest
        .fn()
        .mockImplementation((m: string) => m || 'claude-sonnet-4'),
    };
    const ctor = SdkQueryOptionsBuilder as unknown as new (
      ...args: unknown[]
    ) => SdkQueryOptionsBuilder;
    return new ctor(
      logger,
      permissionHandler,
      subagentHookHandler,
      compactionConfigProvider,
      compactionHookHandler,
      worktreeHookHandler,
      authEnv,
      modelService,
      injector,
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
    );
  }

  async function buildPremiumWith(
    injector: InjectorStub,
    initialQuery: string,
    extra: { corpusName?: string } = {},
  ) {
    const builder = makeBuilderForPrepend(injector);
    const sessionConfig: AISessionConfig = {
      model: 'claude-sonnet-4',
      projectPath: 'D:/tmp/ws',
      ...(extra.corpusName ? { corpusName: extra.corpusName } : {}),
    } as AISessionConfig;
    const userMessageStream = (async function* () {
      // Intentionally empty.
    })();
    const cfg = await builder.build({
      userMessageStream,
      abortController: new AbortController(),
      sessionConfig,
      isPremium: true,
      initialUserQuery: initialQuery,
    });
    return cfg.options.systemPrompt;
  }

  it('places sessionStart before corpusPrime before memoryRecall before preset content', async () => {
    const injector: InjectorStub = {
      buildSessionStartBlock: jest
        .fn()
        .mockResolvedValue('SESSION_START_TOKEN'),
      buildCorpusBlock: jest.fn().mockResolvedValue('CORPUS_PRIME_TOKEN'),
      buildBlock: jest.fn().mockResolvedValue('MEMORY_RECALL_TOKEN'),
    };
    const sp = await buildPremiumWith(injector, 'a long enough query string', {
      corpusName: 'corpus-A',
    });
    expect(sp).toBeDefined();
    const append = (sp as { append?: string }).append ?? '';
    const startIdx = append.indexOf('SESSION_START_TOKEN');
    const corpusIdx = append.indexOf('CORPUS_PRIME_TOKEN');
    const recallIdx = append.indexOf('MEMORY_RECALL_TOKEN');
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(corpusIdx).toBeGreaterThan(startIdx);
    expect(recallIdx).toBeGreaterThan(corpusIdx);
  });

  it('leaves the corpus slot empty when sessionConfig.corpusName is not set', async () => {
    const injector: InjectorStub = {
      buildSessionStartBlock: jest
        .fn()
        .mockResolvedValue('SESSION_START_TOKEN'),
      buildCorpusBlock: jest.fn().mockResolvedValue('CORPUS_PRIME_TOKEN'),
      buildBlock: jest.fn().mockResolvedValue('MEMORY_RECALL_TOKEN'),
    };
    const sp = await buildPremiumWith(injector, 'a long enough query string');
    const append = (sp as { append?: string }).append ?? '';
    expect(append).not.toContain('CORPUS_PRIME_TOKEN');
    expect(injector.buildCorpusBlock).not.toHaveBeenCalled();
  });

  it('omits sessionStart block entirely when injector returns empty', async () => {
    const injector: InjectorStub = {
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
      buildBlock: jest.fn().mockResolvedValue('MEMORY_RECALL_TOKEN'),
    };
    const sp = await buildPremiumWith(injector, 'a long enough query string');
    const append = (sp as { append?: string }).append ?? '';
    expect(append).toContain('MEMORY_RECALL_TOKEN');
  });

  it('passes cwd as workspaceRoot to buildSessionStartBlock', async () => {
    const injector: InjectorStub = {
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
      buildBlock: jest.fn().mockResolvedValue(''),
    };
    await buildPremiumWith(injector, 'a long enough query string');
    expect(injector.buildSessionStartBlock).toHaveBeenCalledWith('D:/tmp/ws');
  });

  it('forwards corpusName to buildCorpusBlock when set on sessionConfig', async () => {
    const injector: InjectorStub = {
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue('CORPUS_PRIME_TOKEN'),
      buildBlock: jest.fn().mockResolvedValue(''),
    };
    await buildPremiumWith(injector, 'a long enough query string', {
      corpusName: 'corpus-XYZ',
    });
    expect(injector.buildCorpusBlock).toHaveBeenCalledWith('corpus-XYZ');
  });
});

// ---------------------------------------------------------------------------
// SdkQueryOptionsBuilder.validateModelAvailability (Fix: NODE-NESTJS-3B/2W)
//
// Pre-flight model existence check executed inside build() for third-party
// providers (non-Anthropic base URL) when models are already cached.
//
// The helper is private, so we drive it through the public build() API,
// injecting tailored modelService stubs into the builder constructor.
// ---------------------------------------------------------------------------

describe('SdkQueryOptionsBuilder.validateModelAvailability (pre-flight, via build)', () => {
  /** Build a full SdkQueryOptionsBuilder whose modelService is controlled by the caller. */
  function makeBuilderWithModelService(modelService: {
    resolveModelId: jest.Mock;
    hasCachedModels?: jest.Mock;
    getSupportedModels?: jest.Mock;
  }): SdkQueryOptionsBuilder {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as const;

    const permissionHandler = {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    };
    const subagentHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };
    const compactionConfigProvider = {
      getConfig: jest
        .fn()
        .mockReturnValue({ enabled: false, contextTokenThreshold: 200_000 }),
    };
    const compactionHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };
    const worktreeHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };

    const memoryPromptInjector = {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    };
    const postToolUseHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };
    const userPromptSubmitHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };

    const ctor = SdkQueryOptionsBuilder as unknown as new (
      ...args: unknown[]
    ) => SdkQueryOptionsBuilder;
    return new ctor(
      logger,
      permissionHandler,
      subagentHookHandler,
      compactionConfigProvider,
      compactionHookHandler,
      worktreeHookHandler,
      // Third-party provider: non-Anthropic base URL triggers model validation.
      { ANTHROPIC_BASE_URL: 'https://api.moonshot.cn/v1' } as AuthEnv,
      modelService,
      memoryPromptInjector,
      postToolUseHookHandler,
      userPromptSubmitHookHandler,
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
    );
  }

  async function buildWithModel(
    builder: SdkQueryOptionsBuilder,
    model: string,
  ): Promise<void> {
    const sessionConfig = {
      model,
      projectPath: 'D:/tmp/ws',
    } as AISessionConfig;
    const userMessageStream = (async function* () {
      // Intentionally empty.
    })();
    await builder.build({
      userMessageStream,
      abortController: new AbortController(),
      sessionConfig,
    });
  }

  it('skips validation and succeeds when no models are cached yet (hasCachedModels = false)', async () => {
    const modelService = {
      resolveModelId: jest
        .fn()
        .mockImplementation((m: string) => m || 'kimi-k2.6'),
      hasCachedModels: jest.fn().mockReturnValue(false),
      getSupportedModels: jest.fn(),
    };
    const builder = makeBuilderWithModelService(modelService);

    // Should NOT throw — cache miss is always a skip, not a failure.
    await expect(buildWithModel(builder, 'kimi-k2.6')).resolves.not.toThrow();
    expect(modelService.getSupportedModels).not.toHaveBeenCalled();
  });

  it('passes through when the model IS in the cached list', async () => {
    const modelService = {
      resolveModelId: jest
        .fn()
        .mockImplementation((m: string) => m || 'kimi-k2.6'),
      hasCachedModels: jest.fn().mockReturnValue(true),
      getSupportedModels: jest
        .fn()
        .mockResolvedValue([
          { value: 'kimi-k2.6' },
          { value: 'moonshot-v1-8k' },
        ]),
    };
    const builder = makeBuilderWithModelService(modelService);

    await expect(buildWithModel(builder, 'kimi-k2.6')).resolves.not.toThrow();
  });

  it('throws ModelNotAvailableError when the model is NOT in the cached list', async () => {
    const modelService = {
      resolveModelId: jest
        .fn()
        .mockImplementation((m: string) => m || 'devstral'),
      hasCachedModels: jest.fn().mockReturnValue(true),
      getSupportedModels: jest
        .fn()
        .mockResolvedValue([
          { value: 'moonshot-v1-8k' },
          { value: 'moonshot-v1-32k' },
        ]),
    };
    const builder = makeBuilderWithModelService(modelService);

    await expect(buildWithModel(builder, 'devstral')).rejects.toBeInstanceOf(
      ModelNotAvailableError,
    );
  });

  it('falls through gracefully when getSupportedModels() throws (never blocks the query)', async () => {
    const modelService = {
      resolveModelId: jest
        .fn()
        .mockImplementation((m: string) => m || 'kimi-k2.6'),
      hasCachedModels: jest.fn().mockReturnValue(true),
      getSupportedModels: jest
        .fn()
        .mockRejectedValue(new Error('network error')),
    };
    const builder = makeBuilderWithModelService(modelService);

    // An error in getSupportedModels must NOT block the build — the SDK will
    // surface any real model error when the subprocess starts.
    await expect(buildWithModel(builder, 'kimi-k2.6')).resolves.not.toThrow();
  });

  it('skips validation for direct Anthropic base URL (authoritative — never validate)', async () => {
    // Rebuild builder with direct Anthropic URL.
    const ctor = SdkQueryOptionsBuilder as unknown as new (
      ...args: unknown[]
    ) => SdkQueryOptionsBuilder;
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as const;
    const permissionHandler = {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    };
    const subagentHookHandler = {
      createHooks: jest.fn().mockReturnValue({}),
    };
    const compactionConfigProvider = {
      getConfig: jest
        .fn()
        .mockReturnValue({ enabled: false, contextTokenThreshold: 200_000 }),
    };
    const compactionHookHandler = {
      createHooks: jest.fn().mockReturnValue({}),
    };
    const worktreeHookHandler = { createHooks: jest.fn().mockReturnValue({}) };
    const modelService = {
      resolveModelId: jest
        .fn()
        .mockImplementation((m: string) => m || 'claude-3-opus-20240229'),
      hasCachedModels: jest.fn().mockReturnValue(true),
      getSupportedModels: jest
        .fn()
        .mockResolvedValue([{ value: 'claude-3-5-sonnet-20241022' }]),
    };
    const memoryPromptInjector = {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    };
    const postToolUseHookHandler = {
      createHooks: jest.fn().mockReturnValue({}),
    };
    const userPromptSubmitHookHandler = {
      createHooks: jest.fn().mockReturnValue({}),
    };
    const builder = new ctor(
      logger,
      permissionHandler,
      subagentHookHandler,
      compactionConfigProvider,
      compactionHookHandler,
      worktreeHookHandler,
      { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } as AuthEnv,
      modelService,
      memoryPromptInjector,
      postToolUseHookHandler,
      userPromptSubmitHookHandler,
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
    );

    const sessionConfig = {
      model: 'claude-3-opus-20240229',
      projectPath: 'D:/tmp/ws',
    } as AISessionConfig;
    const userMessageStream = (async function* (): AsyncGenerator<
      never,
      void,
      unknown
    > {
      // empty stream — build-only test, no user messages required
      if (false as boolean) yield undefined as never;
    })();
    // claude-3-opus-20240229 is NOT in the cached list, but Anthropic is
    // direct — validation must be skipped entirely.
    await expect(
      builder.build({
        userMessageStream,
        abortController: new AbortController(),
        sessionConfig,
      }),
    ).resolves.not.toThrow();

    // hasCachedModels / getSupportedModels must NOT be consulted.
    expect(modelService.hasCachedModels).not.toHaveBeenCalled();
    expect(modelService.getSupportedModels).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SdkQueryOptionsBuilder.build — permission routing safeParse fallback
//
// NODE-NESTJS-3Y hardening: previously `build()` called `SessionId.from(...)`
// / `TabId.from(...)` on the routing args, which THROW on a non-UUID input
// and crashed the adapter (see Sentry issue from v0.2.32). The chat RPC
// schema now blocks malformed ids at the boundary, but defense-in-depth in
// this layer keeps any other caller (CLI, MCP proxy, IPC) from crashing.
// We safeParse instead and emit a warn-level log on the malformed id.
// ---------------------------------------------------------------------------

describe('SdkQueryOptionsBuilder.build — permission routing safeParse fallback', () => {
  function makeBuilderWithPermissionSpy(): {
    builder: SdkQueryOptionsBuilder;
    logger: {
      info: jest.Mock;
      warn: jest.Mock;
      error: jest.Mock;
      debug: jest.Mock;
    };
    permissionHandler: { createCallback: jest.Mock };
  } {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const permissionHandler = {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    };
    const subagentHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };
    const compactionConfigProvider = {
      getConfig: jest
        .fn()
        .mockReturnValue({ enabled: false, contextTokenThreshold: 200_000 }),
    };
    const compactionHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };
    const worktreeHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };
    const authEnv: AuthEnv = {} as AuthEnv;
    const modelService = {
      resolveModelId: jest
        .fn()
        .mockImplementation((m: string) => m || 'claude-sonnet-4'),
    };
    const memoryPromptInjector = {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    };
    const postToolUseHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };
    const userPromptSubmitHookHandler = {
      createHooks: jest
        .fn()
        .mockReturnValue(
          {} as Partial<Record<HookEvent, HookCallbackMatcher[]>>,
        ),
    };
    const ctor = SdkQueryOptionsBuilder as unknown as new (
      ...args: unknown[]
    ) => SdkQueryOptionsBuilder;
    const builder = new ctor(
      logger,
      permissionHandler,
      subagentHookHandler,
      compactionConfigProvider,
      compactionHookHandler,
      worktreeHookHandler,
      authEnv,
      modelService,
      memoryPromptInjector,
      postToolUseHookHandler,
      userPromptSubmitHookHandler,
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
    );
    return { builder, logger, permissionHandler };
  }

  async function runBuild(
    builder: SdkQueryOptionsBuilder,
    sessionConfig: AISessionConfig,
  ): Promise<void> {
    const userMessageStream = (async function* () {
      // Intentionally empty.
    })();
    await builder.build({
      userMessageStream,
      abortController: new AbortController(),
      sessionConfig,
    });
  }

  const VALID_SESSION_UUID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
  const VALID_TAB_UUID = '11111111-2222-4333-8444-555555555555';
  const LEGACY_TAB_ID = 'tab_1778939573732_w43e75q';

  it('passes the parsed branded ids to createCallback when both are valid UUIDs', async () => {
    const { builder, permissionHandler } = makeBuilderWithPermissionSpy();
    const sessionConfig = {
      model: 'claude-sonnet-4',
      projectPath: 'D:/tmp/ws',
      tabId: VALID_TAB_UUID,
      sessionId: VALID_SESSION_UUID,
    } as AISessionConfig;

    await runBuild(builder, sessionConfig);

    // First arg is the routingId (tabId here for a new session); third arg
    // is the explicit TabId stamp. Both must be the original strings.
    expect(permissionHandler.createCallback).toHaveBeenCalledWith(
      VALID_TAB_UUID,
      undefined,
      VALID_TAB_UUID,
    );
  });

  it('falls back to undefined when sessionConfig.tabId is not a UUID (no SessionId.from throw)', async () => {
    const { builder, logger, permissionHandler } =
      makeBuilderWithPermissionSpy();
    const sessionConfig = {
      model: 'claude-sonnet-4',
      projectPath: 'D:/tmp/ws',
      tabId: LEGACY_TAB_ID, // the original NODE-NESTJS-3Y payload
    } as AISessionConfig;

    // Before the hardening this build() call threw a TypeError. After the
    // fix it must resolve cleanly.
    await expect(runBuild(builder, sessionConfig)).resolves.not.toThrow();

    // Both routing args degrade to undefined when the id is malformed.
    expect(permissionHandler.createCallback).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
    );

    // The malformed id is logged at warn-level for observability.
    const warnMessages = logger.warn.mock.calls.map(([msg]) => msg as string);
    const warnedAboutRouting = warnMessages.some((m) =>
      m.includes('Permission routing id is not a UUID'),
    );
    const warnedAboutTabId = warnMessages.some((m) =>
      m.includes('Permission tabId is not a UUID'),
    );
    expect(warnedAboutRouting).toBe(true);
    expect(warnedAboutTabId).toBe(true);
  });
});

describe('SdkQueryOptionsBuilder.createHooks — PostToolUse + UserPromptSubmit merger', () => {
  interface BuilderWithCreateHooks {
    createHooks(
      cwd: string,
      sessionId?: string,
    ): Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  }

  function makeBuilderWithSpies(): {
    builder: BuilderWithCreateHooks;
    postToolUseHookHandler: { createHooks: jest.Mock };
    userPromptSubmitHookHandler: { createHooks: jest.Mock };
    subagentHookHandler: { createHooks: jest.Mock };
    compactionHookHandler: { createHooks: jest.Mock };
    worktreeHookHandler: { createHooks: jest.Mock };
  } {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const permissionHandler = {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    };
    const subagentMatcher: HookCallbackMatcher = {
      hooks: [jest.fn().mockResolvedValue({ continue: true })],
    };
    const compactionMatcher: HookCallbackMatcher = {
      hooks: [jest.fn().mockResolvedValue({ continue: true })],
    };
    const worktreeMatcher: HookCallbackMatcher = {
      hooks: [jest.fn().mockResolvedValue({ continue: true })],
    };
    const postToolUseMatcher: HookCallbackMatcher = {
      hooks: [jest.fn().mockResolvedValue({ continue: true })],
    };
    const userPromptSubmitMatcher: HookCallbackMatcher = {
      hooks: [jest.fn().mockResolvedValue({ continue: true })],
    };
    const subagentHookHandler = {
      createHooks: jest.fn().mockReturnValue({
        SubagentStop: [subagentMatcher],
      } as Partial<Record<HookEvent, HookCallbackMatcher[]>>),
    };
    const compactionConfigProvider = {
      getConfig: jest
        .fn()
        .mockReturnValue({ enabled: false, contextTokenThreshold: 200_000 }),
    };
    const compactionHookHandler = {
      createHooks: jest.fn().mockReturnValue({
        PreCompact: [compactionMatcher],
      } as Partial<Record<HookEvent, HookCallbackMatcher[]>>),
    };
    const worktreeHookHandler = {
      createHooks: jest.fn().mockReturnValue({
        WorktreeCreate: [worktreeMatcher],
      } as Partial<Record<HookEvent, HookCallbackMatcher[]>>),
    };
    const authEnv: AuthEnv = {} as AuthEnv;
    const modelService = {
      resolveModelId: jest
        .fn()
        .mockImplementation((m: string) => m || 'claude-sonnet-4'),
    };
    const memoryPromptInjector = {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    };
    const postToolUseHookHandler = {
      createHooks: jest.fn().mockReturnValue({
        PostToolUse: [postToolUseMatcher],
      } as Partial<Record<HookEvent, HookCallbackMatcher[]>>),
    };
    const userPromptSubmitHookHandler = {
      createHooks: jest.fn().mockReturnValue({
        UserPromptSubmit: [userPromptSubmitMatcher],
      } as Partial<Record<HookEvent, HookCallbackMatcher[]>>),
    };

    const ctor = SdkQueryOptionsBuilder as unknown as new (
      ...args: unknown[]
    ) => SdkQueryOptionsBuilder;
    const builder = new ctor(
      logger,
      permissionHandler,
      subagentHookHandler,
      compactionConfigProvider,
      compactionHookHandler,
      worktreeHookHandler,
      authEnv,
      modelService,
      memoryPromptInjector,
      postToolUseHookHandler,
      userPromptSubmitHookHandler,
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
      { createHooks: jest.fn().mockReturnValue({}) },
    );
    return {
      builder: builder as unknown as BuilderWithCreateHooks,
      postToolUseHookHandler,
      userPromptSubmitHookHandler,
      subagentHookHandler,
      compactionHookHandler,
      worktreeHookHandler,
    };
  }

  it('invokes PostToolUseHookHandler.createHooks with (sessionId, cwd)', () => {
    const { builder, postToolUseHookHandler } = makeBuilderWithSpies();
    builder.createHooks('D:/tmp/ws', 'sess-abc');
    expect(postToolUseHookHandler.createHooks).toHaveBeenCalledWith(
      'sess-abc',
      'D:/tmp/ws',
    );
  });

  it('invokes UserPromptSubmitHookHandler.createHooks with (sessionId, cwd)', () => {
    const { builder, userPromptSubmitHookHandler } = makeBuilderWithSpies();
    builder.createHooks('D:/tmp/ws', 'sess-abc');
    expect(userPromptSubmitHookHandler.createHooks).toHaveBeenCalledWith(
      'sess-abc',
      'D:/tmp/ws',
    );
  });

  it('merged hooks output includes PostToolUse and UserPromptSubmit alongside existing keys', () => {
    const { builder } = makeBuilderWithSpies();
    const merged = builder.createHooks('D:/tmp/ws', 'sess-abc');
    const keys = Object.keys(merged);
    expect(keys).toEqual(
      expect.arrayContaining([
        'SubagentStop',
        'PreCompact',
        'WorktreeCreate',
        'PostToolUse',
        'UserPromptSubmit',
      ]),
    );
    expect(merged.PostToolUse).toHaveLength(1);
    expect(merged.UserPromptSubmit).toHaveLength(1);
  });

  it('defaults sessionId to empty string when undefined is passed', () => {
    const { builder, postToolUseHookHandler, userPromptSubmitHookHandler } =
      makeBuilderWithSpies();
    builder.createHooks('D:/tmp/ws');
    expect(postToolUseHookHandler.createHooks).toHaveBeenCalledWith(
      '',
      'D:/tmp/ws',
    );
    expect(userPromptSubmitHookHandler.createHooks).toHaveBeenCalledWith(
      '',
      'D:/tmp/ws',
    );
  });
});
