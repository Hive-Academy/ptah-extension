/**
 * GeminiCliAdapter Unit Tests
 * TASK_2025_294 Batch W7.B1
 *
 * Tests: detect(), buildCommand(), runSdk() streaming with JSONL events,
 *        AbortSignal propagation, error propagation (spawn error, JSON parse),
 *        Windows `.cmd` shim handling via cross-spawn / spawnCli.
 *
 * Mirrors the pattern in codex-cli.adapter.spec.ts. Module-level mocks for
 * `child_process`, `cross-spawn` (indirectly via cli-adapter.utils), and
 * `fs/promises` are declared before adapter import.
 */

// ---- Mocks must be declared before any imports that trigger module resolution ----

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

/**
 * Fake child process that satisfies the subset of the ChildProcess surface
 * used by GeminiCliAdapter.runSdk(): stdin.write/end, stdout/stderr streams,
 * kill(), and `close` / `error` events.
 */
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
  killed: boolean;
  kill: jest.Mock;
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
      // Mark ended — tests assert this was called.
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

// Shared handle to the last spawned child (tests inspect/drive this).
let currentChild: FakeChildControls | null = null;

const mockSpawnCli = jest.fn();
const mockResolveCliPath = jest.fn();

// Mock cli-adapter.utils so we can intercept spawnCli and resolveCliPath.
// stripAnsiCodes/buildTaskPrompt are preserved via jest.requireActual so the
// real formatting helpers still run in the adapter under test.
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

// Mock child_process for detect() (execFileAsync path) and for any accidental imports.
const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile,
}));

