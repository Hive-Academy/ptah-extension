/**
 * AntigravityCliAdapter Unit Tests
 *
 * The adapter spawns the `agy` binary in print mode and parses PLAIN TEXT
 * stdout (no JSONL). Tests mock cli-adapter.utils (spawnCli / resolveCliPath /
 * probeCliVersion) and fs so no real `agy` process or disk write happens.
 * Covers: detect() (installed/not), listModels() parsing of `agy models`,
 * runSdk() arg construction (print/model/skip-permissions/conversation/add-dir),
 * the heuristic text→segment parser, and post-run session-id recovery.
 */
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

interface FakeChildControls {
  stdout: PassThrough;
  stderr: PassThrough;
  emitClose: (code: number | null, signal?: NodeJS.Signals | null) => void;
  emitError: (err: Error) => void;
  killed: boolean;
  kill: jest.Mock;
  child: EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: { end: jest.Mock; write: jest.Mock };
    kill: jest.Mock;
    killed: boolean;
    pid: number;
  };
}

/** A stable fake PID so abort handlers route through killProcessTree(pid). */
const FAKE_PID = 4242;

function createFakeChild(): FakeChildControls {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');

  const emitter = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: { end: jest.Mock; write: jest.Mock };
    kill: jest.Mock;
    killed: boolean;
    pid: number;
  };
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.stdin = { end: jest.fn(), write: jest.fn() };
  emitter.pid = FAKE_PID;
  emitter.killed = false;
  emitter.kill = jest.fn((_signal?: string) => {
    emitter.killed = true;
    return true;
  });

  return {
    stdout,
    stderr,
    emitClose: (code, signal) => emitter.emit('close', code, signal ?? null),
    emitError: (err) => emitter.emit('error', err),
    get killed() {
      return emitter.killed;
    },
    kill: emitter.kill,
    child: emitter,
  };
}

let currentChild: FakeChildControls | null = null;

const mockSpawnCli = jest.fn();
const mockResolveCliPath = jest.fn();
const mockProbeCliVersion = jest.fn();
const mockKillProcessTree = jest.fn();

jest.mock('./cli-adapter.utils', () => {
  const actual = jest.requireActual<typeof import('./cli-adapter.utils')>(
    './cli-adapter.utils',
  );
  return {
    ...actual,
    spawnCli: (...args: unknown[]) => mockSpawnCli(...args),
    resolveCliPath: (...args: unknown[]) => mockResolveCliPath(...args),
    probeCliVersion: (...args: unknown[]) => mockProbeCliVersion(...args),
    // Abort handlers tree-kill the child by PID. Mock it so the test never
    // issues a real process.kill(-pid) group-kill against the runner.
    killProcessTree: (...args: unknown[]) => mockKillProcessTree(...args),
  };
});

