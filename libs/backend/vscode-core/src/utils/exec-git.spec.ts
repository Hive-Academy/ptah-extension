/**
 * execGit / execGitBuffer — unit specs (TASK_2026_173, N2).
 *
 * Coverage matrix:
 *   execGit       — a multi-byte UTF-8 sequence split across a 64 KiB chunk
 *                   boundary survives decoding (the N2 corruption bug)
 *   execGit       — closes stdin immediately when no `stdin` option is given,
 *                   so no git subcommand can block on an open pipe
 *   execGit       — writes and closes `options.stdin` when supplied
 *   execGit       — merges the deterministic git env (LC_ALL/LANG/
 *                   GIT_OPTIONAL_LOCKS) and honours a caller `env` override
 *   execGitBuffer — returns raw stdout bytes, NUL bytes intact
 *   both          — non-zero exit codes and stderr are surfaced, not thrown
 *
 * TASK_2026_437 additions (C11 git process supervision):
 *   GitProcessGate — caps live slots, FIFO per workspace, round-robin across
 *                    workspaces, one saturation warning per minute
 *   execGit       — 10 concurrent calls never run more than 4 children
 *   execGit       — a timeout rejects but keeps the slot until the child
 *                   closes, or 2 s after the forced kill
 *   execGit       — the output cap kills the child and rejects typed
 *   execGit       — a spawn error with no pid frees the slot at once
 *   execGit       — `priority: 'background'` lowers the child's OS priority;
 *                   a refused `setPriority` does not fail the call
 *
 * `crossSpawn` is mocked at the module boundary so no git binary is required.
 *
 * Source-under-test:
 *   libs/backend/vscode-core/src/utils/exec-git.ts
 */

import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Mock cross-spawn so we control the child process entirely.
// ---------------------------------------------------------------------------
const mockSpawn = jest.fn();
jest.mock('cross-spawn', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockSpawn(...args),
}));

// `which` is mocked too: exec-git resolves the git binary through it, and the
// suite must not depend on a git installation being present or on where it is.
const mockWhichSync = jest.fn();
jest.mock('which', () => ({
  __esModule: true,
  default: { sync: (...args: unknown[]) => mockWhichSync(...args) },
}));

// Tree termination is shared by platform-core. Mock that public boundary so a
// timeout or output-cap spec can never aim a real kill at a fake pid.
const mockTreeKill = jest.fn().mockResolvedValue(undefined);
jest.mock('@ptah-extension/platform-core', () => {
  const actual = jest.requireActual<
    typeof import('@ptah-extension/platform-core')
  >('@ptah-extension/platform-core');
  return {
    ...actual,
    killProcessTree: (...args: unknown[]) => mockTreeKill(...args),
  };
});

// `os.setPriority` is mocked so background-priority specs never touch a real
// process and can observe the call.
const mockSetPriority = jest.fn();
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  setPriority: (...args: unknown[]) => mockSetPriority(...args),
}));

import * as os from 'os';
import {
  configureGitProcessGate,
  execGit,
  execGitBuffer,
  GitOutputLimitError,
  GitProcessGate,
  resetGitProcessGateForTests,
  resetResolvedGitBinaryForTests,
} from './exec-git';

// ---------------------------------------------------------------------------
// Fake child process. Emits the supplied stdout/stderr chunks then closes.
// ---------------------------------------------------------------------------
interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: {
    end: jest.Mock;
    write: jest.Mock;
    on: jest.Mock;
  };
  kill: jest.Mock;
  pid: number;
  killed: boolean;
  /** Everything the implementation pushed into stdin. */
  writtenToStdin(): Buffer;
  /** Whether the implementation closed the stdin pipe. */
  stdinClosed(): boolean;
}

function makeFakeChild(opts: {
  stdout?: Buffer[];
  stderr?: Buffer[];
  exitCode?: number;
}): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const written: Buffer[] = [];
  let closed = false;

  child.stdin = {
    write: jest.fn((chunk: string | Buffer) => {
      written.push(Buffer.from(chunk as never));
      return true;
    }),
    end: jest.fn((chunk?: string | Buffer) => {
      if (chunk !== undefined) written.push(Buffer.from(chunk as never));
      closed = true;
    }),
    on: jest.fn(),
  };
  child.kill = jest.fn();
  child.pid = 4242;
  child.killed = false;
  child.writtenToStdin = () => Buffer.concat(written);
  child.stdinClosed = () => closed;

  setTimeout(() => {
    for (const chunk of opts.stdout ?? []) child.stdout.emit('data', chunk);
    for (const chunk of opts.stderr ?? []) child.stderr.emit('data', chunk);
    child.emit('close', opts.exitCode ?? 0);
  }, 0);

  return child;
}

