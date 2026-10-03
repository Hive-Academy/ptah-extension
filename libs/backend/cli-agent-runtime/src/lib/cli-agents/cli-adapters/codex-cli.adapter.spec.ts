import type { CliOutputSegment } from '@ptah-extension/shared';
/**
 * CodexCliAdapter Unit Tests
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

/**
 * Fake event source that yields its events and then NEVER ends — the shape
 * `codex exec` has on Windows when a long-lived child keeps its stdout open
 * after the final event. Records whether the consumer closed it early, which
 * is what runs the real SDK's `finally` (readline close + child kill).
 */
function createNeverEndingEventSource(events: FakeCodexEvent[]): {
  events: AsyncGenerator<FakeCodexEvent>;
  wasReturned: () => boolean;
} {
  let index = 0;
  let returned = false;
  const gen: AsyncGenerator<FakeCodexEvent> = {
    [Symbol.asyncIterator]() {
      return gen;
    },
    next(): Promise<IteratorResult<FakeCodexEvent>> {
      if (!returned && index < events.length) {
        return Promise.resolve({ done: false, value: events[index++] });
      }
      return new Promise<never>(() => {
        /* stdout never closes */
      });
    },
    async return(): Promise<IteratorResult<FakeCodexEvent>> {
      returned = true;
      return { done: true, value: undefined as never };
    },
    async throw(err: Error): Promise<IteratorResult<FakeCodexEvent>> {
      throw err;
    },
    [Symbol.asyncDispose](): PromiseLike<void> {
      return Promise.resolve();
    },
  };
  return { events: gen, wasReturned: () => returned };
}

/**
 * Resolve with the promise's value, or with `'still-running'` if it has not
 * settled within `ms`. Keeps a regression a clear assertion failure instead of
 * a Jest timeout, and clears its timer so no handle outlives the test.
 */
async function settleWithin<T>(
  promise: Promise<T>,
  ms = 1000,
): Promise<T | 'still-running'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'still-running'>((resolve) => {
        timer = setTimeout(() => resolve('still-running'), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
const mockResumeThread = jest.fn();
const mockCodexConstructor = jest.fn();

// The user-server reader reads the developer's real ~/.codex otherwise.
const mockReadUserServers = jest.fn();
jest.mock('./codex/codex-user-mcp-servers', () => ({
  readCodexUserMcpServerNames: (...args: unknown[]) =>
    mockReadUserServers(...args),
}));

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
const mockProbeCliVersion = jest.fn();
jest.mock('./cli-adapter.utils', () => {
  const actual = jest.requireActual<typeof import('./cli-adapter.utils')>(
    './cli-adapter.utils',
  );
  return {
    ...actual,
    resolveCliPath: (...args: unknown[]) => mockResolveCliPath(...args),
    spawnCli: (...args: unknown[]) => mockSpawnCli(...args),
    probeCliVersion: (...args: unknown[]) => mockProbeCliVersion(...args),
  };
});

// Mock child_process defensively in case any transitive import reaches for it.
const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile,
  spawn: jest.fn(),
}));

// Mock fs.existsSync so the native-binary resolver probes a deterministic,
// synthetic filesystem instead of the developer's real node_modules tree.
const mockExistsSync = jest.fn();
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
  };
});

// Import adapter AFTER mocks are declared
import path from 'path';
import { CodexCliAdapter, commandToolLabel } from './codex-cli.adapter';
import type { CliLaneBudgets, SdkHandle } from './cli-adapter.interface';
import type { AgentRoleDefinition } from '@ptah-extension/shared';
import { readFileSync } from 'fs';
import type { Logger } from '@ptah-extension/vscode-core';
import { buildTaskPrompt, renderRoleBlock } from './cli-adapter.utils';
import { CODEX_RESUME_RESENDS_ROLE } from './codex/codex-lane-config.builder';

