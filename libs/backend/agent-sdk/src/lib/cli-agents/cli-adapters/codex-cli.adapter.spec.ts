/**
 * CodexCliAdapter Unit Tests
 * TASK_2025_158 Batch 3, Task 3.1
 *
 * Tests: runSdk(), detect(), handleStreamEvent(), dynamic import caching, abort/cancellation
 */

// ---- Mocks must be declared before any imports that trigger module resolution ----

/**
 * Fake async generator that yields events and respects AbortSignal.
 */
function createFakeEventGenerator(
  events: FakeCodexEvent[],
  signal?: AbortSignal,
): AsyncGenerator<FakeCodexEvent> {
  let index = 0;
  const gen: AsyncGenerator<FakeCodexEvent> = {
    [Symbol.asyncIterator]() {
      return gen;
    },
    async next(): Promise<IteratorResult<FakeCodexEvent>> {
      if (signal?.aborted) {
        throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
      }
      if (index < events.length) {
        return { done: false, value: events[index++] };
      }
      return { done: true, value: undefined as never };
    },
    async return(): Promise<IteratorResult<FakeCodexEvent>> {
      return { done: true, value: undefined as never };
    },
    async throw(err: Error): Promise<IteratorResult<FakeCodexEvent>> {
      throw err;
    },
    [Symbol.asyncDispose](): PromiseLike<void> {
      return Promise.resolve();
    },
  };
  return gen;
}

/** Minimal event types matching CodexThreadEvent from the adapter */
type FakeCodexEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | {
      type: 'turn.completed';
      usage: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
      };
    }
  | { type: 'turn.failed'; error: { message: string } }
  | {
      type: 'item.completed';
      item:
        | { type: 'agent_message'; id: string; text: string }
        | { type: 'reasoning'; id: string; text: string }
        | {
            type: 'command_execution';
            id: string;
            command: string;
            aggregated_output: string;
            status: string;
            exit_code?: number;
          }
        | {
            type: 'file_change';
            id: string;
            changes: Array<{ path: string; kind: string }>;
            status: string;
          }
        | { type: 'error'; id: string; message: string };
    }
  | { type: 'error'; message: string };

const mockRunStreamed = jest.fn();
const mockStartThread = jest.fn();
const mockCodexConstructor = jest.fn();

/**
 * Mock the ESM-only @openai/codex-sdk via jest.mock.
 * The adapter uses a cached dynamic import() so we mock the module itself.
 */
jest.mock('@openai/codex-sdk', () => {
  return {
    __esModule: true,
    Codex: mockCodexConstructor,
  };
});

// Mock cli-adapter.utils so detect()'s resolveCliPath and the SDK's
// spawnCli version probe can be intercepted deterministically across
// platforms (otherwise `which codex` on Windows finds the real .CMD shim
// installed on the developer's machine). stripAnsiCodes / buildTaskPrompt
// are preserved via jest.requireActual so production formatting still runs
// inside the adapter under test.
const mockResolveCliPath = jest.fn();
const mockSpawnCli = jest.fn();
jest.mock('./cli-adapter.utils', () => {
  const actual = jest.requireActual<typeof import('./cli-adapter.utils')>(
    './cli-adapter.utils',
  );
  return {
    ...actual,
    resolveCliPath: (...args: unknown[]) => mockResolveCliPath(...args),
    spawnCli: (...args: unknown[]) => mockSpawnCli(...args),
  };
});

// Mock child_process defensively in case any transitive import reaches for it.
const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile,
  spawn: jest.fn(),
}));

// Import adapter AFTER mocks are declared
import { CodexCliAdapter } from './codex-cli.adapter';
import type { SdkHandle } from './cli-adapter.interface';
import { EventEmitter } from 'events';