const WS = '/fake/workspace';

/** What the mocked `which` resolves `git` to unless a test says otherwise. */
const GIT_ABS = '/usr/bin/git';

beforeEach(() => {
  resetResolvedGitBinaryForTests();
  // A fresh process gate per spec: a child a previous spec left holding a slot
  // must not change how many this spec may start.
  resetGitProcessGateForTests();
  // Full reset (not clear): several specs install a throwing or null-returning
  // implementation, and it must not leak into the next spec's default.
  mockWhichSync.mockReset();
  mockWhichSync.mockReturnValue(GIT_ABS);
});

describe('execGit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // N2 — chunk-boundary UTF-8 corruption (Risk A-2)
  // =========================================================================
  describe('multi-byte UTF-8 across a chunk boundary', () => {
    it('decodes a 4-byte sequence straddling the 64 KiB boundary without corruption', async () => {
      const CHUNK = 64 * 1024;
      // 65534 ASCII bytes of padding puts the 4-byte emoji at byte offsets
      // 65534..65537 — so a 64 KiB read splits it 2 bytes / 2 bytes.
      const payload = `${'a'.repeat(CHUNK - 2)}\u{1F600}tail\n`;
      const bytes = Buffer.from(payload, 'utf8');
      const first = bytes.subarray(0, CHUNK);
      const second = bytes.subarray(CHUNK);

      expect(first.byteLength).toBe(CHUNK);
      expect(second.byteLength).toBeGreaterThan(0);

      mockSpawn.mockImplementation(() =>
        makeFakeChild({ stdout: [first, second], exitCode: 0 }),
      );

      const result = await execGit(['show', 'HEAD:big.ts'], WS);

      expect(result.stdout).not.toContain('�');
      expect(result.stdout).toBe(payload);
    });

    it('decodes a 2-byte sequence split across two small chunks', async () => {
      const payload = 'café\n';
      const bytes = Buffer.from(payload, 'utf8');
      // 'é' occupies bytes 3..4; split between them.
      const first = bytes.subarray(0, 4);
      const second = bytes.subarray(4);

      mockSpawn.mockImplementation(() =>
        makeFakeChild({ stdout: [first, second], exitCode: 0 }),
      );

      const result = await execGit(['show', 'HEAD:cafe.ts'], WS);

      expect(result.stdout).toBe(payload);
    });
  });

  // =========================================================================
  // stdin lifecycle
  // =========================================================================
  describe('stdin', () => {
    it('closes stdin immediately when no stdin option is supplied', async () => {
      let child: FakeChild | undefined;
      mockSpawn.mockImplementation(() => {
        child = makeFakeChild({ stdout: [Buffer.from('ok\n')], exitCode: 0 });
        return child;
      });

      await execGit(['status', '--porcelain=v2'], WS);

      expect(child?.stdinClosed()).toBe(true);
      expect(child?.writtenToStdin().byteLength).toBe(0);
    });

    it('writes the stdin payload and closes the pipe', async () => {
      let child: FakeChild | undefined;
      mockSpawn.mockImplementation(() => {
        child = makeFakeChild({ exitCode: 0 });
        return child;
      });

      const patch = 'diff --git a/x b/x\n';
      await execGit(['apply', '--cached', '-'], WS, { stdin: patch });

      expect(child?.stdinClosed()).toBe(true);
      expect(child?.writtenToStdin().toString('utf8')).toBe(patch);
    });

    it('writes a Buffer stdin payload byte-for-byte', async () => {
      let child: FakeChild | undefined;
      mockSpawn.mockImplementation(() => {
        child = makeFakeChild({ exitCode: 0 });
        return child;
      });

      const payload = Buffer.from([0x00, 0xff, 0x41, 0x00]);
      await execGit(['hash-object', '-w', '--stdin'], WS, { stdin: payload });

      expect(child?.writtenToStdin()).toEqual(payload);
    });
  });

  // =========================================================================
  // Deterministic environment
  // =========================================================================
  describe('environment', () => {
    it('forces LC_ALL, LANG and GIT_OPTIONAL_LOCKS on every invocation', async () => {
      mockSpawn.mockImplementation(() => makeFakeChild({ exitCode: 0 }));

      await execGit(['status'], WS);

      const spawnOptions = mockSpawn.mock.calls[0][2] as {
        env: NodeJS.ProcessEnv;
        cwd: string;
      };
      expect(spawnOptions.cwd).toBe(WS);
      expect(spawnOptions.env['LC_ALL']).toBe('C');
      expect(spawnOptions.env['LANG']).toBe('C');
      expect(spawnOptions.env['GIT_OPTIONAL_LOCKS']).toBe('0');
    });

    it('lets a caller env entry win over the deterministic defaults', async () => {
      mockSpawn.mockImplementation(() => makeFakeChild({ exitCode: 0 }));

      await execGit(['status'], WS, { env: { GIT_OPTIONAL_LOCKS: '1' } });

      const spawnOptions = mockSpawn.mock.calls[0][2] as {
        env: NodeJS.ProcessEnv;
      };
      expect(spawnOptions.env['GIT_OPTIONAL_LOCKS']).toBe('1');
      expect(spawnOptions.env['LC_ALL']).toBe('C');
    });
  });

  // =========================================================================
  // Result surface
  // =========================================================================
  describe('result', () => {
    it('surfaces a non-zero exit code and stderr instead of rejecting', async () => {
      mockSpawn.mockImplementation(() =>
        makeFakeChild({
          stderr: [Buffer.from('fatal: bad object\n')],
          exitCode: 128,
        }),
      );

      const result = await execGit(['show', 'HEAD:missing.ts'], WS);

      expect(result.exitCode).toBe(128);
      expect(result.stderr).toBe('fatal: bad object\n');
      expect(result.stdout).toBe('');
    });

    it('rejects when the child emits an error', async () => {
      mockSpawn.mockImplementation(() => {
        const child = new EventEmitter() as FakeChild;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdin = { end: jest.fn(), write: jest.fn(), on: jest.fn() };
        child.kill = jest.fn();
        setTimeout(() => child.emit('error', new Error('spawn ENOENT')), 0);
        return child;
      });

      await expect(execGit(['status'], WS)).rejects.toThrow('spawn ENOENT');
    });
  });
});

