/**
 * CopilotSdkAdapter Unit Tests
 * TASK_2025_294 Batch W7.B1
 *
 * Tests: detect(), listModels() (static + dynamic), runSdk() session wiring
 *        with streaming events, abort propagation, auth-required negative
 *        path, session creation failure, and Windows .cmd resolution.
 *
 * Uses jest.mock('@github/copilot-sdk', ...) so the adapter's dynamic
 * import() returns a controllable fake SDK.
 */

// ---- Mocks must be declared before any imports that trigger module resolution ----

import { EventEmitter } from 'events';

// --- Mock vscode (auth API) ---
const mockGetSession = jest.fn();
jest.mock(
  'vscode',
  () => ({
    authentication: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  }),
  { virtual: true },
);

// --- Mock @github/copilot-sdk (ESM-only; imported via dynamic import()) ---
interface FakeSessionCtl {
  sessionId: string;
  emit: (type: string, data: Record<string, unknown>) => void;
  send: jest.Mock<Promise<string>, [{ prompt: string }]>;
  abort: jest.Mock<Promise<void>, []>;
  destroy: jest.Mock<Promise<void>, []>;
}

interface FakeClientCtl {
  start: jest.Mock<Promise<void>, []>;
  stop: jest.Mock<Promise<Error[]>, []>;
  forceStop: jest.Mock<Promise<void>, []>;
  createSession: jest.Mock<Promise<unknown>, [unknown?]>;
  resumeSession: jest.Mock<Promise<unknown>, [string, unknown?]>;
  listModels: jest.Mock<Promise<Array<{ id: string; name: string }>>, []>;
  getState: jest.Mock<string, []>;
}

// Captured between tests
let currentSession: FakeSessionCtl | null = null;
let currentClient: FakeClientCtl | null = null;
let capturedClientOptions: Record<string, unknown> | null = null;
const copilotClientConstructor = jest.fn();

function createFakeSession(sessionId: string): {
  ctl: FakeSessionCtl;
  session: unknown;
} {
  const bus = new EventEmitter();

  const ctl: FakeSessionCtl = {
    sessionId,
    emit: (type, data) => {
      bus.emit(type, { id: `evt-${type}`, timestamp: '', type, data });
    },
    send: jest.fn(async (_opts: { prompt: string }) => 'assistant-msg-id'),
    abort: jest.fn(async () => {
      /* noop */
    }),
    destroy: jest.fn(async () => {
      /* noop */
    }),
  };

  const session = {
    sessionId,
    on: (
      type: string,
      handler: (event: {
        id: string;
        timestamp: string;
        type: string;
        data: Record<string, unknown>;
      }) => void,
    ): (() => void) => {
      bus.on(type, handler);
      return () => bus.off(type, handler);
    },
    send: ctl.send,
    sendAndWait: jest.fn(),
    abort: ctl.abort,
    destroy: ctl.destroy,
  };

  return { ctl, session };
}

jest.mock(
  '@github/copilot-sdk',
  () => ({
    __esModule: true,
    CopilotClient: copilotClientConstructor,
  }),
  { virtual: true },
);

// --- Mock cli-adapter.utils for detect() path and Windows .cmd handling ---
const mockResolveCliPath = jest.fn();
const mockResolveWindowsCmd = jest.fn();
jest.mock('./cli-adapter.utils', () => {
  const actual = jest.requireActual<typeof import('./cli-adapter.utils')>(
    './cli-adapter.utils',
  );
  return {
    ...actual,
    resolveCliPath: (...args: unknown[]) => mockResolveCliPath(...args),
    resolveWindowsCmd: (...args: unknown[]) => mockResolveWindowsCmd(...args),
  };
});

// --- Mock child_process for the version-probe in detect() ---
const mockExecFile = jest.fn();
jest.mock('child_process', () => ({
  execFile: mockExecFile,
}));

// Import AFTER mocks are declared
import { CopilotSdkAdapter } from './copilot-sdk.adapter';
import { CopilotPermissionBridge } from './copilot-permission-bridge';

