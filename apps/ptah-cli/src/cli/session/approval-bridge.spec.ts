/**
 * Unit tests for `ApprovalBridge`.
 *
 * Covers:
 *   1. happy path — emit `permission:request` → bridge emits
 *      `permission.request` JSON-RPC notification → call `permission.response`
 *      RPC handler → `permissionHandler.handleResponse` invoked with the
 *      expected args.
 *   2. PTAH_AUTO_APPROVE=true short-circuits — no notification emitted,
 *      `handleResponse` called immediately with `decision: 'allow'`.
 *   3. timeout path — fake timers; advance 300_001ms; verify `task.error`
 *      notification + `handleResponse(deny, 'timeout')` + `process.exit(3)`.
 *   4. multiple concurrent permission requests — each tracked by id;
 *      responses unblock the matching one only.
 *   5. question round-trip mirror — same pattern with
 *      `ask-user-question:request` and `question.response`.
 *   6. detach — cleans listeners, unregisters handlers, clears all timers.
 */

import { EventEmitter } from 'node:events';

import type {
  AskUserQuestionResponse,
  ISdkPermissionHandler,
  PermissionResponse,
} from '@ptah-extension/shared';

const mockDisposeHostRuntime = jest.fn<Promise<void>, []>();
const mockFlushMetadata = jest.fn<Promise<void>, []>();

jest.mock('@ptah-extension/cli-engine', () => ({
  CliDIContainer: { disposeHostRuntime: () => mockDisposeHostRuntime() },
}));
jest.mock('@ptah-extension/agent-sdk', () => ({
  flushSessionMetadataStores: () => mockFlushMetadata(),
}));

import {
  ApprovalBridge,
  type ApprovalBridgeJsonRpc,
} from './approval-bridge.js';

interface NotifyCall {
  method: string;
  params?: unknown;
}

interface FakeBridgeEnv {
  bridge: ApprovalBridge;
  adapter: EventEmitter;
  jsonrpc: ApprovalBridgeJsonRpc & {
    notify: jest.Mock;
    register: jest.Mock;
    unregister: jest.Mock;
  };
  notifyCalls: NotifyCall[];
  registeredHandlers: Map<
    string,
    (params: unknown) => Promise<unknown> | unknown
  >;
  permissionHandler: jest.Mocked<ISdkPermissionHandler>;
  exitMock: jest.Mock;
}

const activeBridges: ApprovalBridge[] = [];

beforeEach(() => {
  mockDisposeHostRuntime.mockReset().mockResolvedValue(undefined);
  mockFlushMetadata.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  while (activeBridges.length > 0) {
    const bridge = activeBridges.pop();
    try {
      bridge?.detach();
    } catch {
      // ignore — detach is idempotent and only fails if listeners are gone
    }
  }
});

function makeEnv(options?: { timeoutMs?: number }): FakeBridgeEnv {
  const adapter = new EventEmitter();
  const notifyCalls: NotifyCall[] = [];
  const registeredHandlers = new Map<
    string,
    (params: unknown) => Promise<unknown> | unknown
  >();

  const notify = jest.fn(async (method: string, params?: unknown) => {
    notifyCalls.push({ method, params });
  });
  const register = jest.fn(
    (
      method: string,
      handler: (params: unknown) => Promise<unknown> | unknown,
    ) => {
      registeredHandlers.set(method, handler);
    },
  );
  const unregister = jest.fn((method: string) => {
    registeredHandlers.delete(method);
  });
  const jsonrpc = { notify, register, unregister };

  const permissionHandler: jest.Mocked<ISdkPermissionHandler> = {
    handleResponse: jest.fn(),
    handleQuestionResponse: jest.fn(),
    getPermissionLevel: jest.fn(() => 'ask'),
    cleanupPendingPermissions: jest.fn(),
  };

  const exitMock = jest.fn((_code: number) => undefined as never);

  // The teardown halves are INJECTED, not `jest.mock`ed. The module mocks
  // below still stand, because they keep two heavy barrels out of this file's
  // module graph — but they are no longer what the ordering test reads. On
  // Linux CI the bridge reached `exitFn`, which it can only do once
  // `teardownBeforeExit` has called both halves, while `mockFlushMetadata`
  // recorded nothing: the module mock the assertion read was not the function
  // the bridge called. An override cannot drift from the call that way.
  const bridge = new ApprovalBridge(adapter, jsonrpc, permissionHandler, {
    timeoutMs: options?.timeoutMs,
    exit: exitMock as unknown as (code: number) => never,
    disposeRuntime: mockDisposeHostRuntime,
    flushMetadata: mockFlushMetadata,
  });
  activeBridges.push(bridge);

  return {
    bridge,
    adapter,
    jsonrpc,
    notifyCalls,
    registeredHandlers,
    permissionHandler,
    exitMock,
  };
}

