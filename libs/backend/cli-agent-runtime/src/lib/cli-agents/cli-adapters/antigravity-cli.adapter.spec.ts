/**
 * AntigravityCliAdapter Unit Tests
 *
 * The adapter spawns the `agy` binary in print mode with
 * `--output-format stream-json` and parses the resulting JSONL event stream.
 * Tests mock cli-adapter.utils (spawnCli / resolveCliPath / probeCliVersion)
 * and fs so no real `agy` process or disk write happens.
 * Covers: detect() (installed/not), listModels() parsing of `agy models`,
 * runSdk() arg construction (stream-json/print/model/effort/skip-permissions/
 * conversation/add-dir), the stream-json → segment mapping, the non-JSON
 * fallback, and session-id capture from the `init` event.
 *
 * Every stream-json fixture below is copied from output captured by running the
 * real binary (agy 1.1.11) — see `.ptah/specs/TASK_2026_199/stream-json-capture.md`.
 */
// The adapter reaches the MCP facet through the `harness-sync` barrel, which
// pulls in `vscode-core`'s tsyringe decorators. Same reason the other DI-touching
// specs in this lib import it first.
import 'reflect-metadata';
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
    whenSpawned: Promise<number | null>;
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
    whenSpawned: Promise<number | null>;
  };
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.stdin = { end: jest.fn(), write: jest.fn() };
  emitter.pid = FAKE_PID;
  emitter.whenSpawned = Promise.resolve(FAKE_PID);
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

    it('spawns print mode with stream-json, skip-permissions and the prompt LAST', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [binaryArg, argsArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
      ];
      expect(binaryArg).toBe('agy');
      expect(argsArg[argsArg.indexOf('--output-format') + 1]).toBe(
        'stream-json',
      );
      expect(argsArg).toContain('--dangerously-skip-permissions');
      expect(argsArg).toContain('--add-dir');
      expect(argsArg[argsArg.indexOf('--add-dir') + 1]).toBe('/proj');
      // --print is the LAST flag and its value is the built task prompt.
      expect(argsArg[argsArg.length - 2]).toBe('--print');
      expect(argsArg[argsArg.length - 1]).toContain('Do the thing');
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

    it('adds --effort for a value agy accepts', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        reasoningEffort: 'high',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg[argsArg.indexOf('--effort') + 1]).toBe('high');
    });

    it('drops --effort for a value agy does not accept', async () => {
      const handle = await adapter.runSdk({
        ...baseOptions,
        reasoningEffort: 'xhigh',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg).not.toContain('--effort');
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

  describe('runSdk() — stream-json → segment parsing', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };
    const CONV_ID = '917bf234-79d8-496b-88b0-c3d7e376d066';

    /** `init` line as emitted by agy 1.1.11 (tool list truncated). */
    const initLine = JSON.stringify({
      event: 'init',
      conversation_id: CONV_ID,
      init: {
        cwd: 'D:\\projects\\ptah-extension',
        tools: ['list_dir', 'view_file', 'run_command'],
        permission_mode: 'always-proceed',
      },
    });

    const stepLine = (step: Record<string, unknown>): string =>
      JSON.stringify({
        event: 'step_update',
        step_update: { conversation_id: CONV_ID, ...step },
      });

    it('maps a tool step to a tool-call then a tool-result', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(initLine + '\n');
      currentChild?.stdout.write(
        stepLine({
          step_index: 3,
          state: 'ACTIVE',
          step_type: 'tool',
          tool_name: 'list_dir',
          tool_info: {
            name: 'list_dir',
            parameters: { DirectoryPath: 'D:\\projects\\ptah-extension' },
          },
        }) + '\n',
      );
      currentChild?.stdout.write(
        stepLine({
          step_index: 3,
          state: 'DONE',
          step_type: 'tool',
          tool_name: 'list_dir',
          duration_seconds: 0.2881932,
          tool_info: {
            name: 'list_dir',
            parameters: { DirectoryPath: 'D:\\projects\\ptah-extension' },
            output: 'apps/\nlibs/\npackage.json',
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const call = segments.find((s) => s.type === 'tool-call');
      const result = segments.find((s) => s.type === 'tool-result');
      expect(call).toMatchObject({
        toolName: 'list_dir',
        toolCallId: '3',
        toolInput: { DirectoryPath: 'D:\\projects\\ptah-extension' },
      });
      expect(result).toMatchObject({
        toolName: 'list_dir',
        toolCallId: '3',
        content: 'apps/\nlibs/\npackage.json',
      });
    });

    it('emits incremental agent_response text_deltas as text segments', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { output, segments } = collect(handle);

      currentChild?.stdout.write(initLine + '\n');
      currentChild?.stdout.write(
        stepLine({
          step_index: 5,
          state: 'ACTIVE',
          step_type: 'agent_response',
          text_delta: 'Here are the files ',
        }) + '\n',
      );
      currentChild?.stdout.write(
        stepLine({
          step_index: 5,
          state: 'DONE',
          step_type: 'agent_response',
          text_delta: 'in the repo root.\n',
          duration_seconds: 4.43,
          usage: { input_tokens: 5112, output_tokens: 2390 },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const text = segments.filter((s) => s.type === 'text');
      expect(text.map((s) => s.content)).toEqual([
        'Here are the files ',
        'in the repo root.\n',
      ]);
      expect(output.join('')).toContain('Here are the files in the repo root.');
    });

    it('produces no segment for structural steps', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(initLine + '\n');
      currentChild?.stdout.write(
        stepLine({ step_index: 0, state: 'DONE', step_type: 'user_input' }) +
          '\n',
      );
      currentChild?.stdout.write(
        stepLine({
          step_index: 1,
          state: 'DONE',
          step_type: 'unknown',
          duration_seconds: 0.0009982,
        }) + '\n',
      );
      currentChild?.stdout.write(
        stepLine({
          step_index: 4,
          state: 'DONE',
          step_type: 'checkpoint',
          usage: { input_tokens: 103, output_tokens: 4 },
        }) + '\n',
      );
      // An agent_response that only produced thinking carries usage but no
      // text_delta — agy never streams reasoning text, so nothing is emitted.
      currentChild?.stdout.write(
        stepLine({
          step_index: 2,
          state: 'DONE',
          step_type: 'agent_response',
          usage: { output_tokens: 168, thinking_tokens: 125 },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(segments).toHaveLength(0);
    });

    it('emits a usage info segment on a SUCCESS result without repeating the response', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(initLine + '\n');
      currentChild?.stdout.write(
        JSON.stringify({
          event: 'result',
          result: {
            conversation_id: CONV_ID,
            status: 'SUCCESS',
            response: 'Here are the files in the repo root.',
            duration_seconds: 6.72,
            num_turns: 1,
            usage: { input_tokens: 25269, output_tokens: 2562 },
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(segments).toEqual([
        { type: 'info', content: 'Usage: 25269 input, 2562 output tokens' },
      ]);
    });

    it('emits an error segment for a non-SUCCESS result', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          event: 'result',
          result: {
            conversation_id: CONV_ID,
            status: 'ERROR',
            response: 'model quota exceeded',
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const errors = segments.filter((s) => s.type === 'error');
      expect(errors[0].content).toBe('ERROR: model quota exceeded');
    });

    it('falls back to verbatim text for a line that is not JSON', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { output, segments } = collect(handle);

      currentChild?.stdout.write('Warning: update available\n');
      currentChild?.stdout.write('{"event":"step_update",\n'); // truncated JSON
      currentChild?.emitClose(0);
      await handle.done;

      const text = segments.filter((s) => s.type === 'text');
      expect(text.map((s) => s.content)).toEqual([
        'Warning: update available',
        '{"event":"step_update",',
      ]);
      expect(output.join('')).toContain('Warning: update available');
    });

    it('surfaces an unrecognized event name as info rather than dropping it', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({ event: 'future_event', payload: 1 }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(segments).toEqual([
        {
          type: 'info',
          content: '{"event":"future_event","payload":1}',
        },
      ]);
    });

    it('flushes a trailing partial line on close', async () => {
      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);

      currentChild?.stdout.write(
        stepLine({
          step_index: 5,
          state: 'DONE',
          step_type: 'agent_response',
          text_delta: 'Final answer',
        }),
      );
      currentChild?.emitClose(0);
      await handle.done;

      const text = segments.filter((s) => s.type === 'text');
      expect(text).toHaveLength(1);
      expect(text[0].content).toBe('Final answer');
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

    it('tree-kills with the pid whenSpawned reports, not the synchronous one', async () => {
      // Off-thread the child is created on a worker, so `pid` is still
      // undefined when abort fires. The tree kill has to read `whenSpawned`
      // instead, or the whole subtree is orphaned (TASK_2026_367).
      const OFF_THREAD_PID = 7777;
      mockSpawnCli.mockImplementationOnce(() => {
        currentChild = createFakeChild();
        const child = currentChild.child as unknown as {
          pid: number | undefined;
          whenSpawned: Promise<number | null>;
        };
        child.pid = undefined;
        child.whenSpawned = Promise.resolve(OFF_THREAD_PID);
        return currentChild.child;
      });

      const handle = await adapter.runSdk(baseOptions);
      collect(handle);

      handle.abort.abort();
      currentChild?.emitClose(null, 'SIGTERM');
      await handle.done;

      expect(mockKillProcessTree).toHaveBeenCalledWith(OFF_THREAD_PID);
    });
  });

  describe('runSdk() — session id capture', () => {
    const CONV_ID = '917bf234-79d8-496b-88b0-c3d7e376d066';

    it('captures the conversation id from the init event, mid-run', async () => {
      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
      });
      collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          event: 'init',
          conversation_id: CONV_ID,
          init: { cwd: '/proj', tools: [], permission_mode: 'always-proceed' },
        }) + '\n',
      );
      // Available before the process exits — no post-run mtime scan.
      expect(handle.getSessionId?.()).toBe(CONV_ID);

      currentChild?.emitClose(0);
      await handle.done;
      expect(handle.getSessionId?.()).toBe(CONV_ID);
    });

    it('falls back to the id on a step_update when init was missed', async () => {
      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
      });
      collect(handle);

      currentChild?.stdout.write(
        JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: CONV_ID,
            step_index: 0,
            state: 'DONE',
            step_type: 'user_input',
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(handle.getSessionId?.()).toBe(CONV_ID);
    });

    it('returns undefined when the stream carried no conversation id', async () => {
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