describe('execGitBuffer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns raw stdout bytes with NUL bytes intact', async () => {
    const blob = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a, 0x0a]);
    mockSpawn.mockImplementation(() =>
      makeFakeChild({ stdout: [blob.subarray(0, 3), blob.subarray(3)] }),
    );

    const result = await execGitBuffer(['show', 'HEAD:logo.png'], WS);

    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect(Buffer.compare(result.stdout, blob)).toBe(0);
    expect(result.stdout.includes(0)).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('reports byte length rather than character length for multi-byte content', async () => {
    const text = Buffer.from('ééé', 'utf8'); // 6 bytes, 3 chars
    mockSpawn.mockImplementation(() => makeFakeChild({ stdout: [text] }));

    const result = await execGitBuffer(['show', 'HEAD:x.ts'], WS);

    expect(result.stdout.byteLength).toBe(6);
  });
});

// ===========================================================================
// Git binary resolution — follow-up to TASK_2026_230.
//
// Passing the bare name `git` makes cross-spawn re-run `which.sync` on every
// spawn, synchronously, on the Electron main thread. Resolving once and
// spawning the absolute path cut the mean synchronous cost of a spawn from
// ~80-108 ms to ~42-81 ms in an interleaved A/B on Windows. These specs pin
// the resolution to once per process; without them the memo can be dropped
// (or the bare name reinstated) with no test noticing.
// ===========================================================================
describe('git binary resolution', () => {
  beforeEach(() => {
    // Call counts, not just implementations: these specs assert on
    // `mock.calls[0]`, which would otherwise be a previous spec's spawn.
    jest.clearAllMocks();
    mockSpawn.mockImplementation(() => makeFakeChild({}));
  });

  it('resolves the git binary once and reuses it across calls', async () => {
    await execGit(['status'], WS);
    await execGit(['rev-parse', '--is-inside-work-tree'], WS);
    await execGitBuffer(['show', 'HEAD:a.ts'], WS);

    expect(mockSpawn).toHaveBeenCalledTimes(3);
    expect(mockWhichSync).toHaveBeenCalledTimes(1);
  });

  it('spawns the resolved absolute path rather than the bare name', async () => {
    await execGit(['status'], WS);

    expect(mockSpawn.mock.calls[0][0]).toBe(GIT_ABS);
  });

  it('falls back to the bare name when git is not on PATH', async () => {
    mockWhichSync.mockReturnValue(null);

    await execGit(['status'], WS);

    expect(mockSpawn.mock.calls[0][0]).toBe('git');
  });

  it('does not retry resolution after a failed lookup', async () => {
    mockWhichSync.mockReturnValue(null);

    await execGit(['status'], WS);
    await execGit(['status'], WS);

    expect(mockWhichSync).toHaveBeenCalledTimes(1);
  });

  it('falls back to the bare name when PATH cannot be read at all', async () => {
    mockWhichSync.mockImplementation(() => {
      throw new Error('EACCES');
    });

    await execGit(['status'], WS);

    expect(mockSpawn.mock.calls[0][0]).toBe('git');
  });
});