/**
 * Advance past the approval timeout, then AWAIT the chain the expiry started.
 *
 * Counting microtask turns does not work here and cannot be made to work. The
 * timer callback is a `setTimeout` callback, so it cannot await — it starts the
 * handler and returns. The teardown that handler performs (dispose the host
 * runtime, flush session metadata, exit) is therefore unreachable from the
 * outside, and a fixed number of `advanceTimersByTimeAsync` drains is a guess
 * at how many turns it takes. The guess held most runs and broke the rest,
 * stalling between the dispose and the flush. `whenTimeoutSettled()` hands back
 * the actual promise, so this waits on the thing itself.
 */
async function advanceToApprovalExit(env: FakeBridgeEnv): Promise<void> {
  await jest.advanceTimersByTimeAsync(300_001);
  await env.bridge.whenTimeoutSettled();
}

function makePermissionPayload(
  overrides: Partial<{
    id: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    toolUseId: string;
    description: string;
    sessionId: string;
  }> = {},
): {
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string;
  agentToolCallId?: string;
  timestamp: number;
  description: string;
  timeoutAt: number;
  sessionId?: string;
} {
  return {
    id: overrides.id ?? 'perm-1',
    toolName: overrides.toolName ?? 'Bash',
    toolInput: overrides.toolInput ?? { command: 'ls' },
    toolUseId: overrides.toolUseId ?? 'tu-1',
    timestamp: 1234567890,
    description: overrides.description ?? 'Run shell command',
    timeoutAt: 0,
    sessionId: overrides.sessionId ?? 'sess-1',
  };
}

function makeQuestionPayload(
  overrides: Partial<{
    id: string;
    sessionId: string;
    tabId: string;
  }> = {},
): {
  id: string;
  toolName: 'AskUserQuestion';
  questions: ReadonlyArray<unknown>;
  toolUseId: string;
  timestamp: number;
  timeoutAt: number;
  sessionId?: string;
  tabId?: string;
} {
  return {
    id: overrides.id ?? 'q-1',
    toolName: 'AskUserQuestion' as const,
    questions: [
      { id: 'q', question: 'Continue?', multiSelect: false, options: [] },
    ],
    toolUseId: 'tu-q-1',
    timestamp: 1234567890,
    timeoutAt: 0,
    sessionId: overrides.sessionId ?? 'sess-1',
    tabId: overrides.tabId ?? 'tab-1',
  };
}

describe('ApprovalBridge — attach/detach', () => {
  it('attach() registers two push listeners and two JSON-RPC handlers', () => {
    const env = makeEnv();
    env.bridge.attach();

    expect(env.adapter.listenerCount('permission:request')).toBe(1);
    expect(env.adapter.listenerCount('ask-user-question:request')).toBe(1);
    expect(env.jsonrpc.register).toHaveBeenCalledWith(
      'permission.response',
      expect.any(Function),
    );
    expect(env.jsonrpc.register).toHaveBeenCalledWith(
      'question.response',
      expect.any(Function),
    );
  });

  it('attach() is idempotent — calling twice does not duplicate listeners', () => {
    const env = makeEnv();
    env.bridge.attach();
    env.bridge.attach();
    expect(env.adapter.listenerCount('permission:request')).toBe(1);
    expect(env.jsonrpc.register).toHaveBeenCalledTimes(2); // 2 methods, 1 attach
  });

  it('detach() removes listeners + unregisters handlers + is safe to call twice', () => {
    const env = makeEnv();
    env.bridge.attach();
    env.bridge.detach();
    expect(env.adapter.listenerCount('permission:request')).toBe(0);
    expect(env.adapter.listenerCount('ask-user-question:request')).toBe(0);
    expect(env.jsonrpc.unregister).toHaveBeenCalledWith('permission.response');
    expect(env.jsonrpc.unregister).toHaveBeenCalledWith('question.response');
    // Second call is a no-op.
    env.bridge.detach();
  });
});

