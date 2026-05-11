/**
 * TC-6 — Batch 1 regression guard: CLI signal handler must NOT call
 * process.exit() directly in the first-signal path.
 *
 * The Batch 1 fix changes the SIGINT/SIGTERM handler to set `process.exitCode`
 * and return, relying on the synchronous `process.on('exit', ...)` hook for the
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
