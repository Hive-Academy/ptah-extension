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

import { withEngine } from './with-engine.js';
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
}

function makeFakeContainer(): FakeContainer {
  return { clearInstances: jest.fn() };
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
});
