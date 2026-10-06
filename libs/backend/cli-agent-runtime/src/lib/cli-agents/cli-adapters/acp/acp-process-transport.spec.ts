/**
 * AcpProcessTransport spec — drives REAL `node -e` children so the stdio
 * bridging, stderr line splitting and lifecycle are exercised against the
 * OS, not a fake. Only `killProcessTree` is mocked (tree-kill is a real
 * `taskkill` walk we must not fire in a unit test); the child itself exits
 * through the graceful stdin end.
 *
 * SDK import boundary: no runtime SDK import lives here — this module knows
 * nothing about ACP messages. `jest.requireActual` below is the Jest API,
 * not a bare `require` call.
 */
const mockKillProcessTree = jest.fn();

jest.mock('@ptah-extension/platform-core', () => {
  const actual = jest.requireActual<
    typeof import('@ptah-extension/platform-core')
  >('@ptah-extension/platform-core');
  return {
    ...actual,
    killProcessTree: (...args: unknown[]) => mockKillProcessTree(...args),
  };
});

import { spawn } from 'node:child_process';
import { Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import type {
  IProcessSpawner,
  ProcessErrorListener,
  ProcessExitListener,
  SpawnedProcessHandle,
} from '@ptah-extension/platform-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { spawnAcpProcess } from './acp-process-transport';

/**
 * A spawner over a plain `child_process.spawn` that keeps the `ChildProcess`,
 * so a spec can emit events on the real child the transport listens to.
 */
function createRecordingSpawner(stdin?: Writable): {
  spawner: IProcessSpawner;
  child: () => ChildProcess | undefined;
} {
  let last: ChildProcess | undefined;
  const spawner: IProcessSpawner = {
    spawnProcess: (request) => {
      const real = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      last = real;
      const handle: SpawnedProcessHandle = {
        stdin: stdin ?? real.stdin,
        stdout: real.stdout,
        stderr: real.stderr,
        whenSpawned: Promise.resolve(real.pid ?? null),
        get pid() {
          return real.pid;
        },
        get killed() {
          return real.killed;
        },
        get exitCode() {
          return real.exitCode;
        },
        kill: (signal) => real.kill(signal),
        on: (
          event: 'exit' | 'close' | 'error',
          listener: ProcessExitListener | ProcessErrorListener,
        ) => {
          real.on(event, listener);
        },
        once: (
          event: 'exit' | 'close' | 'error',
          listener: ProcessExitListener | ProcessErrorListener,
        ) => {
          real.once(event, listener);
        },
        off: (
          event: 'exit' | 'close' | 'error',
          listener: ProcessExitListener | ProcessErrorListener,
        ) => {
          real.off(event, listener);
        },
      };
      return handle;
    },
  };
  return { spawner, child: () => last };
}

/** Collects the lines the transport hands to `onStderrLine`, in order. */
function recordStderr(): {
  lines: string[];
  onLine: (line: string) => void;
  waitFor: (line: string) => Promise<void>;
} {
  const lines: string[] = [];
  const waiters: Array<{ line: string; resolve: () => void }> = [];
  const onLine = (line: string): void => {
    lines.push(line);
    for (const waiter of [...waiters]) {
      if (waiter.line === line) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  };
  const waitFor = (line: string): Promise<void> =>
    new Promise((resolve) => {
      // The line may already have been delivered before the caller waits.
      if (lines.includes(line)) {
        resolve();
        return;
      }
      waiters.push({ line, resolve });
    });
  return { lines, onLine, waitFor };
}

/** Drains the readable to a string. Resolves once the transport closes it. */
async function readAll(readable: ReadableStream<Uint8Array>): Promise<string> {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Echo child: writes the stderr fixtures up front (ANSI, empty, oversized,
 * plain), then echoes every stdin line back on stdout and exits 0 once stdin
 * ends. `\\n` inside this template is a two-character escape the CHILD's
 * parser evaluates, so the argv stays short.
 */
const ECHO_SCRIPT = [
  "process.stderr.write('\\x1b[31mred stderr line\\x1b[0m\\n');",
  "process.stderr.write('\\n');",
  "process.stderr.write('x'.repeat(70000) + '\\n');",
  "process.stderr.write('plain line\\n');",
  "process.stdin.setEncoding('utf8');",
  "let tail = '';",
  "process.stdin.on('data', (chunk) => {",
  '  tail += chunk;',
  "  let i = tail.indexOf('\\n');",
  '  while (i >= 0) {',
  '    const line = tail.slice(0, i);',
  '    tail = tail.slice(i + 1);',
  "    if (line.length > 0) process.stdout.write(line + '\\n');",
  "    i = tail.indexOf('\\n');",
  '  }',
  '});',
  "process.stdin.on('end', () => { process.exit(0); });",
].join('\n');

/** Kill-path child: announces itself on stderr, then waits for stdin to end. */
const WAIT_SCRIPT = [
  "process.stderr.write('ready\\n');",
  "process.stdin.on('end', () => { process.exit(0); });",
  'process.stdin.resume();',
].join('\n');

describe('spawnAcpProcess', () => {
  beforeEach(() => {
    mockKillProcessTree.mockClear();
  });

  it('round-trips NDJSON through stdin/stdout and delivers stderr lines', async () => {
    const stderr = recordStderr();
    const transport = spawnAcpProcess({
      command: process.execPath,
      args: ['-e', ECHO_SCRIPT],
      cwd: process.cwd(),
      onStderrLine: stderr.onLine,
    });

    const writer = transport.stream.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode('{"n":1}\n'));
    await writer.write(encoder.encode('{"n":2}\n'));

    // Both writes flushed, so the child is attached and alive.
    expect(transport.getPid()).toBeDefined();

    // Ends stdin -> the child echoes nothing more and exits 0.
    await writer.close();

    const stdout = await readAll(transport.stream.readable);
    expect(stdout).toBe('{"n":1}\n{"n":2}\n');

    const exit = await transport.exited;
    expect(exit).toEqual({ code: 0, signal: null });
    expect(transport.getPid()).toBeUndefined();

    // All four stderr lines were written at child start, so waiting for
    // the last one proves the collected array is complete.
    await stderr.waitFor('plain line');
    expect(stderr.lines).toEqual([
      'red stderr line',
      'x'.repeat(64 * 1024) + ' …[truncated]',
      'plain line',
    ]);
  }, 15000);

  it('kill() ends stdin, tree-kills once, and clears the pid', async () => {
    const stderr = recordStderr();
    const transport = spawnAcpProcess({
      command: process.execPath,
      args: ['-e', WAIT_SCRIPT],
      cwd: process.cwd(),
      onStderrLine: stderr.onLine,
    });

    await stderr.waitFor('ready');
    const pid = transport.getPid();
    expect(pid).toBeDefined();

    transport.kill();
    transport.kill(); // second call must be a no-op

    const exit = await transport.exited;
    expect(exit).toEqual({ code: 0, signal: null });
    expect(mockKillProcessTree).toHaveBeenCalledTimes(1);
    expect(mockKillProcessTree).toHaveBeenCalledWith(pid);
    expect(transport.getPid()).toBeUndefined();
  }, 15000);

  it('merges the spawn env over the inherited environment', async () => {
    process.env['PTAH_ACP_SPEC_INHERITED'] = 'inherited';
    try {
      const transport = spawnAcpProcess({
        command: process.execPath,
        args: [
          '-e',
          'process.stdout.write(JSON.stringify({ lane: process.env.PTAH_ACP_SPEC_LANE, inherited: process.env.PTAH_ACP_SPEC_INHERITED }) + "\\n");',
        ],
        cwd: process.cwd(),
        env: { PTAH_ACP_SPEC_LANE: 'lane-only' },
      });

      const stdout = await readAll(transport.stream.readable);
      expect(JSON.parse(stdout)).toEqual({
        lane: 'lane-only',
        inherited: 'inherited',
      });
      await expect(transport.exited).resolves.toEqual({
        code: 0,
        signal: null,
      });
    } finally {
      delete process.env['PTAH_ACP_SPEC_INHERITED'];
    }
  }, 15000);

  it('an error on a running child keeps its pid, so kill() still tree-kills it', async () => {
    const stderr = recordStderr();
    const logger = createMockLogger();
    const recording = createRecordingSpawner();
    const transport = spawnAcpProcess({
      command: process.execPath,
      args: ['-e', WAIT_SCRIPT],
      cwd: process.cwd(),
      spawner: recording.spawner,
      onStderrLine: stderr.onLine,
      logger: logger as unknown as Logger,
    });

    await stderr.waitFor('ready');
    const pid = transport.getPid();
    expect(pid).toBeDefined();

    // What Node emits when, for example, a signal cannot be delivered.
    recording.child()?.emit('error', new Error('kill EPERM'));

    expect(transport.getPid()).toBe(pid);
    const pending = Symbol('pending');
    await expect(
      Promise.race([transport.exited, Promise.resolve(pending)]),
    ).resolves.toBe(pending);
    expect(logger.warn).toHaveBeenCalledWith(
      '[AcpProcessTransport] error on a running agent process',
      { pid, error: 'kill EPERM' },
    );

    transport.kill();
    await expect(transport.exited).resolves.toEqual({ code: 0, signal: null });
    expect(mockKillProcessTree).toHaveBeenCalledWith(pid);
  }, 15000);

  it('closes the readable shortly after exit when a descendant keeps stdout open', async () => {
    // The child hands its stdout pipe to a long-lived grandchild, prints the
    // grandchild pid and exits: 'exit' fires, 'close' does not. `detached`
    // keeps the grandchild out of the child's Windows job object, which would
    // otherwise kill it together with the child.
    const script = [
      "const { spawn } = require('child_process');",
      "const gc = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: ['ignore', 'inherit', 'ignore'], detached: true });",
      "process.stdout.write('gc ' + gc.pid + '\\n', () => process.exit(0));",
    ].join('\n');
    const transport = spawnAcpProcess({
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
    });

    // Without the exit grace this read hangs until the grandchild ends (20 s,
    // past the spec timeout), so the grandchild also cleans itself up.
    const stdout = await readAll(transport.stream.readable);
    const grandchildPid = Number(/^gc (\d+)$/m.exec(stdout)?.[1]);
    expect(grandchildPid).toBeGreaterThan(0);
    // Still alive and holding the pipe: proves 'close' could not have fired.
    expect(process.kill(grandchildPid)).toBe(true);
    await expect(transport.exited).resolves.toEqual({
      code: 0,
      signal: null,
    });
  }, 10000);

  it('a failed spawn settles exited with signal "error", closes the readable, and drops late writes', async () => {
    const stderr = recordStderr();
    const transport = spawnAcpProcess({
      command: 'ptah-no-such-binary-617',
      args: [],
      cwd: process.cwd(),
      onStderrLine: stderr.onLine,
    });

    const exit = await transport.exited;
    expect(exit).toEqual({ code: null, signal: 'error' });
    expect(transport.getPid()).toBeUndefined();

    const first = await transport.stream.readable.getReader().read();
    expect(first.done).toBe(true);

    // A write made after the failure is dropped, not thrown into the SDK.
    const writer = transport.stream.writable.getWriter();
    await expect(
      writer.write(new TextEncoder().encode('{"late":true}\n')),
    ).resolves.toBeUndefined();
  }, 15000);

  describe('stdin backpressure', () => {
    /** A stdin whose buffer is full after one chunk until `release()` is called. */
    function createFullStdin(): { stdin: Writable; release: () => void } {
      let pending: (() => void) | undefined;
      const stdin = new Writable({
        highWaterMark: 1,
        write(_chunk, _encoding, callback) {
          pending = () => callback();
        },
      });
      return { stdin, release: () => pending?.() };
    }

    async function startWithFullStdin(full: { stdin: Writable }) {
      const stderr = recordStderr();
      const recording = createRecordingSpawner(full.stdin);
      const transport = spawnAcpProcess({
        command: process.execPath,
        args: ['-e', WAIT_SCRIPT],
        cwd: process.cwd(),
        spawner: recording.spawner,
        onStderrLine: stderr.onLine,
      });
      await stderr.waitFor('ready');
      const writer = transport.stream.writable.getWriter();
      let settled = false;
      const write = writer
        .write(new TextEncoder().encode('{"n":1}\n'))
        .then(() => {
          settled = true;
        });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const finish = async (): Promise<void> => {
        // The real child waits for its own stdin to end.
        recording.child()?.stdin?.end();
        await transport.exited;
      };
      return { write, isSettled: () => settled, finish };
    }

    it('holds a write until the full stdin drains', async () => {
      const full = createFullStdin();
      const run = await startWithFullStdin(full);

      expect(run.isSettled()).toBe(false);
      full.release();
      await run.write;
      expect(run.isSettled()).toBe(true);
      expect(full.stdin.listenerCount('drain')).toBe(0);
      expect(full.stdin.listenerCount('close')).toBe(0);

      await run.finish();
    }, 15000);

    it('drops a held write when the full stdin closes instead of draining', async () => {
      const full = createFullStdin();
      const run = await startWithFullStdin(full);

      expect(run.isSettled()).toBe(false);
      full.stdin.destroy();
      await run.write;
      expect(run.isSettled()).toBe(true);
      expect(full.stdin.listenerCount('drain')).toBe(0);

      await run.finish();
    }, 15000);
  });
});
