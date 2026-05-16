/**
 * Unit tests for `ptah proxy stop` / `ptah proxy status`.
 *
 * Coverage:
 *   - `executeStop`:
 *       * Missing `--port` → exit 1 with `proxy_invalid_request` stderr-json.
 *       * No matching registry entry (alive or stale) → exit 1 with
 *         `proxy_not_found`.
 *       * Stale entry (pid already dead) → unregister, stderr note, exit 0.
 *       * SIGTERM-then-SIGKILL fallback when the pid does not exit within 5s.
 *   - `executeStatus`:
 *       * Empty registry → exit 0, no output.
 *       * NDJSON one line per entry in `--json` mode (default).
 *       * Tabular print in `--human` mode.
 *
 * All process-level operations (`process.kill`, `setTimeout`, registry
 * functions) are injected via `ProxyLifecycleHooks` so the tests never touch
 * real pids or the real `~/.ptah/proxies/` directory.
 */

import {
  executeStatus,
  executeStop,
  type ProxyLifecycleHooks,
} from './proxy.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { ProxyRegistryEntry } from '../../services/proxy/proxy-registry.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/tmp/ws',
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

interface CapturedStreams {
  stdout: string[];
  stderr: string[];
}

function makeStreams(): CapturedStreams {
  return { stdout: [], stderr: [] };
}

function streamHooks(
  captured: CapturedStreams,
): Pick<ProxyLifecycleHooks, 'stdoutWrite' | 'stderrWrite'> {
  return {
    stdoutWrite: (chunk: string): boolean => {
      captured.stdout.push(chunk);
      return true;
    },
    stderrWrite: (chunk: string): boolean => {
      captured.stderr.push(chunk);
      return true;
    },
  };
}

function makeEntry(
  port: number,
  overrides: Partial<ProxyRegistryEntry> = {},
): ProxyRegistryEntry {
  return {
    pid: 12345,
    port,
    host: '127.0.0.1',
    startedAt: 1_700_000_000_000,
    tokenFingerprint: 'fingerprintabcdef',
    ...overrides,
  };
}

/**
 * Strongly-typed `process.kill` mock builder. Returns a function compatible
 * with `(pid: number, signal?: NodeJS.Signals | number) => true`. Backing
 * state lets tests script per-pid alive/dead behavior across multiple polls.
 */
interface KillMock {
  fn: jest.Mock<true, [number, (NodeJS.Signals | number)?]>;
  /** Set the alive flag for a pid (`true` = alive, `false` = dead/ESRCH). */
  setAlive(pid: number, alive: boolean): void;
}

function makeKillMock(initialAlive: Map<number, boolean>): KillMock {
  const alive = new Map(initialAlive);
  const fn = jest.fn((pid: number, _signal?: NodeJS.Signals | number): true => {
    const isAlive = alive.get(pid) ?? false;
    if (!isAlive) {
      const err = new Error(
        `ESRCH: no such process ${pid}`,
      ) as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    }
    return true;
  });
  return {
    fn,
    setAlive(pid: number, value: boolean): void {
      alive.set(pid, value);
    },
  };
}

// ---------------------------------------------------------------------------
// executeStop
// ---------------------------------------------------------------------------

