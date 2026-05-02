/**
 * Unit tests for `withEngine` — DI bootstrap + deterministic dispose.
 *
 * TASK_2026_104 Batch 4.
 *
 * The DI bootstrap is mocked via the `bootstrap` override on
 * `WithEngineOptions` so tests do not pay the real container cost. Coverage
 * targets ≥ 80% on `with-engine.ts`.
 */

import { EventEmitter } from 'node:events';
import type { DependencyContainer } from 'tsyringe';

import { withEngine, SdkInitFailedError } from './with-engine.js';
import type {
  EngineContext,
  WithEngineGlobals,
  WithEngineOptions,
} from './with-engine.js';
import type {
  CliBootstrapOptions,
  CliBootstrapResult,
} from '../../di/container.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import { CliWebviewManagerAdapter } from '../../transport/cli-webview-manager-adapter.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface FakeContainer extends Partial<DependencyContainer> {
  clearInstances: jest.Mock<void, []>;
  // Loose typing — production code calls `resolve(AGENT_ADAPTER_TOKEN)`; tests
  // override with arbitrary `jest.fn()` flavors and we don't care about the
  // arity match here.
  resolve: jest.Mock;
  /** Adapter returned by `resolve(AGENT_ADAPTER_TOKEN)`; tests can override. */
  __sdkAdapter: {
    initialize: jest.Mock;
    dispose: jest.Mock;
  };
}

/**
 * Build a fake DI container. `resolve()` returns the embedded SDK adapter
 * stub for any token (the production code only resolves
 * `Symbol.for('AgentAdapter')` from `withEngine`, so per-token routing isn't
 * needed). Tests override `__sdkAdapter.initialize` to drive failure paths.
 */
function makeFakeContainer(
  initializeReturns: boolean | (() => Promise<boolean>) = true,
): FakeContainer {
  const sdkAdapter = {
    initialize: jest.fn(async () => {
      if (typeof initializeReturns === 'function') {
        return initializeReturns();
      }
      return initializeReturns;
    }),
    dispose: jest.fn(),
  };
  const container: FakeContainer = {
    clearInstances: jest.fn(),
    resolve: jest.fn(() => sdkAdapter),
    __sdkAdapter: sdkAdapter,
  };
  return container;
}

interface FakeBootstrapTrace {
  options: CliBootstrapOptions[];
  results: CliBootstrapResult[];
  diPhaseEvents: Array<{
    phase: string;
    state: 'start' | 'end';
    durationMs?: number;
  }>;
}

/**
 * Build a fake `bootstrap` function plus a trace handle that records every
 * invocation and replays scripted `debug.di.phase` events on the push adapter
 * when `verbose === true`.
 */
function makeFakeBootstrap(): {
  bootstrap: NonNullable<WithEngineOptions['bootstrap']>;
  trace: FakeBootstrapTrace;
} {
  const trace: FakeBootstrapTrace = {
    options: [],
    results: [],
    diPhaseEvents: [],
  };
  const bootstrap = (options: CliBootstrapOptions): CliBootstrapResult => {
    trace.options.push(options);

    const pushAdapter = new CliWebviewManagerAdapter();
    pushAdapter.on('debug.di.phase', (payload: unknown) => {
      trace.diPhaseEvents.push(
        payload as { phase: string; state: 'start' | 'end' },
      );
    });

    if (options.verbose === true) {
      // Simulate the real container's six numbered-phase boundaries.
      // bootstrapMode === 'minimal' skips Phase 4.
      const phases =
        options.bootstrapMode === 'minimal'
          ? ['0', '1', '2', '3', '3.5']
          : ['0', '1', '2', '3', '3.5', '4'];
      for (const p of phases) {
        pushAdapter.emit('debug.di.phase', { phase: p, state: 'start' });
        pushAdapter.emit('debug.di.phase', {
          phase: p,
          state: 'end',
          durationMs: 1,
        });
      }
    }

    const fakeContainer = makeFakeContainer();
    const fakeTransport = { call: jest.fn() } as unknown as CliMessageTransport;
    const result: CliBootstrapResult = {
      container: fakeContainer as unknown as DependencyContainer,
      transport: fakeTransport,
      pushAdapter,
      fireAndForget: { handlePermissionResponse: jest.fn() } as never,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as never,
    };
    trace.results.push(result);
    return result;
  };
  return { bootstrap, trace };
}

