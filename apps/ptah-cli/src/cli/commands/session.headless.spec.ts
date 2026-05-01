/**
 * Integration-level regression tests for `ptah session start --task` headless flow.
 *
 * Bug context: commit 00364dc8 — CLI registered `SdkAgentAdapter` in DI but
 * never called `initialize()`. Every `chat:start` RPC threw inside the adapter,
 * was swallowed by the chat-session catch, and `chat-bridge.ts` hung forever
 * waiting for terminal events. `ptah session start --task "..."` only emitted
 * `session.created` then never spawned claude.
 *
 * These tests prove the WIRING is correct end-to-end (SDK adapter init →
 * chat:start → push events → bridge resolves → JSON-RPC stream emitted),
 * complementing the per-component unit tests in:
 *   - apps/ptah-cli/src/cli/bootstrap/with-engine.spec.ts (init lifecycle)
 *   - apps/ptah-cli/src/cli/session/chat-bridge.spec.ts ({success:false} ack)
 *   - apps/ptah-cli/src/cli/output/stderr-json.spec.ts (NDJSON shape)
 */

import { EventEmitter } from 'node:events';

// Mock @ptah-extension/agent-sdk barrel — same pattern as session.spec.ts.
jest.mock(
  '@ptah-extension/agent-sdk',
  () => {
    const {
      mockAnthropicProviders,
    } = require('../../test-utils/agent-sdk-mock');
    return {
      SDK_TOKENS: {
        SDK_PERMISSION_HANDLER: Symbol.for('SdkPermissionHandler'),
      },
      ANTHROPIC_PROVIDERS: mockAnthropicProviders(),
    };
  },
  { virtual: true },
);

import { execute } from './session.js';
import type { SessionExecuteHooks } from './session.js';
import { SdkInitFailedError, withEngine } from '../bootstrap/with-engine.js';
import type {
  CliBootstrapOptions,
  CliBootstrapResult,
} from '../../di/container.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import {
  PLATFORM_TOKENS,
  type IStateStorage,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { DependencyContainer } from 'tsyringe';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/test-workspace',
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: true,
  reveal: false,
};

interface NotificationCall {
  method: string;
  params?: unknown;
}

function makeFormatter(): {
  formatter: Formatter;
  notifications: NotificationCall[];
} {
  const notifications: NotificationCall[] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { formatter, notifications };
}

/**
 * Drain microtasks across multiple ticks so that `runStart`'s prologue
 * (persist → emit → bridge.attach → rpcCall) finishes before the test fires
 * push events.
 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
  }
}

interface FakeAdapter {
  initialize: jest.Mock<Promise<boolean>, []>;
  dispose: jest.Mock<void, []>;
  /** Hook called when chat:start RPC fires. Default: emits chat:complete. */
  onChatStart?: (
    params: { tabId: string; prompt?: string },
    pushAdapter: EventEmitter,
  ) => void;
}

interface IntegrationHarness {
  bootstrap: NonNullable<
    Parameters<typeof withEngine>[1] extends infer O
      ? O extends { bootstrap?: infer B }
        ? B
        : never
      : never
  >;
  pushAdapter: EventEmitter;
  rpcCalls: Array<{ method: string; params: unknown }>;
  storageMap: Map<string, unknown>;
  fakeAdapter: FakeAdapter;
  // Real `withEngine` is exported below but typed loosely via SessionExecuteHooks.
  withEngineHook: SessionExecuteHooks['withEngine'];
}

/**
 * Build a harness that reuses the REAL `withEngine` so the test exercises
 * the actual SDK adapter init → fn(ctx) → dispose pipeline. Only the
 * `bootstrap` hook is faked.
 */
