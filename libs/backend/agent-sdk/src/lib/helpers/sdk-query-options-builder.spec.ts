/**
 * Unit specs for `SdkQueryOptionsBuilder.mergeMcpOverride` —
 * TASK_2026_108 § 2 T2 (Layer 5 helper).
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
    const builder = new ctor(
      logger,
      permissionHandler,
      subagentHookHandler,
      compactionConfigProvider,
      compactionHookHandler,
      worktreeHookHandler,
      { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' } as AuthEnv,
      modelService,
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
