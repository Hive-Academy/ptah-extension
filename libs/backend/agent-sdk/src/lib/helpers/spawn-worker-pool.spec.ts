import type { DegradationReporter, Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';

import {
  LIVE_WORKER_HARD_CAP,
  SpawnWorkerPool,
  type SpawnWorkerSink,
} from './spawn-worker-pool';

/**
 * Pool accounting only. The thread is replaced by an inert stand-in so a cap of
 * 64 costs nothing and the rate-limit window can be driven by fake timers;
 * everything that needs a REAL worker and a real child lives in
 * `off-thread-process-spawner.spec.ts`.
 */
jest.mock('node:worker_threads', () => {
  const { EventEmitter } =
    jest.requireActual<typeof import('node:events')>('node:events');
  class InertWorker extends EventEmitter {
    postMessage = jest.fn();
    ref = jest.fn();
    unref = jest.fn();
    terminate = jest.fn(() => Promise.resolve(0));
  }
  return { Worker: InertWorker };
});

const REPORT_WINDOW_MS = 60_000;

function sink(): SpawnWorkerSink {
  return { onMessage: jest.fn(), onWorkerLost: jest.fn() };
}

describe('SpawnWorkerPool', () => {
  let reporter: { report: jest.Mock };
  let pool: SpawnWorkerPool;

  beforeEach(() => {
    jest.useFakeTimers();
    reporter = { report: jest.fn() };
    pool = new SpawnWorkerPool(
      createMockLogger() as unknown as Logger,
      reporter as unknown as DegradationReporter,
    );
  });

  afterEach(async () => {
    await pool.dispose();
    jest.useRealTimers();
  });

  describe('hard-cap reporting in a sustained storm', () => {
    function hardCapDetails(): string[] {
      return reporter.report.mock.calls
        .map((call) => call[0] as { code: string; detail: string })
        .filter(
          (report) => report.code === 'agent.spawn-worker.hard-cap-inline',
        )
        .map((report) => report.detail);
    }

    it('reports once per window and carries the inline launches the window suppressed', () => {
      for (let i = 0; i < LIVE_WORKER_HARD_CAP; i++) {
        expect(pool.admit()).toBe(true);
        pool.acquire(sink());
      }

      // First refusal: reported immediately.
      expect(pool.admit()).toBe(false);
      expect(hardCapDetails()).toHaveLength(1);
      expect(hardCapDetails()[0]).toContain('inlineSinceLastReport=1');

      // Four more inside the window: refused, not reported, not forgotten.
      for (let i = 0; i < 4; i++) expect(pool.admit()).toBe(false);
      expect(hardCapDetails()).toHaveLength(1);

      jest.advanceTimersByTime(REPORT_WINDOW_MS);

      // The next report accounts for the four suppressed launches plus itself.
      expect(pool.admit()).toBe(false);
      const details = hardCapDetails();
      expect(details).toHaveLength(2);
      expect(details[1]).toContain('inlineSinceLastReport=5');
      expect(details[1]).toContain('refusals=6');
    });

    it('admits again as soon as a worker is idle', () => {
      const leases = Array.from({ length: LIVE_WORKER_HARD_CAP }, () =>
        pool.acquire(sink()),
      );
      expect(pool.admit()).toBe(false);

      leases[0]?.release(true);

      expect(pool.admit()).toBe(true);
    });
  });
});