const baseGlobals: WithEngineGlobals = { verbose: false };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withEngine', () => {
  describe('bootstrap mode propagation', () => {
    it('forwards mode=minimal into CliBootstrapOptions', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      await withEngine(
        baseGlobals,
        { mode: 'minimal', bootstrap },
        async () => 'ok',
      );
      expect(trace.options).toHaveLength(1);
      expect(trace.options[0]?.bootstrapMode).toBe('minimal');
    });

    it('forwards mode=full into CliBootstrapOptions', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      await withEngine(
        baseGlobals,
        { mode: 'full', bootstrap },
        async () => 'ok',
      );
      expect(trace.options[0]?.bootstrapMode).toBe('full');
    });

    it('threads cwd from globals to workspacePath', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      await withEngine(
        { ...baseGlobals, cwd: 'C:/scratch' },
        { mode: 'minimal', bootstrap },
        async () => 0,
      );
      expect(trace.options[0]?.workspacePath).toBe('C:/scratch');
    });
  });

  describe('verbose flag pass-through', () => {
    it('verbose=true forwards verbose into bootstrap options and emits phase events', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      await withEngine(
        { verbose: true },
        { mode: 'full', bootstrap },
        async () => undefined,
      );
      expect(trace.options[0]?.verbose).toBe(true);
      // Six phases × {start, end} = 12 events.
      expect(trace.diPhaseEvents.length).toBeGreaterThanOrEqual(6);
      const startEvents = trace.diPhaseEvents.filter(
        (e) => e.state === 'start',
      );
      const endEvents = trace.diPhaseEvents.filter((e) => e.state === 'end');
      expect(startEvents.length).toBe(endEvents.length);
      expect(startEvents.length).toBe(6);
    });

    it('verbose=false suppresses debug.di.phase events', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      await withEngine(
        { verbose: false },
        { mode: 'full', bootstrap },
        async () => undefined,
      );
      expect(trace.options[0]?.verbose).toBe(false);
      expect(trace.diPhaseEvents).toHaveLength(0);
    });

    it('minimal mode emits one fewer phase boundary than full mode', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      await withEngine(
        { verbose: true },
        { mode: 'minimal', bootstrap },
        async () => undefined,
      );
      // Five phases × {start, end} = 10 events under 'minimal'.
      const startEvents = trace.diPhaseEvents.filter(
        (e) => e.state === 'start',
      );
      expect(startEvents.length).toBe(5);
      expect(startEvents.map((e) => e.phase)).not.toContain('4');
    });
  });

  describe('dispose lifecycle', () => {
    it('runs dispose on success and returns fn result', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      const dispose = jest.fn();
      const result = await withEngine(
        baseGlobals,
        { mode: 'minimal', bootstrap, dispose },
        async () => 42,
      );
      expect(result).toBe(42);
      expect(dispose).toHaveBeenCalledTimes(1);
      const ctx = dispose.mock.calls[0]?.[0] as EngineContext;
      expect(ctx.container).toBe(trace.results[0]?.container);
      expect(ctx.pushAdapter).toBe(trace.results[0]?.pushAdapter);
      expect(ctx.transport).toBe(trace.results[0]?.transport);
    });

    it('runs dispose on throw and re-throws original error', async () => {
      const { bootstrap } = makeFakeBootstrap();
      const dispose = jest.fn();
      const userErr = new Error('fn-failed');
      await expect(
        withEngine(
          baseGlobals,
          { mode: 'full', bootstrap, dispose },
          async () => {
            throw userErr;
          },
        ),
      ).rejects.toBe(userErr);
      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('default dispose clears container instances and removes adapter listeners', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      let pushAdapterRef: CliWebviewManagerAdapter | undefined;
      await withEngine(
        baseGlobals,
        { mode: 'minimal', bootstrap },
        async (ctx) => {
          pushAdapterRef = ctx.pushAdapter;
          // Attach a listener to verify default dispose removes it.
          ctx.pushAdapter.on('chat:chunk', () => {
            /* noop */
          });
          expect(ctx.pushAdapter.listenerCount('chat:chunk')).toBe(1);
          return undefined;
        },
      );

      const fakeContainer = trace.results[0]
        ?.container as unknown as FakeContainer;
      expect(fakeContainer.clearInstances).toHaveBeenCalledTimes(1);
      // After dispose the adapter has zero listeners (apart from the
      // bootstrap-time `debug.di.phase` listener installed by the trace —
      // verbose=false here, so it was never attached).
      expect(pushAdapterRef?.listenerCount('chat:chunk')).toBe(0);
    });

    it('swallows dispose errors and surfaces original fn error', async () => {
      const { bootstrap } = makeFakeBootstrap();
      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);
      const userErr = new Error('user-failed');
      const disposeErr = new Error('dispose-broke');
      await expect(
        withEngine(
          baseGlobals,
          {
            mode: 'minimal',
            bootstrap,
            dispose: () => {
              throw disposeErr;
            },
          },
          async () => {
            throw userErr;
          },
        ),
      ).rejects.toBe(userErr);
      expect(stderrSpy).toHaveBeenCalled();
      stderrSpy.mockRestore();
    });

    it('awaits async dispose before resolving the call', async () => {
      const { bootstrap } = makeFakeBootstrap();
      let disposed = false;
      const result = await withEngine(
        baseGlobals,
        {
          mode: 'minimal',
          bootstrap,
          dispose: async () => {
            await new Promise((r) => setImmediate(r));
            disposed = true;
          },
        },
        async () => 'value',
      );
      expect(result).toBe('value');
      expect(disposed).toBe(true);
    });
  });

  describe('engine context shape', () => {
    it('exposes container, transport, and pushAdapter from the bootstrap result', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      await withEngine(
        baseGlobals,
        { mode: 'full', bootstrap },
        async (ctx) => {
          expect(ctx.container).toBe(trace.results[0]?.container);
          expect(ctx.transport).toBe(trace.results[0]?.transport);
          expect(ctx.pushAdapter).toBeInstanceOf(EventEmitter);
          return undefined;
        },
      );
    });
  });

  // -------------------------------------------------------------------------
  // P0 Fix 1 — SDK adapter initialization lifecycle.
  //
  // `mode === 'full'` must call AGENT_ADAPTER.initialize() before invoking
  // `fn`. Failure surfaces a `SdkInitFailedError` so command-level catch
  // blocks can map it to JSON-RPC `task.error` with `ptah_code: 'sdk_init_failed'`.
  // `mode === 'minimal'` skips the call entirely (introspection-only commands).
  // -------------------------------------------------------------------------
  describe('SDK adapter lifecycle (P0 Fix 1)', () => {
    it('mode=full calls SDK adapter initialize() before fn', async () => {
      const { bootstrap, trace } = makeFakeBootstrap();
      const initSpy = jest.fn(async () => true);
      // Wrap bootstrap so the next-built container's adapter uses our spy.
      const wrapped: typeof bootstrap = (options) => {
        const result = bootstrap(options);
        const c = result.container as unknown as FakeContainer;
        c.__sdkAdapter.initialize = initSpy;
        c.resolve = jest.fn(() => c.__sdkAdapter);
        return result;
      };

      await withEngine(
        baseGlobals,
        { mode: 'full', bootstrap: wrapped },
        async () => {
          // initialize must have been called before fn runs.
          expect(initSpy).toHaveBeenCalledTimes(1);
          return undefined;
        },
      );

      expect(trace.results).toHaveLength(1);
    });

    it('mode=minimal does NOT call SDK adapter initialize()', async () => {
      const { bootstrap } = makeFakeBootstrap();
      const initSpy = jest.fn(async () => true);
      const wrapped: typeof bootstrap = (options) => {
        const result = bootstrap(options);
        const c = result.container as unknown as FakeContainer;
        c.__sdkAdapter.initialize = initSpy;
        c.resolve = jest.fn(() => c.__sdkAdapter);
        return result;
      };

      await withEngine(
        baseGlobals,
        { mode: 'minimal', bootstrap: wrapped },
        async () => undefined,
      );
      expect(initSpy).not.toHaveBeenCalled();
    });

    it('throws SdkInitFailedError when initialize() returns false', async () => {
      const { bootstrap } = makeFakeBootstrap();
      const wrapped: typeof bootstrap = (options) => {
        const result = bootstrap(options);
        const c = result.container as unknown as FakeContainer;
        c.__sdkAdapter.initialize = jest.fn(async () => false);
        c.resolve = jest.fn(() => c.__sdkAdapter);
        return result;
      };

      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      await expect(
        withEngine(
          baseGlobals,
          { mode: 'full', bootstrap: wrapped },
          async () => 'never',
        ),
      ).rejects.toBeInstanceOf(SdkInitFailedError);

      // Structured stderr line carries the canonical code.
      const calls = stderrSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes('sdk_init_failed'));
      expect(calls.length).toBeGreaterThan(0);
      const ndjson = calls.find((l) => l.startsWith('{'));
      expect(ndjson).toBeDefined();
      const parsed = JSON.parse((ndjson ?? '').trim());
      expect(parsed.error).toBe('sdk_init_failed');

      stderrSpy.mockRestore();
    });

    it('throws SdkInitFailedError when initialize() throws', async () => {
      const { bootstrap } = makeFakeBootstrap();
      const wrapped: typeof bootstrap = (options) => {
        const result = bootstrap(options);
        const c = result.container as unknown as FakeContainer;
        c.__sdkAdapter.initialize = jest.fn(async () => {
          throw new Error('boom');
        });
        c.resolve = jest.fn(() => c.__sdkAdapter);
        return result;
      };

      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      await expect(
        withEngine(
          baseGlobals,
          { mode: 'full', bootstrap: wrapped },
          async () => 'never',
        ),
      ).rejects.toMatchObject({
        name: 'SdkInitFailedError',
        message: expect.stringContaining('boom'),
      });

      stderrSpy.mockRestore();
    });

    it('skips SDK init failure when container.resolve throws (treats as init-failed)', async () => {
      const { bootstrap } = makeFakeBootstrap();
      const wrapped: typeof bootstrap = (options) => {
        const result = bootstrap(options);
        const c = result.container as unknown as FakeContainer;
        c.resolve = jest.fn(() => {
          throw new Error('not registered');
        });
        return result;
      };

      const stderrSpy = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      await expect(
        withEngine(
          baseGlobals,
          { mode: 'full', bootstrap: wrapped },
          async () => 'never',
        ),
      ).rejects.toBeInstanceOf(SdkInitFailedError);

      stderrSpy.mockRestore();
    });

    it('mode=full + requireSdk=false skips initialize() AND dispose()', async () => {
      const { bootstrap } = makeFakeBootstrap();
      let captured: FakeContainer | undefined;
      const initSpy = jest.fn(async () => true);
      const wrapped: typeof bootstrap = (options) => {
        const result = bootstrap(options);
        const c = result.container as unknown as FakeContainer;
        c.__sdkAdapter.initialize = initSpy;
        c.resolve = jest.fn(() => c.__sdkAdapter);
        captured = c;
        return result;
      };

      await withEngine(
        baseGlobals,
        { mode: 'full', requireSdk: false, bootstrap: wrapped },
        async () => undefined,
      );

      // No init, no dispose — auth-bootstrap commands MUST be able to run before
      // the SDK is configured.
      expect(initSpy).not.toHaveBeenCalled();
      expect(captured?.__sdkAdapter.dispose).not.toHaveBeenCalled();
    });

    it('mode=full + requireSdk=false does NOT throw even if initialize() would have failed', async () => {
      const { bootstrap } = makeFakeBootstrap();
      const initSpy = jest.fn(async () => false);
      const wrapped: typeof bootstrap = (options) => {
        const result = bootstrap(options);
        const c = result.container as unknown as FakeContainer;
        c.__sdkAdapter.initialize = initSpy;
        c.resolve = jest.fn(() => c.__sdkAdapter);
        return result;
      };

      await expect(
        withEngine(
          baseGlobals,
          { mode: 'full', requireSdk: false, bootstrap: wrapped },
          async () => 'ran',
        ),
      ).resolves.toBe('ran');
      expect(initSpy).not.toHaveBeenCalled();
    });

    it('mode=full + requireSdk=true (explicit) still calls initialize()', async () => {
      const { bootstrap } = makeFakeBootstrap();
      const initSpy = jest.fn(async () => true);
      const wrapped: typeof bootstrap = (options) => {
        const result = bootstrap(options);
        const c = result.container as unknown as FakeContainer;
        c.__sdkAdapter.initialize = initSpy;
        c.resolve = jest.fn(() => c.__sdkAdapter);
        return result;
      };

      await withEngine(
        baseGlobals,
        { mode: 'full', requireSdk: true, bootstrap: wrapped },
        async () => undefined,
      );
      expect(initSpy).toHaveBeenCalledTimes(1);
    });

    it('calls SDK adapter dispose() on the success teardown path', async () => {
      const { bootstrap } = makeFakeBootstrap();
      let captured: FakeContainer | undefined;
      const wrapped: typeof bootstrap = (options) => {
        const result = bootstrap(options);
        const c = result.container as unknown as FakeContainer;
        c.resolve = jest.fn(() => c.__sdkAdapter);
        captured = c;
        return result;
      };

      await withEngine(
        baseGlobals,
        { mode: 'full', bootstrap: wrapped },
        async () => undefined,
      );
      expect(captured?.__sdkAdapter.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
