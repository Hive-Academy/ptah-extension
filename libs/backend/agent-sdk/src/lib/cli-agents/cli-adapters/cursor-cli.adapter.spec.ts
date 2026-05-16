/**
 * CursorCliAdapter Unit Tests
 *
 * Tests: detect() (must resolve cursor-agent, NOT cursor), buildCommand(),
 *        runSdk() streaming with JSONL events, AbortSignal propagation,
 *        error paths (spawn error, JSON parse failure, non-zero exit),
 *        Windows .cmd shim handling via cross-spawn / spawnCli.
 */

// ---- Mocks must be declared before any imports that trigger module resolution ----

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

/** Fake child process driving stdout/stderr and exit events. */
interface FakeChildControls {
  stdin: {
    written: string[];
    ended: boolean;
    write: (data: string) => void;
    end: () => void;
  };
  stdout: PassThrough;
  stderr: PassThrough;
  emitClose: (code: number | null, signal?: NodeJS.Signals | null) => void;
  emitError: (err: Error) => void;
  kill: jest.Mock;
  killed: boolean;
  child: EventEmitter & {
    stdin: FakeChildControls['stdin'];
    stdout: PassThrough;
    stderr: PassThrough;
    kill: jest.Mock;
    killed: boolean;
  };
}

function createFakeChild(): FakeChildControls {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');

  const writtenChunks: string[] = [];
  const stdin = {
    written: writtenChunks,
    ended: false,
    write: (data: string): void => {
      writtenChunks.push(data);
    },
    end: (): void => {
      controls.stdin.ended = true;
    },
  };

  const emitter = new EventEmitter() as EventEmitter & {
    stdin: typeof stdin;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: jest.Mock;
    killed: boolean;
  };
  emitter.stdin = stdin;
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.killed = false;
  emitter.kill = jest.fn((_signal?: string) => {
    emitter.killed = true;
    return true;
  });

  const controls: FakeChildControls = {
    stdin,
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
  return controls;
}

let currentChild: FakeChildControls | null = null;

const mockSpawnCli = jest.fn();
const mockResolveCliPath = jest.fn();

jest.mock('./cli-adapter.utils', () => {
  const actual = jest.requireActual<typeof import('./cli-adapter.utils')>(
    './cli-adapter.utils',
  );
  return {
    ...actual,
    spawnCli: (...args: unknown[]) => mockSpawnCli(...args),
    resolveCliPath: (...args: unknown[]) => mockResolveCliPath(...args),
  };
});

const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile,
}));

// MCP config writes should be no-ops for these tests.
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

import { CursorCliAdapter } from './cursor-cli.adapter';
import type { SdkHandle } from './cli-adapter.interface';