// ===========================================================================
// IProcessSpawner routing — TASK_2026_383 Batch 11.3.
//
// `child_process.spawn` runs `CreateProcessW` on the CALLING thread, so an
// inline git spawn freezes the Electron main process for its whole duration.
// When a host supplies `options.spawner`, git must go through the port and the
// inline `crossSpawn` must not be called at all; when it does not, the inline
// path has to survive exactly as it was.
// ===========================================================================
describe('spawner routing', () => {
  interface FakeHandle {
    stdin: FakeChild['stdin'];
    stdout: EventEmitter;
    stderr: EventEmitter;
    whenSpawned: Promise<number | null>;
    pid: number | undefined;
    killed: boolean;
    kill: jest.Mock;
    on: jest.Mock;
  }

  /** A `SpawnedProcessHandle` that emits the given output then closes. */
  function makeFakeHandle(opts: {
    stdout?: Buffer[];
    stderr?: Buffer[];
    exitCode?: number;
    /** Emit `error` instead of `close`. */
    error?: Error;
  }): FakeHandle {
    const emitter = new EventEmitter();
    const handle: FakeHandle = {
      stdin: {
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
      },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      whenSpawned: Promise.resolve(9191),
      pid: undefined,
      killed: false,
      kill: jest.fn(),
      on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
        emitter.on(event, listener);
      }),
    };

    setTimeout(() => {
      for (const chunk of opts.stdout ?? []) handle.stdout.emit('data', chunk);
      for (const chunk of opts.stderr ?? []) handle.stderr.emit('data', chunk);
      if (opts.error) emitter.emit('error', opts.error);
      else emitter.emit('close', opts.exitCode ?? 0);
    }, 0);

    return handle;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockImplementation(() => makeFakeChild({}));
  });

  it('spawns through the port and never touches cross-spawn', async () => {
    const spawnProcess = jest.fn(() =>
      makeFakeHandle({ stdout: [Buffer.from('## main\n')], exitCode: 0 }),
    );

    const result = await execGit(['status', '--porcelain=v2'], WS, {
      spawner: { spawnProcess } as never,
    });

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(spawnProcess).toHaveBeenCalledTimes(1);
    expect(result.stdout).toBe('## main\n');
    expect(result.exitCode).toBe(0);
  });

  it('hands the port the resolved binary, argv, cwd and the deterministic env', async () => {
    interface SpawnRequest {
      command: string;
      args: readonly string[];
      cwd?: string;
      env: Record<string, string | undefined>;
    }
    const seen: SpawnRequest[] = [];
    const spawnProcess = jest.fn((request: SpawnRequest) => {
      seen.push(request);
      return makeFakeHandle({ exitCode: 0 });
    });

    await execGit(['status'], WS, {
      spawner: { spawnProcess } as never,
      env: { LC_ALL: 'de_DE.UTF-8' },
    });

    const request = seen[0];
    expect(request.command).toBe(GIT_ABS);
    expect(request.args).toEqual(['status']);
    expect(request.cwd).toBe(WS);
    expect(request.env['GIT_OPTIONAL_LOCKS']).toBe('0');
    // A caller override still wins over the deterministic default.
    expect(request.env['LC_ALL']).toBe('de_DE.UTF-8');
  });

  it('surfaces a non-zero exit code and stderr from the port path', async () => {
    const spawnProcess = jest.fn(() =>
      makeFakeHandle({
        stderr: [Buffer.from('fatal: not a repo\n')],
        exitCode: 128,
      }),
    );

    const result = await execGit(['status'], WS, {
      spawner: { spawnProcess } as never,
    });

    expect(result.exitCode).toBe(128);
    expect(result.stderr).toBe('fatal: not a repo\n');
  });

  it('rejects when the port reports a spawn error', async () => {
    const spawnProcess = jest.fn(() =>
      makeFakeHandle({ error: new Error('ENOENT') }),
    );

    await expect(
      execGit(['status'], WS, { spawner: { spawnProcess } as never }),
    ).rejects.toThrow('ENOENT');
  });

  it('writes and closes stdin on the port path', async () => {
    let handle: FakeHandle | undefined;
    const spawnProcess = jest.fn(() => {
      handle = makeFakeHandle({ exitCode: 0 });
      return handle;
    });

    await execGit(['apply', '-'], WS, {
      spawner: { spawnProcess } as never,
      stdin: 'diff --git a/x b/x\n',
    });

    expect(handle?.stdin.end).toHaveBeenCalledWith('diff --git a/x b/x\n');
  });

  it('keeps the inline cross-spawn path when no spawner is supplied', async () => {
    await execGit(['status'], WS);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Git process supervision — TASK_2026_437 C11 (INV-3, INV-4, AC-3 P2).
//
// The gate is process-wide, so these specs pin what every caller gets: at most
// `PTAH_GIT_MAX_CONCURRENT` (default 4) live children, a slot held by the
// CHILD until it exits (a timeout never frees it early), an output cap that
// kills, and a best-effort background priority.
// ===========================================================================
describe('GitProcessGate', () => {
  it('admits up to the cap and queues the rest without rejecting', async () => {
    const gate = new GitProcessGate(4);
    const releases: Array<() => void> = [];
    const pending = Array.from({ length: 10 }, () =>
      gate.acquire('/ws').then((release) => {
        releases.push(release);
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(gate.liveCount).toBe(4);
    expect(gate.queuedCount).toBe(6);

    for (let i = 0; i < 10; i++) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      expect(gate.liveCount).toBeLessThanOrEqual(4);
    }
    await Promise.all(pending);
    expect(gate.liveCount).toBe(0);
    expect(gate.queuedCount).toBe(0);
  });

  it('ignores a second release of the same slot', async () => {
    const gate = new GitProcessGate(2);
    const release = await gate.acquire('/ws', 'background');
    const second = gate.acquire('/ws', 'background');
    release();
    release();
    await second;
    expect(gate.liveCount).toBe(1);
  });

  it('serves FIFO within a workspace and round-robin across workspaces', async () => {
    const gate = new GitProcessGate(2);
    const holder = await gate.acquire('/a', 'background');
    const order: string[] = [];
    const take = (workspace: string, label: string) =>
      gate.acquire(workspace, 'background').then((release) => {
        order.push(label);
        return release;
      });

    const a1 = take('/a', 'a1');
    const a2 = take('/a', 'a2');
    const a3 = take('/a', 'a3');
    const b1 = take('/b', 'b1');

    holder();
    (await a1)();
    (await b1)();
    (await a2)();
    (await a3)();

    expect(order).toEqual(['a1', 'b1', 'a2', 'a3']);
  });

  it('warns about saturation at most once per minute', async () => {
    let now = 0;
    const warn = jest.fn();
    const gate = new GitProcessGate(2, warn, () => now);

    let release = await gate.acquire('/ws', 'background');
    const waiters = [
      gate.acquire('/ws', 'background'),
      gate.acquire('/ws', 'background'),
      gate.acquire('/ws', 'background'),
    ];

    now = 6_000; // the first waiter waited 6 s
    release();
    release = await waiters[0];
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('[GitProcessGate] saturated');

    now = 7_000; // the second waited 7 s, inside the same minute
    release();
    release = await waiters[1];
    expect(warn).toHaveBeenCalledTimes(1);

    now = 67_000; // a minute after the first warning
    release();
    await waiters[2];
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('does not warn when the wait stays under 5 s', async () => {
    let now = 0;
    const warn = jest.fn();
    const gate = new GitProcessGate(2, warn, () => now);
    const release = await gate.acquire('/ws', 'background');
    const waiter = gate.acquire('/ws', 'background');
    now = 4_000;
    release();
    await waiter;
    expect(warn).not.toHaveBeenCalled();
  });

  it('routes the saturation warning to a configured logger', async () => {
    let now = 0;
    const gate = new GitProcessGate(2, undefined, () => now);
    const logger = { warn: jest.fn() };
    gate.configure({ logger: logger as never });

    const release = await gate.acquire('/ws', 'background');
    const waiter = gate.acquire('/ws', 'background');
    now = 6_000;
    release();
    await waiter;

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('[GitProcessGate] saturated'),
    );
  });

  it('keeps one slot free of background work for interactive calls', async () => {
    const gate = new GitProcessGate(4);
    const background = [
      await gate.acquire('/ws', 'background'),
      await gate.acquire('/ws', 'background'),
      await gate.acquire('/ws', 'background'),
    ];
    let fourthBackground = false;
    void gate.acquire('/ws', 'background').then(() => {
      fourthBackground = true;
    });
    await Promise.resolve();
    expect(fourthBackground).toBe(false);
    expect(gate.liveCount).toBe(3);

    // The interactive call is admitted at once, ahead of the older
    // background waiter, because the background lane is at its cap.
    const interactive = await gate.acquire('/ws', 'interactive');
    expect(gate.liveCount).toBe(4);

    interactive();
    background[0]();
    await Promise.resolve();
    expect(fourthBackground).toBe(true);
  });

  it('raises a cap of 1 to 2, so a hung background call never blocks an interactive one', async () => {
    const warn = jest.fn();
    const gate = new GitProcessGate(1, warn);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('below the minimum; using 2'),
    );

    await gate.acquire('/ws', 'background');
    let secondBackground = false;
    void gate.acquire('/ws', 'background').then(() => {
      secondBackground = true;
    });
    await Promise.resolve();
    expect(secondBackground).toBe(false);

    await gate.acquire('/ws', 'interactive');
    expect(gate.liveCount).toBe(2);
  });

  it('holds a clamp notice until a logger is configured', () => {
    const gate = new GitProcessGate(1);
    const logger = { warn: jest.fn() };
    gate.configure({ logger: logger as never });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('below the minimum');
  });

  it('keeps the first configuration and reports a conflicting one once', async () => {
    const gate = new GitProcessGate(4);
    const first = { warn: jest.fn() };
    const second = { warn: jest.fn() };

    gate.configure({ logger: first as never, maxConcurrent: 3 });
    gate.configure({ logger: first as never, maxConcurrent: 3 });
    expect(first.warn).not.toHaveBeenCalled();

    gate.configure({ logger: second as never, maxConcurrent: 8 });
    gate.configure({ logger: second as never });
    expect(first.warn).toHaveBeenCalledTimes(1);
    expect(first.warn.mock.calls[0][0]).toContain('keeping the first');
    expect(second.warn).not.toHaveBeenCalled();

    // Still 3 slots, not 8.
    for (let i = 0; i < 4; i++) void gate.acquire('/ws');
    await Promise.resolve();
    expect(gate.liveCount).toBe(3);
  });

  it('picks the longer-waiting head when both lanes are admissible', async () => {
    let now = 0;
    const gate = new GitProcessGate(2, undefined, () => now);
    const holderA = await gate.acquire('/ws');
    const holderB = await gate.acquire('/ws');
    const order: string[] = [];
    now = 1;
    void gate.acquire('/ws', 'background').then(() => order.push('bg'));
    now = 2;
    void gate.acquire('/ws', 'interactive').then(() => order.push('int'));

    holderA();
    await Promise.resolve();
    expect(order).toEqual(['bg']);
    holderB();
    await Promise.resolve();
    expect(order).toEqual(['bg', 'int']);
  });
});

describe('git process supervision', () => {
  /** A fake inline child that stays alive until the spec closes it. */
  interface HeldChild extends EventEmitter {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: jest.Mock; write: jest.Mock; on: jest.Mock };
    kill: jest.Mock;
    pid: number | undefined;
    killed: boolean;
  }

  const held: HeldChild[] = [];
  let live = 0;
  let maxLive = 0;

  function makeHeldChild(pid: number | null = 4242): HeldChild {
    const child = new EventEmitter() as HeldChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: jest.fn(), write: jest.fn(), on: jest.fn() };
    child.kill = jest.fn();
    child.pid = pid ?? undefined;
    child.killed = false;
    live++;
    maxLive = Math.max(maxLive, live);
    child.once('close', () => {
      live--;
    });
    held.push(child);
    return child;
  }

  async function drain(): Promise<void> {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  /**
   * Background lane. With `PTAH_GIT_MAX_CONCURRENT=2` (the minimum) it has
   * exactly one slot, which is what the single-slot specs below need.
   */
  const BG = { priority: 'background' } as const;

  beforeEach(() => {
    jest.clearAllMocks();
    held.length = 0;
    live = 0;
    maxLive = 0;
    mockSpawn.mockImplementation(() => makeHeldChild());
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env['PTAH_GIT_MAX_CONCURRENT'];
    resetGitProcessGateForTests();
  });

  it('never runs more than 4 git children for 10 concurrent calls', async () => {
    const calls = Array.from({ length: 10 }, (_, i) =>
      execGit(['show', `HEAD:f${i}.ts`], i % 2 === 0 ? WS : '/fake/other'),
    );
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(4);

    for (let i = 0; i < 10; i++) {
      held[i].emit('close', 0);
      await drain();
      expect(live).toBeLessThanOrEqual(4);
    }

    const results = await Promise.all(calls);
    expect(results).toHaveLength(10);
    expect(mockSpawn).toHaveBeenCalledTimes(10);
    expect(maxLive).toBe(4);
  });

  it('honours PTAH_GIT_MAX_CONCURRENT', async () => {
    process.env['PTAH_GIT_MAX_CONCURRENT'] = '2';
    resetGitProcessGateForTests();

    const calls = Array.from({ length: 5 }, () => execGit(['status'], WS));
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    for (let i = 0; i < 5; i++) {
      held[i].emit('close', 0);
      await drain();
    }
    await Promise.all(calls);
    expect(maxLive).toBe(2);
  });

  it('a timeout rejects at once but keeps the slot until the child closes', async () => {
    process.env['PTAH_GIT_MAX_CONCURRENT'] = '2';
    resetGitProcessGateForTests();

    const first = execGit(['status'], WS, { ...BG, timeoutMs: 20 });
    await expect(first).rejects.toThrow('git status timed out after 20ms');
    expect(held[0].kill).toHaveBeenCalledWith('SIGTERM');
    await drain();
    if (process.platform === 'win32') {
      expect(mockTreeKill).toHaveBeenCalledWith(4242);
    }

    const second = execGit(['rev-parse', 'HEAD'], WS, BG);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // The dying child still owns the only slot.
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    held[0].emit('close', null);
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    held[1].emit('close', 0);
    await expect(second).resolves.toMatchObject({ exitCode: 0 });
  });

  it('starts the timeout clock at spawn, not while queued', async () => {
    jest.useFakeTimers({
      doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
    });
    process.env['PTAH_GIT_MAX_CONCURRENT'] = '2';
    resetGitProcessGateForTests();

    const first = execGit(['status'], WS, { ...BG, timeoutMs: 60_000 });
    const queued = execGit(['log'], WS, { ...BG, timeoutMs: 1_000 });
    await drain();

    // Far past the queued call's own timeout while it is still waiting.
    await jest.advanceTimersByTimeAsync(5_000);
    held[0].emit('close', 0);
    await first;
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    held[1].emit('close', 0);
    await expect(queued).resolves.toMatchObject({ exitCode: 0 });
  });

  it('frees the slot 2 s after the forced kill when the child never closes', async () => {
    jest.useFakeTimers({
      doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'],
    });
    process.env['PTAH_GIT_MAX_CONCURRENT'] = '2';
    resetGitProcessGateForTests();

    const first = execGit(['status'], WS, { ...BG, timeoutMs: 1_000 });
    const firstRejected = expect(first).rejects.toThrow('timed out');
    await drain();
    await jest.advanceTimersByTimeAsync(1_000);
    await firstRejected;

    const second = execGit(['log'], WS, BG);
    await jest.advanceTimersByTimeAsync(1_999);
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await drain();
    // `killed` stayed false, so the grace escalated before giving the slot up.
    expect(held[0].kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    held[1].emit('close', 0);
    await expect(second).resolves.toMatchObject({ exitCode: 0 });
  });

  it('kills a child whose output passes the cap and rejects with GitOutputLimitError', async () => {
    process.env['PTAH_GIT_MAX_CONCURRENT'] = '2';
    resetGitProcessGateForTests();

    const call = execGitBuffer(['show', 'HEAD:huge.bin'], WS, {
      ...BG,
      maxOutputBytes: 10,
    });
    await drain();
    held[0].stdout.emit('data', Buffer.alloc(6));
    held[0].stderr.emit('data', Buffer.alloc(6));

    const error = await call.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(GitOutputLimitError);
    expect((error as GitOutputLimitError).code).toBe('GIT_OUTPUT_LIMIT');
    expect((error as GitOutputLimitError).limitBytes).toBe(10);
    expect(held[0].kill).toHaveBeenCalledWith('SIGTERM');

    // The killed child keeps its slot until it exits.
    const next = execGit(['status'], WS, BG);
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    held[0].emit('close', null);
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    held[1].emit('close', 0);
    await next;
  });

  it('resolves normally when output stays within the cap', async () => {
    const call = execGit(['status'], WS, { ...BG, maxOutputBytes: 10 });
    await drain();
    held[0].stdout.emit('data', Buffer.from('0123456789'));
    held[0].emit('close', 0);
    await expect(call).resolves.toMatchObject({ stdout: '0123456789' });
  });

  it('frees the slot at once when the child never started', async () => {
    process.env['PTAH_GIT_MAX_CONCURRENT'] = '2';
    resetGitProcessGateForTests();
    mockSpawn.mockImplementationOnce(() => makeHeldChild(null));

    const failed = execGit(['status'], WS, BG);
    await drain();
    held[0].emit('error', new Error('spawn ENOENT'));
    await expect(failed).rejects.toThrow('spawn ENOENT');

    const next = execGit(['status'], WS, BG);
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    held[1].emit('close', 0);
    await next;
  });

  it('frees the slot when spawning throws synchronously', async () => {
    process.env['PTAH_GIT_MAX_CONCURRENT'] = '2';
    resetGitProcessGateForTests();
    mockSpawn.mockImplementationOnce(() => {
      throw new Error('EINVAL');
    });

    await expect(execGit(['status'], WS, BG)).rejects.toThrow('EINVAL');

    const next = execGit(['status'], WS, BG);
    await drain();
    expect(held).toHaveLength(1);
    held[0].emit('close', 0);
    await next;
  });

  it('kills a started child that reports an error, and holds its slot until it closes', async () => {
    process.env['PTAH_GIT_MAX_CONCURRENT'] = '2';
    resetGitProcessGateForTests();

    const failed = execGit(['status'], WS, BG);
    await drain();
    held[0].emit('error', new Error('EPIPE'));
    await expect(failed).rejects.toThrow('EPIPE');
    await drain();

    expect(held[0].kill).toHaveBeenCalledWith('SIGTERM');
    if (process.platform === 'win32') {
      expect(mockTreeKill).toHaveBeenCalledWith(4242);
    }

    const next = execGit(['status'], WS, BG);
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    held[0].emit('close', null);
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    held[1].emit('close', 0);
    await next;
  });

  it('never kills a child that already closed before its error arrived', async () => {
    const call = execGit(['status'], WS);
    await drain();
    held[0].emit('close', 0);
    await call;
    held[0].emit('error', new Error('late'));
    await drain();
    expect(held[0].kill).not.toHaveBeenCalled();
    expect(mockTreeKill).not.toHaveBeenCalled();
  });

  it('never lets 3 hung long commands block an interactive read', async () => {
    const longCalls = Array.from({ length: 3 }, (_, i) =>
      execGit(['worktree', 'add', `wt${i}`], WS, { timeoutMs: 300_000 }),
    );
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(3);

    // A fourth long command waits: the background lane is at max - 1.
    const fourthLong = execGit(['worktree', 'remove', 'wt9'], WS, {
      timeoutMs: 300_000,
    });
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(3);

    const read = execGit(['status'], WS);
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(4);
    expect(mockSpawn.mock.calls[3][1]).toEqual(['status']);

    held[3].emit('close', 0);
    await read;
    for (let i = 0; i < 3; i++) held[i].emit('close', 0);
    await Promise.all(longCalls);
    await drain();
    held[4].emit('close', 0);
    await fourthLong;
  });

  it('applies a slot count from configureGitProcessGate, raised to the minimum', async () => {
    const logger = { warn: jest.fn() };
    configureGitProcessGate({ logger: logger as never, maxConcurrent: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('below the minimum; using 2'),
    );
    const calls = Array.from({ length: 3 }, () => execGit(['status'], WS));
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 3; i++) {
      held[i].emit('close', 0);
      await drain();
    }
    await Promise.all(calls);
  });

  it('PTAH_GIT_MAX_CONCURRENT=1 runs with 2 slots: a hung background call never blocks a read', async () => {
    process.env['PTAH_GIT_MAX_CONCURRENT'] = '1';
    resetGitProcessGateForTests();

    const hung = execGit(['status'], WS, BG);
    await drain();
    const read = execGit(['show', 'HEAD:a.ts'], WS);
    await drain();
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(mockSpawn.mock.calls[1][1]).toEqual(['show', 'HEAD:a.ts']);

    held[1].emit('close', 0);
    await read;
    held[0].emit('close', 0);
    await hung;
  });

  it('lowers a background child to below-normal priority', async () => {
    const call = execGit(['status'], WS, { priority: 'background' });
    await drain();
    expect(mockSetPriority).toHaveBeenCalledWith(
      4242,
      os.constants.priority.PRIORITY_BELOW_NORMAL,
    );
    held[0].emit('close', 0);
    await call;
  });

  it('leaves a normal-priority child alone', async () => {
    const call = execGit(['status'], WS);
    await drain();
    held[0].emit('close', 0);
    await call;
    expect(mockSetPriority).not.toHaveBeenCalled();
  });

  it('skips setPriority for a child that closed before its pid arrived', async () => {
    let reportPid!: (pid: number | null) => void;
    const closeListeners: Array<(code: number) => void> = [];
    const spawnProcess = jest.fn(() => ({
      stdin: { on: jest.fn(), end: jest.fn(), write: jest.fn() },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      whenSpawned: new Promise<number | null>((resolve) => {
        reportPid = resolve;
      }),
      pid: undefined,
      killed: false,
      kill: jest.fn(),
      on: jest.fn((event: string, listener: (code: number) => void) => {
        if (event === 'close') closeListeners.push(listener);
      }),
    }));

    const call = execGit(['status'], WS, {
      priority: 'background',
      spawner: { spawnProcess } as never,
    });
    await drain();
    for (const listener of closeListeners) listener(0);
    await call;
    reportPid(5150);
    await drain();

    expect(mockSetPriority).not.toHaveBeenCalled();
  });

  it('does not fail the git call when setPriority is refused', async () => {
    mockSetPriority.mockImplementationOnce(() => {
      throw new Error('EACCES');
    });
    const call = execGit(['status'], WS, { priority: 'background' });
    await drain();
    held[0].stdout.emit('data', Buffer.from('ok'));
    held[0].emit('close', 0);
    await expect(call).resolves.toMatchObject({ stdout: 'ok', exitCode: 0 });
  });
});
