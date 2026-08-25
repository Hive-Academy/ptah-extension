/**
 * `finalizeExit` — the one-shot CLI's terminal step.
 *
 * The behaviour under test is the fix for a CLI-wide hang: `main()` set
 * `process.exitCode` and returned, and every `withEngine({ mode: 'full' })`
 * command leaves a live chokidar watcher behind, so the event loop never
 * drained and the process never exited. `ptah doctor --json` printed a
 * complete report and then sat there until its caller timed out.
 *
 * Three properties matter and each has a test below:
 *   1. It drains stdout BEFORE exiting (Windows pipes accept writes async, so
 *      exiting on the write tick truncates the last notification).
 *   2. The drain is CAPPED — a consumer that stopped reading must not be able
 *      to hang the exit path that exists to stop hangs.
 *   3. The code survives the trip: a failed CI gate must not exit 0.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  DEFAULT_DRAIN_TIMEOUT_MS,
  finalizeExit,
  resolveExitCode,
} from './finalize-exit.js';

interface StdoutTrace {
  stdout: { write(chunk: string, cb: () => void): boolean };
  /** Release a withheld drain callback. Undefined until `write` was called. */
  release?: () => void;
}

/** A stdout whose write callback fires immediately (the happy path). */
function immediateStdout(): StdoutTrace {
  return {
    stdout: {
      write: (_chunk: string, cb: () => void): boolean => {
        cb();
        return true;
      },
    },
  };
}

/** A stdout that never invokes its write callback (a stalled consumer). */
function stalledStdout(): StdoutTrace {
  const trace: StdoutTrace = {
    stdout: {
      write: (_chunk: string, cb: () => void): boolean => {
        trace.release = cb;
        return false;
      },
    },
  };
  return trace;
}

function makeStderr(): { write: jest.Mock; buffer: () => string } {
  const chunks: string[] = [];
  const write = jest.fn((chunk: string) => {
    chunks.push(chunk);
    return true;
  });
  return { write, buffer: () => chunks.join('') };
}

describe('resolveExitCode', () => {
  it('passes integer codes through', () => {
    expect(resolveExitCode(0)).toBe(0);
    expect(resolveExitCode(1)).toBe(1);
    expect(resolveExitCode(130)).toBe(130);
  });

  it('treats an unset exit code as success', () => {
    expect(resolveExitCode(undefined)).toBe(0);
    expect(resolveExitCode(null)).toBe(0);
  });

  // `process.exitCode` is typed `number | string | undefined`. A string reaching
  // `process.exit` unparsed becomes NaN and then 0, which would turn a red CI
  // gate green — the exact failure mode `ptah harness doctor` exists to catch.
  it('parses a numeric string rather than collapsing it to 0', () => {
    expect(resolveExitCode('1')).toBe(1);
    expect(resolveExitCode('42')).toBe(42);
  });

  it('falls back to 0 for a non-numeric string', () => {
    expect(resolveExitCode('SIGTERM')).toBe(0);
  });
});

describe('finalizeExit', () => {
  it('drains stdout before calling exit', async () => {
    const order: string[] = [];
    const exit = jest.fn(() => {
      order.push('exit');
    });
    const stdout = {
      write: (_chunk: string, cb: () => void): boolean => {
        order.push('write');
        cb();
        return true;
      },
    };

    await finalizeExit(0, { stdout, exit, stderr: makeStderr() });

    expect(order).toEqual(['write', 'exit']);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('forwards the resolved exit code', async () => {
    const exit = jest.fn();

    await finalizeExit(1, {
      stdout: immediateStdout().stdout,
      exit,
      stderr: makeStderr(),
    });

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits anyway when the drain never completes, and says so on stderr', async () => {
    jest.useFakeTimers();
    try {
      const exit = jest.fn();
      const stderr = makeStderr();
      const trace = stalledStdout();

      const pending = finalizeExit(3, {
        stdout: trace.stdout,
        exit,
        stderr,
        drainTimeoutMs: 5_000,
      });

      // The consumer is stalled — nothing has happened yet.
      await Promise.resolve();
      expect(exit).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5_000);
      await pending;

      expect(exit).toHaveBeenCalledWith(3);
      expect(stderr.buffer()).toMatch(/stdout drain timeout \(5000ms\)/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not warn when the drain wins the race', async () => {
    const stderr = makeStderr();

    await finalizeExit(0, {
      stdout: immediateStdout().stdout,
      exit: jest.fn(),
      stderr,
    });

    expect(stderr.write).not.toHaveBeenCalled();
  });

  it('defaults the cap to the same 5s `session start --once` uses', () => {
    expect(DEFAULT_DRAIN_TIMEOUT_MS).toBe(5_000);
  });
});

/**
 * A helper nobody calls fixes nothing. `main.ts` cannot be imported here — it
 * runs `void main()` at module load — so this follows the same static-analysis
 * approach as `batch1-signal-handler.spec.ts` and asserts the wiring as text.
 */
describe('main.ts wiring', () => {
  const MAIN_TS_PATH = path.resolve(__dirname, '..', '..', 'main.ts');
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(MAIN_TS_PATH, 'utf-8');
  });

  it('imports finalizeExit and resolveExitCode', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*finalizeExit[^}]*\}\s*from\s*'\.\/cli\/io\/finalize-exit\.js'/,
    );
    expect(source).toMatch(/resolveExitCode/);
  });

  it('awaits finalizeExit after the router resolves, with the resolved code', () => {
    const parseIndex = source.indexOf('router.parseAsync(process.argv)');
    const finalizeIndex = source.indexOf(
      'finalizeExit(resolveExitCode(process.exitCode))',
    );
    expect(parseIndex).toBeGreaterThan(-1);
    expect(finalizeIndex).toBeGreaterThan(parseIndex);
    expect(source).toMatch(
      /await\s+finalizeExit\(resolveExitCode\(process\.exitCode\)\)/,
    );
  });
});
