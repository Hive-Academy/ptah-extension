/**
 * OpencodeCliAdapter Unit Tests
 *
 * The adapter spawns the `opencode` binary in `run --format json` mode and
 * parses JSONL events from stdout. Tests mock cli-adapter.utils (spawnCli /
 * resolveCliPath / probeCliVersion), fs (existsSync — keeps the Windows
 * native-binary fallback inert) and fs/promises (opencode.json read/write) so
 * no real process or disk write happens. Covers: detect() (installed/not),
 * listModels() parsing, runSdk() arg construction, JSONL→segment mapping for
 * text / tool_use (bash + generic) / step_finish / error, session-id capture,
 * and MCP config read-merge-write.
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
  };
}

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
  };
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.stdin = { end: jest.fn(), write: jest.fn() };
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

jest.mock('./cli-adapter.utils', () => {
  const actual = jest.requireActual<typeof import('./cli-adapter.utils')>(
    './cli-adapter.utils',
  );
  return {
    ...actual,
    spawnCli: (...args: unknown[]) => mockSpawnCli(...args),
    resolveCliPath: (...args: unknown[]) => mockResolveCliPath(...args),
    probeCliVersion: (...args: unknown[]) => mockProbeCliVersion(...args),
  };
});

const mockExistsSync = jest.fn();

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  };
});

const mockReadFile = jest.fn();
const mockWriteFile = jest.fn();

jest.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

import { OpencodeCliAdapter } from './opencode-cli.adapter';
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

/** Flush a pending microtask so async setup inside runSdk settles. */
const flush = () => Promise.resolve();