function makeIntegrationHarness(opts?: {
  initializeReturns?: boolean;
  initializeThrows?: Error;
}): IntegrationHarness {
  const rpcCalls: IntegrationHarness['rpcCalls'] = [];
  const storageMap = new Map<string, unknown>();
  const pushAdapter = new EventEmitter();

  const fakeAdapter: FakeAdapter = {
    initialize: jest.fn(async () => {
      if (opts?.initializeThrows) throw opts.initializeThrows;
      return opts?.initializeReturns ?? true;
    }),
    dispose: jest.fn(() => undefined),
  };

  const storage: IStateStorage = {
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      storageMap.has(key)
        ? (storageMap.get(key) as T)
        : (defaultValue as T | undefined),
    update: jest.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        storageMap.delete(key);
      } else {
        storageMap.set(key, value);
      }
    }),
    keys: () => [...storageMap.keys()],
  } as unknown as IStateStorage;

  const workspaceProvider: IWorkspaceProvider = {
    getWorkspaceFolders: () => ['D:/test-workspace'],
    getWorkspaceRoot: () => 'D:/test-workspace',
  } as unknown as IWorkspaceProvider;

  const transport: CliMessageTransport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      // Simulate the bug fix: chat:start now reaches a healthy SDK adapter and
      // the backend asynchronously emits chunk → complete events. We schedule
      // them on the next microtask so the bridge's listeners (registered
      // BEFORE rpcCall awaits) catch them.
      if (method === 'chat:start' && fakeAdapter.onChatStart) {
        const startParams = params as { tabId: string; prompt?: string };
        queueMicrotask(() =>
          fakeAdapter.onChatStart!(startParams, pushAdapter),
        );
      }
      return { success: true, data: { __default: method } };
    }),
  } as unknown as CliMessageTransport;

  const container: Partial<DependencyContainer> = {
    resolve: jest.fn((token: symbol) => {
      // SDK adapter token — Symbol.for('AgentAdapter')
      if (token === Symbol.for('AgentAdapter')) return fakeAdapter;
      if (token === PLATFORM_TOKENS.WORKSPACE_PROVIDER)
        return workspaceProvider;
      if (token === PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE) return storage;
      if (token === Symbol.for('SdkPermissionHandler')) {
        return {
          handleResponse: jest.fn(),
          handleQuestionResponse: jest.fn(),
          request: jest.fn(),
        };
      }
      throw new Error(`unexpected token: ${String(token)}`);
    }),
    clearInstances: jest.fn(),
  } as unknown as Partial<DependencyContainer>;

  const bootstrap = (_options: CliBootstrapOptions): CliBootstrapResult => {
    return {
      container: container as DependencyContainer,
      transport,
      pushAdapter: pushAdapter as unknown as CliBootstrapResult['pushAdapter'],
      fireAndForget: { handlePermissionResponse: jest.fn() } as never,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as never,
    };
  };

  // Wrap the real `withEngine` so callers' `mode: 'full'` invokes the actual
  // adapter init lifecycle (this is the load-bearing wiring proven here).
  const withEngineHook: SessionExecuteHooks['withEngine'] = (async (
    globals,
    engineOpts,
    fn,
  ) => {
    return withEngine(
      globals,
      { ...(engineOpts as Parameters<typeof withEngine>[1]), bootstrap },
      fn as Parameters<typeof withEngine>[2],
    );
  }) as SessionExecuteHooks['withEngine'];

  return {
    bootstrap,
    pushAdapter,
    rpcCalls,
    storageMap,
    fakeAdapter,
    withEngineHook,
  };
}

// ---------------------------------------------------------------------------
// Test 1 — `session start --task` doesn't hang (regression repro)
// ---------------------------------------------------------------------------

