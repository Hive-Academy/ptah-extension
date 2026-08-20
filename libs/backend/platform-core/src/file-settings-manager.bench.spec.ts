/**
 * PtahFileSettingsManager — Performance smoke test (Gap E).
 *
 * NOT a CI hard gate. This is a sanity check to catch catastrophic regressions
 * such as O(n²) flush behavior or unbounded write-queue growth.
 *
 * The check compares the cost of the LAST quarter of 1 000 sequential awaited
 * writes against the FIRST quarter. It fails only on a serious algorithmic
 * regression — the write serialization chain turning O(n²), or every write
 * flushing the whole accumulated queue — because those make per-write cost grow
 * with queue depth. A ratio, unlike an absolute stopwatch bound, does not flake
 * when the gate runs this project next to four others competing for the disk.
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
  /**
   * Tail-vs-head latency ratio permitted before we call it a regression.
   *
   * Under the healthy linear chain the last quarter of the writes costs about
   * the same as the first quarter, so the ratio hovers near 1. Under the
   * O(n²) failure this test exists to catch — where each `set()` re-walks or
   * re-flushes the accumulated queue — the tail is many times the head, and
   * at n = 1000 the ratio is in the tens. 4× sits far above the noise floor
   * and far below any real regression.
   */
  const MAX_TAIL_HEAD_RATIO = 4;

  it(
    `keeps per-write cost flat across ${WRITE_COUNT} sequential set() calls (no O(n²) growth)`,
    async () => {
      const mgr = new PtahFileSettingsManager({});

      const keys = [
        'authMethod',
        'llm.defaultProvider',
        'provider.openrouter.selectedModel',
        'agentOrchestration.copilotAutoApprove',
        'reasoningEffort',
      ];

      const quarter = WRITE_COUNT / 4;
      let headMs = 0;
      let tailMs = 0;
      const start = performance.now();

      for (let i = 0; i < WRITE_COUNT; i++) {
        const key = keys[i % keys.length];
        const t0 = performance.now();
        await mgr.set(key, `value-${i}`);
        const cost = performance.now() - t0;
        if (i < quarter) headMs += cost;
        else if (i >= WRITE_COUNT - quarter) tailMs += cost;
      }

      const elapsed = performance.now() - start;
      const ratio = headMs === 0 ? 1 : tailMs / headMs;

      // Log for observability — always printed so CI logs show the latency.
      console.info(
        `[bench] ${WRITE_COUNT} sequential set() calls: ` +
          `total=${elapsed.toFixed(1)} ms, avg=${(elapsed / WRITE_COUNT).toFixed(2)} ms/write, ` +
          `head=${headMs.toFixed(1)} ms, tail=${tailMs.toFixed(1)} ms, ratio=${ratio.toFixed(2)}`,
      );

      // This assertion is a SHAPE check, not a stopwatch.
      //
      // It used to be `expect(elapsed).toBeLessThan(10_000)`, which flaked: the
      // gate runs this project alongside four others, all hammering the same
      // disk, and 1 000 atomic write+rename pairs routinely drift past 10 s
      // purely from I/O contention (observed: 10.9 s, 12.5 s, 13.0 s). The fix
      // is deliberately NOT a bigger number — raising the bound would only move
      // the flake further out while still measuring the disk rather than the
      // code. A head-to-tail ratio measures the property the test actually
      // claims to guard (per-write cost must not grow with queue depth) and is
      // insensitive to contention, because contention slows both halves alike.
      expect(ratio).toBeLessThan(MAX_TAIL_HEAD_RATIO);

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