const mockReaddirSync = jest.fn();
const mockStatSync = jest.fn();

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    statSync: (...args: unknown[]) => mockStatSync(...args),
  };
});

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockRejectedValue(new Error('missing')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

import { AntigravityCliAdapter } from './antigravity-cli.adapter';
import type { SdkHandle } from './cli-adapter.interface';
import type { CliOutputSegment } from '@ptah-extension/shared';

/** Drain a handle's raw output + structured segments into arrays. */
function collect(handle: SdkHandle): {
  output: string[];
  segments: CliOutputSegment[];
} {
  const output: string[] = [];
  const segments: CliOutputSegment[] = [];
  handle.onOutput((data) => output.push(data));
  handle.onSegment?.((seg) => segments.push(seg));
  return { output, segments };
}

describe('AntigravityCliAdapter', () => {
  let adapter: AntigravityCliAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    currentChild = null;
    mockSpawnCli.mockImplementation(() => {
      currentChild = createFakeChild();
      return currentChild.child;
    });
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ mtimeMs: 0 });
    adapter = new AntigravityCliAdapter();
  });

  describe('detect()', () => {
    it('reports installed when resolveCliPath finds the binary', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/agy');
      mockProbeCliVersion.mockResolvedValue('agy 1.1.3');

      const result = await adapter.detect();
      expect(result.cli).toBe('antigravity');
      expect(result.installed).toBe(true);
      expect(result.path).toBe('/usr/local/bin/agy');
      expect(result.version).toBe('agy 1.1.3');
      expect(result.supportsSteer).toBe(false);
    });

    it('reports NOT installed when resolveCliPath returns null', async () => {
      mockResolveCliPath.mockResolvedValue(null);
      const result = await adapter.detect();
      expect(result.installed).toBe(false);
    });
  });

  describe('listModels()', () => {
    it('parses `agy models` stdout into id/name pairs', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/agy');
      const models = adapter.listModels();

      // probeModels spawns `agy models`; feed it labels then close.
      await Promise.resolve();
      currentChild?.stdout.write(
        'Gemini 3.1 Pro (High)\nClaude Sonnet 4.6 (Thinking)\n\n',
      );
      currentChild?.emitClose(0);

      expect(await models).toEqual([
        { id: 'Gemini 3.1 Pro (High)', name: 'Gemini 3.1 Pro (High)' },
        {
          id: 'Claude Sonnet 4.6 (Thinking)',
          name: 'Claude Sonnet 4.6 (Thinking)',
        },
      ]);
      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg).toEqual(['models']);
    });

    it('returns an empty list when the probe produces no output', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/agy');
      const models = adapter.listModels();
      await Promise.resolve();
      currentChild?.emitClose(0);
      expect(await models).toEqual([]);
    });
  });

  describe('runSdk() — argument construction', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('spawns print mode with skip-permissions and the prompt LAST', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [binaryArg, argsArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
      ];
      expect(binaryArg).toBe('agy');
      expect(argsArg).toContain('--dangerously-skip-permissions');
      expect(argsArg).toContain('--add-dir');
      expect(argsArg[argsArg.indexOf('--add-dir') + 1]).toBe('/proj');
      // --print is the LAST flag and its value is the built task prompt.
      expect(argsArg[argsArg.length - 2]).toBe('--print');
      expect(argsArg[argsArg.length - 1]).toBe('Do the thing');
    });

    it('adds --model when a model is provided', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        model: 'Gemini 3.1 Pro (High)',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg[argsArg.indexOf('--model') + 1]).toBe(
        'Gemini 3.1 Pro (High)',
      );
    });

    it('adds --conversation when resuming a session', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        resumeSessionId: 'abc-123',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg[argsArg.indexOf('--conversation') + 1]).toBe('abc-123');
    });

    it('omits skip-permissions when autoApprove is false', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        autoApprove: false,
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg).not.toContain('--dangerously-skip-permissions');
    });

    it('passes binaryPath through to spawnCli when provided', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        binaryPath: 'C:/agy/bin/agy.exe',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [binaryArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(binaryArg).toBe('C:/agy/bin/agy.exe');
    });
  });

  describe('runSdk() — text→segment parsing', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('classifies narration lines as thinking and answers as text', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { output, segments } = collect(handle);

      currentChild?.stdout.write('I will read the config file.\n');
      currentChild?.stdout.write('The answer is 42.\n');
      currentChild?.stdout.write('\n');
      currentChild?.emitClose(0);
      await handle.done;

      expect(output.join('')).toContain('I will read the config file.');
      expect(output.join('')).toContain('The answer is 42.');

      const thinking = segments.filter((s) => s.type === 'thinking');
      const text = segments.filter((s) => s.type === 'text');
      expect(thinking).toHaveLength(1);
      expect(thinking[0].content).toBe('I will read the config file.');
      expect(text).toHaveLength(1);
      expect(text[0].content).toBe('The answer is 42.');
      // Blank line produces no segment.
      expect(segments).toHaveLength(2);
    });

    it('flushes a trailing partial line on close', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write('Final answer without newline');
      currentChild?.emitClose(0);
      await handle.done;

      const text = segments.filter((s) => s.type === 'text');
      expect(text).toHaveLength(1);
      expect(text[0].content).toBe('Final answer without newline');
    });

    it('emits an error segment for stderr and a non-zero exit', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stderr.write('fatal: authentication failed\n');
      currentChild?.emitClose(1);
      await handle.done;

      const errors = segments.filter((s) => s.type === 'error');
      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(
        errors.some((e) => e.content.includes('authentication failed')),
      ).toBe(true);
      expect(errors.some((e) => e.content.includes('exited with code 1'))).toBe(
        true,
      );
    });

    it('resolves done with the child exit code', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);
      currentChild?.emitClose(0);
      expect(await handle.done).toBe(0);
    });

    it('tree-kills the child process group and resolves 1 on abort', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      handle.abort.abort();
      currentChild?.emitClose(null, 'SIGTERM');
      const code = await handle.done;

      expect(mockKillProcessTree).toHaveBeenCalledWith(FAKE_PID);
      expect(code).toBe(1);
    });
  });

  describe('runSdk() — session id recovery', () => {
    it('returns the newest .db (excluding wal/shm) after the run', async () => {
      mockReaddirSync.mockReturnValue([
        'old.db',
        'new.db',
        'new.db-wal',
        'new.db-shm',
      ]);
      mockStatSync.mockImplementation((p: string) => ({
        mtimeMs: p.includes('new.db') ? Date.now() + 10_000 : 1,
      }));

      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      expect(handle.getSessionId?.()).toBe('new');
    });

    it('returns undefined when no db is newer than the run start', async () => {
      mockReaddirSync.mockReturnValue(['stale.db']);
      mockStatSync.mockReturnValue({ mtimeMs: 1 });

      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      expect(handle.getSessionId?.()).toBeUndefined();
    });
  });

  describe('supportsSteer() / parseOutput()', () => {
    it('reports supportsSteer() false', () => {
      expect(adapter.supportsSteer()).toBe(false);
    });

    it('strips ANSI escape codes', () => {
      expect(adapter.parseOutput('\x1b[32mok\x1b[0m')).toBe('ok');
    });
  });
});
