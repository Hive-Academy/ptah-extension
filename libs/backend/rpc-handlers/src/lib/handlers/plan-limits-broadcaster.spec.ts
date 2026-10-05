/**
 * PlanLimitsBroadcaster — push of `planLimits:changed` (TASK_2026_596,
 * Component 12; Decision 7).
 *
 * Contracts: subscribes to the ledger on construction; one 500 ms timer folds
 * a burst of changes into one push of the full snapshot; an overlapping
 * older push is dropped; failures are debug-logged and not retried;
 * `dispose()` is synchronous, idempotent, clears the timer and unsubscribes.
 */

// The cli-agent-runtime barrel (plan-limit discovery tokens) reaches the
// workspace-intelligence tree-sitter loader, whose `wasm-bundle-dir` reads
// `import.meta.url` (unparseable under CommonJS ts-jest). Nothing here parses.
jest.mock('../../../../workspace-intelligence/src/ast/wasm-bundle-dir', () => ({
  BUNDLE_DIR: '',
  resolveWasmPath: (filename: string) => filename,
}));
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { MESSAGE_TYPES, type PlanLimitsSnapshot } from '@ptah-extension/shared';

import {
  PLAN_LIMITS_PUSH_DELAY_MS,
  PlanLimitsBroadcaster,
} from './plan-limits-broadcaster';

function snapshotAt(generatedAt: number): PlanLimitsSnapshot {
  return { generatedAt, owners: [], sessionOwners: {} };
}

interface Suite {
  broadcaster: PlanLimitsBroadcaster;
  emit: () => void;
  listeners: Set<() => void>;
  currentSnapshot: jest.Mock<Promise<PlanLimitsSnapshot>, []>;
  broadcastMessage: jest.Mock<Promise<void>, [string, unknown]>;
  logger: MockLogger;
}

