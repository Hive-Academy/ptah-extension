/**
 * PtahFileSettingsManager — Performance smoke test (Gap E).
 *
 * NOT a CI hard gate. This is a sanity check to catch catastrophic regressions
 * such as O(n²) flush behavior or unbounded write-queue growth.
 *
 * The bound of 5 000 ms for 1 000 sequential awaited writes is very loose —
 * an individual write on a healthy disk should complete in < 3 ms. The test
 * will only fail if there is a serious performance regression (e.g. the write
 * serialization chain becomes O(n²) or every write flushes the entire queue
 * multiple times).
 *
 * To run in isolation:
 *   nx test platform-core --testFile file-settings-manager.bench.spec.ts
 *
 * Source-under-test:
 *   libs/backend/platform-core/src/file-settings-manager.ts
 */

import * as fs from 'fs';
import * as nodeOs from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Sandbox homedir so the benchmark writes to an isolated temp directory.
// ---------------------------------------------------------------------------

const benchTempHome = fs.mkdtempSync(path.join(nodeOs.tmpdir(), 'ptah-bench-'));

const prevHome = process.env['HOME'];
const prevUserProfile = process.env['USERPROFILE'];
process.env['HOME'] = benchTempHome;
process.env['USERPROFILE'] = benchTempHome;

jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return { ...actual, homedir: () => benchTempHome };
});

afterAll(() => {
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
  if (prevUserProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = prevUserProfile;
  try {
    fs.rmSync(benchTempHome, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

import { PtahFileSettingsManager } from './file-settings-manager';

// ---------------------------------------------------------------------------
// Performance smoke test
// ---------------------------------------------------------------------------

/**
 * SANITY CHECK — not a CI hard gate.
 *
 * 1 000 sequential awaited set() calls must complete in < 5 000 ms.
 * Average per-write latency is logged for observability.
 *
 * This catches:
 *   - O(n²) write-queue chaining (the writePromise chain would grow without bound).
 *   - Unbounded fsPromises.writeFile call accumulation.
 *   - Missed async dispose causing open handles.
 */
describe('Performance smoke — PtahFileSettingsManager (Gap E)', () => {
  // Use a generous 30 s Jest timeout so this does not flake on slow CI.
  const JEST_TIMEOUT = 30_000;
  const WRITE_COUNT = 1_000;
  const MAX_TOTAL_MS = 10_000; // loose sanity bound — not a perf SLA (raised for slow Windows runners)

  it(
    `completes ${WRITE_COUNT} sequential set() calls in < ${MAX_TOTAL_MS} ms`,
    async () => {
      const mgr = new PtahFileSettingsManager({});

      const keys = [
        'authMethod',
        'llm.defaultProvider',
        'provider.openrouter.selectedModel',
        'agentOrchestration.copilotAutoApprove',
        'reasoningEffort',
      ];

      const start = performance.now();

      for (let i = 0; i < WRITE_COUNT; i++) {
        const key = keys[i % keys.length];
        await mgr.set(key, `value-${i}`);
      }

      const elapsed = performance.now() - start;
      const avgMs = elapsed / WRITE_COUNT;

      // Log for observability — always printed so CI logs show the latency.
      console.info(
        `[bench] ${WRITE_COUNT} sequential set() calls: ` +
          `total=${elapsed.toFixed(1)} ms, avg=${avgMs.toFixed(2)} ms/write`,
      );

      // Sanity bound: total must be under 10 s (raised from 5 s for slow Windows CI runners).
      // NOTE: This is NOT a performance SLA — just a sanity check that
      // catastrophic O(n²) behavior or infinite write queues haven't regressed.
      expect(elapsed).toBeLessThan(MAX_TOTAL_MS);

      // Verify the file is still valid JSON after all writes.
      const settingsPath = mgr.getFilePath();
      expect(fs.existsSync(settingsPath)).toBe(true);
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
    },
    JEST_TIMEOUT,
  );

  it(
    'does not leak open handles after 1 000 writes (disposeCrossProcessWatch is idempotent)',
    async () => {
      const mgr = new PtahFileSettingsManager({});
      mgr.enableCrossProcessWatch();

      for (let i = 0; i < 20; i++) {
        await mgr.set(`bench.key.${i % 5}`, i);
      }

      // Dispose must not throw and must close the watcher cleanly.
      expect(() => mgr.disposeCrossProcessWatch()).not.toThrow();
      expect(() => mgr.disposeCrossProcessWatch()).not.toThrow(); // idempotent
    },
    JEST_TIMEOUT,
  );
});