function createClient(): { ctl: FakeClientCtl; client: unknown } {
  const ctl: FakeClientCtl = {
    start: jest.fn(async () => {
      /* noop */
    }),
    stop: jest.fn(async () => [] as Error[]),
    forceStop: jest.fn(async () => {
      /* noop */
    }),
    createSession: jest.fn(async (_config?: unknown) => {
      const { ctl: sessCtl, session } = createFakeSession('copilot-sess-1');
      currentSession = sessCtl;
      return session;
    }),
    resumeSession: jest.fn(async (_id: string, _config?: unknown) => {
      const { ctl: sessCtl, session } = createFakeSession('resumed-sess');
      currentSession = sessCtl;
      return session;
    }),
    listModels: jest.fn(async () => [
      { id: 'dynamic-model-1', name: 'Dynamic Model 1' },
    ]),
    getState: jest.fn(() => 'ready'),
  };

  const client = {
    start: ctl.start,
    stop: ctl.stop,
    forceStop: ctl.forceStop,
    createSession: ctl.createSession,
    resumeSession: ctl.resumeSession,
    listModels: ctl.listModels,
    getState: ctl.getState,
  };

  return { ctl, client };
}

describe('CopilotSdkAdapter', () => {
  let adapter: CopilotSdkAdapter;
  let bridge: CopilotPermissionBridge;

  beforeEach(() => {
    jest.clearAllMocks();
    currentSession = null;
    currentClient = null;
    capturedClientOptions = null;

    // Every new CopilotClient() call yields a fresh client; capture options.
    copilotClientConstructor.mockImplementation(
      (options?: Record<string, unknown>) => {
        const { ctl, client } = createClient();
        currentClient = ctl;
        capturedClientOptions = options ?? null;
        return client;
      },
    );

    // Default: no VS Code GitHub session (useLoggedInUser fallback path).
    mockGetSession.mockResolvedValue(null);
    // Default: non-Windows .cmd resolution returns the input unchanged.
    mockResolveWindowsCmd.mockImplementation(async (p: string) => p);

    bridge = new CopilotPermissionBridge();
    adapter = new CopilotSdkAdapter(bridge);
  });

  describe('detect()', () => {
    it('reports installed when copilot is on PATH', async () => {
      mockResolveCliPath.mockResolvedValue('/usr/local/bin/copilot');
      mockExecFile.mockImplementation(
        (
          _cmd: string,
          _args: readonly string[],
          _opts: Record<string, unknown>,
          cb?: (err: Error | null, result: { stdout: string }) => void,
        ) => {
          cb?.(null, { stdout: 'copilot 0.1.25\n' });
        },
      );

      const result = await adapter.detect();

      expect(result.cli).toBe('copilot');
      expect(result.installed).toBe(true);
      expect(result.path).toBe('/usr/local/bin/copilot');
      expect(result.version).toBe('copilot 0.1.25');
      expect(result.supportsSteer).toBe(false);
    });

    it('reports not installed when copilot is missing', async () => {
      mockResolveCliPath.mockResolvedValue(null);

      const result = await adapter.detect();

      expect(result.cli).toBe('copilot');
      expect(result.installed).toBe(false);
    });
  });

  describe('listModels()', () => {
    it('returns the static COPILOT_MODELS list before the client is initialized', async () => {
      const models = await adapter.listModels();
      // Static list contains claude-sonnet-4.5 etc.
      expect(models.some((m) => m.id === 'claude-sonnet-4.5')).toBe(true);
    });

    it('delegates to client.listModels() once the client is initialized', async () => {
      // Run a full runSdk() to force ensureClient() to wire the singleton.
      const handle = await adapter.runSdk({
        task: 'warm up the client',
        workingDirectory: '/proj',
      });
      handle.onOutput(() => {
        /* drain */
      });
      currentSession?.emit('session.idle', {});
      await handle.done;

      const models = await adapter.listModels();
      expect(currentClient?.listModels).toHaveBeenCalled();
      expect(models).toEqual([
        { id: 'dynamic-model-1', name: 'Dynamic Model 1' },
      ]);
    });
  });

  describe('runSdk() — session wiring', () => {
    const defaultOptions = {
      task: 'Implement feature X',
      workingDirectory: '/proj',
    };

    it('uses useLoggedInUser when no VS Code GitHub session is available (auth-required negative path)', async () => {
      mockGetSession.mockResolvedValue(null);

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      expect(copilotClientConstructor).toHaveBeenCalledTimes(1);
      expect(capturedClientOptions?.['useLoggedInUser']).toBe(true);
      expect(capturedClientOptions?.['githubToken']).toBeUndefined();
      expect(currentClient?.start).toHaveBeenCalled();

      // Resolve done via idle.
      currentSession?.emit('session.idle', {});
      const code = await handle.done;
      expect(code).toBe(0);
    });

    it('passes a GitHub token when a VS Code session exists', async () => {
      mockGetSession.mockResolvedValue({ accessToken: 'gh-token-abc' });

      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      expect(capturedClientOptions?.['githubToken']).toBe('gh-token-abc');
      expect(capturedClientOptions?.['useLoggedInUser']).toBeUndefined();

      currentSession?.emit('session.idle', {});
      await handle.done;
    });

    it('resolves Windows .cmd binaryPath via resolveWindowsCmd before passing to the SDK', async () => {
      const cmdPath = 'C:\\Users\\dev\\AppData\\Roaming\\npm\\copilot.cmd';
      mockResolveWindowsCmd.mockResolvedValue(
        'C:\\real\\path\\copilot\\bin\\copilot.js',
      );

      const handle = await adapter.runSdk({
        ...defaultOptions,
        binaryPath: cmdPath,
      });
      handle.onOutput(() => {
        /* drain */
      });

      expect(mockResolveWindowsCmd).toHaveBeenCalledWith(cmdPath);
      expect(capturedClientOptions?.['cliPath']).toBe(
        'C:\\real\\path\\copilot\\bin\\copilot.js',
      );

      currentSession?.emit('session.idle', {});
      await handle.done;
    });

    it('streams assistant.message_delta events as text output + text segments', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      const segments: Array<{ type: string; content: string }> = [];
      handle.onOutput((data) => output.push(data));
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, content: seg.content }),
      );

      currentSession?.emit('assistant.message_delta', {
        deltaContent: 'Hello ',
      });
      currentSession?.emit('assistant.message_delta', {
        deltaContent: 'world',
      });
      // Full assistant.message after deltas should be skipped.
      currentSession?.emit('assistant.message', {
        content: 'Hello world',
      });
      currentSession?.emit('session.idle', {});

      const code = await handle.done;
      expect(code).toBe(0);
      expect(output.join('')).toContain('Hello ');
      expect(output.join('')).toContain('world');
      // Check we got two delta segments but no duplicate full-message segment.
      const textSegs = segments.filter((s) => s.type === 'text');
      expect(textSegs.map((s) => s.content)).toEqual(['Hello ', 'world']);
    });

    it('maps tool.execution_start/complete into tool-call + tool-result segments', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const segments: Array<{
        type: string;
        toolName?: string;
        content: string;
      }> = [];
      handle.onOutput(() => {
        /* drain */
      });
      handle.onSegment?.((seg) =>
        segments.push({
          type: seg.type,
          toolName: seg.toolName,
          content: seg.content,
        }),
      );

      currentSession?.emit('tool.execution_start', {
        toolName: 'read_file',
        arguments: { path: 'src/app.ts' },
        toolCallId: 'tc-1',
      });
      currentSession?.emit('tool.execution_complete', {
        success: true,
        toolCallId: 'tc-1',
        result: { content: 'file contents here' },
      });
      currentSession?.emit('session.idle', {});

      await handle.done;

      expect(
        segments.some(
          (s) => s.type === 'tool-call' && s.toolName === 'read_file',
        ),
      ).toBe(true);
      expect(
        segments.some(
          (s) =>
            s.type === 'tool-result' && /file contents here/.test(s.content),
        ),
      ).toBe(true);
    });

    it('maps tool.execution_complete errors to tool-result-error segments', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const segments: Array<{ type: string; content: string }> = [];
      handle.onOutput(() => {
        /* drain */
      });
      handle.onSegment?.((seg) =>
        segments.push({ type: seg.type, content: seg.content }),
      );

      currentSession?.emit('tool.execution_start', {
        toolName: 'write_file',
        arguments: { path: '/readonly/file' },
        toolCallId: 'tc-err',
      });
      currentSession?.emit('tool.execution_complete', {
        success: false,
        toolCallId: 'tc-err',
        error: { message: 'EACCES: permission denied' },
      });
      currentSession?.emit('session.idle', {});
      await handle.done;

      expect(
        segments.some(
          (s) =>
            s.type === 'tool-result-error' &&
            /permission denied/.test(s.content),
        ),
      ).toBe(true);
    });

    it('resolves done with 1 when session.error fires', async () => {
      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data) => output.push(data));

      currentSession?.emit('session.error', {
        message: 'upstream Copilot API failure',
      });

      const code = await handle.done;
      expect(code).toBe(1);
      expect(output.join('')).toContain('upstream Copilot API failure');
    });

    it('aborts the session and resolves done with 1 when AbortController fires', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      handle.abort.abort();

      expect(currentSession?.abort).toHaveBeenCalled();
      expect(currentSession?.destroy).toHaveBeenCalled();

      const code = await handle.done;
      expect(code).toBe(1);
      expect(handle.abort.signal.aborted).toBe(true);
    });

    it('returns a failed handle (done=1) when createSession throws', async () => {
      // Override the client factory to throw on createSession.
      copilotClientConstructor.mockImplementationOnce(
        (options?: Record<string, unknown>) => {
          capturedClientOptions = options ?? null;
          return {
            start: jest.fn(async () => {
              /* noop */
            }),
            stop: jest.fn(async () => [] as Error[]),
            forceStop: jest.fn(async () => {
              /* noop */
            }),
            createSession: jest.fn(async () => {
              throw new Error('account not entitled');
            }),
            resumeSession: jest.fn(),
            listModels: jest.fn(async () => []),
            getState: jest.fn(() => 'error'),
          };
        },
      );

      const handle = await adapter.runSdk(defaultOptions);

      const output: string[] = [];
      handle.onOutput((data) => output.push(data));
      // In the failure branch, the adapter may push buffered output when
      // onOutput is registered. Give the buffer a tick to flush.
      await new Promise((r) => setImmediate(r));

      const code = await handle.done;
      expect(code).toBe(1);
      expect(output.join('')).toContain('account not entitled');
    });

    it('uses resumeSession when resumeSessionId is provided', async () => {
      const handle = await adapter.runSdk({
        ...defaultOptions,
        resumeSessionId: 'prev-session-123',
      });
      handle.onOutput(() => {
        /* drain */
      });

      expect(currentClient?.resumeSession).toHaveBeenCalledWith(
        'prev-session-123',
        expect.any(Object),
      );
      expect(currentClient?.createSession).not.toHaveBeenCalled();

      currentSession?.emit('session.idle', {});
      await handle.done;
    });

    it('updates the agentId used for permission routing via setAgentId()', async () => {
      const handle = await adapter.runSdk(defaultOptions);
      handle.onOutput(() => {
        /* drain */
      });

      expect(typeof handle.setAgentId).toBe('function');
      // Just smoke-test that calling it is safe and returns nothing.
      expect(handle.setAgentId?.('real-agent-id')).toBeUndefined();

      currentSession?.emit('session.idle', {});
      await handle.done;
    });
  });

  describe('dispose()', () => {
    it('stops the singleton client and cleans up the permission bridge', async () => {
      // Warm the client via a runSdk() round-trip.
      const handle = await adapter.runSdk({
        task: 'warm client',
        workingDirectory: '/proj',
      });
      handle.onOutput(() => {
        /* drain */
      });
      currentSession?.emit('session.idle', {});
      await handle.done;

      const cleanupSpy = jest.spyOn(bridge, 'cleanup');
      const stopSpy = currentClient?.stop;
      await adapter.dispose();

      expect(cleanupSpy).toHaveBeenCalled();
      expect(stopSpy).toHaveBeenCalled();
    });
  });
});