function buildSuite(): Suite {
  const logger = createMockLogger();
  const listeners = new Set<() => void>();
  const ledger = {
    onChange: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
  const currentSnapshot = jest.fn<Promise<PlanLimitsSnapshot>, []>(async () =>
    snapshotAt(1),
  );
  const broadcastMessage = jest.fn<Promise<void>, [string, unknown]>(
    async () => undefined,
  );
  const broadcaster = new PlanLimitsBroadcaster(
    logger as unknown as Logger,
    ledger,
    { currentSnapshot },
    { broadcastMessage },
  );
  return {
    broadcaster,
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
    listeners,
    currentSnapshot,
    broadcastMessage,
    logger,
  };
}

describe('PlanLimitsBroadcaster', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('subscribes to ledger changes on construction', () => {
    const s = buildSuite();
    expect(s.listeners.size).toBe(1);
  });

  it('folds a burst of changes into one push of the full snapshot after 500 ms', async () => {
    const s = buildSuite();
    s.currentSnapshot.mockResolvedValue(snapshotAt(42));

    s.emit();
    s.emit();
    await jest.advanceTimersByTimeAsync(PLAN_LIMITS_PUSH_DELAY_MS - 1);
    s.emit();
    expect(s.broadcastMessage).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);

    expect(s.currentSnapshot).toHaveBeenCalledTimes(1);
    expect(s.broadcastMessage).toHaveBeenCalledTimes(1);
    expect(s.broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
      snapshotAt(42),
    );
    expect(MESSAGE_TYPES.PLAN_LIMITS_CHANGED).toBe('planLimits:changed');
  });

  it('keeps one timer: a steady stream of changes still pushes every 500 ms', async () => {
    const s = buildSuite();

    for (let i = 0; i < 10; i += 1) {
      s.emit();
      await jest.advanceTimersByTimeAsync(100);
    }

    expect(s.broadcastMessage).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBeLessThanOrEqual(1);
  });

  it('runs one trailing assemble after changes arrive during an in-flight push', async () => {
    const s = buildSuite();
    let releaseFirst!: (value: PlanLimitsSnapshot) => void;
    s.currentSnapshot
      .mockImplementationOnce(
        () =>
          new Promise<PlanLimitsSnapshot>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(snapshotAt(2));

    s.emit();
    s.emit();
    s.emit();
    await jest.advanceTimersByTimeAsync(PLAN_LIMITS_PUSH_DELAY_MS);
    s.emit();
    await jest.advanceTimersByTimeAsync(PLAN_LIMITS_PUSH_DELAY_MS);
    releaseFirst(snapshotAt(1));
    await jest.advanceTimersByTimeAsync(0);

    expect(s.broadcastMessage).toHaveBeenCalledTimes(2);
    expect(s.currentSnapshot).toHaveBeenCalledTimes(2);
    expect(s.broadcastMessage).toHaveBeenLastCalledWith(
      MESSAGE_TYPES.PLAN_LIMITS_CHANGED,
      snapshotAt(2),
    );
  });

  it('debug-logs a failed broadcast once and does not retry it', async () => {
    const s = buildSuite();
    s.broadcastMessage.mockRejectedValue(new Error('webview gone'));

    s.emit();
    await jest.advanceTimersByTimeAsync(PLAN_LIMITS_PUSH_DELAY_MS * 4);

    expect(s.broadcastMessage).toHaveBeenCalledTimes(1);
    expect(s.logger.debug).toHaveBeenCalledWith(
      '[PlanLimitsBroadcaster] push failed',
      { errorName: 'Error' },
    );
  });

  it('debug-logs a failed snapshot without broadcasting', async () => {
    const s = buildSuite();
    s.currentSnapshot.mockRejectedValue(new TypeError('boom'));

    s.emit();
    await jest.advanceTimersByTimeAsync(PLAN_LIMITS_PUSH_DELAY_MS);

    expect(s.broadcastMessage).not.toHaveBeenCalled();
    expect(s.logger.debug).toHaveBeenCalledWith(
      '[PlanLimitsBroadcaster] push failed',
      { errorName: 'TypeError' },
    );
  });

  it('dispose() clears the pending timer and unsubscribes, idempotently', async () => {
    const s = buildSuite();
    s.emit();
    expect(jest.getTimerCount()).toBe(1);

    s.broadcaster.dispose();
    s.broadcaster.dispose();

    expect(jest.getTimerCount()).toBe(0);
    expect(s.listeners.size).toBe(0);
    s.emit();
    await jest.advanceTimersByTimeAsync(PLAN_LIMITS_PUSH_DELAY_MS * 2);
    expect(s.broadcastMessage).not.toHaveBeenCalled();
  });

  it('drops a push whose snapshot settles after dispose()', async () => {
    const s = buildSuite();
    let release!: (value: PlanLimitsSnapshot) => void;
    s.currentSnapshot.mockImplementationOnce(
      () =>
        new Promise<PlanLimitsSnapshot>((resolve) => {
          release = resolve;
        }),
    );

    s.emit();
    await jest.advanceTimersByTimeAsync(PLAN_LIMITS_PUSH_DELAY_MS);
    s.broadcaster.dispose();
    release(snapshotAt(3));
    await jest.advanceTimersByTimeAsync(0);

    expect(s.broadcastMessage).not.toHaveBeenCalled();
  });

  it('does not run a dirty trailing push after dispose during an assemble', async () => {
    const s = buildSuite();
    let release!: (value: PlanLimitsSnapshot) => void;
    s.currentSnapshot.mockImplementationOnce(
      () =>
        new Promise<PlanLimitsSnapshot>((resolve) => {
          release = resolve;
        }),
    );
    s.emit();
    await jest.advanceTimersByTimeAsync(PLAN_LIMITS_PUSH_DELAY_MS);
    s.emit();
    s.broadcaster.dispose();
    release(snapshotAt(1));
    await jest.advanceTimersByTimeAsync(0);

    expect(s.currentSnapshot).toHaveBeenCalledTimes(1);
  });
});
