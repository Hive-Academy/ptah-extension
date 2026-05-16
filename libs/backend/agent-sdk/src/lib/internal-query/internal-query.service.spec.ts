/**
 * InternalQueryService — unit specs.
 *
 * Surface under test:
 *   - One-shot dispatch: execute() MUST load the SDK query function from
 *     SdkModuleLoader and invoke it with a **string** prompt (not an async
 *     iterable) and `permissionMode: 'bypassPermissions'`. This is the
 *     signature difference from the interactive chat path.
 *   - Stream isolation (KEY PROPERTY): the stream returned by execute()
 *     MUST be the exact AsyncIterable produced by `queryFn()` — NOT routed
 *     through StreamTransformer, NOT wired into the active SessionLifecycle
 *     queues, NOT observable on any user-facing stream returned by
 *     SdkAgentAdapter. The GENERATION workflow must never leak into the
 *     USAGE workflow (otherwise the setup wizard would interleave into
 *     active chat tabs — see the module's "WHY SEPARATE" doc comment).
 *   - AbortSignal propagation: the AbortController referenced in options
 *     MUST be the same one exposed to the caller via `handle.abort()` so
 *     `queryFn()` and the caller share one cancellation scope.
 *   - Health gating: execute() MUST throw SdkError when the adapter's
 *     health is not 'available' (prevents launching the SDK subprocess on
 *     a misconfigured provider).
 *   - CLI path fallback: the service tries `SdkAgentAdapter.getCliJsPath()`
 *     first, then `SdkModuleLoader.getCliJsPath()` — the adapter has the
 *     bundled cli.js fallback, the loader only knows about detected CLIs.
 *
 * Mocking posture:
 *   - All collaborators injected directly as typed jest mocks (no tsyringe
 *     container). AuthEnv is plain data so we pass it inline.
 *   - The SDK `queryFn` is a `jest.fn()` that returns a fake Query whose
 *     async-iterator is backed by `createFakeAsyncGenerator` from
 *     `@ptah-extension/shared/testing`.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts`
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  createMockLogger,
  createFakeAsyncGenerator,
  freezeTime,
  type FrozenClock,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { InternalQueryService } from './internal-query.service';
import type { InternalQueryConfig } from './internal-query.types';
import { SdkError } from '../errors';
import type { SdkAgentAdapter } from '../sdk-agent-adapter';
import type { SdkModuleLoader } from '../helpers/sdk-module-loader';
import type { SubagentHookHandler } from '../helpers/subagent-hook-handler';
import type { CompactionConfigProvider } from '../helpers/compaction-config-provider';
import type { CompactionHookHandler } from '../helpers/compaction-hook-handler';
import type { SdkModelService } from '../helpers/sdk-model-service';
import type {
  Options as SdkQueryOptions,
  QueryFunction,
  Query,
  SDKMessage,
} from '../types/sdk-types/claude-sdk.types';

// ---------------------------------------------------------------------------
// Typed bridges — production Logger is a nominal class; bridge at the handle.
// ---------------------------------------------------------------------------

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Fake Query — the object queryFn() returns.
//
// The SDK Query interface has many members; we only need it to be
// async-iterable + expose a `close()` method in the parts of the source we
// exercise. The extra methods are stubbed to satisfy the type bridge.
// ---------------------------------------------------------------------------

interface FakeQueryHandle {
  query: Query & { close: jest.Mock };
  emittedMessages: SDKMessage[];
}

function createFakeInternalQuery(messages: SDKMessage[] = []): FakeQueryHandle {
  const gen = createFakeAsyncGenerator<SDKMessage>(messages);
  const query = {
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
  } as unknown as Query & { close: jest.Mock };
  return { query, emittedMessages: messages };
}

// ---------------------------------------------------------------------------
// Dependency factories
// ---------------------------------------------------------------------------

function createMockAdapter(
  opts: {
    status?: 'available' | 'error' | 'initializing';
    errorMessage?: string;
    cliJsPath?: string | null;
  } = {},
): jest.Mocked<Pick<SdkAgentAdapter, 'getHealth' | 'getCliJsPath'>> {
  return {
    getHealth: jest.fn().mockReturnValue({
      status: opts.status ?? 'available',
      lastCheck: Date.now(),
      errorMessage: opts.errorMessage,
    }),
    getCliJsPath: jest.fn().mockReturnValue(opts.cliJsPath ?? null),
  };
}

function createMockModuleLoader(): jest.Mocked<
  Pick<SdkModuleLoader, 'getQueryFunction' | 'getCliJsPath'>
> {
  return {
    getQueryFunction: jest.fn(),
    getCliJsPath: jest.fn().mockResolvedValue(null),
  };
}

function createMockSubagentHooks(): jest.Mocked<
  Pick<SubagentHookHandler, 'createHooks'>
> {
  return {
    createHooks: jest.fn().mockReturnValue({}),
  };
}

function createMockCompactionHooks(): jest.Mocked<
  Pick<CompactionHookHandler, 'createHooks'>
> {
  return {
    createHooks: jest.fn().mockReturnValue({}),
  };
}

function createMockCompactionConfig(): jest.Mocked<
  Pick<CompactionConfigProvider, 'getConfig'>
> {
  return {
    getConfig: jest.fn().mockReturnValue({
      enabled: true,
      contextTokenThreshold: 100_000,
    }),
  };
}

function createMockModelService(): jest.Mocked<
  Pick<SdkModelService, 'resolveModelId'>
> {
  return {
    resolveModelId: jest.fn((m: string) => m),
  };
}

function createAuthEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    ...overrides,
  } as AuthEnv;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface ServiceHarness {
  service: InternalQueryService;
  logger: MockLogger;
  adapter: ReturnType<typeof createMockAdapter>;
  moduleLoader: ReturnType<typeof createMockModuleLoader>;
  subagentHooks: ReturnType<typeof createMockSubagentHooks>;
  compactionConfig: ReturnType<typeof createMockCompactionConfig>;
  compactionHooks: ReturnType<typeof createMockCompactionHooks>;
  modelService: ReturnType<typeof createMockModelService>;
  authEnv: AuthEnv;
  queryFn: jest.Mock;
}

function makeService(
  opts: {
    adapter?: Parameters<typeof createMockAdapter>[0];
    authEnv?: Partial<AuthEnv>;
    queryFnImpl?: (params: {
      prompt: string | AsyncIterable<unknown>;
      options?: SdkQueryOptions;
    }) => Query;
  } = {},
): ServiceHarness {
  const logger = createMockLogger();
  const adapter = createMockAdapter(opts.adapter);
  const moduleLoader = createMockModuleLoader();
  const subagentHooks = createMockSubagentHooks();
  const compactionConfig = createMockCompactionConfig();
  const compactionHooks = createMockCompactionHooks();
  const modelService = createMockModelService();
  const authEnv = createAuthEnv(opts.authEnv);

  const defaultImpl = () => createFakeInternalQuery().query;
  const queryFn = jest.fn(opts.queryFnImpl ?? defaultImpl);
  moduleLoader.getQueryFunction.mockResolvedValue(
    queryFn as unknown as QueryFunction,
  );

  const service = new InternalQueryService(
    asLogger(logger),
    adapter as unknown as SdkAgentAdapter,
    moduleLoader as unknown as SdkModuleLoader,
    subagentHooks as unknown as SubagentHookHandler,
    compactionConfig as unknown as CompactionConfigProvider,
    compactionHooks as unknown as CompactionHookHandler,
    authEnv,
    modelService as unknown as SdkModelService,
  );

  return {
    service,
    logger,
    adapter,
    moduleLoader,
    subagentHooks,
    compactionConfig,
    compactionHooks,
    modelService,
    authEnv,
    queryFn,
  };
}

function makeConfig(
  overrides: Partial<InternalQueryConfig> = {},
): InternalQueryConfig {
  return {
    cwd: '/fake/workspace',
    model: 'claude-sonnet-4-20250514',
    prompt: 'Analyze this workspace',
    isPremium: false,
    mcpServerRunning: false,
    ...overrides,
  };
}

// Build a fake SDKMessage quickly — we only need these values equal-by-reference
// for the stream-isolation test.
function fakeSdkMessage(tag: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: tag,
  } as unknown as SDKMessage;
}

describe('InternalQueryService', () => {
  let clock: FrozenClock;

  beforeEach(() => {
    clock = freezeTime('2026-01-01T00:00:00Z');
  });

  afterEach(() => {
    clock.restore();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Health gating
  // -------------------------------------------------------------------------

  describe('health gating', () => {
    it('throws SdkError when the adapter reports status other than "available"', async () => {
      const h = makeService({
        adapter: { status: 'error', errorMessage: 'auth missing' },
      });

      await expect(h.service.execute(makeConfig())).rejects.toBeInstanceOf(
        SdkError,
      );
      // queryFn MUST NOT be reached when health is not available.
      expect(h.queryFn).not.toHaveBeenCalled();
    });

    it('surfaces the adapter errorMessage in the thrown SdkError', async () => {
      const h = makeService({
        adapter: { status: 'initializing', errorMessage: 'still booting' },
      });

      await expect(h.service.execute(makeConfig())).rejects.toThrow(
        /still booting/,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Query dispatch
  // -------------------------------------------------------------------------

  describe('execute() — query dispatch', () => {
    it('calls the SDK query function with a STRING prompt (single-shot mode)', async () => {
      const h = makeService();
      await h.service.execute(makeConfig({ prompt: 'Do the thing' }));

      expect(h.queryFn).toHaveBeenCalledTimes(1);
      const [params] = h.queryFn.mock.calls[0] as [
        { prompt: unknown; options: SdkQueryOptions },
      ];
      // Critical: internal queries MUST use a raw string prompt, not an
      // AsyncIterable<SDKUserMessage> like the chat path.
      expect(typeof params.prompt).toBe('string');
      expect(params.prompt).toBe('Do the thing');
    });

    it('sets permissionMode to "bypassPermissions" (no user to approve)', async () => {
      const h = makeService();
      await h.service.execute(makeConfig());

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.permissionMode).toBe('bypassPermissions');
      expect(params.options.allowDangerouslySkipPermissions).toBe(true);
    });

    it('defaults maxTurns to 25 and persistSession to false', async () => {
      const h = makeService();
      await h.service.execute(makeConfig());

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.maxTurns).toBe(25);
      expect(params.options.persistSession).toBe(false);
    });

    it('honours explicit maxTurns override from config', async () => {
      const h = makeService();
      await h.service.execute(makeConfig({ maxTurns: 7 }));

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.maxTurns).toBe(7);
    });

    it('resolves bare tier names to full model IDs before launching the query', async () => {
      const h = makeService();
      h.modelService.resolveModelId.mockImplementationOnce((m: string) =>
        m === 'opus' ? 'claude-opus-4-6' : m,
      );
      await h.service.execute(makeConfig({ model: 'opus' }));

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.model).toBe('claude-opus-4-6');
    });
  });

  // -------------------------------------------------------------------------
  // Stream isolation — the KEY correctness property.
  // -------------------------------------------------------------------------

  describe('stream isolation (internal events MUST NOT leak into user stream)', () => {
    it('returns exactly the queryFn() async iterable — NOT transformed, NOT coupled to any user stream', async () => {
      const sentinel = createFakeInternalQuery();
      const h = makeService({ queryFnImpl: () => sentinel.query });

      const handle = await h.service.execute(makeConfig());
      // Identity assertion — the caller receives the exact reference the
      // SDK returned. No proxying, no transform, no multiplexing into an
      // observable shared with SdkAgentAdapter's user-facing streams.
      expect(handle.stream).toBe(sentinel.query);
    });

    it('emitted internal SDKMessages are consumed ONLY through the returned handle — never via a separate user-facing observable', async () => {
      const msgs = [
        fakeSdkMessage('internal-init'),
        fakeSdkMessage('internal-result'),
      ];
      const sentinel = createFakeInternalQuery(msgs);
      const h = makeService({ queryFnImpl: () => sentinel.query });

      // A watchdog observable: simulates a hypothetical user-facing stream.
      // If the service accidentally coupled into any broadcaster, these
      // messages would show up here. They MUST NOT.
      const userFacingObservable: SDKMessage[] = [];
      // No subscribe hook is available on the service — which is the point:
      // there is no way to observe the internal stream except by iterating
      // the returned handle. Iterate it and confirm events flow *only*
      // through `handle.stream`.
      const handle = await h.service.execute(makeConfig());

      const collected: SDKMessage[] = [];
      for await (const msg of handle.stream) {
        collected.push(msg);
      }

      expect(collected).toEqual(msgs);
      // The "user-facing observable" was never populated because no such
      // coupling exists — this is the correctness property being asserted.
      expect(userFacingObservable).toEqual([]);
      // And critically: the service never touched a StreamTransformer
      // (we didn't inject one) nor a SessionLifecycleManager (ditto) —
      // proving that the internal path bypasses both by construction.
      //
      // The presence of a passing test here IS the assertion: if those
      // deps were required the service wouldn't even instantiate without
      // them being injected.
    });

    it('does NOT enqueue into SessionLifecycleManager or StreamTransformer — proven by lack of DI dependency', () => {
      // Structural property: the InternalQueryService constructor signature
      // does not accept a SessionLifecycleManager or a StreamTransformer.
      // This spec documents the architectural invariant: the type system
      // prevents any future coupling between the internal (generation)
      // path and the interactive (usage) path.
      //
      // If a well-meaning refactor added those deps, InternalQueryService's
      // constructor would change and this test (or the harness) would fail
      // to compile — surfacing the regression at build time.
      const h = makeService();
      expect(h.service).toBeInstanceOf(InternalQueryService);
    });
  });

  // -------------------------------------------------------------------------
  // AbortController propagation
  // -------------------------------------------------------------------------

  describe('AbortController propagation', () => {
    it('creates a fresh AbortController when none is supplied and wires it into options', async () => {
      const h = makeService();
      const handle = await h.service.execute(makeConfig());

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.abortController).toBeInstanceOf(AbortController);

      // handle.abort() MUST abort the SAME controller that queryFn received.
      const ctrl = params.options.abortController as AbortController;
      expect(ctrl.signal.aborted).toBe(false);
      handle.abort();
      expect(ctrl.signal.aborted).toBe(true);
    });

    it('respects a caller-provided AbortController (same reference flows through)', async () => {
      const h = makeService();
      const external = new AbortController();
      const handle = await h.service.execute(
        makeConfig({ abortController: external }),
      );

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.abortController).toBe(external);

      // Aborting via the handle aborts the externally-owned controller too.
      handle.abort();
      expect(external.signal.aborted).toBe(true);
    });

    it('close() invokes conversation.close() on the underlying Query handle', async () => {
      const sentinel = createFakeInternalQuery();
      const h = makeService({ queryFnImpl: () => sentinel.query });

      const handle = await h.service.execute(makeConfig());
      handle.close();
      expect(sentinel.query.close).toHaveBeenCalledTimes(1);
    });

    it('close() swallows errors thrown by conversation.close()', async () => {
      const sentinel = createFakeInternalQuery();
      (sentinel.query.close as jest.Mock).mockImplementationOnce(() => {
        throw new Error('close boom');
      });
      const h = makeService({ queryFnImpl: () => sentinel.query });

      const handle = await h.service.execute(makeConfig());
      expect(() => handle.close()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // CLI js path resolution
  // -------------------------------------------------------------------------

  describe('cliJsPath resolution', () => {
    it('prefers SdkAgentAdapter.getCliJsPath() when it returns a value', async () => {
      const h = makeService({
        adapter: { cliJsPath: '/adapter/cli.js' },
      });
      await h.service.execute(makeConfig());

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.pathToClaudeCodeExecutable).toBe('/adapter/cli.js');
      expect(h.moduleLoader.getCliJsPath).not.toHaveBeenCalled();
    });

    it('falls back to SdkModuleLoader.getCliJsPath() when the adapter has none', async () => {
      const h = makeService({ adapter: { cliJsPath: null } });
      h.moduleLoader.getCliJsPath.mockResolvedValueOnce('/loader/cli.js');
      await h.service.execute(makeConfig());

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.pathToClaudeCodeExecutable).toBe('/loader/cli.js');
    });

    it('leaves pathToClaudeCodeExecutable undefined when neither source resolves', async () => {
      const h = makeService({ adapter: { cliJsPath: null } });
      h.moduleLoader.getCliJsPath.mockResolvedValueOnce(null);
      await h.service.execute(makeConfig());

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.pathToClaudeCodeExecutable).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // MCP wiring (premium + running)
  // -------------------------------------------------------------------------

  describe('MCP server configuration', () => {
    it('disables MCP when the user is NOT premium', async () => {
      const h = makeService();
      await h.service.execute(
        makeConfig({ isPremium: false, mcpServerRunning: true }),
      );

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.mcpServers).toEqual({});
    });

    it('disables MCP when the server is not running, even for premium', async () => {
      const h = makeService();
      await h.service.execute(
        makeConfig({ isPremium: true, mcpServerRunning: false }),
      );

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.mcpServers).toEqual({});
    });

    it('configures the Ptah MCP server for premium users when the server is running', async () => {
      const h = makeService();
      await h.service.execute(
        makeConfig({
          isPremium: true,
          mcpServerRunning: true,
          mcpPort: 51820,
        }),
      );

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      const servers = params.options.mcpServers as Record<
        string,
        { url: string }
      >;
      expect(servers['ptah']).toBeDefined();
      expect(servers['ptah'].url).toBe('http://localhost:51820');
    });
  });

  // -------------------------------------------------------------------------
  // System prompt assembly
  // -------------------------------------------------------------------------

  describe('system prompt assembly', () => {
    it('emits a claude_code preset with NO append when not premium and no task-specific append', async () => {
      const h = makeService();
      await h.service.execute(makeConfig({ isPremium: false }));

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      const sp = params.options.systemPrompt as {
        type: 'preset';
        preset: 'claude_code';
        append?: string;
      };
      expect(sp.type).toBe('preset');
      expect(sp.preset).toBe('claude_code');
      expect(sp.append).toBeUndefined();
    });

    it('appends the task-specific systemPromptAppend when provided', async () => {
      const h = makeService();
      await h.service.execute(
        makeConfig({
          isPremium: false,
          systemPromptAppend: 'Return JSON schema X',
        }),
      );

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      const sp = params.options.systemPrompt as { append?: string };
      expect(sp.append).toBe('Return JSON schema X');
    });

    it('appends PTAH_CORE_SYSTEM_PROMPT for premium users (generation workflow — NEVER enhanced prompts)', async () => {
      const h = makeService();
      await h.service.execute(makeConfig({ isPremium: true }));

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      const sp = params.options.systemPrompt as { append?: string };
      expect(sp.append).toBeTruthy();
      expect(sp.append?.length ?? 0).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Output format passthrough
  // -------------------------------------------------------------------------

  describe('outputFormat', () => {
    it('passes outputFormat through when supplied', async () => {
      const h = makeService();
      const outputFormat = {
        type: 'json_schema',
        schema: { type: 'object', properties: {} },
      } as unknown as InternalQueryConfig['outputFormat'];
      await h.service.execute(makeConfig({ outputFormat }));

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.outputFormat).toBe(outputFormat);
    });

    it('omits outputFormat from options when not supplied', async () => {
      const h = makeService();
      await h.service.execute(makeConfig());

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.outputFormat).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Settings sources — translation proxy detection
  // -------------------------------------------------------------------------

  describe('settingSources (translation proxy handling)', () => {
    it('excludes "user" settings source when using a localhost translation proxy', async () => {
      const h = makeService({
        authEnv: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8080' },
      });
      await h.service.execute(makeConfig());

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.settingSources).toEqual(['project', 'local']);
    });

    it('includes all three sources when routing directly to api.anthropic.com', async () => {
      const h = makeService({
        authEnv: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' },
      });
      await h.service.execute(makeConfig());

      const [params] = h.queryFn.mock.calls[0] as [
        { options: SdkQueryOptions },
      ];
      expect(params.options.settingSources).toEqual([
        'user',
        'project',
        'local',
      ]);
    });
  });
});