describe('ApprovalBridge — permission round-trip', () => {
  it('happy path — emits permission.request notification → handleResponse on permission.response', async () => {
    const env = makeEnv();
    env.bridge.attach();

    const payload = makePermissionPayload();
    env.adapter.emit('permission:request', payload);
    // Allow the async handler microtask to flush.
    await new Promise((resolve) => setImmediate(resolve));

    expect(env.notifyCalls).toHaveLength(1);
    expect(env.notifyCalls[0]?.method).toBe('permission.request');
    expect(env.notifyCalls[0]?.params).toEqual({
      id: 'perm-1',
      session_id: 'sess-1',
      tool_use_id: 'tu-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      reason: 'Run shell command',
    });

    const handler = env.registeredHandlers.get('permission.response');
    expect(handler).toBeDefined();
    const response: PermissionResponse = {
      id: 'perm-1',
      decision: 'allow',
    };
    await handler?.(response);

    expect(env.permissionHandler.handleResponse).toHaveBeenCalledWith(
      'perm-1',
      response,
    );
  });

  it('PTAH_AUTO_APPROVE=true short-circuits — no notification, immediate allow', async () => {
    const prev = process.env['PTAH_AUTO_APPROVE'];
    process.env['PTAH_AUTO_APPROVE'] = 'true';
    try {
      const env = makeEnv();
      env.bridge.attach();

      env.adapter.emit('permission:request', makePermissionPayload());
      await new Promise((resolve) => setImmediate(resolve));

      expect(env.notifyCalls).toHaveLength(0);
      expect(env.permissionHandler.handleResponse).toHaveBeenCalledWith(
        'perm-1',
        {
          id: 'perm-1',
          decision: 'allow',
          reason: 'PTAH_AUTO_APPROVE=true',
        },
      );
    } finally {
      if (prev === undefined) {
        delete process.env['PTAH_AUTO_APPROVE'];
      } else {
        process.env['PTAH_AUTO_APPROVE'] = prev;
      }
    }
  });

  it('timeout path — emits task.error{auth_required} + deny + exit(3)', async () => {
    jest.useFakeTimers();
    try {
      const env = makeEnv({ timeoutMs: 300_000 });
      env.bridge.attach();

      env.adapter.emit('permission:request', makePermissionPayload());
      // Flush the async handler so the setTimeout is queued.
      await Promise.resolve();
      await Promise.resolve();

      // Sanity — initial notification should already have flushed via notify.
      // (notify is async; the macro-task ordering means we simply advance
      // timers and inspect state afterward.)
      //
      // Advanced ASYNCHRONOUSLY: the timeout path awaits a runtime teardown
      // and a metadata flush before it exits (TASK_2026_324 / TASK_2026_326),
      // so a synchronous advance returns before `exit` is ever reached.
      await advanceToApprovalExit(env);

      const taskError = env.notifyCalls.find((c) => c.method === 'task.error');
      expect(taskError).toBeDefined();
      expect(taskError?.params).toMatchObject({
        ptah_code: 'auth_required',
        request_id: 'perm-1',
      });
      expect(env.permissionHandler.handleResponse).toHaveBeenCalledWith(
        'perm-1',
        {
          id: 'perm-1',
          decision: 'deny',
          reason: 'timeout',
        },
      );
      expect(env.exitMock).toHaveBeenCalledWith(3);
    } finally {
      jest.useRealTimers();
    }
  });

  // ---------------------------------------------------------------------
  // This exit fires from inside a live `withEngine` callback, so it reaches
  // neither that helper's `finally` teardown (TASK_2026_326 finding 1) nor
  // `main()`'s pre-`finalizeExit` flush (TASK_2026_324 finding 3). Without
  // the teardown below, a timed-out `interact` strands its spawned CLI
  // agents, leaves their proxy sockets listening, and drops the last turn's
  // staged metadata. Reaping an agent is what produces the final
  // `addCliSession` write, so the runtime has to go down BEFORE the flush.
  // ---------------------------------------------------------------------
  it('timeout path — ends the host runtime, then flushes metadata, then exits', async () => {
    jest.useFakeTimers();
    try {
      const env = makeEnv({ timeoutMs: 300_000 });
      env.bridge.attach();

      env.adapter.emit('permission:request', makePermissionPayload());
      await Promise.resolve();
      await Promise.resolve();

      await advanceToApprovalExit(env);

      expect(mockDisposeHostRuntime).toHaveBeenCalledTimes(1);
      expect(mockFlushMetadata).toHaveBeenCalledTimes(1);
      expect(mockDisposeHostRuntime.mock.invocationCallOrder[0]).toBeLessThan(
        mockFlushMetadata.mock.invocationCallOrder[0],
      );
      expect(env.exitMock).toHaveBeenCalledWith(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('timeout path — a teardown that rejects still exits auth_required', async () => {
    jest.useFakeTimers();
    try {
      mockDisposeHostRuntime.mockRejectedValue(new Error('proxy already gone'));
      mockFlushMetadata.mockRejectedValue(new Error('storage closing'));
      const env = makeEnv({ timeoutMs: 300_000 });
      env.bridge.attach();

      env.adapter.emit('permission:request', makePermissionPayload());
      await Promise.resolve();
      await Promise.resolve();

      await advanceToApprovalExit(env);

      expect(env.exitMock).toHaveBeenCalledWith(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('multiple concurrent permission requests — only matching id unblocks', async () => {
    const env = makeEnv();
    env.bridge.attach();

    env.adapter.emit('permission:request', makePermissionPayload({ id: 'a' }));
    env.adapter.emit('permission:request', makePermissionPayload({ id: 'b' }));
    env.adapter.emit('permission:request', makePermissionPayload({ id: 'c' }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(env.notifyCalls).toHaveLength(3);

    const handler = env.registeredHandlers.get('permission.response');
    await handler?.({
      id: 'b',
      decision: 'allow',
    } satisfies PermissionResponse);

    expect(env.permissionHandler.handleResponse).toHaveBeenCalledTimes(1);
    expect(env.permissionHandler.handleResponse).toHaveBeenCalledWith('b', {
      id: 'b',
      decision: 'allow',
    });
  });

  it('rejects malformed permission:request payloads silently', async () => {
    const env = makeEnv();
    env.bridge.attach();

    env.adapter.emit('permission:request', null);
    env.adapter.emit('permission:request', { id: 42 });
    env.adapter.emit('permission:request', { id: 'x' }); // missing toolName/toolInput
    await new Promise((resolve) => setImmediate(resolve));

    expect(env.notifyCalls).toHaveLength(0);
    expect(env.permissionHandler.handleResponse).not.toHaveBeenCalled();
  });

  it('rejects malformed permission.response RPC params silently', async () => {
    const env = makeEnv();
    env.bridge.attach();
    const handler = env.registeredHandlers.get('permission.response');
    await handler?.({ id: 'x', decision: 'unknown-thing' });
    expect(env.permissionHandler.handleResponse).not.toHaveBeenCalled();
  });
});

describe('ApprovalBridge — question round-trip', () => {
  it('happy path — emits question.ask notification → handleQuestionResponse on question.response', async () => {
    const env = makeEnv();
    env.bridge.attach();

    env.adapter.emit('ask-user-question:request', makeQuestionPayload());
    await new Promise((resolve) => setImmediate(resolve));

    expect(env.notifyCalls).toHaveLength(1);
    expect(env.notifyCalls[0]?.method).toBe('question.ask');
    expect(env.notifyCalls[0]?.params).toMatchObject({
      id: 'q-1',
      session_id: 'sess-1',
      tab_id: 'tab-1',
    });

    const handler = env.registeredHandlers.get('question.response');
    const response: AskUserQuestionResponse = {
      id: 'q-1',
      answers: { q: 'yes' },
    };
    await handler?.(response);
    expect(env.permissionHandler.handleQuestionResponse).toHaveBeenCalledWith(
      response,
    );
  });

  it('PTAH_AUTO_APPROVE=true short-circuits with empty answers', async () => {
    const prev = process.env['PTAH_AUTO_APPROVE'];
    process.env['PTAH_AUTO_APPROVE'] = 'true';
    try {
      const env = makeEnv();
      env.bridge.attach();
      env.adapter.emit('ask-user-question:request', makeQuestionPayload());
      await new Promise((resolve) => setImmediate(resolve));
      expect(env.notifyCalls).toHaveLength(0);
      expect(env.permissionHandler.handleQuestionResponse).toHaveBeenCalledWith(
        { id: 'q-1', answers: {} },
      );
    } finally {
      if (prev === undefined) {
        delete process.env['PTAH_AUTO_APPROVE'];
      } else {
        process.env['PTAH_AUTO_APPROVE'] = prev;
      }
    }
  });

  it('timeout path for question — task.error + empty answers + exit(3)', async () => {
    jest.useFakeTimers();
    try {
      const env = makeEnv({ timeoutMs: 300_000 });
      env.bridge.attach();
      env.adapter.emit('ask-user-question:request', makeQuestionPayload());
      await Promise.resolve();
      await Promise.resolve();
      // Async advance — see the note on the permission timeout above.
      await advanceToApprovalExit(env);

      const taskError = env.notifyCalls.find((c) => c.method === 'task.error');
      expect(taskError).toBeDefined();
      expect(env.permissionHandler.handleQuestionResponse).toHaveBeenCalledWith(
        { id: 'q-1', answers: {} },
      );
      expect(env.exitMock).toHaveBeenCalledWith(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects malformed ask-user-question:request payloads silently', async () => {
    const env = makeEnv();
    env.bridge.attach();
    env.adapter.emit('ask-user-question:request', { id: 'x' }); // missing questions[]
    await new Promise((resolve) => setImmediate(resolve));
    expect(env.notifyCalls).toHaveLength(0);
  });
});

describe('ApprovalBridge — detach clears pending timers', () => {
  it('detach() clears pending permission timeouts so no exit(3) fires', async () => {
    jest.useFakeTimers();
    try {
      const env = makeEnv({ timeoutMs: 1000 });
      env.bridge.attach();
      env.adapter.emit('permission:request', makePermissionPayload());
      await Promise.resolve();
      await Promise.resolve();
      env.bridge.detach();
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(env.exitMock).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
