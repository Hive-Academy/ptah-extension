/**
 * PiCliAdapter Unit Tests — RPC mode
 *
 * The adapter spawns the `pi` binary in `--mode rpc` and drives it over a
 * persistent-during-run stdin channel: it writes the initial `prompt` + a
 * `get_state` request, parses JSONL events/responses from stdout, resolves the
 * turn on the RPC-only `agent_settled` event, then kills the child so no
 * persistent process leaks. Tests mock cli-adapter.utils (spawnCli /
 * resolveCliPath / probeCliVersion) and fs/promises (auth.json) so no real
 * process or disk access happens. Covers: detect() (installed/not, supportsSteer
 * true), listModels() parsing, runSdk() arg construction (--mode rpc / -a /
 * --model / --thinking, NO positional prompt), initial prompt + get_state written
 * to stdin, session id capture (session header + get_state response),
 * event→segment mapping (text_delta, thinking_delta, tool_execution_start/end),
 * agent_settled → resolve + kill, steer() envelope, continue() re-spawn with
 * --session, and abort → abort envelope + kill.
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
  stdinWrite: jest.Mock;
  pid: number;
  child: EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: {
      end: jest.Mock;
      write: jest.Mock;
      writable: boolean;
      on: jest.Mock;
    };
    kill: jest.Mock;
    killed: boolean;
    pid: number;
  };
}

/** Incrementing fake PIDs so each spawned child has a distinct tree-kill target. */
let nextFakePid = 4242;

function createFakeChild(): FakeChildControls {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');

  const pid = nextFakePid++;
  const stdinWrite = jest.fn().mockReturnValue(true);
  const emitter = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: {
      end: jest.Mock;
      write: jest.Mock;
      writable: boolean;
      on: jest.Mock;
    };
    kill: jest.Mock;
    killed: boolean;
    pid: number;
  };
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.pid = pid;
  // RPC mode keeps stdin open and writable for the whole run.
  emitter.stdin = {
    end: jest.fn(),
    write: stdinWrite,
    writable: true,
    on: jest.fn(),
  };
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
    stdinWrite,
    pid,
    child: emitter,
  };
}

let currentChild: FakeChildControls | null = null;
let spawnedChildren: FakeChildControls[] = [];

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
    // Settle/abort teardown tree-kills the child by PID. Mock it so the test
    // never issues a real process.kill(-pid) group-kill against the runner.
    killProcessTree: (...args: unknown[]) => mockKillProcessTree(...args),
  };
});

const mockReadFile = jest.fn();

