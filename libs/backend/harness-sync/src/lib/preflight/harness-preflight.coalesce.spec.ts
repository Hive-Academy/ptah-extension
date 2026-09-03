/**
 * `HarnessPreflightService` — concurrency coalescing and external-pass credit (TASK_2026_367 / C6a).
 *
 * Verifies that:
 * 1. Concurrent `ensure()` calls for the same workspace root share a single in-flight pass.
 * 2. Concurrent `ensure()` calls for different roots run independently.
 * 3. `force: true` bypasses throttle but still joins an already in-flight pass.
 * 4. External passes emitted by the reconciler stamp `lastPassAt` and credit the throttle.
 * 5. After an in-flight pass settles, the map is cleaned up and subsequent passes can run.
 * 6. `dispose()` unsubscribes the health listener from the reconciler.
 * 7. Cleanup cannot precede insertion, so a failure before the first `await` can
 *    never cache a rejected promise for a root (TASK_2026_367 / F3).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { HarnessHealth } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  DEFAULT_PREFLIGHT_TIMEOUT_MS,
  HarnessPreflightService,
} from './harness-preflight.service';
import type { HarnessReconcilerService } from '../reconciler/harness-reconciler.service';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeHealth(over: Partial<HarnessHealth> = {}): HarnessHealth {
  return {
    workspaceRoot: '/ws',
    generatedAt: '2026-01-01T00:00:00.000Z',
    mode: 'preflight',
    reason: 'session-preflight:preflight',
    sources: 'ok',
    targets: [],
    collisions: [],
    ...over,
  };
}

function makeWorkspace(): { root: string; nested: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'ptah-preflight-coalesce-'));
  mkdirSync(join(root, '.ptah'), { recursive: true });
  const nested = join(root, 'packages', 'api', 'src');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, 'package.json'), '{}', 'utf8');
  return {
    root,
    nested,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

interface MockReconciler {
  reconcile: jest.Mock;
  onHealth: jest.Mock;
  emitHealth: (health: HarnessHealth) => void;
  healthListeners: Set<(health: HarnessHealth) => void>;
  unsubscribeMock: jest.Mock;
}

function makeMockReconciler(): MockReconciler {
  const healthListeners = new Set<(health: HarnessHealth) => void>();
  const unsubscribeMock = jest.fn();

  const reconcile = jest.fn();
  const onHealth = jest.fn((listener: (health: HarnessHealth) => void) => {
    healthListeners.add(listener);
    return () => {
      healthListeners.delete(listener);
      unsubscribeMock();
    };
  });

  const emitHealth = (health: HarnessHealth) => {
    for (const listener of healthListeners) {
      listener(health);
    }
  };

  return {
    reconcile,
    onHealth,
    emitHealth,
    healthListeners,
    unsubscribeMock,
  };
}

function build(
  reconciler: MockReconciler,
  deps: ConstructorParameters<typeof HarnessPreflightService>[2] = {},
): { service: HarnessPreflightService; logger: Logger } {
  const logger = makeLogger();
  const service = new HarnessPreflightService(
    logger,
    reconciler as unknown as HarnessReconcilerService,
    deps,
  );
  return { service, logger };
}

describe('HarnessPreflightService — concurrency coalescing and credit (C6a)', () => {
  let ws1: ReturnType<typeof makeWorkspace>;
  let ws2: ReturnType<typeof makeWorkspace>;
  let reconciler: MockReconciler;

  beforeEach(() => {
    ws1 = makeWorkspace();
    ws2 = makeWorkspace();
    reconciler = makeMockReconciler();
  });

  afterEach(() => {
    ws1.cleanup();
    ws2.cleanup();
  });

  it('invokes reconciler.reconcile once and returns the same value for concurrent ensure() calls on the same root', async () => {
    let finishPass!: (health: HarnessHealth) => void;
    reconciler.reconcile.mockImplementation(
      () =>
        new Promise<HarnessHealth>((resolve) => {
          finishPass = resolve;
        }),
    );
    const { service } = build(reconciler, { minIntervalMs: 60_000 });

    const p1 = service.ensure(ws1.root);
    const p2 = service.ensure(ws1.root);

    // Only one reconcile invocation has been dispatched
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);

    const health = makeHealth({ workspaceRoot: ws1.root });
    finishPass(health);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(health);
    expect(r2).toBe(health);
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);
  });

  it('runs separate reconcile passes concurrently for different workspace roots', async () => {
    let finishWs1!: (health: HarnessHealth) => void;
    let finishWs2!: (health: HarnessHealth) => void;
    reconciler.reconcile.mockImplementation((root: string) => {
      if (root === ws1.root) {
        return new Promise<HarnessHealth>((resolve) => {
          finishWs1 = resolve;
        });
      }
      return new Promise<HarnessHealth>((resolve) => {
        finishWs2 = resolve;
      });
    });
    const { service } = build(reconciler, { minIntervalMs: 60_000 });

    const p1 = service.ensure(ws1.root);
    const p2 = service.ensure(ws2.root);

    expect(reconciler.reconcile).toHaveBeenCalledTimes(2);

    const health1 = makeHealth({ workspaceRoot: ws1.root });
    const health2 = makeHealth({ workspaceRoot: ws2.root });
    finishWs1(health1);
    finishWs2(health2);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(health1);
    expect(r2).toBe(health2);
  });

  it('joins an in-flight pass even when force: true is specified for the same root', async () => {
    let finishPass!: (health: HarnessHealth) => void;
    reconciler.reconcile.mockImplementation(
      () =>
        new Promise<HarnessHealth>((resolve) => {
          finishPass = resolve;
        }),
    );
    const { service } = build(reconciler, { minIntervalMs: 60_000 });

    const p1 = service.ensure(ws1.root);
    const p2 = service.ensure(ws1.root, { force: true });

    // force: true joins the in-flight pass rather than spawning a concurrent duplicate
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);

    const health = makeHealth({ workspaceRoot: ws1.root });
    finishPass(health);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(health);
    expect(r2).toBe(health);
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);
  });

  it('credits external passes by stamping lastPassAt on health events, throttling subsequent ensure() without reconcile', async () => {
    reconciler.reconcile.mockResolvedValue(
      makeHealth({ workspaceRoot: ws1.root }),
    );
    const { service } = build(reconciler, { minIntervalMs: 60_000 });

    // Emitting a health event for ws1.root (e.g. from an external full pass or propagate)
    reconciler.emitHealth(makeHealth({ workspaceRoot: ws1.root }));

    // Subsequent ensure() call for that root should be throttled and return null without calling reconcile
    const result = await service.ensure(ws1.root);
    expect(result).toBeNull();
    expect(reconciler.reconcile).not.toHaveBeenCalled();
  });

  it('cleans up inFlight when settled, allowing subsequent force: true to start a new pass', async () => {
    const health1 = makeHealth({
      workspaceRoot: ws1.root,
      generatedAt: '2026-01-01T00:00:00.000Z',
    });
    const health2 = makeHealth({
      workspaceRoot: ws1.root,
      generatedAt: '2026-01-01T00:01:00.000Z',
    });
    reconciler.reconcile
      .mockResolvedValueOnce(health1)
      .mockResolvedValueOnce(health2);

    const { service } = build(reconciler, { minIntervalMs: 60_000 });

    const r1 = await service.ensure(ws1.root);
    expect(r1).toBe(health1);
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);

    // After the pass has settled, inFlight is cleaned up. A forced call starts a new pass.
    const r2 = await service.ensure(ws1.root, { force: true });
    expect(r2).toBe(health2);
    expect(reconciler.reconcile).toHaveBeenCalledTimes(2);
  });

  /**
   * F3 (TASK_2026_367). The pass used to run as an IIFE whose `finally` could
   * fire BEFORE `inFlight.set`, so a synchronous throw ahead of the first
   * `await` deleted an absent entry and then cached the rejected promise for
   * the root forever. `readTimeoutMs` is the host-supplied read that could do
   * it.
   */
  describe('a throwing timeout-config read (F3)', () => {
    it('resolves instead of rejecting, runs the pass on the default budget, and cleans the map up', async () => {
      const health1 = makeHealth({ workspaceRoot: ws1.root });
      const health2 = makeHealth({
        workspaceRoot: ws1.root,
        generatedAt: '2026-01-01T00:01:00.000Z',
      });
      reconciler.reconcile
        .mockResolvedValueOnce(health1)
        .mockResolvedValueOnce(health2);
      const readTimeoutMs = jest.fn(() => {
        throw new Error('settings store unavailable');
      });
      const { service, logger } = build(reconciler, {
        minIntervalMs: 60_000,
        readTimeoutMs,
      });

      await expect(service.ensure(ws1.root)).resolves.toBe(health1);
      expect(readTimeoutMs).toHaveBeenCalled();
      expect(reconciler.reconcile).toHaveBeenCalledTimes(1);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('using the default budget'),
        expect.objectContaining({ budgetMs: DEFAULT_PREFLIGHT_TIMEOUT_MS }),
      );

      // The map was cleaned, so the next forced call starts a NEW pass rather
      // than joining a cached rejected promise.
      await expect(service.ensure(ws1.root, { force: true })).resolves.toBe(
        health2,
      );
      expect(reconciler.reconcile).toHaveBeenCalledTimes(2);
    });
  });

  it('cleans up inFlight after a timed-out pass, allowing a forced call to start a new one', async () => {
    const health = makeHealth({ workspaceRoot: ws1.root });
    reconciler.reconcile
      .mockImplementationOnce(
        () =>
          // Never settles inside the budget; the race decides.
          new Promise<HarnessHealth>(() => undefined),
      )
      .mockResolvedValueOnce(health);
    const { service } = build(reconciler, { minIntervalMs: 60_000 });

    await expect(
      service.ensure(ws1.root, { timeoutMs: 5 }),
    ).resolves.toBeNull();
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);

    await expect(service.ensure(ws1.root, { force: true })).resolves.toBe(
      health,
    );
    expect(reconciler.reconcile).toHaveBeenCalledTimes(2);
  });

  it('cleans up inFlight after a rejected reconcile, allowing a forced call to start a new one', async () => {
    const health = makeHealth({ workspaceRoot: ws1.root });
    reconciler.reconcile
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockResolvedValueOnce(health);
    const { service } = build(reconciler, { minIntervalMs: 60_000 });

    await expect(service.ensure(ws1.root)).resolves.toBeNull();
    expect(reconciler.reconcile).toHaveBeenCalledTimes(1);

    await expect(service.ensure(ws1.root, { force: true })).resolves.toBe(
      health,
    );
    expect(reconciler.reconcile).toHaveBeenCalledTimes(2);
  });

  /**
   * The delete is CONDITIONAL on the stored promise still being this pass's
   * own. Through the public API an entry is only ever replaced after its own
   * cleanup ran, so this reads the private map directly to model the one
   * ordering the guard exists for: an earlier pass settling while a LATER
   * pass for the same root is the stored one. An unconditional delete would
   * evict the later pass and let a third caller start a duplicate walk.
   */
  it('does not delete a later pass entry when an earlier pass for the same root settles', async () => {
    let finishPass!: (health: HarnessHealth) => void;
    reconciler.reconcile.mockImplementation(
      () =>
        new Promise<HarnessHealth>((resolve) => {
          finishPass = resolve;
        }),
    );
    const { service } = build(reconciler, { minIntervalMs: 60_000 });

    const first = service.ensure(ws1.root);
    const inFlight = (
      service as unknown as {
        inFlight: Map<string, Promise<HarnessHealth | null>>;
      }
    ).inFlight;
    expect(inFlight.size).toBe(1);

    // A later pass for the same root becomes the stored entry.
    const laterHealth = makeHealth({
      workspaceRoot: ws1.root,
      generatedAt: '2026-01-01T00:02:00.000Z',
    });
    const laterPass = Promise.resolve<HarnessHealth | null>(laterHealth);
    inFlight.set(ws1.root, laterPass);

    finishPass(makeHealth({ workspaceRoot: ws1.root }));
    await first;

    expect(inFlight.get(ws1.root)).toBe(laterPass);
  });

  it('unsubscribes from reconciler health events on dispose()', () => {
    const { service } = build(reconciler);
    expect(reconciler.onHealth).toHaveBeenCalledTimes(1);
    expect(reconciler.healthListeners.size).toBe(1);

    service.dispose();
    expect(reconciler.unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(reconciler.healthListeners.size).toBe(0);
  });
});