describe('CursorCliAdapter', () => {
  let adapter: CursorCliAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    currentChild = null;

    mockSpawnCli.mockImplementation(() => {
      currentChild = createFakeChild();
      return currentChild.child;
    });

    adapter = new CursorCliAdapter();
  });

  describe('detect()', () => {
    it('resolves `cursor-agent` (headless CLI), NOT `cursor` (GUI binary)', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/cursor-agent');
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: readonly string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          cb?.(null, { stdout: 'cursor-agent 0.9.1\n' });
        },
      );

      const result = await adapter.detect();

      expect(mockResolveCliPath).toHaveBeenCalledWith('cursor-agent');
      expect(result.cli).toBe('cursor');
      expect(result.installed).toBe(true);
      expect(result.path).toBe('/usr/local/bin/cursor-agent');
      expect(result.version).toBe('cursor-agent 0.9.1');
      expect(result.supportsSteer).toBe(false);
    });

    it('reports not installed when cursor-agent is missing (auth-required negative path)', async () => {
      // Without the binary there is no way to authenticate — the adapter
      // signals "not available" rather than failing open.
      mockResolveCliPath.mockResolvedValue(null);

      const result = await adapter.detect();

      expect(result.cli).toBe('cursor');
      expect(result.installed).toBe(false);
    });

    it('still reports installed when the version probe itself fails', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/cursor-agent');
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: readonly string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null) => void,
        ) => {
          cb?.(new Error('not authenticated'));
        },
      );

      const result = await adapter.detect();

      expect(result.installed).toBe(true);
      expect(result.version).toBeUndefined();
    });
  });

  describe('buildCommand()', () => {
    it('uses the cursor-agent binary with stream-json, --trust and --force flags', () => {
      const cmd = adapter.buildCommand({
        task: 'Refactor module',
        workingDirectory: '/proj',
      });

      expect(cmd.binary).toBe('cursor-agent');
      expect(cmd.args).toEqual(
        expect.arrayContaining([
          '--output-format',
          'stream-json',
          '--trust',
          '--force',
          '-p',
          expect.stringContaining('Refactor module'),
        ]),
      );
    });
  });

  describe('listModels() / supportsSteer() / parseOutput()', () => {
    it('returns the curated Cursor model list', async () => {
      const models = await adapter.listModels();
      expect(models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'cursor-fast' }),
        ]),
      );
    });

    it('reports supportsSteer() false', () => {
      expect(adapter.supportsSteer()).toBe(false);
    });

    it('strips ANSI escape codes', () => {
      expect(adapter.parseOutput('\x1b[32mok\x1b[0m')).toBe('ok');
    });
  });

  describe('runSdk() — streaming + aborting', () => {
    const defaultOptions = {
      task: 'Refactor module',
      workingDirectory: '/proj',
    };

    it('spawns cursor-agent with stream-json, --trust, --force and writes prompt to stdin', async () => {
      const handle: SdkHandle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      const [binaryArg, argsArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        Record<string, unknown>,
      ];
      expect(binaryArg).toBe('cursor-agent');
      expect(argsArg).toEqual(
        expect.arrayContaining([
          '--output-format',
          'stream-json',
          '--trust',
          '--force',
          '-p',
        ]),
      );

      const stdinStr = currentChild?.stdin.written.join('') ?? '';
      expect(stdinStr).toContain('Refactor module');

      currentChild?.emitClose(0);
      const code = await handle.done;
      expect(code).toBe(0);
    });

    it('passes a Windows cursor-agent.cmd binaryPath through to spawnCli untouched', async () => {
      const handle = await adapter.runSdk({
        ...defaultOptions,
        binaryPath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\cursor-agent.cmd',
      });
      handle.onOutput(() => {
        /* drain */
      });

      const [binaryArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        Record<string, unknown>,
      ];
      // cross-spawn (called inside spawnCli) handles .cmd shims transparently
      // — the adapter should not rewrite the path itself.
      expect(binaryArg).toBe(
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\cursor-agent.cmd',
      );

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('does NOT request a console (unlike Gemini — Cursor does not use ConPTY)', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      const [, , opts] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        { needsConsole?: boolean } | undefined,
      ];
      expect(opts?.needsConsole).toBeUndefined();

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('parses init JSONL event and captures session id', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'init',
          model: 'cursor-fast',
          session_id: 'cs-7',
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({ type: 'assistant', content: 'Done.' }) + '\n',
      );
      currentChild?.emitClose(0);

      const code = await handle.done;
      expect(code).toBe(0);
      expect(output.join('')).toContain('[Model: cursor-fast]');
      expect(output.join('')).toContain('[Session: cs-7]');
      expect(output.join('')).toContain('Done.');
      expect(handle.getSessionId?.()).toBe('cs-7');
    });

    it('emits a tool-call segment on a tool_call in_progress event', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      const segments: Array<{ type: string; toolName?: string }> = [];
      handle.onOutput((data) => output.push(data));
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, toolName: seg.toolName }),
      );

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool_call',
          id: 'tc-1',
          name: 'read_file',
          status: 'in_progress',
          input: { path: 'src/app.ts' },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(output.join('')).toContain('**Tool:** `read_file`');
      expect(
        segments.some(
          (s) => s.type === 'tool-call' && s.toolName === 'read_file',
        ),
      ).toBe(true);
    });

    it('tolerates malformed JSON lines by emitting non-JSON text as-is', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      currentChild?.stdout.write('plain fallback text\n');
      currentChild?.stdout.write('{not valid json\n');
      currentChild?.emitClose(0);

      const code = await handle.done;
      expect(code).toBe(0);
      expect(output.join('')).toContain('plain fallback text');
      expect(output.join('')).not.toContain('{not valid json');
    });

    it('propagates AbortSignal by sending SIGTERM to the child process', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      handle.abort.abort();

      expect(currentChild?.kill).toHaveBeenCalledWith('SIGTERM');

      currentChild?.emitClose(null, 'SIGTERM');
      const code = await handle.done;
      expect(code).toBe(1);
      expect(handle.abort.signal.aborted).toBe(true);
    });

    it('resolves done with 1 and emits an error segment on spawn ENOENT', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      currentChild?.emitError(
        Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
      );

      const code = await handle.done;
      expect(code).toBe(1);
      expect(output.join('')).toContain('[Cursor CLI Error]');
      expect(output.join('')).toContain('spawn ENOENT');
    });

    it('resolves done with the CLI non-zero exit code', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      // Cursor emits an error JSONL event before exiting non-zero.
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'error',
          message: 'Auth required',
          code: 401,
        }) + '\n',
      );
      currentChild?.emitClose(3);

      const code = await handle.done;
      expect(code).toBe(3);
    });

    it('classifies error-like stderr as error segment and other stderr as info', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      const segments: Array<{ type: string; content: string }> = [];
      handle.onOutput((data) => output.push(data));
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, content: seg.content }),
      );

      currentChild?.stderr.write('fetching model list...\n');
      currentChild?.stderr.write('Error: auth token refused\n');
      currentChild?.emitClose(0);
      await handle.done;

      expect(
        segments.some(
          (s) => s.type === 'error' && /auth token refused/.test(s.content),
        ),
      ).toBe(true);
      expect(
        segments.some(
          (s) => s.type === 'info' && /fetching model list/.test(s.content),
        ),
      ).toBe(true);
    });
  });
});
