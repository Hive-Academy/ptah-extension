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
/** Receives the `run --help` probes, so `mockSpawnCli` sees only real spawns. */
const mockHelpProbe = jest.fn();
const mockResolveCliPath = jest.fn();
const mockProbeCliVersion = jest.fn();
const mockKillProcessTree = jest.fn();

/** `opencode run --help` flag lines as printed by opencode 2.0.12. */
const V2_RUN_HELP = [
  '  --standalone            Run with a private server instead of the background service',
  '  --print-logs            Print logs to stderr (server logs require --standalone)',
].join('\n');

/** A probe child that prints `stdout`, then closes with `code`. */
function helpProbeChild(stdout: string, code = 0): FakeChildControls['child'] {
  const fake = createFakeChild();
  setImmediate(() => {
    fake.stdout.write(stdout);
    setImmediate(() => fake.emitClose(code));
  });
  return fake.child;
}

jest.mock('./cli-adapter.utils', () => {
  const actual = jest.requireActual<typeof import('./cli-adapter.utils')>(
    './cli-adapter.utils',
  );
  return {
    ...actual,
    spawnCli: (...args: unknown[]) =>
      (args[1] as string[]).includes('--help')
        ? mockHelpProbe(...args)
        : mockSpawnCli(...args),
    resolveCliPath: (...args: unknown[]) => mockResolveCliPath(...args),
    probeCliVersion: (...args: unknown[]) => mockProbeCliVersion(...args),
  };
});

