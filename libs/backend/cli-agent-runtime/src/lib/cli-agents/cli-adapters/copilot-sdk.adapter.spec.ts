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
    kill: jest.Mock;
    killed: boolean;
    pid: number;
  };
  emitter.stdout = stdout;
  emitter.stderr = stderr;
  emitter.pid = FAKE_PID;
  emitter.killed = false;
  emitter.kill = jest.fn((_signal?: string) => {
    emitter.killed = true;
    return true;
  });

  const controls: FakeChildControls = {
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

jest.mock('child_process', () => ({
  execFile: jest.fn(),
  spawn: jest.fn(),
}));

import { CopilotSdkAdapter } from './copilot-sdk.adapter';
import { CopilotPermissionBridge } from './copilot-permission-bridge';

describe('CopilotSdkAdapter', () => {
  let adapter: CopilotSdkAdapter;
  let bridge: CopilotPermissionBridge;

  beforeEach(() => {
    jest.clearAllMocks();
    currentChild = null;

    mockSpawnCli.mockImplementation(() => {
      currentChild = createFakeChild();
      return currentChild.child;
    });

    bridge = new CopilotPermissionBridge();
    adapter = new CopilotSdkAdapter(bridge);
  });

  describe('detect()', () => {
    it('reports installed when resolveCliPath finds the binary', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/copilot');
      mockProbeCliVersion.mockResolvedValue('copilot 1.0.26');

      const result = await adapter.detect();

      expect(result.cli).toBe('copilot');
      expect(result.installed).toBe(true);
      expect(result.path).toBe('/usr/local/bin/copilot');
      expect(result.version).toBe('copilot 1.0.26');
      expect(result.supportsSteer).toBe(false);
    });

    it('forwards the resolved binary path to probeCliVersion', async () => {
      const cmdPath = 'C:\\Users\\dev\\AppData\\Roaming\\npm\\copilot.cmd';
      mockResolveCliPath.mockResolvedValue(cmdPath);
      mockProbeCliVersion.mockResolvedValue('copilot 1.0.26');

      const result = await adapter.detect();

      expect(mockProbeCliVersion).toHaveBeenCalledWith(cmdPath);
      expect(result.installed).toBe(true);
      expect(result.path).toBe(cmdPath);
    });

    it('reports not installed when resolveCliPath returns null', async () => {
      mockResolveCliPath.mockResolvedValue(null);

      const result = await adapter.detect();

      expect(result.cli).toBe('copilot');
      expect(result.installed).toBe(false);
      expect(result.supportsSteer).toBe(false);
      expect(mockProbeCliVersion).not.toHaveBeenCalled();
    });

    it('still reports installed when version probe returns undefined', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/copilot');
      mockProbeCliVersion.mockResolvedValue(undefined);

      const result = await adapter.detect();

      expect(result.installed).toBe(true);
      expect(result.version).toBeUndefined();
    });
  });

  describe('listModels() / supportsSteer() / parseOutput()', () => {
    it('returns the curated Copilot model list including claude-sonnet-4.5', async () => {
      const models = await adapter.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some((m) => m.id === 'claude-sonnet-4.5')).toBe(true);
    });

    it('reports supportsSteer() false', () => {
      expect(adapter.supportsSteer()).toBe(false);
    });

    it('strips ANSI escape codes via parseOutput()', () => {
      expect(adapter.parseOutput('\x1b[31mred\x1b[0m text')).toBe('red text');
    });
  });

  describe('runSdk() — binary missing', () => {
    it('returns a done=1 handle immediately when copilot binary cannot be resolved', async () => {
      mockResolveCliPath.mockResolvedValue(null);

      const handle = await adapter.runSdk({
        task: 'anything',
        workingDirectory: '/proj',
      });
      const output: string[] = [];
      handle.onOutput((d) => output.push(d));

      const code = await handle.done;
      expect(code).toBe(1);
      expect(output.join('')).toContain('copilot');
      expect(mockSpawnCli).not.toHaveBeenCalled();
    });
  });

  describe('runSdk() — spawn and streaming', () => {
    const defaultOptions = {
      task: 'Implement feature X',
      workingDirectory: '/proj',
    };

    beforeEach(() => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/copilot');
    });

    it('spawns copilot with --output-format json and -s flags', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {});

      expect(mockSpawnCli).toHaveBeenCalledTimes(1);
      const [binaryArg, argsArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        Record<string, unknown>,
      ];
      expect(binaryArg).toBe('/usr/local/bin/copilot');
      expect(argsArg).toContain('--output-format');
      expect(argsArg).toContain('json');
      expect(argsArg).toContain('--allow-all-tools');
      expect(argsArg).toContain('-s');

      currentChild?.emitClose(0);
      const code = await handle.done;
      expect(code).toBe(0);
    });

    it('passes binaryPath directly to spawnCli when provided', async () => {
      const handle = await adapter.runSdk({
        ...defaultOptions,
        binaryPath: 'C:\\Users\\dev\\AppData\\Roaming\\npm\\copilot.cmd',
      });
      handle.onOutput(() => {});

      const [binaryArg] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        Record<string, unknown>,
      ];
      expect(binaryArg).toBe(
        'C:\\Users\\dev\\AppData\\Roaming\\npm\\copilot.cmd',
      );

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('requests needsConsole:true for ConPTY compatibility', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {});

      const [, , opts] = mockSpawnCli.mock.calls[0] as [
        string,
        string[],
        { needsConsole?: boolean },
      ];
      expect(opts.needsConsole).toBe(true);

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('appends --resume=<id> when resumeSessionId is provided', async () => {
      const handle = await adapter.runSdk({
        ...defaultOptions,
        resumeSessionId: 'sess-prev-123',
      });
      handle.onOutput(() => {});

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      expect(argsArg.some((a) => a.startsWith('--resume='))).toBe(true);
      expect(argsArg.find((a) => a.startsWith('--resume='))).toBe(
        '--resume=sess-prev-123',
      );

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('appends --model when model option is provided', async () => {
      const handle = await adapter.runSdk({
        ...defaultOptions,
        model: 'claude-sonnet-4.5',
      });
      handle.onOutput(() => {});

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      const modelIdx = argsArg.indexOf('--model');
      expect(modelIdx).toBeGreaterThanOrEqual(0);
      expect(argsArg[modelIdx + 1]).toBe('claude-sonnet-4.5');

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('appends --additional-mcp-config when mcpPort is provided', async () => {
      const handle = await adapter.runSdk({
        ...defaultOptions,
        mcpPort: 51820,
      });
      handle.onOutput(() => {});

      const [, argsArg] = mockSpawnCli.mock.calls[0] as [string, string[]];
      const idx = argsArg.indexOf('--additional-mcp-config');
      expect(idx).toBeGreaterThanOrEqual(0);
      const mcpJson = argsArg[idx + 1];
      expect(mcpJson).toContain('51820');
      expect(mcpJson).toContain('ptah');

      currentChild?.emitClose(0);
      await handle.done;
    });

    it('streams assistant.message_delta events as text output and segments', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      const segments: Array<{ type: string; content: string }> = [];
      handle.onOutput((d) => output.push(d));
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, content: seg.content }),
      );

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'assistant.message_delta',
          data: { deltaContent: 'Hello ' },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'assistant.message_delta',
          data: { deltaContent: 'world' },
        }) + '\n',
      );
      currentChild?.emitClose(0);

      const code = await handle.done;
      expect(code).toBe(0);
      expect(output.join('')).toContain('Hello ');
      expect(output.join('')).toContain('world');
      const textSegs = segments.filter((s) => s.type === 'text');
      expect(textSegs.map((s) => s.content)).toEqual(['Hello ', 'world']);
    });

    it('skips assistant.message full content when deltas were already received', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((d) => output.push(d));

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'assistant.message_delta',
          data: { deltaContent: 'partial' },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'assistant.message',
          data: { content: 'full duplicate content' },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(output.join('')).not.toContain('full duplicate content');
    });

    it('emits assistant.message full content when no deltas were received', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((d) => output.push(d));

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'assistant.message',
          data: { content: 'full non-delta content' },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(output.join('')).toContain('full non-delta content');
    });

    it('emits thinking segments for assistant.reasoning_delta events', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const segments: Array<{ type: string; content: string }> = [];
      handle.onOutput(() => {});
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, content: seg.content }),
      );

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'assistant.reasoning_delta',
          data: { deltaContent: 'thinking...' },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(
        segments.some(
          (s) => s.type === 'thinking' && s.content === 'thinking...',
        ),
      ).toBe(true);
    });

    it('maps tool.execution_start into a tool-call segment', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      const segments: Array<{ type: string; toolName?: string }> = [];
      handle.onOutput((d) => output.push(d));
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, toolName: seg.toolName }),
      );

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool.execution_start',
          data: {
            toolName: 'read_file',
            arguments: { path: 'src/app.ts' },
            toolCallId: 'tc-1',
          },
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

    it('maps successful tool.execution_complete into a tool-result segment', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const segments: Array<{ type: string; content: string }> = [];
      handle.onOutput(() => {});
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, content: seg.content }),
      );

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool.execution_start',
          data: {
            toolName: 'read_file',
            arguments: { path: 'src/app.ts' },
            toolCallId: 'tc-1',
          },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool.execution_complete',
          data: {
            success: true,
            toolCallId: 'tc-1',
            result: { content: 'file contents here' },
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(
        segments.some(
          (s) =>
            s.type === 'tool-result' && /file contents here/.test(s.content),
        ),
      ).toBe(true);
    });

    it('maps shell tool.execution_complete into a command segment', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const segments: Array<{ type: string }> = [];
      handle.onOutput(() => {});
      handle.onSegment?.((seg) => segments.push({ type: seg.type }));

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool.execution_start',
          data: {
            toolName: 'run_shell_command',
            arguments: { command: 'ls -la' },
            toolCallId: 'tc-shell',
          },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool.execution_complete',
          data: {
            success: true,
            toolCallId: 'tc-shell',
            result: { content: 'file1.ts\nfile2.ts' },
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(segments.some((s) => s.type === 'command')).toBe(true);
    });

    it('maps failed tool.execution_complete into a tool-result-error segment', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const segments: Array<{ type: string; content: string }> = [];
      handle.onOutput(() => {});
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, content: seg.content }),
      );

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool.execution_start',
          data: {
            toolName: 'write_file',
            arguments: { path: '/readonly/file' },
            toolCallId: 'tc-err',
          },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'tool.execution_complete',
          data: {
            success: false,
            toolCallId: 'tc-err',
            error: { message: 'EACCES: permission denied' },
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(
        segments.some(
          (s) =>
            s.type === 'tool-result-error' &&
            /permission denied/.test(s.content),
        ),
      ).toBe(true);
    });

    it('emits an error segment for session.error events', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((d) => output.push(d));

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'session.error',
          data: { message: 'upstream Copilot API failure' },
        }) + '\n',
      );
      currentChild?.emitClose(1);

      const code = await handle.done;
      expect(code).toBe(1);
      expect(output.join('')).toContain('upstream Copilot API failure');
    });

    it('emits usage info from assistant.usage events', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((d) => output.push(d));

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'assistant.usage',
          data: {
            model: 'claude-sonnet-4.5',
            inputTokens: 1000,
            outputTokens: 500,
            cost: 0.0025,
          },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const joined = output.join('');
      expect(joined).toContain('Usage:');
      expect(joined).toContain('claude-sonnet-4.5');
    });

    it('captures sessionId from result event', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {});

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'result',
          sessionId: 'copilot-sess-abc',
          exitCode: 0,
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(handle.getSessionId?.()).toBe('copilot-sess-abc');
    });

    it('tolerates malformed JSON by emitting non-brace lines as raw text', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((d) => output.push(d));

      currentChild?.stdout.write('plain fallback line\n');
      currentChild?.stdout.write('{bogus json line\n');
      currentChild?.emitClose(0);
      await handle.done;

      expect(output.join('')).toContain('plain fallback line');
      expect(output.join('')).not.toContain('{bogus json line');
    });

    it('tree-kills the child process group on abort', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {});

      handle.abort.abort();

      expect(mockKillProcessTree).toHaveBeenCalledWith(FAKE_PID);

      currentChild?.emitClose(null, 'SIGTERM');
      const code = await handle.done;
      expect(code).toBe(1);
      expect(handle.abort.signal.aborted).toBe(true);
    });

    it('resolves done with 1 and emits error output on spawn-level error', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((d) => output.push(d));

      const spawnError = Object.assign(new Error('spawn ENOENT'), {
        code: 'ENOENT',
      });
      currentChild?.emitError(spawnError);

      const code = await handle.done;
      expect(code).toBe(1);
      expect(output.join('')).toContain('[Copilot CLI Error]');
      expect(output.join('')).toContain('spawn ENOENT');
    });

    it('resolves done with non-zero exit code when the CLI exits non-zero', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {});

      currentChild?.emitClose(2);
      const code = await handle.done;
      expect(code).toBe(2);
    });

    it('filters Windows ConPTY noise and stack frames from stderr', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const segments: Array<{ type: string; content: string }> = [];
      handle.onOutput(() => {});
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, content: seg.content }),
      );

      currentChild?.stderr.write('conpty_console_list_agent.js failed\n');
      currentChild?.stderr.write(
        '    at Object.spawn (node_modules/blah.js:1)\n',
      );
      currentChild?.stderr.write(
        '    at file:///C:/Users/dev/node_modules/x.js:5\n',
      );
      currentChild?.stderr.write('actual error: quota exceeded\n');
      currentChild?.emitClose(1);
      await handle.done;

      const contents = segments.map((s) => s.content);
      expect(
        contents.some((c) => c.includes('conpty_console_list_agent')),
      ).toBe(false);
      expect(contents.some((c) => c.includes('node_modules'))).toBe(false);
      expect(contents.some((c) => c.includes('quota exceeded'))).toBe(true);
    });

    it('emits session.compaction_start and session.compaction_complete as info', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((d) => output.push(d));

      currentChild?.stdout.write(
        JSON.stringify({ type: 'session.compaction_start', data: {} }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'session.compaction_complete',
          data: { tokensBefore: 5000, tokensAfter: 1200 },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const joined = output.join('');
      expect(joined).toContain('compaction');
      expect(joined).toContain('5000');
      expect(joined).toContain('1200');
    });
  });

  describe('runSdk() — continuation via resume-by-session-id', () => {
    const defaultOptions = {
      task: 'Implement feature X',
      workingDirectory: '/proj',
    };

    beforeEach(() => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/copilot');
    });

    it('reports supportsContinuation false until a session id is resolved, true after', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {});

      expect(handle.supportsContinuation?.()).toBe(false);

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'result',
          sessionId: 'copilot-sess-xyz',
          exitCode: 0,
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(handle.supportsContinuation?.()).toBe(true);
    });

    it('returns supportsContinuation=false handle when the binary cannot be resolved', async () => {
      mockResolveCliPath.mockResolvedValue(null);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {});
      await handle.done;

      expect(handle.supportsContinuation?.()).toBe(false);
      expect(handle.continue).toBeUndefined();
    });

    it('continue() spawns a NEW child with --resume=<capturedSessionId> and the message as the task', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {});

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'result',
          sessionId: 'copilot-sess-cont',
          exitCode: 0,
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      expect(mockSpawnCli).toHaveBeenCalledTimes(1);

      const outcome = await handle.continue?.('follow-up question');
      expect(outcome).toBeDefined();

      expect(mockSpawnCli).toHaveBeenCalledTimes(2);
      const [binaryArg, argsArg] = mockSpawnCli.mock.calls[1] as [
        string,
        string[],
      ];
      expect(binaryArg).toBe('/usr/local/bin/copilot');
      expect(argsArg).toContain('--resume=copilot-sess-cont');
      const promptIdx = argsArg.indexOf('-p');
      expect(promptIdx).toBeGreaterThanOrEqual(0);
      expect(argsArg[promptIdx + 1]).toContain('follow-up question');

      currentChild?.emitClose(0);
      const code = await outcome!.done;
      expect(code).toBe(0);
    });

    it('routes the continued child output to the SAME onOutput callback', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((d) => output.push(d));

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'assistant.message_delta',
          data: { deltaContent: 'turn one' },
        }) + '\n',
      );
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'result',
          sessionId: 'copilot-sess-same',
          exitCode: 0,
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const outcome = await handle.continue?.('next turn');
      currentChild?.stdout.write(
        JSON.stringify({
          type: 'assistant.message_delta',
          data: { deltaContent: 'turn two' },
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await outcome!.done;

      const joined = output.join('');
      expect(joined).toContain('turn one');
      expect(joined).toContain('turn two');
    });

    it('abort cancels the continued child', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {});

      currentChild?.stdout.write(
        JSON.stringify({
          type: 'result',
          sessionId: 'copilot-sess-abort',
          exitCode: 0,
        }) + '\n',
      );
      currentChild?.emitClose(0);
      await handle.done;

      const outcome = await handle.continue?.('keep going');
      const continuedChild = currentChild;

      handle.abort.abort();
      expect(mockKillProcessTree).toHaveBeenCalledWith(FAKE_PID);

      continuedChild?.emitClose(null, 'SIGTERM');
      const code = await outcome!.done;
      expect(code).toBe(1);
    });
  });

  describe('dispose()', () => {
    it('calls permissionBridge.cleanup()', async () => {
      const cleanupSpy = jest.spyOn(bridge, 'cleanup');
      await adapter.dispose();
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
});
