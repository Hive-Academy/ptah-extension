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

import { spawnAcpProcess } from './acp-process-transport';

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
});