function createMockLogger(): {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
} {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

/** The `configOverrides` the `call`-th Codex client was constructed with. */
function constructedOverrides(call = 0): string[] {
  const [options] = mockCodexConstructor.mock.calls[call] as [
    { configOverrides?: string[] },
  ];
  return options.configOverrides ?? [];
}

/**
 * The value of `key` in the `call`-th client's overrides, decoded: a TOML
 * basic string with only the short escapes is valid JSON. `undefined` when
 * the key is absent.
 */
function overrideValue(key: string, call = 0): unknown {
  const entry = constructedOverrides(call).find((e) => e.startsWith(`${key}=`));
  return entry === undefined
    ? undefined
    : JSON.parse(entry.slice(key.length + 1));
}

describe('CodexCliAdapter', () => {
  let adapter: CodexCliAdapter;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock setup: Codex constructor returns a client with both
    // thread entry points.
    mockCodexConstructor.mockImplementation(() => ({
      startThread: mockStartThread,
      resumeThread: mockResumeThread,
    }));

    // Default mock: either entry point returns a thread with runStreamed
    mockStartThread.mockReturnValue({
      runStreamed: mockRunStreamed,
    });
    mockResumeThread.mockReturnValue({
      runStreamed: mockRunStreamed,
    });

    // No native binary candidate exists unless a test says otherwise.
    mockExistsSync.mockReturnValue(false);
    mockProbeCliVersion.mockResolvedValue(undefined);
    mockReadUserServers.mockResolvedValue({ names: [], warnings: [] });

    adapter = new CodexCliAdapter();
  });

  // Reset the cached dynamic import between tests by clearing the module-level variable.
  // Since it is a module-level `let`, we need to re-require the module or use a workaround.
  // The simplest approach: we clear the jest module registry for each test.
  afterEach(() => {
    // Clear cached SDK import by resetting the module registry for the adapter module
    jest.resetModules();
  });

  describe('detect()', () => {
    it('should return installed: true when codex binary is found', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/codex');
      mockProbeCliVersion.mockResolvedValue('1.2.3');

      const result = await adapter.detect();

      expect(result.cli).toBe('codex');
      expect(result.installed).toBe(true);
      expect(result.path).toBe('/usr/local/bin/codex');
      expect(result.version).toBe('1.2.3');
      expect(result.messagingMode).toBe('queue');
    });

    it('should return installed: false when codex binary is not found', async () => {
      mockResolveCliPath.mockResolvedValue(null);

      const result = await adapter.detect();

      expect(result.cli).toBe('codex');
      expect(result.installed).toBe(false);
      expect(result.messagingMode).toBe('queue');
      expect(mockProbeCliVersion).not.toHaveBeenCalled();
    });
  });

  describe('capabilities()', () => {
    it('reports continuation only', () => {
      expect(adapter.capabilities()).toEqual({
        steer: false,
        interrupt: false,
        continuation: true,
      });
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
      // Only the non-config options travel as thread options; approval and
      // web search are config overrides (review N-A).
      expect(mockStartThread).toHaveBeenCalledWith({
        workingDirectory: '/project/root',
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

      expect(mockRunStreamed).toHaveBeenCalledWith(
        expect.stringContaining('Implement feature X'),
        {
          signal: expect.any(AbortSignal),
        },
      );
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
            cached_input_tokens: 80,
            output_tokens: 50,
          },
        },
      ]);

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      const segments: CliOutputSegment[] = [];
      handle.onSegment?.((segment) => segments.push(segment));
      handle.onOutput((data: string) => output.push(data));

      const exitCode = await handle.done;

      expect(output.join('')).toContain(
        '[Usage: 100 input (80 cached), 50 output tokens]',
      );
      expect(segments).toContainEqual({
        type: 'info',
        content: 'Usage: 100 input (80 cached), 50 output tokens',
        usage: { inputTokens: 100, outputTokens: 50 },
      });
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

  describe('continue() — multi-turn continuation', () => {
    const defaultOptions = {
      task: 'Implement feature X',
      workingDirectory: '/project/root',
    };

    function setupMockEvents(events: FakeCodexEvent[]): void {
      mockRunStreamed.mockResolvedValue({
        events: createFakeEventGenerator(events),
      });
    }

    it('reports supportsContinuation() true', async () => {
      setupMockEvents([]);
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      expect(handle.supportsContinuation?.()).toBe(true);
    });

    it('runs the next turn on the SAME thread through a new client that resumes it', async () => {
      mockRunStreamed.mockImplementation(async () => ({
        events: createFakeEventGenerator([
          { type: 'thread.started', thread_id: 'thread-1' },
        ]),
      }));
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;

      expect(mockRunStreamed).toHaveBeenCalledTimes(1);
      expect(mockStartThread).toHaveBeenCalledTimes(1);

      expect(handle.continue).toBeDefined();
      const outcome = await handle.continue?.('Follow-up message');
      const code = await outcome?.done;

      expect(code).toBe(0);
      expect(mockStartThread).toHaveBeenCalledTimes(1);
      expect(mockCodexConstructor).toHaveBeenCalledTimes(2);
      expect(mockResumeThread).toHaveBeenCalledWith('thread-1', {
        workingDirectory: '/project/root',
        sandboxMode: 'danger-full-access',
        skipGitRepoCheck: true,
      });
      expect(mockRunStreamed).toHaveBeenCalledTimes(2);
      // The tool policy reached this thread on turn one, so it is not resent;
      // the completion contract always is.
      const followUp = mockRunStreamed.mock.calls[1][0] as string;
      expect(followUp.startsWith('Follow-up message')).toBe(true);
      expect(followUp).not.toContain('Tool policy:');
      expect(followUp).toContain('## Before you exit');
    });

    it('starts a new thread with the full prefix when the first turn never reported one', async () => {
      setupMockEvents([]);
      const handle = await adapter.runSdk(defaultOptions);
      await handle.done;

      const outcome = await handle.continue?.('Follow-up message');
      await outcome?.done;

      expect(mockResumeThread).not.toHaveBeenCalled();
      expect(mockStartThread).toHaveBeenCalledTimes(2);
      expect(mockRunStreamed.mock.calls[1][0]).toContain('Tool policy:');
    });

    it('streams the continued turn through the same onOutput callbacks', async () => {
      mockRunStreamed
        .mockResolvedValueOnce({ events: createFakeEventGenerator([]) })
        .mockResolvedValueOnce({
          events: createFakeEventGenerator([
            {
              type: 'item.completed',
              item: { type: 'agent_message', id: 'm2', text: 'Second turn' },
            },
          ]),
        });

      const handle = await adapter.runSdk(defaultOptions);
      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));
      await handle.done;

      const outcome = await handle.continue?.('again');
      await outcome?.done;

      expect(output).toContain('Second turn\n');
    });

    it('abort still cancels the in-flight turn', async () => {
      let abortResolve: (() => void) | undefined;
      const waitForAbort = new Promise<void>((resolve) => {
        abortResolve = resolve;
      });

      mockRunStreamed.mockImplementation(
        (
          _task: string,
          opts: { signal?: AbortSignal },
        ): Promise<{ events: AsyncGenerator<FakeCodexEvent> }> => {
          const gen: AsyncGenerator<FakeCodexEvent> = {
            [Symbol.asyncIterator]() {
              return gen;
            },
            async next(): Promise<IteratorResult<FakeCodexEvent>> {
              await waitForAbort;
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

      await new Promise((r) => setTimeout(r, 10));
      handle.abort.abort();
      abortResolve?.();

      const code = await handle.done;
      expect(code).toBe(1);
      expect(handle.abort.signal.aborted).toBe(true);
    });
  });

  // `codex exec` on Windows can keep stdout open long after its final event
  // (a lingering powershell.exe child), so the SDK iterator never ends. A turn
  // must finish on its terminal EVENT, and close the stream so the SDK kills
  // the child — not wait for an end that may take an hour.
  describe('terminal turn events on a stream that never ends', () => {
    const defaultOptions = {
      task: 'Implement feature X',
      workingDirectory: '/project/root',
    };
    const usage = {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
    };

    it('resolves done with 0 after turn.completed and closes the stream', async () => {
      const source = createNeverEndingEventSource([
        { type: 'thread.started', thread_id: 'thread-1' },
        {
          type: 'item.completed',
          item: { type: 'agent_message', id: 'm1', text: 'Final report' },
        },
        { type: 'turn.completed', usage },
      ]);
      mockRunStreamed.mockResolvedValue({ events: source.events });

      const handle = await adapter.runSdk(defaultOptions);
      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      expect(await settleWithin(handle.done)).toBe(0);
      expect(source.wasReturned()).toBe(true);
      expect(output.join('')).toContain(
        '[Usage: 10 input (0 cached), 5 output tokens]',
      );
      expect(handle.getSessionId?.()).toBe('thread-1');
    });

    it('resolves done with 1 after turn.failed and closes the stream', async () => {
      const source = createNeverEndingEventSource([
        { type: 'turn.failed', error: { message: 'rate limited' } },
      ]);
      mockRunStreamed.mockResolvedValue({ events: source.events });

      const handle = await adapter.runSdk(defaultOptions);
      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      expect(await settleWithin(handle.done)).toBe(1);
      expect(source.wasReturned()).toBe(true);
      expect(output).toContain('[Turn Failed] rate limited\n');
    });

    it('does not treat a stream error event as the end of the turn', async () => {
      const source = createNeverEndingEventSource([
        { type: 'error', message: 'Reconnecting... 1/5' },
      ]);
      mockRunStreamed.mockResolvedValue({ events: source.events });

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      expect(await settleWithin(handle.done, 50)).toBe('still-running');
      expect(source.wasReturned()).toBe(false);
    });

    it('runs a continuation after an early return, on the same thread', async () => {
      const first = createNeverEndingEventSource([
        { type: 'thread.started', thread_id: 'thread-1' },
        { type: 'turn.completed', usage },
      ]);
      const second = createNeverEndingEventSource([
        {
          type: 'item.completed',
          item: { type: 'agent_message', id: 'm2', text: 'Second turn' },
        },
        { type: 'turn.completed', usage },
      ]);
      mockRunStreamed
        .mockResolvedValueOnce({ events: first.events })
        .mockResolvedValueOnce({ events: second.events });

      const handle = await adapter.runSdk(defaultOptions);
      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));

      expect(await settleWithin(handle.done)).toBe(0);
      expect(first.wasReturned()).toBe(true);

      const outcome = await handle.continue?.('Follow-up message');
      expect(outcome).toBeDefined();
      expect(await settleWithin(outcome?.done ?? Promise.resolve(-1))).toBe(0);

      expect(second.wasReturned()).toBe(true);
      expect(mockStartThread).toHaveBeenCalledTimes(1);
      expect(mockResumeThread).toHaveBeenCalledWith(
        'thread-1',
        expect.anything(),
      );
      expect(mockRunStreamed).toHaveBeenCalledTimes(2);
      expect(mockRunStreamed.mock.calls[1][0]).toContain('Follow-up message');
      expect(output).toContain('Second turn\n');
    });
  });

  // `@openai/codex-<platform>` >= 0.147 ships its native binary at
  // `vendor/<triple>/bin/`; earlier releases used `vendor/<triple>/codex/`.
  // The resolver must probe both, newest layout first, at every candidate root
  // — a resolver that only knows the legacy segment never matches, leaves
  // codexPathOverride unset, and lets the SDK self-resolve into `app.asar`.
  describe('native binary resolution (codexPathOverride)', () => {
    const RESOURCES = path.join(path.sep, 'ptah-app', 'resources');
    const VENDOR_ROOT = path.join(
      RESOURCES,
      'app.asar.unpacked',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
    );
    const binLayout = path.join(VENDOR_ROOT, 'bin', 'codex.exe');
    const legacyLayout = path.join(VENDOR_ROOT, 'codex', 'codex.exe');

    type ResourcesProcess = NodeJS.Process & { resourcesPath?: string };
    const originalPlatform = process.platform;
    const originalArch = process.arch;
    const originalResourcesPath = (process as ResourcesProcess).resourcesPath;

    function stub(key: 'platform' | 'arch', value: string): void {
      Object.defineProperty(process, key, { value, configurable: true });
    }

    beforeEach(() => {
      // Pin platform/arch so the target triple (and therefore every candidate
      // path asserted below) is identical on every CI runner.
      stub('platform', 'win32');
      stub('arch', 'x64');
      (process as ResourcesProcess).resourcesPath = RESOURCES;
      mockRunStreamed.mockResolvedValue({
        events: createFakeEventGenerator([]),
      });
    });

    afterEach(() => {
      stub('platform', originalPlatform);
      stub('arch', originalArch);
      if (originalResourcesPath === undefined) {
        delete (process as ResourcesProcess).resourcesPath;
      } else {
        (process as ResourcesProcess).resourcesPath = originalResourcesPath;
      }
    });

    /** Every path handed to existsSync, in probe order. */
    function probedPaths(): string[] {
      return mockExistsSync.mock.calls.map((call) => call[0] as string);
    }

    /** The codexPathOverride the adapter handed to the Codex constructor. */
    function resolvedOverride(): string | undefined {
      const [options] = mockCodexConstructor.mock.calls[0] as [
        { codexPathOverride?: string },
      ];
      return options.codexPathOverride;
    }

    async function runAndSettle(): Promise<void> {
      const handle = await adapter.runSdk({
        task: 'T',
        workingDirectory: '/proj',
      });
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;
    }

    it('probes both vendor layouts per candidate root, bin/ first', async () => {
      await runAndSettle();

      const probed = probedPaths();
      expect(probed[0]).toBe(binLayout);
      expect(probed[1]).toBe(legacyLayout);
      expect(resolvedOverride()).toBeUndefined();
    });

    it('probes the packaged Electron root under app.asar.unpacked', async () => {
      await runAndSettle();

      // The asar-rewrite behaviour itself is pinned directly on
      // withAsarUnpackedTwin in cli-adapter.utils.spec.ts — no candidate here
      // ever contains `app.asar`, so asserting its absence would be vacuous.
      const unpackedRoot = path.join(RESOURCES, 'app.asar.unpacked') + path.sep;
      expect(probedPaths()[0].startsWith(unpackedRoot)).toBe(true);
    });

    it('prefers the bin/ layout when both layouts exist', async () => {
      mockExistsSync.mockImplementation(
        (p: string) => p === binLayout || p === legacyLayout,
      );

      await runAndSettle();

      expect(resolvedOverride()).toBe(binLayout);
    });

    it('resolves when only the current bin/ layout exists', async () => {
      mockExistsSync.mockImplementation((p: string) => p === binLayout);

      await runAndSettle();

      expect(resolvedOverride()).toBe(binLayout);
    });

    it('resolves when only the legacy codex/ layout exists', async () => {
      mockExistsSync.mockImplementation((p: string) => p === legacyLayout);

      await runAndSettle();

      expect(resolvedOverride()).toBe(legacyLayout);
    });

    it('logs the probed version of the binary the lane runs when its package has no package.json', async () => {
      // The synthetic tree has no `@openai/codex-win32-x64/package.json`, so
      // the version comes from one `--version` probe of that binary; the
      // global `codex` that detect() would probe is never asked (F2).
      // A root of its own: the probe is cached per binary path for the life
      // of the module, and earlier cases already probed `binLayout`.
      const probeResources = path.join(path.sep, 'ptah-probe', 'resources');
      (process as ResourcesProcess).resourcesPath = probeResources;
      const probeBinary = binLayout.replace(RESOURCES, probeResources);
      mockExistsSync.mockImplementation((p: string) => p === probeBinary);
      mockProbeCliVersion.mockResolvedValue('codex-cli 0.155.1');
      const logger = createMockLogger();
      adapter = new CodexCliAdapter(logger as unknown as Logger);

      await runAndSettle();

      expect(mockProbeCliVersion).toHaveBeenCalledWith(probeBinary);
      expect(mockResolveCliPath).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[CodexCliAdapter] Codex lane config',
        expect.objectContaining({
          codexVersion: '0.155.1',
          nativeBinary: probeBinary,
        }),
      );
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

  describe('role delivery (developer-instructions)', () => {
    const role: AgentRoleDefinition = {
      name: 'reviewer',
      body: 'Review the diff before approving.',
      sourcePath: '/project/.claude/agents/reviewer.md',
      bytes: 33,
    };
    const baseOptions = {
      task: 'Review the change',
      workingDirectory: '/project',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      mcpPort: 51820,
    };

    function setupMockEvents(): void {
      mockRunStreamed.mockResolvedValue({
        events: createFakeEventGenerator([]),
      });
    }

    it('declares the developer-instructions channel', () => {
      expect(adapter.roleChannel).toBe('developer-instructions');
    });

    it('puts the role block in developer_instructions and keeps it out of the thread input', async () => {
      setupMockEvents();

      const handle = await adapter.runSdk({ ...baseOptions, role });
      await handle.done;

      expect(overrideValue('developer_instructions')).toBe(
        renderRoleBlock(role, 'codex'),
      );
      const input = mockRunStreamed.mock.calls[0][0] as string;
      expect(input).not.toContain('## Role: reviewer');
      expect(input).toBe(buildTaskPrompt({ ...baseOptions, role: undefined }));
    });

    it('keeps a leading --- block of the role body in developer_instructions', async () => {
      setupMockEvents();
      const blockRole = {
        ...role,
        body: '---\nkeep: this block\n---\nThe real instructions.',
      };

      await adapter.runSdk({ ...baseOptions, role: blockRole });

      expect(overrideValue('developer_instructions')).toContain(
        '---\nkeep: this block\n---\nThe real instructions.',
      );
    });

    it('keeps the role out of a continuation input and resends it on the resume config only while CODEX_RESUME_RESENDS_ROLE', async () => {
      mockRunStreamed.mockImplementation(async () => ({
        events: createFakeEventGenerator([
          { type: 'thread.started', thread_id: 'thread-r' },
        ]),
      }));
      const handle = await adapter.runSdk({ ...baseOptions, role });
      await handle.done;

      const outcome = await handle.continue?.('Follow-up');
      await outcome?.done;

      expect(mockCodexConstructor).toHaveBeenCalledTimes(2);
      expect(mockResumeThread).toHaveBeenCalledWith(
        'thread-r',
        expect.anything(),
      );
      const followUp = mockRunStreamed.mock.calls[1][0] as string;
      expect(followUp.startsWith('Follow-up')).toBe(true);
      expect(followUp).not.toContain('## Role: reviewer');
      expect(overrideValue('developer_instructions', 1)).toBe(
        CODEX_RESUME_RESENDS_ROLE ? renderRoleBlock(role, 'codex') : undefined,
      );
    });

    it('leaves the role-less config without developer_instructions', async () => {
      setupMockEvents();

      await adapter.runSdk(baseOptions);

      expect(overrideValue('developer_instructions')).toBeUndefined();
    });

    it('caps an oversized role at 10,000 chars before it reaches the Codex client', async () => {
      // The lane cap (TASK_2026_597) bounds every role block, so a 1.1 MB role
      // can no longer push developer_instructions past the command-line limit.
      setupMockEvents();
      const identity = 'IDENTITY_PARAGRAPH: you review logic, never style.';
      const hugeBody =
        `${identity}\n\n` + `${'x'.repeat(999)}.\n\n`.repeat(1_100);
      const hugeRole = { ...role, body: hugeBody, bytes: hugeBody.length };

      await adapter.runSdk({ ...baseOptions, role: hugeRole });

      const instructions = String(overrideValue('developer_instructions'));
      expect(instructions).toBe(renderRoleBlock(hugeRole, 'codex'));
      expect(hugeBody.length).toBeGreaterThan(1_000_000);
      expect(instructions.length).toBeLessThanOrEqual(10_000);
      // The identity paragraph survives and the pointer names the full file.
      expect(instructions).toContain(identity);
      expect(instructions).toContain(`\`${hugeRole.sourcePath}\``);
      expect(instructions).toContain('This role was condensed for the lane');
      expect(mockStartThread).toHaveBeenCalled();
    });

    it('does not change sandbox, approval, model or effort when a role is set', async () => {
      setupMockEvents();

      await adapter.runSdk(baseOptions);
      await adapter.runSdk({ ...baseOptions, role });

      expect(mockStartThread.mock.calls[1][0]).toEqual(
        mockStartThread.mock.calls[0][0],
      );
      const withRole = constructedOverrides(1).filter(
        (entry) => !entry.startsWith('developer_instructions='),
      );
      expect(withRole).toEqual(constructedOverrides(0));
      expect(overrideValue('approval_policy', 1)).toBe('never');
      expect(overrideValue('model_reasoning_effort', 1)).toBe('high');
    });
  });

  describe('Ptah MCP server wiring', () => {
    function setupMockEvents(events: FakeCodexEvent[]): void {
      mockRunStreamed.mockResolvedValue({
        events: createFakeEventGenerator(events),
      });
    }

    it('registers the Ptah server with its tool timeout and never the dead deferral flag', async () => {
      setupMockEvents([]);

      await adapter.runSdk({
        task: 'Task',
        workingDirectory: '/project',
        mcpPort: 51820,
      });

      // The URL carries the spawn's working directory so the server can
      // attribute this agent's calls to the right workspace (TASK_2026_364).
      expect(overrideValue('mcp_servers.ptah.url')).toBe(
        'http://localhost:51820/workspace/%2Fproject',
      );
      expect(overrideValue('mcp_servers.ptah.tool_timeout_sec')).toBe(960);
      expect(constructedOverrides().join('\n')).not.toContain(
        'tool_search_always_defer_mcp_tools',
      );
      // The SDK's own `config` flattener is bypassed entirely (N-A).
      expect(mockCodexConstructor.mock.calls[0][0]).not.toHaveProperty(
        'config',
      );
    });

    it('leads the MCP URL with /agent/{id} when one was reserved', async () => {
      setupMockEvents([]);

      await adapter.runSdk({
        task: 'Task',
        workingDirectory: '/project',
        mcpPort: 51820,
        agentId: 'agent-7',
      });

      // The agent segment is how the server learns WHICH spawn is calling
      // (TASK_2026_402) — the child never names itself.
      expect(overrideValue('mcp_servers.ptah.url')).toBe(
        'http://localhost:51820/agent/agent-7/workspace/%2Fproject',
      );
    });

    it('sets no Ptah server key when no MCP port is available', async () => {
      setupMockEvents([]);

      await adapter.runSdk({ task: 'Task', workingDirectory: '/project' });

      expect(
        constructedOverrides().some((e) => e.startsWith('mcp_servers.ptah.')),
      ).toBe(false);
    });
  });

  // TASK_2026_597 Batch 4: what the SDK double receives, turn by turn.
  describe('lane config on the SDK path', () => {
    const THREAD_OPTION_KEYS = [
      'model',
      'sandboxMode',
      'skipGitRepoCheck',
      'workingDirectory',
    ];
    const role: AgentRoleDefinition = {
      name: 'reviewer',
      body: 'Review the diff before approving.',
      sourcePath: '/project/.claude/agents/reviewer.md',
      bytes: 33,
    };
    const laneOptions = {
      task: 'Review the change',
      workingDirectory: '/project',
      model: 'gpt-6-sol',
      reasoningEffort: 'high',
      mcpPort: 51820,
      agentId: 'agent-7',
      role,
    };
    const rejectionStderr = readFileSync(
      path.join(
        __dirname,
        'codex',
        '__fixtures__',
        'exec-invalid-value.stderr.txt',
      ),
      'utf-8',
    );
    const rejectionError = (): Error =>
      new Error(`Codex Exec exited with code 1: ${rejectionStderr}`);
    const usage = { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 };

    function eventsOnce(events: FakeCodexEvent[]): void {
      mockRunStreamed.mockImplementationOnce(async () => ({
        events: createFakeEventGenerator(events),
      }));
    }

    function threadOptionKeys(mock: jest.Mock, call = 0): string[] {
      const args = mock.mock.calls[call] as unknown[];
      return Object.keys(args[args.length - 1] as object).sort();
    }

    it('first turn: role, approval, effort and web search arrive only as overrides', async () => {
      eventsOnce([]);

      const handle = await adapter.runSdk(laneOptions);
      await handle.done;

      expect(overrideValue('developer_instructions')).toBe(
        renderRoleBlock(role, 'codex'),
      );
      expect(overrideValue('web_search')).toBe('live');
      expect(overrideValue('approval_policy')).toBe('never');
      expect(overrideValue('model_reasoning_effort')).toBe('high');
      expect(overrideValue('model_auto_compact_token_limit')).toBe(120000);
      expect(overrideValue('tool_output_token_limit')).toBe(2500);
      expect(threadOptionKeys(mockStartThread)).toEqual(THREAD_OPTION_KEYS);
    });

    it('codexWebSearch=false yields web_search="disabled" with no later thread-option override (N-A)', async () => {
      eventsOnce([]);

      const handle = await adapter.runSdk({
        ...laneOptions,
        laneBudgets: {
          autoCompactTokens: 50000,
          toolOutputTokenLimit: 0,
          webSearch: false,
        },
      });
      await handle.done;

      expect(overrideValue('web_search')).toBe('disabled');
      expect(overrideValue('model_auto_compact_token_limit')).toBe(50000);
      // 0 leaves Codex's own default in place: no key at all.
      expect(overrideValue('tool_output_token_limit')).toBeUndefined();
      expect(threadOptionKeys(mockStartThread)).toEqual(THREAD_OPTION_KEYS);
    });

    it('a resume spawn uses the resume variant on resumeThread', async () => {
      eventsOnce([]);

      const handle = await adapter.runSdk({
        ...laneOptions,
        resumeSessionId: 'thread-9',
      });
      await handle.done;

      expect(mockStartThread).not.toHaveBeenCalled();
      expect(mockResumeThread).toHaveBeenCalledWith(
        'thread-9',
        expect.anything(),
      );
      expect(threadOptionKeys(mockResumeThread)).toEqual(THREAD_OPTION_KEYS);
      expect(constructedOverrides()).toContain(
        'skills.include_instructions=false',
      );
      expect(overrideValue('developer_instructions')).toBe(
        CODEX_RESUME_RESENDS_ROLE ? renderRoleBlock(role, 'codex') : undefined,
      );
    });

    it('a continue() turn builds a new client with the resume variant and drops both delivered preambles', async () => {
      eventsOnce([{ type: 'thread.started', thread_id: 'thread-1' }]);
      eventsOnce([]);

      const handle = await adapter.runSdk(laneOptions);
      await handle.done;
      const outcome = await handle.continue?.('Follow-up');
      await outcome?.done;

      expect(mockCodexConstructor).toHaveBeenCalledTimes(2);
      expect(mockResumeThread).toHaveBeenCalledWith(
        'thread-1',
        expect.anything(),
      );
      expect(constructedOverrides(1)).toContain(
        'skills.include_instructions=false',
      );
      expect(overrideValue('developer_instructions', 1)).toBe(
        CODEX_RESUME_RESENDS_ROLE ? renderRoleBlock(role, 'codex') : undefined,
      );
      // The first turn carried the tool policy and (agent id + port) the
      // messaging block, so neither is resent; the contract always is.
      const firstInput = mockRunStreamed.mock.calls[0][0] as string;
      const followUp = mockRunStreamed.mock.calls[1][0] as string;
      expect(firstInput).toContain('Tool policy:');
      expect(followUp).not.toContain('Tool policy:');
      expect(followUp.length).toBeLessThan(firstInput.length);
      expect(followUp).toContain('## Before you exit');
    });

    it('sends reader and builder warnings to the log once, never to the stream', async () => {
      const logger = createMockLogger();
      adapter = new CodexCliAdapter(logger as unknown as Logger);
      mockReadUserServers.mockResolvedValue({
        names: ['github'],
        warnings: ['Could not read /project/.codex/config.toml'],
      });
      eventsOnce([]);
      eventsOnce([]);

      const output: string[] = [];
      const first = await adapter.runSdk(laneOptions);
      first.onOutput((chunk) => output.push(chunk));
      await first.done;
      const second = await adapter.runSdk(laneOptions);
      await second.done;

      const warned = logger.warn.mock.calls.map((call) => String(call[0]));
      // No version answered, so the builder warns that it is unknown.
      expect(
        warned.filter((w) =>
          w.includes('Could not read /project/.codex/config.toml'),
        ),
      ).toHaveLength(1);
      expect(
        warned.filter((w) => w.includes('Codex version unknown')),
      ).toHaveLength(1);
      expect(output.join('')).not.toContain('config.toml');
    });

    it.each([
      ['a string', { autoCompactTokens: '120000' }, 'codexAutoCompactTokens'],
      ['a float', { toolOutputTokenLimit: 2.5 }, 'codexToolOutputTokenLimit'],
      ['a negative value', { autoCompactTokens: -1 }, 'codexAutoCompactTokens'],
      [
        'a value above MAX_SAFE_INTEGER',
        { toolOutputTokenLimit: Number.MAX_SAFE_INTEGER + 1 },
        'codexToolOutputTokenLimit',
      ],
      ['a non-boolean web search', { webSearch: 'false' }, 'codexWebSearch'],
    ])(
      'replaces %s from settings with the default and warns once for that key',
      async (_label, budgets, key) => {
        const logger = createMockLogger();
        adapter = new CodexCliAdapter(logger as unknown as Logger);
        eventsOnce([]);
        eventsOnce([]);
        // Settings import does not validate values: the lane must not trust
        // them (Batch 3 review).
        const laneBudgets = {
          autoCompactTokens: 120000,
          toolOutputTokenLimit: 2500,
          webSearch: true,
          ...budgets,
        } as unknown as CliLaneBudgets;

        await (
          await adapter.runSdk({ ...laneOptions, laneBudgets })
        ).done;
        await (
          await adapter.runSdk({ ...laneOptions, laneBudgets })
        ).done;

        for (const call of [0, 1]) {
          expect(overrideValue('model_auto_compact_token_limit', call)).toBe(
            120000,
          );
          expect(overrideValue('tool_output_token_limit', call)).toBe(2500);
          expect(overrideValue('web_search', call)).toBe('live');
        }
        const keyWarnings = logger.warn.mock.calls
          .map((call) => String(call[0]))
          .filter((w) => w.includes(`agentOrchestration.${key}`));
        expect(keyWarnings).toHaveLength(1);
      },
    );

    it('retries a config rejection once with the essential keys, keeping effort and the user-server entry', async () => {
      const logger = createMockLogger();
      adapter = new CodexCliAdapter(logger as unknown as Logger);
      mockReadUserServers.mockResolvedValue({
        names: ['github'],
        warnings: [],
      });
      mockRunStreamed.mockRejectedValueOnce(rejectionError());
      eventsOnce([{ type: 'turn.completed', usage }]);

      const handle = await adapter.runSdk(laneOptions);
      const segments: CliOutputSegment[] = [];
      handle.onSegment?.((s) => segments.push(s));
      const rejected = jest.fn();
      handle.onLaneConfigRejected?.(rejected);

      expect(await handle.done).toBe(0);
      expect(mockCodexConstructor).toHaveBeenCalledTimes(2);
      expect(
        constructedOverrides(0).some((e) => e.startsWith('mcp_servers={')),
      ).toBe(true);
      // Effort (M1) and the user-server disable (M3) survive the retry.
      expect(constructedOverrides(1).map((e) => e.split('=')[0])).toEqual([
        'web_search',
        'approval_policy',
        'model_reasoning_effort',
        'mcp_servers',
        'mcp_servers.ptah.url',
        'mcp_servers.ptah.tool_timeout_sec',
        'developer_instructions',
      ]);
      expect(overrideValue('model_reasoning_effort', 1)).toBe('high');
      expect(constructedOverrides(1)).toContain(
        'mcp_servers={"github"={enabled=false}}',
      );
      // `--model` is a thread option and stays.
      expect(mockStartThread.mock.calls[1][0]).toMatchObject({
        model: 'gpt-6-sol',
      });
      expect(rejected).toHaveBeenCalledTimes(1);
      expect(segments).toContainEqual({
        type: 'info',
        content:
          'Codex rejected the lane config; this run drops the lane budget and prefix keys, so Codex defaults and the full Codex prefix apply',
      });
      const warnCall = logger.warn.mock.calls.find((call) =>
        String(call[0]).includes('rejected the lane config'),
      );
      const fields = warnCall?.[1] as {
        stderr: string;
        userServersReEnabled: boolean;
      };
      expect(fields.stderr.startsWith('Error loading config.toml')).toBe(true);
      expect(fields.stderr.length).toBeLessThanOrEqual(200);
      expect(fields.userServersReEnabled).toBe(false);
    });

    it('drops the user-server entry only when Codex names a user server, and says so (M3)', async () => {
      const logger = createMockLogger();
      adapter = new CodexCliAdapter(logger as unknown as Logger);
      mockReadUserServers.mockResolvedValue({ names: ['ghost'], warnings: [] });
      const serverStderr = readFileSync(
        path.join(
          __dirname,
          'codex',
          '__fixtures__',
          'exec-unloaded-server-disable.stderr.txt',
        ),
        'utf-8',
      );
      mockRunStreamed.mockRejectedValueOnce(
        new Error(`Codex Exec exited with code 1: ${serverStderr}`),
      );
      eventsOnce([{ type: 'turn.completed', usage }]);

      const handle = await adapter.runSdk(laneOptions);
      const segments: CliOutputSegment[] = [];
      handle.onSegment?.((s) => segments.push(s));

      expect(await handle.done).toBe(0);
      expect(
        constructedOverrides(1).some((e) => e.startsWith('mcp_servers={')),
      ).toBe(false);
      expect(overrideValue('model_reasoning_effort', 1)).toBe('high');
      const info = segments.find((s) => s.type === 'info');
      expect(info?.content).toContain(
        'your own MCP servers are enabled for this lane',
      );
      const warnCall = logger.warn.mock.calls.find((call) =>
        String(call[0]).includes('rejected the lane config'),
      );
      expect(
        (warnCall?.[1] as { userServersReEnabled: boolean })
          .userServersReEnabled,
      ).toBe(true);
    });

    it('reports a second rejection as a normal error and never retries again', async () => {
      mockRunStreamed.mockRejectedValueOnce(rejectionError());
      mockRunStreamed.mockRejectedValueOnce(rejectionError());

      const handle = await adapter.runSdk(laneOptions);
      const segments: CliOutputSegment[] = [];
      handle.onSegment?.((s) => segments.push(s));

      expect(await handle.done).toBe(1);
      expect(mockCodexConstructor).toHaveBeenCalledTimes(2);
      expect(segments.filter((s) => s.type === 'error')).toHaveLength(1);
    });

    it("restores the full lane config for later turns when the essential config is rejected too (M2: the user's own config.toml)", async () => {
      const logger = createMockLogger();
      adapter = new CodexCliAdapter(logger as unknown as Logger);
      mockRunStreamed.mockRejectedValueOnce(rejectionError());
      mockRunStreamed.mockRejectedValueOnce(rejectionError());
      eventsOnce([{ type: 'turn.completed', usage }]);

      const handle = await adapter.runSdk(laneOptions);
      const rejected = jest.fn();
      handle.onLaneConfigRejected?.(rejected);
      expect(await handle.done).toBe(1);

      const next = await handle.continue?.('next step');
      expect(await next?.done).toBe(0);

      // The continue() turn carries the budgets again.
      expect(mockCodexConstructor).toHaveBeenCalledTimes(3);
      expect(overrideValue('model_auto_compact_token_limit', 2)).toBe(120000);
      expect(overrideValue('tool_output_token_limit', 2)).toBe(2500);
      expect(rejected).toHaveBeenCalledTimes(1);
      expect(
        logger.warn.mock.calls.some((call) =>
          String(call[0]).includes('essential lane config too'),
        ),
      ).toBe(true);
    });

    it('keeps the essential keys for later turns when the essential retry worked', async () => {
      mockRunStreamed.mockRejectedValueOnce(rejectionError());
      eventsOnce([{ type: 'turn.completed', usage }]);
      eventsOnce([{ type: 'turn.completed', usage }]);

      const handle = await adapter.runSdk(laneOptions);
      expect(await handle.done).toBe(0);
      const next = await handle.continue?.('next step');
      expect(await next?.done).toBe(0);

      expect(mockCodexConstructor).toHaveBeenCalledTimes(3);
      expect(
        overrideValue('model_auto_compact_token_limit', 2),
      ).toBeUndefined();
      expect(overrideValue('model_reasoning_effort', 2)).toBe('high');
    });

    it("names Ptah's lane default when Codex rejects it, quotes and logs Codex's text, and never retries another model (F10)", async () => {
      const logger = createMockLogger();
      adapter = new CodexCliAdapter(logger as unknown as Logger);
      eventsOnce([
        {
          type: 'turn.failed',
          error: {
            message:
              "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.",
          },
        },
      ]);

      const handle = await adapter.runSdk({
        ...laneOptions,
        modelSource: 'ptah-default',
      });
      const segments: CliOutputSegment[] = [];
      handle.onSegment?.((s) => segments.push(s));

      expect(await handle.done).toBe(1);
      expect(segments).toContainEqual({
        type: 'error',
        content:
          "Codex rejected `gpt-6-sol`, Ptah's lane default. Set `agentOrchestration.codexModel` to a model your account offers. Codex said: \"The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.\"",
      });
      expect(mockCodexConstructor).toHaveBeenCalledTimes(1);
      const warnCall = logger.warn.mock.calls.find((call) =>
        String(call[0]).includes('rejected the lane model'),
      );
      expect(warnCall?.[1]).toMatchObject({
        model: 'gpt-6-sol',
        modelSource: 'ptah-default',
        codexError:
          "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.",
      });
    });

    it.each([
      ['a capacity notice', 'The model is not available right now. Try again.'],
      ['a bare unsupported word', 'model request unsupported: try later'],
    ])(
      'passes %s through untouched instead of the F10 advice (S1)',
      async (_label, message) => {
        eventsOnce([{ type: 'turn.failed', error: { message } }]);

        const handle = await adapter.runSdk({
          ...laneOptions,
          modelSource: 'ptah-default',
        });
        const segments: CliOutputSegment[] = [];
        handle.onSegment?.((s) => segments.push(s));

        expect(await handle.done).toBe(1);
        const text = segments.map((s) => s.content).join('\n');
        expect(text).not.toContain('agentOrchestration.codexModel');
      },
    );

    it('leaves a non-terminal error event with model wording to the normal path (S1)', async () => {
      eventsOnce([
        {
          type: 'error',
          message: "The 'gpt-6-sol' model is not supported right now",
        },
        { type: 'turn.completed', usage },
      ]);

      const handle = await adapter.runSdk({
        ...laneOptions,
        modelSource: 'ptah-default',
      });
      const segments: CliOutputSegment[] = [];
      handle.onSegment?.((s) => segments.push(s));

      expect(await handle.done).toBe(0);
      const text = segments.map((s) => s.content).join('\n');
      expect(text).not.toContain('agentOrchestration.codexModel');
    });

    it('refuses a spawn whose whole override argv is over the command-line limit, before any client (H6)', async () => {
      // Enough user servers to break every platform's limit through the real
      // reader -> builder -> argv path.
      mockReadUserServers.mockResolvedValue({
        names: Array.from(
          { length: 40_000 },
          (_, i) => `user-server-${String(i).padStart(20, '0')}`,
        ),
        warnings: [],
      });

      await expect(adapter.runSdk(laneOptions)).rejects.toMatchObject({
        name: 'CliCommandLineTooLongError',
      });
      expect(mockCodexConstructor).not.toHaveBeenCalled();
    });
  });

  describe('commandToolLabel()', () => {
    it.each([
      [
        '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Content -Raw D:\\a.md"',
        'Get-Content',
      ],
      ['powershell.exe -Command "rg --files D:\\src"', 'rg'],
      ['bash -lc "git status"', 'git'],
      ["/bin/sh -c 'npm test'", 'npm'],
      ['npm test', 'npm'],
    ])('labels %s as %s', (command, expected) => {
      expect(commandToolLabel(command)).toBe(expected);
    });

    it('falls back to Shell for an empty command', () => {
      expect(commandToolLabel('   ')).toBe('Shell');
    });
  });

  describe('segment shapes the tool cards render', () => {
    /** Run one item through the adapter and return the segments it produced. */
    async function segmentsFor(event: unknown): Promise<
      Array<{
        type: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        content: string;
        toolCallId?: string;
      }>
    > {
      mockRunStreamed.mockResolvedValue({
        events: createFakeEventGenerator([event as FakeCodexEvent]),
      });
      const handle = await adapter.runSdk({
        task: 'Task',
        workingDirectory: '/project',
      });
      const segments: Array<{
        type: string;
        toolName?: string;
        toolInput?: Record<string, unknown>;
        content: string;
        toolCallId?: string;
      }> = [];
      handle.onSegment?.((segment) => segments.push(segment));
      handle.onOutput(() => {
        /* drain */
      });
      await handle.done;
      return segments;
    }

    it('sends a command as Bash with a command and a description', async () => {
      const segments = await segmentsFor({
        type: 'item.started',
        item: {
          type: 'command_execution',
          id: 'cmd1',
          command:
            '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "rg --files D:\\src"',
          aggregated_output: '',
          status: 'in_progress',
        },
      });

      expect(segments[0]).toMatchObject({
        type: 'tool-call',
        toolName: 'Bash',
        toolInput: { command: 'rg --files D:\\src', description: 'rg' },
        toolCallId: 'cmd1',
      });
    });

    it('names an MCP call the way the UI expects and parses its arguments', async () => {
      const segments = await segmentsFor({
        type: 'item.started',
        item: {
          type: 'mcp_tool_call',
          id: 'mcp1',
          server: 'ptah',
          tool: 'ptah_search_files',
          arguments: '{"pattern":"**/*.ts"}',
          status: 'in_progress',
        },
      });

      expect(segments[0]).toMatchObject({
        type: 'tool-call',
        toolName: 'mcp__ptah__ptah_search_files',
        toolInput: { pattern: '**/*.ts' },
      });
    });

    it('flattens a structured MCP result instead of rendering [object Object]', async () => {
      const segments = await segmentsFor({
        type: 'item.completed',
        item: {
          type: 'mcp_tool_call',
          id: 'mcp1',
          server: 'ptah',
          tool: 'ptah_search_files',
          result: { content: [{ type: 'text', text: 'two matches' }] },
          status: 'completed',
        },
      });

      expect(segments[0]).toMatchObject({
        type: 'tool-result',
        content: 'two matches',
      });
    });

    it('pairs each patched file with its own card', async () => {
      const segments = await segmentsFor({
        type: 'item.completed',
        item: {
          type: 'file_change',
          id: 'fc1',
          changes: [
            { path: 'src/app.ts', kind: 'update' },
            { path: 'src/new.ts', kind: 'add' },
          ],
          status: 'completed',
        },
      });

      expect(segments).toMatchObject([
        {
          type: 'tool-call',
          toolName: 'Edit',
          toolInput: { file_path: 'src/app.ts' },
          toolCallId: 'fc1:0',
        },
        { type: 'file-change', toolCallId: 'fc1:0' },
        {
          type: 'tool-call',
          toolName: 'Write',
          toolInput: { file_path: 'src/new.ts' },
          toolCallId: 'fc1:1',
        },
        { type: 'file-change', toolCallId: 'fc1:1' },
      ]);
    });

    it('sends a todo list as TodoWrite so it renders as a task list', async () => {
      const segments = await segmentsFor({
        type: 'item.completed',
        item: {
          type: 'todo_list',
          id: 'todo1',
          items: [
            { text: 'Read the adapter', completed: true },
            { text: 'Fix the labels', completed: false },
          ],
        },
      });

      expect(segments[0]).toMatchObject({
        type: 'tool-call',
        toolName: 'TodoWrite',
        toolInput: {
          todos: [
            {
              content: 'Read the adapter',
              status: 'completed',
              activeForm: 'Read the adapter',
            },
            {
              content: 'Fix the labels',
              status: 'pending',
              activeForm: 'Fix the labels',
            },
          ],
        },
      });
      // The card only renders its output section when a result arrives.
      expect(segments[1]).toMatchObject({ type: 'tool-result' });
    });

    it('sends a web search as a WebSearch card', async () => {
      const segments = await segmentsFor({
        type: 'item.completed',
        item: { type: 'web_search', id: 'ws1', query: 'codex mcp deferral' },
      });

      expect(segments[0]).toMatchObject({
        type: 'tool-call',
        toolName: 'WebSearch',
        toolInput: { query: 'codex mcp deferral' },
      });
    });
  });

  describe('unknown thread items', () => {
    it('reports an item type this SDK version does not declare', async () => {
      mockRunStreamed.mockResolvedValue({
        events: createFakeEventGenerator([
          {
            type: 'item.completed',
            // A future Codex build; deliberately outside FakeCodexEvent.
            item: { type: 'view_image', id: 'img1' },
          } as unknown as FakeCodexEvent,
        ]),
      });

      const handle = await adapter.runSdk({
        task: 'Task',
        workingDirectory: '/project',
      });
      const output: string[] = [];
      handle.onOutput((data: string) => output.push(data));
      await handle.done;

      expect(output).toContain('[view_image]\n');
    });
  });
});