// Mock fs / fs/promises so MCP config and trusted-folder writes are no-ops.
jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockRejectedValue(new Error('ENOENT')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

// Import adapter AFTER mocks are declared.
import { GeminiCliAdapter } from './gemini-cli.adapter';
import type { SdkHandle } from './cli-adapter.interface';

describe('GeminiCliAdapter', () => {
  let adapter: GeminiCliAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    currentChild = null;

    // Default: spawnCli returns a fresh fake child, stashed for driving.
    mockSpawnCli.mockImplementation(() => {
      currentChild = createFakeChild();
      return currentChild.child;
    });

    adapter = new GeminiCliAdapter();
  });

  describe('detect()', () => {
    it('reports installed when resolveCliPath finds the binary', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/gemini');
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: readonly string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          cb?.(null, { stdout: 'gemini-cli 1.4.2\n' });
        },
      );

      const result = await adapter.detect();

      expect(result.cli).toBe('gemini');
      expect(result.installed).toBe(true);
      expect(result.path).toBe('/usr/local/bin/gemini');
      expect(result.version).toBe('gemini-cli 1.4.2');
      expect(result.supportsSteer).toBe(false);
    });

    it('reports not installed when resolveCliPath returns null', async () => {
      mockResolveCliPath.mockResolvedValue(null);

      const result = await adapter.detect();

      expect(result.cli).toBe('gemini');
      expect(result.installed).toBe(false);
      expect(result.supportsSteer).toBe(false);
    });

    it('still reports installed when version probe fails', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/gemini');
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: readonly string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null) => void,
        ) => {
          cb?.(new Error('spawn ENOENT'));
        },
      );

      const result = await adapter.detect();

      expect(result.installed).toBe(true);
      expect(result.version).toBeUndefined();
    });
  });

  describe('buildCommand()', () => {
    it('emits -p and text output-format for the CLI fallback path', () => {
      const cmd = adapter.buildCommand({
        task: 'Write a unit test',
        workingDirectory: '/proj',
      });

      expect(cmd.binary).toBe('gemini');
      expect(cmd.args).toEqual([
        '-p',
        expect.stringContaining('Write a unit test'),
        '--output-format',
        'text',
      ]);
    });
  });

  describe('listModels() / supportsSteer() / parseOutput()', () => {
    it('returns the curated Gemini model list', async () => {
      const models = await adapter.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.id === 'gemini-2.5-pro')).toBe(true);
    });

    it('reports supportsSteer() false', () => {
      expect(adapter.supportsSteer()).toBe(false);
    });

    it('strips ANSI escape codes', () => {
      expect(adapter.parseOutput('\x1b[31mred\x1b[0m text')).toBe('red text');
    });
  });

  describe('runSdk() — streaming + aborting', () => {
    const defaultOptions = {
      task: 'Implement feature X',
      workingDirectory: '/proj',
    };

    it('spawns gemini with --output-format stream-json and writes prompt to stdin', async () => {
      const handle: SdkHandle = await adapter.runSdk(defaultOptions);
      // Drain output to avoid the internal buffer growing during the test.
      handle.onOutput(() => {
        /* drain */
      });

      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      const [binaryArg, argsArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        Record<string, unknown>,
      ];
      expect(binaryArg).toBe('gemini');
      expect(argsArg).toContain('--output-format');
      expect(argsArg).toContain('stream-json');
      expect(argsArg).toContain('--yolo');
      expect(argsArg).toContain('--prompt=');

      // Prompt is written via stdin so Windows argv length limits don't apply.
      const stdinStr = currentChild?.stdin.written.join('') ?? '';
      expect(stdinStr).toContain('Implement feature X');

      // Close cleanly so the done promise resolves.
      currentChild?.emitClose(0);
      const code = await handle.done;
      expect(code).toBe(0);
    });

    it('passes Windows binaryPath through to spawnCli (cross-spawn handles .cmd shims)', async () => {
      const handle = await adapter.runSdk({
        ...defaultOptions,
        binaryPath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\gemini.cmd',
      });
      handle.onOutput(() => {
        /* drain */
      });

      const [binaryArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        Record<string, unknown>,
      ];
      // The adapter delegates .cmd handling to cross-spawn (via spawnCli);
      // it does NOT mutate the path itself.
      expect(binaryArg).toBe(
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\gemini.cmd',
      );

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('requests a console window on Windows via needsConsole:true (ConPTY compatibility)', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      const [, , opts] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        { needsConsole?: boolean },
      ];
      expect(opts.needsConsole).toBe(true);

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('parses JSONL init events and captures session id', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      // Stream init then result on stdout.
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'init',
          model: 'gemini-2.5-pro',
          session_id: 'sess-42',
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'message',
          content: 'Hello world',
        }) + '\n',
      );
      currentChild?.emitClose(0);

      const code = await handle.done;
      expect(code).toBe(0);
      expect(output.join('')).toContain('[Model: gemini-2.5-pro]');
      expect(output.join('')).toContain('[Session: sess-42]');
      expect(output.join('')).toContain('Hello world');
      expect(handle.getSessionId?.()).toBe('sess-42');
    });

    it('tolerates malformed JSON lines by emitting them as raw text', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      // A non-JSON line that does not start with '{' — adapter emits as text.
      currentChild?.stdout.write('plain fallback line\n');
      // Invalid JSON that starts with '{' is silently ignored by design.
      currentChild?.stdout.write('{bogus json line\n');
      currentChild?.emitClose(0);

      const code = await handle.done;
      expect(code).toBe(0);
      expect(output.join('')).toContain('plain fallback line');
      expect(output.join('')).not.toContain('{bogus json line');
    });

    it('propagates AbortSignal by sending SIGTERM to the child process', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      handle.abort.abort();

      expect(currentChild?.kill).toHaveBeenCalledWith('SIGTERM');

      // After kill the child normally emits 'close' with a non-zero/signal path.
      currentChild?.emitClose(null, 'SIGTERM');
      const code = await handle.done;
      expect(code).toBe(1);
      expect(handle.abort.signal.aborted).toBe(true);
    });

    it('resolves done with 1 and emits an error segment on spawn-level error', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      const spawnError = Object.assign(new Error('spawn ENOENT'), {
        code: 'ENOENT',
      });
      currentChild?.emitError(spawnError);

      const code = await handle.done;
      expect(code).toBe(1);
      expect(output.join('')).toContain('[Gemini CLI Error]');
      expect(output.join('')).toContain('spawn ENOENT');
    });

    it('resolves done with non-zero exit code when the CLI exits non-zero', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      // A parse error event arrives before the process exits non-zero.
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'error',
          message: 'Auth required',
          code: 401,
        }) + '\n',
      );
      currentChild?.emitClose(2);

      const code = await handle.done;
      expect(code).toBe(2);
    });

    it('filters Windows ConPTY noise from stderr output', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      // First: a noisy ConPTY line that sets the suppress counter to 5.
      currentChild?.stderr.write(
        'conpty_console_list_agent.js failed to attach\n',
      );
      // The next 5 stderr lines are suppressed by design.
      for (let i = 0; i < 5; i++) {
        currentChild?.stderr.write(`stack frame ${i}\n`);
      }
      // After the suppress window closes, a meaningful error should pass through.
      currentChild?.stderr.write('actual failure: quota exceeded\n');
      currentChild?.emitClose(1);

      const code = await handle.done;
      expect(code).toBe(1);
      const joined = output.join('');
      expect(joined).not.toContain('conpty_console_list_agent');
      expect(joined).toContain('actual failure: quota exceeded');
    });

    it('emits a tool-call segment when a tool_use JSONL event arrives', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      const segments: Array<{ type: string; toolName?: string }> = [];
      handle.onOutput((data) => output.push(data));
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, toolName: seg.toolName }),
      );

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool_use',
          tool_name: 'read_file',
          tool_input: { path: 'src/app.ts' },
          tool_call_id: 't-1',
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
  });
});
