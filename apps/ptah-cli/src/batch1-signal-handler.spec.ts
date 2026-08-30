/**
 * Regression guard: CLI signal handler must NOT call
 * process.exit() directly in the first-signal path.
 *
 * The SIGINT/SIGTERM handler sets `process.exitCode`
 * and returns, relying on the synchronous `process.on('exit', ...)` hook for the
 * flushSync() call. If someone reverts this to `process.exit(exitCode)`, the
 * flush is skipped because the 'exit' event still fires but the synchronous
 * tmp-rename inside flushSync() may not complete before the process tears down.
 *
 * This is a static-analysis test: it reads main.ts as text and asserts structural
 * invariants about the signal handler body. It does NOT execute signal handlers.
 *
 * Source-under-test: apps/ptah-cli/src/main.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// Resolve absolute path to the source file under test.
// Using __dirname from the compiled/ts-jest context keeps this
// platform-portable without relying on process.cwd().
const MAIN_TS_PATH = path.resolve(__dirname, 'main.ts');

describe('TC-6: CLI signal handler static analysis — Batch 1 regression guard', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(MAIN_TS_PATH, 'utf-8');
  });

  it('installSignalHandlers sets process.exitCode (not process.exit) in the first-signal path', () => {
    // The source must contain the exitCode assignment pattern.
    expect(source).toMatch(/process\.exitCode\s*=/);
  });

  it('the onSignal handler does NOT call process.exit() in the first-signal branch', () => {
    // Extract the onSignal function body. We look for the function that the
    // signal handler closures share — it contains the `shuttingDown` guard.
    // Strategy: find the block from `onSignal` definition to the closing brace
    // of the outer function. Then assert no process.exit() call appears AFTER
    // `shuttingDown = true` (the first-signal path).
    //
    // The second-signal guard (the early-bail `if (shuttingDown)` block) IS
    // allowed to call process.exit(). We look only at the first-signal tail.
    const secondSignalMarker = 'shuttingDown = true';
    const idx = source.indexOf(secondSignalMarker);
    expect(idx).toBeGreaterThan(-1); // marker must exist

    // Everything after `shuttingDown = true` up to the end of the handler.
    const firstSignalTail = source.slice(idx + secondSignalMarker.length);
    const handlerBodyEnd = firstSignalTail.indexOf('};');
    const handlerBody =
      handlerBodyEnd >= 0
        ? firstSignalTail.slice(0, handlerBodyEnd)
        : firstSignalTail.slice(0, 500); // safety cap

    // The first-signal body must set exitCode
    expect(handlerBody).toMatch(/process\.exitCode\s*=/);

    // Strip comments so we don't match "do NOT call process.exit()" in comments.
    // Remove single-line comments (// ...) from the extracted block.
    const codeOnly = handlerBody.replace(/\/\/[^\n]*/g, '');

    // The first-signal body code (comments removed) must NOT call process.exit(
    expect(codeOnly).not.toMatch(/process\.exit\s*\(/);
  });

  it('process.on("exit") is registered as the flushSync safety net', () => {
    // Verify the exit hook that calls CliDIContainer.flushSync() exists.
    expect(source).toMatch(/process\.on\s*\(\s*['"]exit['"]/);
    expect(source).toMatch(/CliDIContainer\.flushSync\s*\(\s*\)/);
  });
});

/**
 * Every route out of this process must drain the session metadata queue
 * (TASK_2026_324 finding 3). The store coalesces a burst of writes into one
 * update at the end of its queue drain, so a CLI agent that exited on the last
 * turn leaves its reference STAGED. `process.on('exit')` cannot stand in: that
 * hook is synchronous and the write is not.
 *
 * There are three routes, and each needs its own call:
 *   1. a signal — started, because a signal handler cannot be async;
 *   2. normal completion — awaited, before `finalizeExit` calls `process.exit`;
 *   3. a fatal error — awaited, before the `process.exit(1)` in the catch.
 *
 * Route 3 is the one that was missing: a command that threw after running CLI
 * agents dropped everything they had staged.
 */
describe('CLI session metadata flush — every exit route', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(MAIN_TS_PATH, 'utf-8');
  });

  it('calls the flush on all three exit routes', () => {
    const calls = source.split('flushSessionMetadataStores()').length - 1;
    expect(calls).toBe(3);
  });

  it('flushes before the fatal-path process.exit(1), not after', () => {
    const catchIndex = source.indexOf('[ptah] fatal:');
    expect(catchIndex).toBeGreaterThan(-1);
    const catchBody = source.slice(catchIndex);

    const flushIndex = catchBody.indexOf('flushSessionMetadataStores()');
    const exitIndex = catchBody.indexOf('process.exit(1)');

    expect(flushIndex).toBeGreaterThan(-1);
    expect(exitIndex).toBeGreaterThan(-1);
    expect(flushIndex).toBeLessThan(exitIndex);
    expect(catchBody.slice(flushIndex - 6, flushIndex)).toContain('await');
  });
});