jest.mock('fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import { PiCliAdapter } from './pi-cli.adapter';
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

/** Parse the JSONL requests written to a child's stdin. */
function writtenRequests(
  child: FakeChildControls,
): Array<Record<string, unknown>> {
  return child.stdinWrite.mock.calls
    .map(([raw]) => String(raw).trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const flush = () => Promise.resolve();

describe('PiCliAdapter (RPC mode)', () => {
  let adapter: PiCliAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    currentChild = null;
    spawnedChildren = [];
    mockSpawnCli.mockImplementation(() => {
      currentChild = createFakeChild();
      spawnedChildren.push(currentChild);
      return currentChild.child;
    });
    mockReadFile.mockRejectedValue(new Error('missing'));
    adapter = new PiCliAdapter();
  });

  describe('detect()', () => {
    it('reports installed and supportsSteer true when the binary is found', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/pi');
      mockProbeCliVersion.mockResolvedValue('pi 0.80.10');

      const result = await adapter.detect();
      expect(result.cli).toBe('pi');
      expect(result.installed).toBe(true);
      expect(result.path).toBe('/usr/local/bin/pi');
      expect(result.version).toBe('pi 0.80.10');
      expect(result.supportsSteer).toBe(true);
    });

    it('reports NOT installed when resolveCliPath returns null', async () => {
      mockResolveCliPath.mockResolvedValue(null);
      const result = await adapter.detect();
      expect(result.installed).toBe(false);
      expect(result.supportsSteer).toBe(false);
    });
  });

  describe('listModels()', () => {
    it('parses `pi --list-models` stdout into id/name pairs', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/pi');
      const models = adapter.listModels();

      await flush();
      currentChild?.stdout.write('openai/gpt-4o\nanthropic/sonnet\n\n');
      currentChild?.emitClose(0);

      expect(await models).toEqual([
        { id: 'openai/gpt-4o', name: 'openai/gpt-4o' },
        { id: 'anthropic/sonnet', name: 'anthropic/sonnet' },
      ]);
      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg).toEqual(['--list-models']);
    });

    it('returns an empty list when the probe produces no output', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/pi');
      const models = adapter.listModels();
      await flush();
      currentChild?.emitClose(0);
      expect(await models).toEqual([]);
    });
  });

  describe('runSdk() — argument construction', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('spawns --mode rpc with -a and NO positional prompt', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const [binaryArg, argsArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
      ];
      expect(binaryArg).toBe('pi');
      expect(argsArg.slice(0, 3)).toEqual(['--mode', 'rpc', '-a']);
      // Prompt travels over stdin now, not as a positional argument.
      expect(argsArg).not.toContain('Do the thing');
    });

    it('adds --model and --thinking when provided', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        model: 'openai/gpt-4o',
        reasoningEffort: 'high',
      });
      collect(handle);
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg[argsArg.indexOf('--model') + 1]).toBe('openai/gpt-4o');
      expect(argsArg[argsArg.indexOf('--thinking') + 1]).toBe('high');
    });

    it('adds --session when resuming a session', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        resumeSessionId: 'sess-uuid',
      });
      collect(handle);
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg[argsArg.indexOf('--session') + 1]).toBe('sess-uuid');
    });

    it('still passes -a and adds no approval flag when autoApprove is false', async () => {
      // Pi has no tool-approval gate — autoApprove:false is a documented no-op.
      const handle = await adapter.runSdk({
        ...baseOptions,
        autoApprove: false,
      });
      collect(handle);
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg).toContain('-a');
      expect(argsArg).not.toContain('--no-approve');
    });

    it('ignores mcpPort (Pi has no MCP support)', async () => {
      const handle = await adapter.runSdk({ ...baseOptions, mcpPort: 51820 });
      collect(handle);
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg.join(' ')).not.toContain('51820');
    });

    it('passes binaryPath through to spawnCli when provided', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        binaryPath: 'C:/pi/bin/pi.exe',
      });
      collect(handle);
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const [binaryArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(binaryArg).toBe('C:/pi/bin/pi.exe');
    });
  });

  describe('runSdk() — stdin channel', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('writes the initial prompt then a get_state request, keeping stdin open', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      const requests = writtenRequests(currentChild!);
      expect(requests[0]).toEqual({
        type: 'prompt',
        message: 'Do the thing',
        id: 'p1',
      });
      expect(requests[1]).toEqual({ type: 'get_state', id: 's0' });
      // Persistent channel — stdin.end() must NOT be called.
      expect(currentChild?.child.stdin.end).not.toHaveBeenCalled();

      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;
    });
  });

  describe('runSdk() — session id capture', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('captures the session id from the session header line', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'session',
          version: 3,
          id: 'uuid-123',
          cwd: '/proj',
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      expect(handle.getSessionId?.()).toBe('uuid-123');
      // Session header produces no segment.
      expect(segments).toHaveLength(0);
    });

    it('captures the session id from a get_state response', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'response',
          command: 'get_state',
          success: true,
          id: 's0',
          data: { sessionId: 'uuid-gs', sessionFile: '/sessions/uuid-gs.json' },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      expect(handle.getSessionId?.()).toBe('uuid-gs');
      expect(handle.supportsContinuation?.()).toBe(true);
    });
  });

  describe('runSdk() — JSONL → segment mapping', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('maps text_delta message_update events to text segments', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { output, segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'message_update',
          message: {},
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Hello',
          },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const text = segments.filter((s) => s.type === 'text');
      expect(text).toHaveLength(1);
      expect(text[0].content).toBe('Hello');
      expect(output.join('')).toContain('Hello');
    });

    it('maps thinking_delta message_update events to thinking segments', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'thinking_delta',
            contentIndex: 0,
            delta: 'Let me think',
          },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const thinking = segments.filter((s) => s.type === 'thinking');
      expect(thinking).toHaveLength(1);
      expect(thinking[0].content).toBe('Let me think');
    });

    it('maps tool_execution_start to a tool-call segment', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool_execution_start',
          toolCallId: 'tc-1',
          toolName: 'read_file',
          args: { path: '/proj/a.ts' },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const call = segments.find((s) => s.type === 'tool-call');
      expect(call?.toolName).toBe('read_file');
      expect(call?.toolCallId).toBe('tc-1');
      expect(call?.toolArgs).toBe(JSON.stringify({ path: '/proj/a.ts' }));
    });

    it('maps a successful tool_execution_end to a tool-result segment', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'tc-1',
          toolName: 'read_file',
          result: 'file contents',
          isError: false,
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const resultSeg = segments.find((s) => s.type === 'tool-result');
      expect(resultSeg?.content).toBe('file contents');
      expect(resultSeg?.toolCallId).toBe('tc-1');
    });

    it('maps a failed tool_execution_end to a tool-result-error segment', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'tc-2',
          toolName: 'run',
          result: { message: 'boom' },
          isError: true,
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const errSeg = segments.find((s) => s.type === 'tool-result-error');
      expect(errSeg?.content).toBe(JSON.stringify({ message: 'boom' }));
      expect(errSeg?.toolCallId).toBe('tc-2');
    });

    it('does NOT settle on agent_end with willRetry (waits for agent_settled)', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      let resolved = false;
      handle.done.then(() => {
        resolved = true;
      });

      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_end', willRetry: true }) + '\n',
      );
      await flush();
      expect(resolved).toBe(false);
      expect(currentChild?.killed).toBe(false);

      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;
      expect(resolved).toBe(true);
    });

    it('skips non-JSON lines defensively', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write('welcome banner text\n');
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      expect(segments).toHaveLength(0);
    });

    it('emits an error segment for stderr and a non-zero exit', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stderr.write('fatal: authentication failed\n');
      currentChild?.emitClose(1);
      await handle.done;

      const errors = segments.filter((s) => s.type === 'error');
      expect(
        errors.some((e) => e.content.includes('authentication failed')),
      ).toBe(true);
      expect(errors.some((e) => e.content.includes('exited with code 1'))).toBe(
        true,
      );
    });
  });

  describe('runSdk() — settle / steer / continue / abort lifecycle', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('resolves done and kills the child on agent_settled', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      const code = await handle.done;

      expect(code).toBe(0);
      expect(mockKillProcessTree).toHaveBeenCalledWith(currentChild?.pid);
      // Teardown writes a best-effort abort envelope before killing.
      const requests = writtenRequests(currentChild!);
      expect(requests.some((r) => r['type'] === 'abort')).toBe(true);
    });

    it('steer() writes a steer envelope to the live child stdin', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      handle.steer?.('also handle errors');
      const requests = writtenRequests(currentChild!);
      expect(requests).toContainEqual({
        type: 'steer',
        message: 'also handle errors',
      });

      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;
    });

    it('continue() re-spawns with --session and re-points steering to the new child', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      // First turn: capture a session id, then settle.
      currentChild?.stdout.write(
        JSON.stringify({ type: 'session', version: 3, id: 'sess-1' }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await handle.done;

      const firstChild = spawnedChildren[0];
      expect(mockKillProcessTree).toHaveBeenCalledWith(firstChild.pid);

      // Continue: re-spawns with --session <captured id>.
      const outcome = await handle.continue!('now add tests');
      const secondChild = spawnedChildren[1];
      expect(secondChild).toBeDefined();

      const [, secondArgs] = mockSpawnCli.mock.calls[1] as [string, string[]];
      expect(secondArgs[secondArgs.indexOf('--session') + 1]).toBe('sess-1');

      const secondRequests = writtenRequests(secondChild);
      expect(secondRequests[0]).toEqual({
        type: 'prompt',
        message: 'now add tests',
        id: 'p1',
      });

      // Steering now targets the NEW child.
      handle.steer?.('and lint');
      expect(
        writtenRequests(secondChild).some(
          (r) => r['type'] === 'steer' && r['message'] === 'and lint',
        ),
      ).toBe(true);

      secondChild.stdout.write(
        JSON.stringify({ type: 'agent_settled' }) + '\n',
      );
      await outcome.done;
      expect(mockKillProcessTree).toHaveBeenCalledWith(secondChild.pid);
    });

    it('writes an abort envelope and kills the child on abort', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      handle.abort.abort();
      currentChild?.emitClose(null, 'SIGTERM');
      const code = await handle.done;

      expect(mockKillProcessTree).toHaveBeenCalledWith(currentChild?.pid);
      const requests = writtenRequests(currentChild!);
      expect(requests.some((r) => r['type'] === 'abort')).toBe(true);
      expect(code).toBe(1);
    });
  });

  describe('ensureTokensFresh()', () => {
    it('returns true when auth.json has a provider entry', async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ anthropic: { type: 'api_key', key: 'sk-ant' } }),
      );
      expect(await adapter.ensureTokensFresh()).toBe(true);
    });

    it('falls back to an env var when auth.json is missing', async () => {
      mockReadFile.mockRejectedValue(new Error('missing'));
      const prev = process.env['ANTHROPIC_API_KEY'];
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-env';
      try {
        expect(await adapter.ensureTokensFresh()).toBe(true);
      } finally {
        if (prev === undefined) delete process.env['ANTHROPIC_API_KEY'];
        else process.env['ANTHROPIC_API_KEY'] = prev;
      }
    });

    it('returns false when neither auth.json nor env keys are present', async () => {
      mockReadFile.mockRejectedValue(new Error('missing'));
      const saved: Record<string, string | undefined> = {};
      const keys = [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'DEEPSEEK_API_KEY',
        'GEMINI_API_KEY',
        'MISTRAL_API_KEY',
        'GROQ_API_KEY',
        'XAI_API_KEY',
        'OPENROUTER_API_KEY',
      ];
      for (const k of keys) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
      try {
        expect(await adapter.ensureTokensFresh()).toBe(false);
      } finally {
        for (const k of keys) {
          if (saved[k] !== undefined) process.env[k] = saved[k];
        }
      }
    });
  });

  describe('supportsSteer() / parseOutput() / supportsMcp', () => {
    it('reports supportsSteer() true and supportsMcp false', () => {
      expect(adapter.supportsSteer()).toBe(true);
      expect(adapter.supportsMcp).toBe(false);
    });

    it('strips ANSI escape codes', () => {
      expect(adapter.parseOutput('\x1b[32mok\x1b[0m')).toBe('ok');
    });
  });
});