describe('OpencodeCliAdapter', () => {
  let adapter: OpencodeCliAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    currentChild = null;
    mockSpawnCli.mockImplementation(() => {
      currentChild = createFakeChild();
      return currentChild.child;
    });
    // Keep the Windows native-binary fallback inert: no candidate exists.
    mockExistsSync.mockReturnValue(false);
    // Default: no opencode.json on disk.
    mockReadFile.mockRejectedValue(new Error('missing'));
    mockWriteFile.mockResolvedValue(undefined);
    adapter = new OpencodeCliAdapter();
  });

  describe('detect()', () => {
    it('reports installed when resolveCliPath finds the binary', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      mockProbeCliVersion.mockResolvedValue('opencode 0.4.2');

      const result = await adapter.detect();
      expect(result.cli).toBe('opencode');
      expect(result.installed).toBe(true);
      expect(result.path).toBe('/usr/local/bin/opencode');
      expect(result.version).toBe('opencode 0.4.2');
      expect(result.supportsSteer).toBe(false);
    });

    it('reports NOT installed when resolveCliPath returns null', async () => {
      mockResolveCliPath.mockResolvedValue(null);
      const result = await adapter.detect();
      expect(result.installed).toBe(false);
    });
  });

  describe('listModels()', () => {
    it('parses `opencode models` stdout into provider/model ids', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const models = adapter.listModels();

      await flush();
      currentChild?.stdout.write(
        'anthropic/claude-sonnet-4-5\nopenai/gpt-4o\n\n',
      );
      currentChild?.emitClose(0);

      expect(await models).toEqual([
        {
          id: 'anthropic/claude-sonnet-4-5',
          name: 'anthropic/claude-sonnet-4-5',
        },
        { id: 'openai/gpt-4o', name: 'openai/gpt-4o' },
      ]);
      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg).toEqual(['models']);
    });

    it('returns an empty list when the probe produces no output', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const models = adapter.listModels();
      await flush();
      currentChild?.emitClose(0);
      expect(await models).toEqual([]);
    });
  });

  describe('runSdk() — argument construction', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('spawns run --format json with --auto, --dir, and the prompt LAST', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [binaryArg, argsArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
      ];
      expect(binaryArg).toBe('opencode');
      expect(argsArg.slice(0, 3)).toEqual(['run', '--format', 'json']);
      expect(argsArg).toContain('--auto');
      expect(argsArg[argsArg.indexOf('--dir') + 1]).toBe('/proj');
      expect(argsArg[argsArg.length - 1]).toBe('Do the thing');
    });

    it('adds --model when a model is provided', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        model: 'anthropic/claude-sonnet-4-5',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg[argsArg.indexOf('--model') + 1]).toBe(
        'anthropic/claude-sonnet-4-5',
      );
    });

    it('adds --session when resuming a session', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        resumeSessionId: 'ses_abc123',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg[argsArg.indexOf('--session') + 1]).toBe('ses_abc123');
    });

    it('omits --auto when autoApprove is false', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        autoApprove: false,
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg).not.toContain('--auto');
    });

    it('passes binaryPath through to spawnCli when provided', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        binaryPath: 'C:/opencode/bin/opencode.exe',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [binaryArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(binaryArg).toBe('C:/opencode/bin/opencode.exe');
    });
  });

  describe('runSdk() — JSONL → segment mapping', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('maps text events to text segments and captures sessionID', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { output, segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'step_start',
          sessionID: 'ses_xyz',
          part: { type: 'step-start' },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_xyz',
          part: { id: 'prt_1', type: 'text', text: 'Hello' },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(handle.getSessionId?.()).toBe('ses_xyz');
      const text = segments.filter((s) => s.type === 'text');
      expect(text).toHaveLength(1);
      expect(text[0].content).toBe('Hello');
      expect(output.join('')).toContain('Hello');
    });

    it('emits only the appended delta for repeated text on the same part id', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_1',
          part: { id: 'prt_1', type: 'text', text: 'Hel' },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'text',
          sessionID: 'ses_1',
          part: { id: 'prt_1', type: 'text', text: 'Hello' },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const text = segments.filter((s) => s.type === 'text');
      expect(text.map((s) => s.content)).toEqual(['Hel', 'lo']);
    });

    it('maps a bash tool_use to a command segment with exit code', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool_use',
          sessionID: 'ses_1',
          part: {
            id: 'prt_2',
            type: 'tool',
            callID: 'call_1',
            tool: 'bash',
            state: {
              status: 'completed',
              input: { command: 'echo hello' },
              output: 'hello\n',
              metadata: { exit: 0, output: 'hello\n' },
            },
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const command = segments.filter((s) => s.type === 'command');
      expect(command).toHaveLength(1);
      expect(command[0].toolName).toBe('echo hello');
      expect(command[0].exitCode).toBe(0);
      expect(command[0].content).toBe('hello\n');
      expect(command[0].toolCallId).toBe('call_1');
    });

    it('maps a non-bash tool_use to tool-call + tool-result segments', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool_use',
          sessionID: 'ses_1',
          part: {
            id: 'prt_3',
            type: 'tool',
            callID: 'call_2',
            tool: 'read',
            state: {
              status: 'completed',
              input: { filePath: '/proj/a.ts' },
              output: 'file contents',
            },
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const call = segments.find((s) => s.type === 'tool-call');
      const resultSeg = segments.find((s) => s.type === 'tool-result');
      expect(call?.toolName).toBe('read');
      expect(call?.toolCallId).toBe('call_2');
      expect(call?.toolArgs).toBe(JSON.stringify({ filePath: '/proj/a.ts' }));
      expect(resultSeg?.content).toBe('file contents');
      expect(resultSeg?.toolCallId).toBe('call_2');
    });

    it('emits an info usage segment on step_finish with reason stop', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'step_finish',
          sessionID: 'ses_1',
          part: {
            type: 'step-finish',
            reason: 'stop',
            tokens: { input: 671, output: 8 },
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const info = segments.filter((s) => s.type === 'info');
      expect(info).toHaveLength(1);
      expect(info[0].content).toContain('671 input');
      expect(info[0].content).toContain('8 output');
    });

    it('maps a top-level error event to an error segment', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'error',
          sessionID: 'ses_1',
          error: { name: 'APIError', data: { message: 'Rate limit exceeded' } },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const errors = segments.filter((s) => s.type === 'error');
      expect(errors.some((e) => e.content === 'Rate limit exceeded')).toBe(
        true,
      );
    });

    it('skips non-JSON lines defensively', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write('not json at all\n');
      currentChild?.emitClose(0);
      await handle.done;

      expect(segments).toHaveLength(0);
    });

    it('resolves done with the child exit code and reports a non-zero exit', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);
      currentChild?.emitClose(2);
      const code = await handle.done;

      expect(code).toBe(2);
      expect(
        segments.some(
          (s) => s.type === 'error' && s.content.includes('exited with code 2'),
        ),
      ).toBe(true);
    });

    it('kills the child and resolves 1 on abort', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      handle.abort.abort();
      currentChild?.emitClose(null, 'SIGTERM');
      const code = await handle.done;

      expect(currentChild?.killed).toBe(true);
      expect(code).toBe(1);
    });
  });

  describe('runSdk() — MCP config', () => {
    it('writes mcp.ptah into <cwd>/opencode.json before spawn', async () => {
      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
        mcpPort: 51820,
      });
      collect(handle);

      // configureMcpServer runs (and writes) before spawnCli inside runSdk.
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const [writtenPath, writtenContent] = mockWriteFile.mock.calls[0] as [
        string,
        string,
      ];
      expect(writtenPath).toContain('opencode.json');
      const written = JSON.parse(writtenContent) as {
        mcp: { ptah: { type: string; url: string; enabled: boolean } };
      };
      expect(written.mcp.ptah).toEqual({
        type: 'remote',
        url: 'http://localhost:51820',
        enabled: true,
      });

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('merges into an existing opencode.json without dropping other keys', async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ model: 'anthropic/claude-sonnet-4-5' }),
      );

      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
        mcpPort: 4000,
      });
      collect(handle);

      const [, writtenContent] = mockWriteFile.mock.calls[0] as [
        string,
        string,
      ];
      const written = JSON.parse(writtenContent) as Record<string, unknown>;
      expect(written['model']).toBe('anthropic/claude-sonnet-4-5');
      expect((written['mcp'] as Record<string, unknown>)['ptah']).toBeDefined();

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('does not touch opencode.json when no mcpPort is provided', async () => {
      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  describe('supportsSteer() / parseOutput() / supportsMcp', () => {
    it('reports supportsSteer() false and supportsMcp true', () => {
      expect(adapter.supportsSteer()).toBe(false);
      expect(adapter.supportsMcp).toBe(true);
    });

    it('strips ANSI escape codes', () => {
      expect(adapter.parseOutput('\x1b[32mok\x1b[0m')).toBe('ok');
    });
  });
});