describe('ptah proxy stop', () => {
  it('exits 1 with proxy_invalid_request stderr-json when --port is missing', async () => {
    const captured = makeStreams();
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      captured.stderr.push(
        typeof chunk === 'string' ? chunk : chunk.toString(),
      );
      return true;
    }) as typeof process.stderr.write);

    const exit = await executeStop({}, baseGlobals, {
      ...streamHooks(captured),
      list: jest.fn(async () => []),
      findStale: jest.fn(async () => []),
    });

    expect(exit).toBe(ExitCode.GeneralError);
    // emitFatalError writes to process.stderr (not the injected stderrWrite).
    const stderrJoined = captured.stderr.join('');
    expect(stderrJoined).toContain('"error":"proxy_invalid_request"');
    expect(stderrJoined).toContain('--port');
    stderrSpy.mockRestore();
  });

  it('exits 1 with proxy_not_found when registry has no matching entry', async () => {
    const captured = makeStreams();
    const exit = await executeStop({ port: 19999 }, baseGlobals, {
      ...streamHooks(captured),
      list: jest.fn(async () => []),
      findStale: jest.fn(async () => []),
    });

    expect(exit).toBe(ExitCode.GeneralError);
    const stderrJoined = captured.stderr.join('');
    expect(stderrJoined).toContain('"error":"proxy_not_found"');
    expect(stderrJoined).toContain('19999');
  });

  it('removes stale entry and exits 0 when pid is already dead', async () => {
    const captured = makeStreams();
    const unregisterMock = jest.fn(async () => undefined);
    const exit = await executeStop({ port: 18001 }, baseGlobals, {
      ...streamHooks(captured),
      list: jest.fn(async () => []), // no alive entries
      findStale: jest.fn(async () => [makeEntry(18001, { pid: 99999 })]),
      unregister: unregisterMock,
    });

    expect(exit).toBe(ExitCode.Success);
    expect(unregisterMock).toHaveBeenCalledWith(18001);
    const stderrJoined = captured.stderr.join('');
    expect(stderrJoined).toContain(
      '[ptah] removed stale registry entry on port 18001',
    );
  });

  it('SIGTERM then SIGKILL fallback when pid does not exit within deadline', async () => {
    jest.useFakeTimers();
    try {
      const captured = makeStreams();
      const targetPid = 4321;
      // Pid stays alive forever — forces SIGKILL.
      const kill = makeKillMock(new Map([[targetPid, true]]));
      const unregisterMock = jest.fn(async () => undefined);

      const promise = executeStop({ port: 18002 }, baseGlobals, {
        ...streamHooks(captured),
        list: jest.fn(async () => [makeEntry(18002, { pid: targetPid })]),
        findStale: jest.fn(async () => []),
        unregister: unregisterMock,
        kill: kill.fn,
        setTimeoutImpl: setTimeout,
        clearTimeoutImpl: clearTimeout,
      });

      // Drive 51 polling ticks (5000ms / 100ms = 50 + initial = 51 attempts).
      // Run pending timers in a loop until the promise settles.
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });
      for (let i = 0; i < 60 && !resolved; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(100);
      }

      const exit = await promise;
      expect(exit).toBe(ExitCode.Success);

      // First call must be SIGTERM, last call must be SIGKILL.
      const calls = kill.fn.mock.calls;
      const sigtermCalls = calls.filter(([, sig]) => sig === 'SIGTERM');
      const sigkillCalls = calls.filter(([, sig]) => sig === 'SIGKILL');
      expect(sigtermCalls).toHaveLength(1);
      expect(sigkillCalls).toHaveLength(1);
      // Polling probes use signal 0.
      const probeCalls = calls.filter(([, sig]) => sig === 0);
      expect(probeCalls.length).toBeGreaterThan(0);

      // Stderr warning must mention SIGKILL.
      const stderrJoined = captured.stderr.join('');
      expect(stderrJoined).toContain('SIGKILL');

      // Registry must be cleaned up.
      expect(unregisterMock).toHaveBeenCalledWith(18002);
    } finally {
      jest.useRealTimers();
    }
  });

  it('exits 0 cleanly when SIGTERM kills the pid within deadline', async () => {
    jest.useFakeTimers();
    try {
      const captured = makeStreams();
      const targetPid = 4322;
      const kill = makeKillMock(new Map([[targetPid, true]]));
      const unregisterMock = jest.fn(async () => undefined);

      const promise = executeStop({ port: 18003 }, baseGlobals, {
        ...streamHooks(captured),
        list: jest.fn(async () => [makeEntry(18003, { pid: targetPid })]),
        findStale: jest.fn(async () => []),
        unregister: unregisterMock,
        kill: kill.fn,
        setTimeoutImpl: setTimeout,
        clearTimeoutImpl: clearTimeout,
      });

      // After SIGTERM is sent, mark pid dead before the first poll completes.
      // Drive the loop by stepping timers; after the SIGTERM call lands,
      // flip the alive flag.
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      // Allow the SIGTERM call + first immediate tick to run.
      await Promise.resolve();
      // Pid dies between SIGTERM and the first poll tick.
      kill.setAlive(targetPid, false);
      jest.advanceTimersByTime(100);

      // Settle the promise.
      for (let i = 0; i < 5 && !resolved; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(100);
      }

      const exit = await promise;
      expect(exit).toBe(ExitCode.Success);

      // SIGKILL must NOT have been called.
      const sigkillCalls = kill.fn.mock.calls.filter(
        ([, sig]) => sig === 'SIGKILL',
      );
      expect(sigkillCalls).toHaveLength(0);

      const stderrJoined = captured.stderr.join('');
      expect(stderrJoined).not.toContain('SIGKILL');
      expect(unregisterMock).toHaveBeenCalledWith(18003);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// executeStatus
// ---------------------------------------------------------------------------

describe('ptah proxy status', () => {
  it('exits 0 with no output on empty registry', async () => {
    const captured = makeStreams();
    const exit = await executeStatus({}, baseGlobals, {
      ...streamHooks(captured),
      list: jest.fn(async () => []),
    });

    expect(exit).toBe(ExitCode.Success);
    expect(captured.stdout).toEqual([]);
  });

  it('emits one NDJSON line per entry in --json mode', async () => {
    const captured = makeStreams();
    const entries = [
      makeEntry(18010, { pid: 1001 }),
      makeEntry(18011, { pid: 1002 }),
    ];
    const exit = await executeStatus({}, baseGlobals, {
      ...streamHooks(captured),
      list: jest.fn(async () => entries),
    });

    expect(exit).toBe(ExitCode.Success);
    expect(captured.stdout).toHaveLength(2);
    for (const chunk of captured.stdout) {
      expect(chunk.endsWith('\n')).toBe(true);
      // Each chunk must contain exactly one JSON object terminated by \n.
      const parsed = JSON.parse(chunk.trim());
      expect(parsed).toEqual(
        expect.objectContaining({
          host: '127.0.0.1',
          alive: true,
          started_at: 1_700_000_000_000,
        }),
      );
    }
    const ports = captured.stdout.map((c) => JSON.parse(c.trim()).port).sort();
    expect(ports).toEqual([18010, 18011]);
  });

  it('emits human table in --human mode', async () => {
    const captured = makeStreams();
    const entries = [makeEntry(18020, { pid: 2001, host: '127.0.0.1' })];
    const humanGlobals: GlobalOptions = { ...baseGlobals, human: true };

    const exit = await executeStatus({}, humanGlobals, {
      ...streamHooks(captured),
      list: jest.fn(async () => entries),
    });

    expect(exit).toBe(ExitCode.Success);
    const stdoutJoined = captured.stdout.join('');
    // Headers
    expect(stdoutJoined).toContain('PORT');
    expect(stdoutJoined).toContain('HOST');
    expect(stdoutJoined).toContain('PID');
    expect(stdoutJoined).toContain('UPTIME');
    // Row content
    expect(stdoutJoined).toContain('18020');
    expect(stdoutJoined).toContain('127.0.0.1');
    expect(stdoutJoined).toContain('2001');
    // No JSON-RPC envelope leakage.
    expect(stdoutJoined).not.toContain('"jsonrpc"');
  });
});