jest.mock('@ptah-extension/platform-core', () => {
  const actual = jest.requireActual<
    typeof import('@ptah-extension/platform-core')
  >('@ptah-extension/platform-core');
  return {
    ...actual,
    killProcessTree: (...args: unknown[]) => mockKillProcessTree(...args),
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

import path from 'path';
import {
  OpencodeCliAdapter,
  resolveOpencodeNativeBinary,
} from './opencode-cli.adapter';
import type { CliCommandOptions, SdkHandle } from './cli-adapter.interface';
import type {
  AgentRoleDefinition,
  CliOutputSegment,
} from '@ptah-extension/shared';
import { buildTaskPrompt, renderRoleBlock } from './cli-adapter.utils';

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
    mockHelpProbe.mockImplementation(() => helpProbeChild(V2_RUN_HELP));
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
      expect(result.messagingMode).toBe('none');
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
      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg).toEqual(['models']);
    });

    it('retries once and returns parsed model list when a cold first probe exits 0 with empty stdout', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const modelsPromise = adapter.listModels();

      // First probe: cold background service starts, exits 0 with empty stdout.
      await flush();
      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      currentChild?.emitClose(0);

      // Second probe: warm server answers with model list.
      await flush();
      expect(mockSpawnCli).toHaveBeenCalledTimes(2);
      currentChild?.stdout.write('anthropic/claude-sonnet-4-5\nopenai/gpt-4o\n');
      currentChild?.emitClose(0);

      const models = await modelsPromise;
      expect(models).toEqual([
        {
          id: 'anthropic/claude-sonnet-4-5',
          name: 'anthropic/claude-sonnet-4-5',
        },
        { id: 'openai/gpt-4o', name: 'openai/gpt-4o' },
      ]);
    });

    it('returns an empty list when two consecutive probes produce no output without looping', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const modelsPromise = adapter.listModels();

      // First probe: exit 0, empty stdout
      await flush();
      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      currentChild?.emitClose(0);

      // Second probe: exit 0, empty stdout
      await flush();
      expect(mockSpawnCli).toHaveBeenCalledTimes(2);
      currentChild?.emitClose(0);

      const models = await modelsPromise;
      expect(models).toEqual([]);
      expect(mockSpawnCli).toHaveBeenCalledTimes(2);
    });

    it.each([1, 2])('rejects partial stdout from failed attempt %i', async (attempt) => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const modelsPromise = adapter.listModels();

      await flush();
      if (attempt === 2) {
        currentChild?.emitClose(0);
        await flush();
      }
      currentChild?.stdout.write('anthropic/claude-sonnet-4-5\n');
      currentChild?.emitClose(1);

      expect(await modelsPromise).toEqual([]);
      expect(mockSpawnCli).toHaveBeenCalledTimes(attempt);
    });

    it('does not retry when the probe encounters a spawn error', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const modelsPromise = adapter.listModels();

      await flush();
      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      currentChild?.emitError(new Error('spawn ENOENT'));

      const models = await modelsPromise;
      expect(models).toEqual([]);
      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
    });

    it('does not retry when the probe exits with a non-zero code', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const modelsPromise = adapter.listModels();

      await flush();
      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      currentChild?.emitClose(1);

      const models = await modelsPromise;
      expect(models).toEqual([]);
      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
    });
  });

  describe('ensureTokensFresh()', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      // Clear any provider API keys that might be set in the ambient environment.
      for (const key of [
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'OPENROUTER_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'GEMINI_API_KEY',
        'GROQ_API_KEY',
        'MISTRAL_API_KEY',
        'DEEPSEEK_API_KEY',
        'XAI_API_KEY',
      ]) {
        delete process.env[key];
      }
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('returns true when opencode auth list reports stored credentials', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const freshPromise = adapter.ensureTokensFresh();

      await flush();
      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      const [, args] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(args).toEqual(['auth', 'list']);

      currentChild?.stdout.write('OpenCode  Default  stored\n');
      currentChild?.emitClose(0);

      const result = await freshPromise;
      expect(result).toBe(true);
    });

    it('returns false when opencode auth list reports no authenticated integrations', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const freshPromise = adapter.ensureTokensFresh();

      await flush();
      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      currentChild?.stdout.write('No authenticated integrations\n');
      currentChild?.emitClose(0);

      const result = await freshPromise;
      expect(result).toBe(false);
    });

    it('returns true when auth list reports no authenticated integrations but a provider env var is present', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'sk-ant-test-key';
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const freshPromise = adapter.ensureTokensFresh();

      await flush();
      currentChild?.stdout.write('No authenticated integrations\n');
      currentChild?.emitClose(0);

      const result = await freshPromise;
      expect(result).toBe(true);
    });

    it('returns false when auth list fails and no provider env var is present', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      const freshPromise = adapter.ensureTokensFresh();

      await flush();
      currentChild?.emitError(new Error('spawn error'));

      const result = await freshPromise;
      expect(result).toBe(false);
    });
  });

  describe('runSdk() — argument construction', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    it('spawns run --format json with --auto and the prompt LAST', async () => {
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
      expect(argsArg[argsArg.length - 1]).toContain('Do the thing');
    });

    /**
     * `opencode run` has no working-directory flag. Passing `--dir` made
     * opencode 2.0.11 exit 1 with `Unrecognized flag: --dir in command
     * opencode run` before producing a single line of output, so every lane
     * failed at spawn. The directory travels as the spawn's `cwd` instead,
     * which `run` honours.
     */
    it('passes the working directory as cwd and never as a --dir flag', async () => {
      const handle = await adapter.runSdk(baseOptions);
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      const [, argsArg, spawnOptions] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        { cwd?: string },
      ];
      expect(argsArg).not.toContain('--dir');
      expect(spawnOptions.cwd).toBe('/proj');
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

  /**
   * opencode 2.x `run` attaches to a shared background service unless it gets
   * `--standalone`, and that service never sees OPENCODE_CONFIG_CONTENT — the
   * lane then has no Ptah MCP tools. 1.x has no such flag, and 2.x exits 1 on
   * an unknown flag, so the flag follows what `run --help` lists.
   */
  describe('runSdk() — --standalone', () => {
    const baseOptions = { task: 'Do the thing', workingDirectory: '/proj' };

    async function runArgs(
      options: CliCommandOptions = baseOptions,
    ): Promise<string[]> {
      const handle = await adapter.runSdk(options);
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;
      const calls = mockSpawnCli.mock.calls;
      return calls[calls.length - 1][1] as string[];
    }

    it('passes --standalone before the prompt when run --help lists it', async () => {
      const args = await runArgs({ ...baseOptions, mcpPort: 51820 });

      expect(mockHelpProbe).toHaveBeenCalledWith('opencode', ['run', '--help'], {
        spawner: undefined,
      });
      expect(args).toContain('--standalone');
      expect(args.indexOf('--standalone')).toBeLessThan(args.length - 1);
      expect(args[args.length - 1]).toContain('Do the thing');
    });

    it('omits --standalone when run --help does not list it (opencode 1.x)', async () => {
      mockHelpProbe.mockImplementation(() =>
        helpProbeChild('  --print-logs  Print logs to stderr\n'),
      );

      expect(await runArgs()).not.toContain('--standalone');
    });

    it('omits --standalone and says so when the help probe exits non-zero', async () => {
      mockHelpProbe.mockImplementationOnce(() =>
        helpProbeChild(V2_RUN_HELP, 1),
      );

      const handle = await adapter.runSdk(baseOptions);
      const { segments } = collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      expect(mockSpawnCli.mock.calls[0][1]).not.toContain('--standalone');
      expect(
        segments.some(
          (s) => s.type === 'info' && s.content.includes('--standalone'),
        ),
      ).toBe(true);
      // A non-zero exit is not an answer, so the next run probes again.
      expect(await runArgs()).toContain('--standalone');
      expect(mockHelpProbe).toHaveBeenCalledTimes(2);
    });

    it('probes once per binary across runs, including concurrent ones', async () => {
      const [first, second] = await Promise.all([
        adapter.runSdk(baseOptions),
        adapter.runSdk(baseOptions),
      ]);
      collect(first);
      collect(second);
      await runArgs();

      expect(mockHelpProbe).toHaveBeenCalledTimes(1);
      for (const call of mockSpawnCli.mock.calls) {
        expect(call[1]).toContain('--standalone');
      }
    });

    it('probes again after a failed probe spawn', async () => {
      mockHelpProbe.mockImplementationOnce(() => {
        const fake = createFakeChild();
        setImmediate(() => fake.emitError(new Error('ENOENT')));
        return fake.child;
      });

      expect(await runArgs()).not.toContain('--standalone');
      expect(await runArgs()).toContain('--standalone');
      expect(mockHelpProbe).toHaveBeenCalledTimes(2);
    });

    it('probes again when the probe spawn throws', async () => {
      mockHelpProbe.mockImplementationOnce(() => {
        throw new Error('spawn EPERM');
      });

      expect(await runArgs()).not.toContain('--standalone');
      expect(await runArgs()).toContain('--standalone');
    });

    it('does not reuse a cached answer after detect() (CLI upgrade)', async () => {
      mockHelpProbe.mockImplementationOnce(() =>
        helpProbeChild('  --print-logs  Print logs to stderr\n'),
      );
      expect(await runArgs()).not.toContain('--standalone');

      mockResolveCliPath.mockResolvedValue('/usr/local/bin/opencode');
      mockProbeCliVersion.mockResolvedValue('2.0.12');
      await adapter.detect();

      expect(await runArgs()).toContain('--standalone');
      expect(mockHelpProbe).toHaveBeenCalledTimes(2);
    });
  });

  describe('runSdk() — role delivery (task-prompt)', () => {
    const role: AgentRoleDefinition = {
      name: 'reviewer',
      body: 'Review the diff before approving.',
      sourcePath: '/proj/.claude/agents/reviewer.md',
      bytes: 33,
    };
    const baseOptions = {
      task: 'Do the thing',
      workingDirectory: '/proj',
      systemPrompt: 'HARNESS CONTEXT',
      model: 'anthropic/claude-sonnet-4-5',
      mcpPort: 51820,
    };

    async function spawnOnce(options: CliCommandOptions): Promise<void> {
      const handle = await adapter.runSdk(options);
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;
    }

    it('declares the task-prompt channel', () => {
      expect(adapter.roleChannel).toBe('task-prompt');
    });

    it('puts the role block in the trailing positional prompt', async () => {
      await spawnOnce({ ...baseOptions, role });

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      const prompt = argsArg[argsArg.length - 1];
      expect(prompt).toBe(
        buildTaskPrompt({ ...baseOptions, role }, 'opencode'),
      );
      expect(prompt).toContain(renderRoleBlock(role, 'opencode'));
    });

    it('keeps OPENCODE_CONFIG_CONTENT and every other argument unchanged', async () => {
      await spawnOnce(baseOptions);
      await spawnOnce({ ...baseOptions, role });

      const [, roleless, rolelessOpts] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        { env?: NodeJS.ProcessEnv },
      ];
      const [, withRole, withRoleOpts] = mockSpawnCli.mock.calls[1] as [
        string,
        string[],
        { env?: NodeJS.ProcessEnv },
      ];
      expect(withRole.slice(0, -1)).toEqual(roleless.slice(0, -1));
      expect(withRoleOpts.env).toEqual(rolelessOpts.env);
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
      expect(info[0].usage).toEqual({ inputTokens: 671, outputTokens: 8 });
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

  describe('runSdk() — MCP config', () => {
    /** Read the env passed to spawnCli's options (3rd positional arg). */
    function spawnEnv(): NodeJS.ProcessEnv | undefined {
      const call = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        { env?: NodeJS.ProcessEnv },
      ];
      return call?.[2]?.env;
    }

    it('passes the mcp.ptah config via the OPENCODE_CONFIG_CONTENT env at spawn', async () => {
      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
        mcpPort: 51820,
      });
      collect(handle);

      // MCP is configured per-process via an env var — opencode deep-merges it
      // on top of the untouched shared project config, so nothing is written to
      // disk (no opencode.json race between concurrent agents).
      expect(mockWriteFile).not.toHaveBeenCalled();
      const content = spawnEnv()?.['OPENCODE_CONFIG_CONTENT'];
      expect(content).toBeDefined();
      const parsed = JSON.parse(content as string) as {
        mcp: { ptah: { type: string; url: string; enabled: boolean } };
      };
      // The URL carries the spawn's working directory (TASK_2026_364).
      expect(parsed.mcp.ptah).toEqual({
        type: 'remote',
        url: 'http://localhost:51820/workspace/%2Fproj',
        enabled: true,
      });

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('leads the MCP URL with /agent/{id} when one was reserved', async () => {
      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
        mcpPort: 51820,
        agentId: 'agent-7',
      });
      collect(handle);

      const content = spawnEnv()?.['OPENCODE_CONFIG_CONTENT'];
      const parsed = JSON.parse(content as string) as {
        mcp: { ptah: { url: string } };
      };
      // The agent segment is how the server learns WHICH spawn is calling
      // (TASK_2026_402) — the child never names itself.
      expect(parsed.mcp.ptah.url).toBe(
        'http://localhost:51820/agent/agent-7/workspace/%2Fproj',
      );

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('does not set OPENCODE_CONFIG_CONTENT when no mcpPort is provided', async () => {
      const handle = await adapter.runSdk({
        task: 'X',
        workingDirectory: '/proj',
      });
      collect(handle);
      currentChild?.emitClose(0);
      await handle.done;

      expect(spawnEnv()?.['OPENCODE_CONFIG_CONTENT']).toBeUndefined();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });

  // A module-resolved candidate can land inside `app.asar` in a packaged
  // Electron build. existsSync passes through the asar shim there, but the file
  // cannot be spawned — so every such candidate needs its `app.asar.unpacked`
  // twin probed alongside it, exactly as the Codex adapter does.
  describe('resolveOpencodeNativeBinary() — asar-unpacked twins', () => {
    const ASAR_PKG_JSON = path.join(
      path.sep,
      'ptah-app',
      'resources',
      'app.asar',
      'node_modules',
      'opencode-windows-x64',
      'package.json',
    );
    const asarCandidate = path.join(
      path.dirname(ASAR_PKG_JSON),
      'bin',
      'opencode.exe',
    );
    const unpackedCandidate = asarCandidate.replace(
      'app.asar',
      'app.asar.unpacked',
    );

    const originalPlatform = process.platform;
    const originalArch = process.arch;
    const originalAppData = process.env['APPDATA'];
    const appData = path.join(path.sep, 'test-appdata');
    const detectedCliPath = path.join(path.sep, 'detected-install', 'opencode.cmd');
    const relFromBin = path.join(
      'node_modules',
      'opencode-windows-x64',
      'bin',
      'opencode.exe',
    );
    const detectedCandidate = path.join(path.dirname(detectedCliPath), relFromBin);
    const nestedDetectedCandidate = path.join(
      path.dirname(detectedCliPath),
      'node_modules',
      'opencode-ai',
      relFromBin,
    );
    const appDataCandidate = path.join(appData, 'npm', relFromBin);

    function stub(key: 'platform' | 'arch', value: string): void {
      Object.defineProperty(process, key, { value, configurable: true });
    }

    /** Stands in for require.resolve, which can never yield an asar path here. */
    const resolveModulePath = (request: string): string => {
      if (request === 'opencode-windows-x64/package.json') return ASAR_PKG_JSON;
      throw new Error(`Cannot find module '${request}'`);
    };

    beforeEach(() => {
      stub('platform', 'win32');
      stub('arch', 'x64');
      process.env['APPDATA'] = appData;
    });

    afterEach(() => {
      stub('platform', originalPlatform);
      stub('arch', originalArch);
      if (originalAppData === undefined) {
        delete process.env['APPDATA'];
      } else {
        process.env['APPDATA'] = originalAppData;
      }
    });

    it.each([
      ['its own directory', detectedCandidate],
      ['nested opencode-ai', nestedDetectedCandidate],
    ])(
      'prefers the detected-path candidate in %s over module-resolved and APPDATA candidates',
      (_layout, candidate) => {
        mockExistsSync.mockImplementation(
          (p: string) =>
            p === candidate || p === asarCandidate || p === appDataCandidate,
        );

        expect(
          resolveOpencodeNativeBinary(detectedCliPath, resolveModulePath),
        ).toBe(candidate);
      },
    );

    it.each([
      ['module-resolved', asarCandidate],
      ['APPDATA', appDataCandidate],
    ])(
      'falls back to %s when no detected-path candidate exists',
      (_source, candidate) => {
        mockExistsSync.mockImplementation((p: string) => p === candidate);

        expect(
          resolveOpencodeNativeBinary(detectedCliPath, resolveModulePath),
        ).toBe(candidate);
      },
    );

    it('probes the app.asar.unpacked twin right after the asar candidate', () => {
      mockExistsSync.mockReturnValue(false);

      expect(
        resolveOpencodeNativeBinary(undefined, resolveModulePath),
      ).toBeUndefined();

      const probed = mockExistsSync.mock.calls.map((c) => c[0] as string);
      expect(probed).toContain(asarCandidate);
      expect(probed.indexOf(unpackedCandidate)).toBe(
        probed.indexOf(asarCandidate) + 1,
      );
    });

    it('resolves the unpacked twin when only it exists on disk', () => {
      mockExistsSync.mockImplementation((p: string) => p === unpackedCandidate);

      expect(resolveOpencodeNativeBinary(undefined, resolveModulePath)).toBe(
        unpackedCandidate,
      );
    });
  });

  describe('capabilities() / parseOutput() / supportsMcp', () => {
    it('reports no messaging capability and supportsMcp true', () => {
      expect(adapter.capabilities()).toEqual({
        steer: false,
        interrupt: false,
        continuation: false,
      });
      expect(adapter.supportsMcp).toBe(true);
    });

    it('strips ANSI escape codes', () => {
      expect(adapter.parseOutput('\x1b[32mok\x1b[0m')).toBe('ok');
    });
  });
});
