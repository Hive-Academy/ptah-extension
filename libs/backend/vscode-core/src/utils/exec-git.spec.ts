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

import { execGit, execGitBuffer } from './exec-git';

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
