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
import type { SdkHandle } from './cli-adapter.interface';

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

    // No native binary candidate exists unless a test says otherwise.
    mockExistsSync.mockReturnValue(false);

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
      expect(result.supportsSteer).toBe(false);
    });

    it('should return installed: false when codex binary is not found', async () => {
      mockResolveCliPath.mockResolvedValue(null);

      const result = await adapter.detect();

      expect(result.cli).toBe('codex');
      expect(result.installed).toBe(false);
      expect(result.supportsSteer).toBe(false);
      expect(mockProbeCliVersion).not.toHaveBeenCalled();
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
      // approvalPolicy/sandboxMode/skipGitRepoCheck trio so Codex runs
      // non-interactively without permission hooks.
      expect(mockStartThread).toHaveBeenCalledWith({
        workingDirectory: '/project/root',
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
        skipGitRepoCheck: true,
        webSearchEnabled: true,
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

    it('runs the next turn on the SAME thread via runStreamed', async () => {
      setupMockEvents([]);
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
      expect(mockRunStreamed).toHaveBeenCalledTimes(2);
      expect(mockRunStreamed.mock.calls[1][0]).toBe('Follow-up message');
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

  describe('Ptah MCP server wiring', () => {
    function setupMockEvents(events: FakeCodexEvent[]): void {
      mockRunStreamed.mockResolvedValue({
        events: createFakeEventGenerator(events),
      });
    }

    it('registers the Ptah server AND disables MCP tool deferral', async () => {
      setupMockEvents([]);

      await adapter.runSdk({
        task: 'Task',
        workingDirectory: '/project',
        mcpPort: 51820,
      });

      const config = mockCodexConstructor.mock.calls[0][0].config;
      expect(config.mcp_servers).toEqual({
        ptah: { url: 'http://localhost:51820' },
      });
      // Without this, codex-cli 0.150 connects to the server and still keeps
      // every ptah_* tool out of the model's tool list until it runs a tool
      // search — which the model has no reason to do, so it uses the shell.
      expect(config.features).toEqual({
        tool_search_always_defer_mcp_tools: false,
      });
    });

    it('sets neither key when no MCP port is available', async () => {
      setupMockEvents([]);

      await adapter.runSdk({ task: 'Task', workingDirectory: '/project' });

      const config = mockCodexConstructor.mock.calls[0][0].config;
      expect(config.mcp_servers).toBeUndefined();
      expect(config.features).toBeUndefined();
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