describe('CodexCliAdapter', () => {
  let adapter: CodexCliAdapter;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock setup: Codex constructor returns client with startThread
    mockCodexConstructor.mockImplementation(() => ({
      startThread: mockStartThread,
    }));

    // Default mock: startThread returns a thread with runStreamed
    mockStartThread.mockReturnValue({
      runStreamed: mockRunStreamed,
    });

    adapter = new CodexCliAdapter();
  });

  // Reset the cached dynamic import between tests by clearing the module-level variable.
  // Since it is a module-level `let`, we need to re-require the module or use a workaround.
  // The simplest approach: we clear the jest module registry for each test.
  afterEach(() => {
    // Clear cached SDK import by resetting the module registry for the adapter module
    jest.resetModules();
  });

  /**
   * Build a minimal fake ChildProcess that simulates the `--version` probe
   * inside detect(). The adapter wires setEncoding + data + close listeners
   * via spawnCli, so we emit a single stdout chunk and close.
   */
  function createFakeVersionChild(stdout: string): EventEmitter & {
    stdout: EventEmitter & { setEncoding: jest.Mock };
    kill: jest.Mock;
  } {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter & { setEncoding: jest.Mock };
      kill: jest.Mock;
    };
    const stdoutEmitter = Object.assign(new EventEmitter(), {
      setEncoding: jest.fn(),
    });
    child.stdout = stdoutEmitter;
    child.kill = jest.fn();
    // Emit stdout + close on the next tick so listeners (attached after
    // spawnCli returns inside detect()) see the data.
    setImmediate(() => {
      stdoutEmitter.emit('data', stdout);
      child.emit('close', 0);
    });
    return child;
  }

  describe('detect()', () => {
    it('should return installed: true when codex binary is found', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/codex');
      mockSpawnCli.mockImplementation(() => createFakeVersionChild('1.2.3\n'));

      const result = await adapter.detect();

      expect(result.cli).toBe('codex');
      expect(result.installed).toBe(true);
      expect(result.path).toBe('/usr/local/bin/codex');
      expect(result.version).toBe('1.2.3');
      expect(result.supportsSteer).toBe(false);
    });

    it('should return installed: false when codex binary is not found', async () => {
      mockResolveCliPath.mockResolvedValue(null);

      const result = await adapter.detect();

      expect(result.cli).toBe('codex');
      expect(result.installed).toBe(false);
      expect(result.supportsSteer).toBe(false);
    });
  });

  describe('buildCommand()', () => {
    it('should build an `exec --full-auto --ephemeral` command with the task prompt', () => {
      // TASK_2025_157: CLI fallback was migrated from `--quiet` to the
      // `exec` subcommand with `--full-auto --ephemeral` for non-interactive,
      // auto-approve, no-session-persistence execution.
      const cmd = adapter.buildCommand({
        task: 'Write a test',
        workingDirectory: '/project',
      });

      expect(cmd.binary).toBe('codex');
      expect(cmd.args).toContain('exec');
      expect(cmd.args).toContain('--full-auto');
      expect(cmd.args).toContain('--ephemeral');
      expect(cmd.args).toContain('Write a test');
    });
  });

  describe('supportsSteer()', () => {
    it('should return false', () => {
      expect(adapter.supportsSteer()).toBe(false);
    });
  });

  describe('parseOutput()', () => {
    it('should strip ANSI codes from output', () => {
      const raw = '\x1b[32mHello\x1b[0m World';
      const parsed = adapter.parseOutput(raw);
      expect(parsed).toBe('Hello World');
    });
  });

  describe('runSdk()', () => {
    const defaultOptions = {
      task: 'Implement feature X',
      workingDirectory: '/project/root',
    };

    function setupMockEvents(events: FakeCodexEvent[]): void {
      mockRunStreamed.mockResolvedValue({
        events: createFakeEventGenerator(events),
      });
    }

    it('should create a Codex client and start a thread', async () => {
      setupMockEvents([]);

      const handle: SdkHandle = await adapter.runSdk(defaultOptions);

      expect(mockCodexConstructor).toHaveBeenCalledTimes(1);
      // TASK_2025_177: threadOptions now always includes the headless
      // approvalPolicy/sandboxMode/skipGitRepoCheck trio so Codex runs
      // non-interactively without permission hooks.
      expect(mockStartThread).toHaveBeenCalledWith({
        workingDirectory: '/project/root',
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
        skipGitRepoCheck: true,
      });
      expect(handle.abort).toBeInstanceOf(AbortController);
      expect(typeof handle.done.then).toBe('function');
      expect(typeof handle.onOutput).toBe('function');

      // Wait for completion
      const exitCode = await handle.done;
      expect(exitCode).toBe(0);
    });

    it('should pass the task prompt to runStreamed', async () => {
      setupMockEvents([]);

      await adapter.runSdk(defaultOptions);

      expect(mockRunStreamed).toHaveBeenCalledWith('Implement feature X', {
        signal: expect.any(AbortSignal),
      });
    });

    it('should include file context in the task prompt', async () => {
      setupMockEvents([]);

      await adapter.runSdk({
        ...defaultOptions,
        files: ['src/app.ts', 'src/utils.ts'],
      });

      const promptArg = mockRunStreamed.mock.calls[0][0] as string;
      expect(promptArg).toContain('Focus on these files:');
      expect(promptArg).toContain('- src/app.ts');
      expect(promptArg).toContain('- src/utils.ts');
    });

    it('should push agent_message output to onOutput callback', async () => {
      setupMockEvents([
        {
          type: 'item.completed',
          item: { type: 'agent_message', id: 'msg1', text: 'Hello world' },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      expect(output).toContain('Hello world\n');
    });

    it('should push reasoning output to onOutput callback', async () => {
      setupMockEvents([
        {
          type: 'item.completed',
          item: {
            type: 'reasoning',
            id: 'r1',
            text: 'Thinking about the problem',
          },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      // TASK_2025_177: reasoning items are surfaced as "[Thinking] ..." in
      // the plain-output stream (the structured segment uses type 'thinking').
      expect(output).toContain('[Thinking] Thinking about the problem\n');
    });

    it('should push command_execution output to onOutput callback', async () => {
      setupMockEvents([
        {
          type: 'item.completed',
          item: {
            type: 'command_execution',
            id: 'cmd1',
            command: 'npm test',
            aggregated_output: 'All tests passed',
            status: 'completed',
            exit_code: 0,
          },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      expect(output).toContain('$ npm test\n');
      // The adapter emits "All tests passed" and "\n" separately when output doesn't end with newline
      expect(output.join('')).toContain('All tests passed');
    });

    it('should push command_execution non-zero exit code output', async () => {
      setupMockEvents([
        {
          type: 'item.completed',
          item: {
            type: 'command_execution',
            id: 'cmd1',
            command: 'npm test',
            aggregated_output: 'FAIL\n',
            status: 'failed',
            exit_code: 1,
          },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      expect(output).toContain('[exit code: 1]\n');
    });

    it('should push file_change output to onOutput callback', async () => {
      setupMockEvents([
        {
          type: 'item.completed',
          item: {
            type: 'file_change',
            id: 'fc1',
            changes: [
              { path: 'src/app.ts', kind: 'modified' },
              { path: 'src/new.ts', kind: 'created' },
            ],
            status: 'completed',
          },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      expect(output).toContain('[modified] src/app.ts\n');
      expect(output).toContain('[created] src/new.ts\n');
    });

    it('should push error item output to onOutput callback', async () => {
      setupMockEvents([
        {
          type: 'item.completed',
          item: {
            type: 'error',
            id: 'err1',
            message: 'Something went wrong',
          },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      expect(output).toContain('[Error] Something went wrong\n');
    });

    it('should push turn.failed output to onOutput callback', async () => {
      setupMockEvents([
        {
          type: 'turn.failed',
          error: { message: 'Turn failed due to rate limit' },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      expect(output).toContain('[Turn Failed] Turn failed due to rate limit\n');
    });

    it('should push stream error event output to onOutput callback', async () => {
      setupMockEvents([{ type: 'error', message: 'Connection lost' }]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      expect(output).toContain('[Stream Error] Connection lost\n');
    });

    it('should resolve done with 0 on successful completion', async () => {
      setupMockEvents([
        {
          type: 'item.completed',
          item: { type: 'agent_message', id: 'msg1', text: 'Done' },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      const exitCode = await handle.done;
      expect(exitCode).toBe(0);
    });

    it('should resolve done with 1 on SDK error', async () => {
      // Use a delayed rejection so that onOutput can be registered before the error fires
      mockRunStreamed.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('SDK initialization failed')), 5);
          }),
      );

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      const exitCode = await handle.done;

      expect(exitCode).toBe(1);
      expect(output.some((o) => o.includes('SDK initialization failed'))).toBe(
        true,
      );
    });

    it('should resolve done with 1 on AbortError (treated as cancellation)', async () => {
      const abortError = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      });
      mockRunStreamed.mockRejectedValue(abortError);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      const exitCode = await handle.done;

      // AbortError resolves with 1 (non-zero, but not an unexpected error)
      expect(exitCode).toBe(1);
    });

    it('should support abort via AbortController', async () => {
      // Create a generator that waits and then checks abort signal on next iteration
      let abortResolve: (() => void) | undefined;
      const waitForAbort = new Promise<void>((resolve) => {
        abortResolve = resolve;
      });

      mockRunStreamed.mockImplementation(
        (
          _task: string,
          opts: { signal?: AbortSignal },
        ): Promise<{ events: AsyncGenerator<FakeCodexEvent> }> => {
          let firstCallDone = false;
          const gen: AsyncGenerator<FakeCodexEvent> = {
            [Symbol.asyncIterator]() {
              return gen;
            },
            async next(): Promise<IteratorResult<FakeCodexEvent>> {
              if (opts.signal?.aborted) {
                throw Object.assign(new Error('Aborted'), {
                  name: 'AbortError',
                });
              }
              if (!firstCallDone) {
                firstCallDone = true;
                // Return one event, then wait for abort on next call
                return {
                  done: false,
                  value: {
                    type: 'item.completed' as const,
                    item: {
                      type: 'agent_message' as const,
                      id: 'msg1',
                      text: 'Working...',
                    },
                  },
                };
              }
              // Second call: wait until abort happens
              await waitForAbort;
              // After being unblocked, the signal should be aborted
              if (opts.signal?.aborted) {
                throw Object.assign(new Error('Aborted'), {
                  name: 'AbortError',
                });
              }
              return { done: true, value: undefined as never };
            },
            async return(): Promise<IteratorResult<FakeCodexEvent>> {
              return { done: true, value: undefined as never };
            },
            async throw(err: Error): Promise<IteratorResult<FakeCodexEvent>> {
              throw err;
            },
            [Symbol.asyncDispose](): PromiseLike<void> {
              return Promise.resolve();
            },
          };
          return Promise.resolve({ events: gen });
        },
      );

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      // Give the async generator time to process the first event and block on the second
      await new Promise((r) => setTimeout(r, 10));

      // Abort the operation and unblock the generator
      handle.abort.abort();
      abortResolve?.();

      const exitCode = await handle.done;
      expect(exitCode).toBe(1);
      expect(handle.abort.signal.aborted).toBe(true);
    });

    it('should support multiple onOutput callbacks', async () => {
      setupMockEvents([
        {
          type: 'item.completed',
          item: { type: 'agent_message', id: 'msg1', text: 'Hello' },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output1: string[] = [];
      const output2: string[] = [];
      handle.onOutput((data: string) => output1.push(data));
      handle.onOutput((data: string) => output2.push(data));

      await handle.done;

      expect(output1).toEqual(['Hello\n']);
      expect(output2).toEqual(['Hello\n']);
    });

    it('should silently skip non-output events (thread.started, turn.started)', async () => {
      setupMockEvents([
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'turn.started' },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      const exitCode = await handle.done;

      expect(output).toHaveLength(0);
      expect(exitCode).toBe(0);
    });

    it('should emit usage data from turn.completed events', async () => {
      setupMockEvents([
        {
          type: 'turn.completed',
          usage: {
            input_tokens: 100,
            cached_input_tokens: 0,
            output_tokens: 50,
          },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      const exitCode = await handle.done;

      expect(output.join('')).toContain('[Usage: 100 input, 50 output tokens]');
      expect(exitCode).toBe(0);
    });

    it('should buffer output emitted before onOutput is registered', async () => {
      // Use events that emit output synchronously during the IIFE start
      // before onOutput can be registered by the caller
      setupMockEvents([
        {
          type: 'item.completed',
          item: { type: 'agent_message', id: 'msg1', text: 'Early output' },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      // Small delay to let the IIFE process events before we register
      await new Promise((r) => setTimeout(r, 10));

      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      await handle.done;

      // Should receive the early output that was buffered
      expect(output.join('')).toContain('Early output');
    });
  });

  describe('dynamic import caching', () => {
    it('should cache the dynamic import across multiple runSdk calls', async () => {
      // We need a fresh adapter module for this test since afterEach resets modules.
      // Re-import fresh to get a clean cache state.
      jest.resetModules();

      // Re-declare mocks after reset
      const freshMockRunStreamed = jest.fn().mockResolvedValue({
        events: createFakeEventGenerator([]),
      });
      const freshMockStartThread = jest.fn().mockReturnValue({
        runStreamed: freshMockRunStreamed,
      });
      const freshMockConstructor = jest.fn().mockImplementation(() => ({
        startThread: freshMockStartThread,
      }));

      let freshImportCount = 0;
      jest.doMock('@openai/codex-sdk', () => {
        freshImportCount++;
        return {
          __esModule: true,
          Codex: freshMockConstructor,
        };
      });

      const { CodexCliAdapter: FreshAdapter } = require('./codex-cli.adapter');
      const freshAdapter = new FreshAdapter();

      const options = {
        task: 'Task 1',
        workingDirectory: '/project',
      };

      // First call triggers import
      const handle1 = await freshAdapter.runSdk(options);
      handle1.onOutput(() => {
        /* drain */
      });
      await handle1.done;

      // Second call should reuse cached import
      const handle2 = await freshAdapter.runSdk(options);
      handle2.onOutput(() => {
        /* drain */
      });
      await handle2.done;

      // The module factory should only be invoked once (cached)
      expect(freshImportCount).toBe(1);
      // But the Codex constructor is called each time
      expect(freshMockConstructor).toHaveBeenCalledTimes(2);
    });
  });
});