describe('ptah session start --task — headless end-to-end', () => {
  it('does NOT hang: emits session.created → chat:chunk → resolves on chat:complete', async () => {
    jest.setTimeout(5000);
    const { formatter, notifications } = makeFormatter();
    const h = makeIntegrationHarness();

    // Healthy backend simulation: when chat:start lands, schedule one text_delta
    // and a chat:complete. Mirrors the post-fix flow where SDK adapter is
    // initialized so chat:start reaches the real claude path.
    h.fakeAdapter.onChatStart = (params, pushAdapter) => {
      // Emit message_start first so the bridge swaps the synthetic tabId
      // for the real SDK session UUID — mirrors the real backend's flow.
      pushAdapter.emit('chat:chunk', {
        tabId: params.tabId,
        sessionId: 'sdk-uuid-real',
        event: {
          eventType: 'message_start',
          sessionId: 'sdk-uuid-real',
          messageId: 'm-1',
        },
      });
      pushAdapter.emit('chat:chunk', {
        tabId: params.tabId,
        sessionId: 'sdk-uuid-real',
        event: {
          eventType: 'text_delta',
          messageId: 'm-1',
          delta: 'pong',
        },
      });
      pushAdapter.emit('chat:complete', {
        tabId: params.tabId,
        sessionId: 'sdk-uuid-real',
        turnId: 't1',
      });
    };

    const promise = execute(
      { subcommand: 'start', task: 'ping', profile: 'claude_code' },
      baseGlobals,
      {
        formatter,
        withEngine: h.withEngineHook,
        randomUUID: () => 'tab-headless',
        installSigint: () => () => undefined,
      },
    );

    // Race against a deterministic timeout — if the regression returns, the
    // promise will hang and this race resolves first with a sentinel.
    const HANG_SENTINEL = Symbol('hang');
    const guard = new Promise<typeof HANG_SENTINEL>((resolve) =>
      setTimeout(() => resolve(HANG_SENTINEL), 2000),
    );
    const winner = await Promise.race([promise, guard]);
    expect(winner).not.toBe(HANG_SENTINEL);

    const exit = await promise;
    expect(exit).toBe(ExitCode.Success);

    // SDK adapter MUST have been initialized — the bug was that this never ran.
    expect(h.fakeAdapter.initialize).toHaveBeenCalledTimes(1);

    // Expected JSON-RPC stream order:
    //   session.created → agent.message (from text_delta) → no task.error
    const methods = notifications.map((n) => n.method);
    expect(methods).toContain('session.created');
    expect(methods).toContain('agent.message');
    expect(methods).not.toContain('task.error');

    const created = notifications.find((n) => n.method === 'session.created');
    expect(created?.params).toMatchObject({
      session_id: 'tab-headless',
      tab_id: 'tab-headless',
    });

    const message = notifications.find((n) => n.method === 'agent.message');
    expect(message?.params).toMatchObject({
      session_id: 'sdk-uuid-real',
      text: 'pong',
      is_partial: true,
    });

    // Listener leak check — bridge MUST detach.
    expect(h.pushAdapter.listenerCount('chat:chunk')).toBe(0);
    expect(h.pushAdapter.listenerCount('chat:complete')).toBe(0);
    expect(h.pushAdapter.listenerCount('chat:error')).toBe(0);
  });

  it('chat:start is fired with the synthetic tabId AFTER initialize() resolves', async () => {
    const { formatter } = makeFormatter();
    const h = makeIntegrationHarness();
    const initOrder: string[] = [];
    const origInit = h.fakeAdapter.initialize;
    h.fakeAdapter.initialize = jest.fn(async () => {
      initOrder.push('init');
      return origInit();
    });
    h.fakeAdapter.onChatStart = (params, pushAdapter) => {
      initOrder.push('chat:start');
      pushAdapter.emit('chat:complete', {
        tabId: params.tabId,
        sessionId: 'sdk',
      });
    };

    const exit = await execute(
      { subcommand: 'start', task: 'go' },
      baseGlobals,
      {
        formatter,
        withEngine: h.withEngineHook,
        randomUUID: () => 'tab-order',
        installSigint: () => () => undefined,
      },
    );
    expect(exit).toBe(ExitCode.Success);
    // Init must come first — the bug was firing chat:start before init.
    expect(initOrder).toEqual(['init', 'chat:start']);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — sdk_init_failed surfaces deterministically through execute()
// ---------------------------------------------------------------------------

describe('ptah session start --task — sdk_init_failed propagation', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    stderrSpy = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('initialize() returns false → exit 5, task.error with ptah_code:sdk_init_failed, NDJSON stderr', async () => {
    const { formatter, notifications } = makeFormatter();
    const h = makeIntegrationHarness({ initializeReturns: false });

    const exit = await execute(
      { subcommand: 'start', task: 'ping', profile: 'claude_code' },
      baseGlobals,
      {
        formatter,
        withEngine: h.withEngineHook,
        randomUUID: () => 'tab-init-fail',
        installSigint: () => () => undefined,
      },
    );

    // session.execute maps SdkInitFailedError → ExitCode.InternalFailure (5).
    expect(exit).toBe(ExitCode.InternalFailure);

    // task.error notification on stdout carries the canonical ptah_code.
    const taskError = notifications.find((n) => n.method === 'task.error');
    expect(taskError).toBeDefined();
    expect(taskError?.params).toMatchObject({
      ptah_code: 'sdk_init_failed',
      command: 'session.start',
    });

    // Structured NDJSON line on stderr (emitted by withEngine BEFORE throw).
    const stderrLines = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('sdk_init_failed') && l.startsWith('{'));
    expect(stderrLines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stderrLines[0]!.trim());
    expect(parsed).toMatchObject({
      error: 'sdk_init_failed',
      command: 'engine.bootstrap',
      bootstrap_mode: 'full',
    });

    // SDK adapter init was attempted.
    expect(h.fakeAdapter.initialize).toHaveBeenCalledTimes(1);
  });

  it('initialize() throws → SdkInitFailedError surface, task.error, NDJSON stderr', async () => {
    const { formatter, notifications } = makeFormatter();
    const h = makeIntegrationHarness({
      initializeThrows: new Error('claude binary not on PATH'),
    });

    const exit = await execute(
      { subcommand: 'start', task: 'ping' },
      baseGlobals,
      {
        formatter,
        withEngine: h.withEngineHook,
        randomUUID: () => 'tab-throw',
        installSigint: () => () => undefined,
      },
    );

    expect(exit).toBe(ExitCode.InternalFailure);
    const taskError = notifications.find((n) => n.method === 'task.error');
    expect(taskError?.params).toMatchObject({
      ptah_code: 'sdk_init_failed',
    });
    expect((taskError?.params as { message: string }).message).toContain(
      'claude binary not on PATH',
    );

    const stderrLines = stderrSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes('sdk_init_failed') && l.startsWith('{'));
    expect(stderrLines.length).toBeGreaterThan(0);
  });

  it('SdkInitFailedError is thrown BEFORE chat:start RPC fires', async () => {
    const { formatter } = makeFormatter();
    const h = makeIntegrationHarness({ initializeReturns: false });

    await expect(async () => {
      await execute({ subcommand: 'start', task: 'go' }, baseGlobals, {
        formatter,
        withEngine: h.withEngineHook,
        randomUUID: () => 'tab-no-rpc',
        installSigint: () => () => undefined,
      });
    }).not.toThrow(); // execute catches and maps to exit code

    // Critically — chat:start must NOT have fired. The bug emitted
    // session.created and then the RPC never reached a working backend.
    const startCall = h.rpcCalls.find((c) => c.method === 'chat:start');
    expect(startCall).toBeUndefined();
  });

  it('SdkInitFailedError is exported and exposes ptahCode marker', () => {
    const err = new SdkInitFailedError('test');
    expect(err.ptahCode).toBe('sdk_init_failed');
    expect(err.name).toBe('SdkInitFailedError');
  });
});
