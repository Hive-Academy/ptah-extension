/**
 * Unit tests for `ptah session` command — TASK_2026_104 Sub-batch B10c.
 *
 * Coverage matrix:
 *
 *   Per sub-subcommand: at least 1 happy + 1 error path each.
 *
 *     start (no task)         — synth tabId, persist, emit session.created, exit 0
 *     start (with task)       — wires ChatBridge; bridge.complete → exit 0
 *     start (bridge error)    — bridge.error → exit 1, emits task.error
 *     resume (no persisted)   — falls back to id-as-sessionId, calls chat:resume
 *     resume (persisted)      — loads stored sdkSessionId, calls chat:resume
 *     resume (no id)          — UsageError exit 2
 *     resume (with task)      — chat:resume + ChatBridge on chat:continue
 *     send (happy)            — ChatBridge wired, exit 0
 *     send (no id)            — UsageError exit 2
 *     send (no task)          — UsageError exit 2
 *     send (bridge error)     — exit 1, emits task.error
 *     list (happy)            — workspacePath forwarded; per-session enrichment
 *     list (enrichment fail)  — per-session error swallowed
 *     stop (happy)            — chat:abort with sdkSessionId; emits session.stopped
 *     stop (no id)            — UsageError exit 2
 *     delete (happy)          — session:delete + storage entry removed
 *     delete (no id)          — UsageError exit 2
 *     delete (rpc fail)       — emits task.error, exit 1
 *     rename (happy)          — session:rename + name persisted
 *     rename (no id/no --to)  — UsageError exit 2
 *     load (happy)            — session:load emits session.history
 *     load (--out)            — writeFile invoked with JSON
 *     load (no id)            — UsageError exit 2
 *     stats (happy)           — CSV parsed, batch RPC, per-entry notify
 *     stats (empty CSV)       — works with empty array
 *     validate (happy)        — emits session.valid { valid: true }
 *     validate (no id)        — UsageError exit 2
 *     unknown sub-command     — UsageError exit 2
 *
 *   Streaming (start/resume/send): mocks pushAdapter; tests bridge attach/detach
 *   removes listeners on settle (no listener leak); SIGINT path → exit 130 +
 *   chat:abort fired.
 *
 *   State storage round-trip: start creates, resume finds it, delete removes it.
 *
 *   Listener-leak prevention: `pushAdapter.listenerCount('chat:chunk')` is 0
 *   after start completes.
 */

import { EventEmitter } from 'node:events';

// Mock the agent-sdk barrel — same pattern as auth.spec.ts. The session
// command only reads SDK_TOKENS.SDK_PERMISSION_HANDLER at runtime, but the
// transitive import chain through with-engine.ts → container.ts pulls in
// auth-rpc.schema.ts which evaluates ANTHROPIC_PROVIDERS.map() at load.
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

import { execute, executeSessionStart } from './session.js';
import type {
  SessionExecuteHooks,
  SessionOptions,
  PersistedSession,
} from './session.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { Formatter } from '../output/formatter.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import {
  PLATFORM_TOKENS,
  type IStateStorage,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const baseGlobals: GlobalOptions = {
  json: true,
  human: false,
  cwd: 'D:/test-workspace',
  quiet: false,
  verbose: false,
  noColor: true,
  autoApprove: false,
  reveal: false,
};

interface FormatterTrace {
  notifications: Array<{ method: string; params?: unknown }>;
  formatter: Formatter;
}

function makeFormatter(): FormatterTrace {
  const notifications: FormatterTrace['notifications'] = [];
  const formatter: Formatter = {
    writeNotification: jest.fn(async (method: string, params?: unknown) => {
      notifications.push({ method, params });
    }),
    writeRequest: jest.fn(async () => undefined),
    writeResponse: jest.fn(async () => undefined),
    writeError: jest.fn(async () => undefined),
    close: jest.fn(async () => undefined),
  };
  return { notifications, formatter };
}

/**
 * Wait for all pending microtasks + a macrotask tick. Lets `runStart` /
 * `runResume` / `runSend` finish their synchronous prologue (persist + emit
 * + listener-attach + rpcCall) before the test fires push events. The bridge
 * registers listeners BEFORE awaiting `rpcCall`, so a single setImmediate
 * tick is enough to guarantee they're attached even when several microtasks
 * are queued upstream.
 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();
  }
}

function makeStderr(): { stderr: { write: jest.Mock }; buffer: string } {
  const trace = {
    buffer: '',
    stderr: {
      write: jest.fn((chunk: string) => {
        trace.buffer += chunk;
        return true;
      }),
    },
  };
  return trace;
}

interface MockEngine {
  withEngine: SessionExecuteHooks['withEngine'];
  rpcCalls: Array<{ method: string; params: unknown }>;
  scripted: Map<
    string,
    | { success: true; data?: unknown }
    | { success: false; error: string; errorCode?: string }
  >;
  pushAdapter: EventEmitter;
  storage: IStateStorage;
  storageMap: Map<string, unknown>;
  workspaceRoot: string | undefined;
  permissionHandlerResolvable: boolean;
}

function makeStorage(): { storage: IStateStorage; map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  const storage: IStateStorage = {
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      map.has(key) ? (map.get(key) as T) : defaultValue,
    update: jest.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        map.delete(key);
      } else {
        map.set(key, value);
      }
    }),
    keys: () => [...map.keys()],
  } as unknown as IStateStorage;
  return { storage, map };
}

function makeEngine(opts?: {
  workspaceRoot?: string;
  permissionHandlerResolvable?: boolean;
}): MockEngine {
  const rpcCalls: MockEngine['rpcCalls'] = [];
  const scripted: MockEngine['scripted'] = new Map();
  const transport = {
    call: jest.fn(async (method: string, params: unknown) => {
      rpcCalls.push({ method, params });
      const scriptedResp = scripted.get(method);
      if (scriptedResp) return scriptedResp;
      return { success: true, data: { __default: method } };
    }),
  } as unknown as CliMessageTransport;

  const { storage, map } = makeStorage();
  const workspaceRoot = opts?.workspaceRoot ?? 'D:/test-workspace';
  const permissionHandlerResolvable = opts?.permissionHandlerResolvable ?? true;
  const workspaceProvider: IWorkspaceProvider = {
    getWorkspaceFolders: () => (workspaceRoot ? [workspaceRoot] : []),
    getWorkspaceRoot: () => workspaceRoot,
  } as unknown as IWorkspaceProvider;

  const fakePermissionHandler = {
    handleResponse: jest.fn(),
    handleQuestionResponse: jest.fn(),
    request: jest.fn(),
  };

  const container = {
    resolve: jest.fn((token: symbol) => {
      if (token === PLATFORM_TOKENS.WORKSPACE_PROVIDER) {
        return workspaceProvider;
      }
      if (token === PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE) {
        return storage;
      }
      if (token === Symbol.for('SdkPermissionHandler')) {
        if (permissionHandlerResolvable) return fakePermissionHandler;
        throw new Error('SdkPermissionHandler not registered');
      }
      throw new Error(`unexpected token: ${String(token)}`);
    }),
  };

  const pushAdapter = new EventEmitter();

  const withEngine = (async (
    _globals: unknown,
    _opts: unknown,
    fn: (ctx: {
      container: typeof container;
      transport: CliMessageTransport;
      pushAdapter: EventEmitter;
    }) => Promise<unknown>,
  ): Promise<unknown> => {
    return fn({ container, transport, pushAdapter });
  }) as unknown as SessionExecuteHooks['withEngine'];

  return {
    withEngine,
    rpcCalls,
    scripted,
    pushAdapter,
    storage,
    storageMap: map,
    workspaceRoot,
    permissionHandlerResolvable,
  };
}

// ---------------------------------------------------------------------------
// 1. start
// ---------------------------------------------------------------------------

describe('ptah session start', () => {
  it('synthesizes tabId, persists session, and emits session.created (no task)', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const exit = await execute({ subcommand: 'start' }, baseGlobals, {
      formatter: f.formatter,
      withEngine: e.withEngine,
      randomUUID: () => 'tab-fixed-uuid',
      installSigint: () => () => undefined,
    });
    expect(exit).toBe(ExitCode.Success);
    expect(e.storageMap.get('sessions.tab-fixed-uuid')).toMatchObject({
      tabId: 'tab-fixed-uuid',
      workspacePath: 'D:/test-workspace',
    });
    const created = f.notifications.find((n) => n.method === 'session.created');
    expect(created?.params).toMatchObject({
      session_id: 'tab-fixed-uuid',
      tab_id: 'tab-fixed-uuid',
    });
    // chat:start is fired even without --task (bootstrap).
    const startCall = e.rpcCalls.find((c) => c.method === 'chat:start');
    expect(startCall).toBeDefined();
    expect(startCall?.params).toMatchObject({
      tabId: 'tab-fixed-uuid',
      workspacePath: 'D:/test-workspace',
    });
  });

  it('runs ChatBridge when --task given and resolves on chat:complete', async () => {
    const f = makeFormatter();
    const e = makeEngine();

    e.scripted.set('chat:start', { success: true });

    const promise = execute(
      { subcommand: 'start', task: 'do the thing' },
      baseGlobals,
      {
        formatter: f.formatter,
        withEngine: e.withEngine,
        randomUUID: () => 'tab-A',
        installSigint: () => () => undefined,
      },
    );
    // Drain microtasks + a macrotask so listeners are attached and rpcCall
    // resolves. The bridge attaches listeners after `await persistSession`,
    // `await writeNotification`, and `await rpcCall` complete.
    await flushAsync();

    e.pushAdapter.emit('chat:complete', {
      tabId: 'tab-A',
      sessionId: 'sdk-real-uuid',
      turnId: 't1',
    });
    const exit = await promise;
    expect(exit).toBe(ExitCode.Success);
    // The persisted entry should now carry the real SDK session id.
    expect(e.storageMap.get('sessions.tab-A')).toMatchObject({
      tabId: 'tab-A',
      sdkSessionId: 'sdk-real-uuid',
    });
    // Listener leak prevention.
    expect(e.pushAdapter.listenerCount('chat:chunk')).toBe(0);
    expect(e.pushAdapter.listenerCount('chat:complete')).toBe(0);
    expect(e.pushAdapter.listenerCount('chat:error')).toBe(0);
  });

  it('emits task.error and exits 1 when chat:error fires', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const promise = execute({ subcommand: 'start', task: 'go' }, baseGlobals, {
      formatter: f.formatter,
      withEngine: e.withEngine,
      randomUUID: () => 'tab-B',
      installSigint: () => () => undefined,
    });
    await flushAsync();
    e.pushAdapter.emit('chat:error', {
      tabId: 'tab-B',
      sessionId: 'tab-B',
      error: 'boom',
    });
    const exit = await promise;
    expect(exit).toBe(ExitCode.GeneralError);
    const err = f.notifications.find((n) => n.method === 'task.error');
    expect(err).toBeDefined();
    expect((err?.params as { message: string }).message).toBe('boom');
    expect(e.pushAdapter.listenerCount('chat:chunk')).toBe(0);
  });

  it('SIGINT triggers chat:abort and resolves with exit 130', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    let sigintHandler: (() => void) | undefined;
    const promise = execute({ subcommand: 'start', task: 'go' }, baseGlobals, {
      formatter: f.formatter,
      withEngine: e.withEngine,
      randomUUID: () => 'tab-S',
      installSigint: (handler) => {
        sigintHandler = handler;
        return () => undefined;
      },
    });
    await flushAsync();
    expect(sigintHandler).toBeDefined();
    sigintHandler?.();
    // Settle the bridge with an explicit error so the awaiter resolves.
    e.pushAdapter.emit('chat:error', {
      tabId: 'tab-S',
      error: 'aborted',
    });
    const exit = await promise;
    expect(exit).toBe(130);
    const abortCall = e.rpcCalls.find((c) => c.method === 'chat:abort');
    expect(abortCall).toBeDefined();
    expect(abortCall?.params).toMatchObject({ sessionId: 'tab-S' });
  });

  it('continues without approval bridge when permission handler is unresolvable', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine({ permissionHandlerResolvable: false });
    const promise = execute({ subcommand: 'start', task: 'go' }, baseGlobals, {
      formatter: f.formatter,
      stderr: stderrTrace.stderr,
      withEngine: e.withEngine,
      randomUUID: () => 'tab-NA',
      installSigint: () => () => undefined,
    });
    await flushAsync();
    e.pushAdapter.emit('chat:complete', {
      tabId: 'tab-NA',
      sessionId: 'sdk-z',
    });
    const exit = await promise;
    expect(exit).toBe(ExitCode.Success);
    expect(stderrTrace.buffer).toMatch(/approval bridge unavailable/);
  });
});

// ---------------------------------------------------------------------------
// 2. resume
// ---------------------------------------------------------------------------

describe('ptah session resume', () => {
  it('errors with UsageError when <id> is missing', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute({ subcommand: 'resume' }, baseGlobals, {
      formatter: f.formatter,
      stderr: stderrTrace.stderr,
      withEngine: e.withEngine,
    });
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/<id> is required/);
  });

  it('falls back to id-as-sessionId when no persisted entry exists', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const exit = await execute(
      { subcommand: 'resume', id: 'sdk-external' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    const resumeCall = e.rpcCalls.find((c) => c.method === 'chat:resume');
    expect(resumeCall?.params).toMatchObject({
      sessionId: 'sdk-external',
      tabId: 'sdk-external',
      workspacePath: 'D:/test-workspace',
    });
    expect(
      f.notifications.find((n) => n.method === 'session.ready'),
    ).toBeDefined();
  });

  it('reads persisted sdkSessionId when a session entry exists', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const persisted: PersistedSession = {
      tabId: 'tab-persisted',
      sdkSessionId: 'sdk-real',
      createdAt: 1,
      workspacePath: 'D:/test-workspace',
    };
    e.storageMap.set('sessions.tab-persisted', persisted);
    const exit = await execute(
      { subcommand: 'resume', id: 'tab-persisted' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    const call = e.rpcCalls.find((c) => c.method === 'chat:resume');
    expect(call?.params).toMatchObject({
      sessionId: 'sdk-real',
      tabId: 'tab-persisted',
    });
  });

  it('runs ChatBridge for chat:continue when --task is provided', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const promise = execute(
      { subcommand: 'resume', id: 'sdk-x', task: 'go on' },
      baseGlobals,
      {
        formatter: f.formatter,
        withEngine: e.withEngine,
        installSigint: () => () => undefined,
      },
    );
    await flushAsync();
    e.pushAdapter.emit('chat:complete', {
      tabId: 'sdk-x',
      sessionId: 'sdk-x',
    });
    const exit = await promise;
    expect(exit).toBe(ExitCode.Success);
    expect(e.rpcCalls.find((c) => c.method === 'chat:continue')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. send
// ---------------------------------------------------------------------------

describe('ptah session send', () => {
  it('UsageError without <id>', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute(
      { subcommand: 'send', task: 'hi' },
      baseGlobals,
      {
        formatter: f.formatter,
        stderr: stderrTrace.stderr,
        withEngine: e.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('UsageError without --task', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute({ subcommand: 'send', id: 's1' }, baseGlobals, {
      formatter: f.formatter,
      stderr: stderrTrace.stderr,
      withEngine: e.withEngine,
    });
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('wires ChatBridge and exits 0 on chat:complete', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const promise = execute(
      { subcommand: 'send', id: 'sdk-1', task: 'next turn' },
      baseGlobals,
      {
        formatter: f.formatter,
        withEngine: e.withEngine,
        installSigint: () => () => undefined,
      },
    );
    await flushAsync();
    e.pushAdapter.emit('chat:complete', {
      tabId: 'sdk-1',
      sessionId: 'sdk-1',
    });
    const exit = await promise;
    expect(exit).toBe(ExitCode.Success);
    expect(e.rpcCalls.find((c) => c.method === 'chat:continue')).toBeDefined();
  });

  it('exits 1 on chat:error', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const promise = execute(
      { subcommand: 'send', id: 'sdk-1', task: 'next' },
      baseGlobals,
      {
        formatter: f.formatter,
        withEngine: e.withEngine,
        installSigint: () => () => undefined,
      },
    );
    await flushAsync();
    e.pushAdapter.emit('chat:error', {
      tabId: 'sdk-1',
      error: 'rate limited',
    });
    const exit = await promise;
    expect(exit).toBe(ExitCode.GeneralError);
  });
});

// ---------------------------------------------------------------------------
// 4. list
// ---------------------------------------------------------------------------

describe('ptah session list', () => {
  it('forwards workspacePath to session:list and enriches per session', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    e.scripted.set('session:list', {
      success: true,
      data: {
        sessions: [
          {
            id: 's1',
            name: 'one',
            createdAt: 1,
            lastActivityAt: 2,
            messageCount: 3,
          },
        ],
        total: 1,
        hasMore: false,
      },
    });
    e.scripted.set('chat:running-agents', {
      success: true,
      data: { agents: [{ agentId: 'a1', agentType: 'tester' }] },
    });
    e.scripted.set('agent:backgroundList', {
      success: true,
      data: { agents: [] },
    });

    const exit = await execute({ subcommand: 'list' }, baseGlobals, {
      formatter: f.formatter,
      withEngine: e.withEngine,
    });
    expect(exit).toBe(ExitCode.Success);
    const listCall = e.rpcCalls.find((c) => c.method === 'session:list');
    expect(listCall?.params).toMatchObject({
      workspacePath: 'D:/test-workspace',
    });
    const list = f.notifications.find((n) => n.method === 'session.list');
    expect(list).toBeDefined();
    const params = list?.params as {
      sessions: Array<{ id: string; runningAgents: unknown[] }>;
      workspacePath: string;
    };
    expect(params.workspacePath).toBe('D:/test-workspace');
    expect(params.sessions[0].id).toBe('s1');
    expect(params.sessions[0].runningAgents).toEqual([
      { agentId: 'a1', agentType: 'tester' },
    ]);
  });

  it('swallows per-session enrichment errors (best-effort)', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    e.scripted.set('session:list', {
      success: true,
      data: {
        sessions: [
          {
            id: 's1',
            name: 'n',
            createdAt: 1,
            lastActivityAt: 2,
            messageCount: 0,
          },
        ],
        total: 1,
        hasMore: false,
      },
    });
    e.scripted.set('chat:running-agents', {
      success: false,
      error: 'broke',
    });
    e.scripted.set('agent:backgroundList', {
      success: false,
      error: 'broke',
    });
    const exit = await execute({ subcommand: 'list' }, baseGlobals, {
      formatter: f.formatter,
      withEngine: e.withEngine,
    });
    expect(exit).toBe(ExitCode.Success);
    const list = f.notifications.find((n) => n.method === 'session.list');
    const params = list?.params as {
      sessions: Array<{
        runningAgents: unknown[];
        backgroundAgents: unknown[];
      }>;
    };
    expect(params.sessions[0].runningAgents).toEqual([]);
    expect(params.sessions[0].backgroundAgents).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. stop
// ---------------------------------------------------------------------------

describe('ptah session stop', () => {
  it('UsageError without <id>', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute({ subcommand: 'stop' }, baseGlobals, {
      formatter: f.formatter,
      stderr: stderrTrace.stderr,
      withEngine: e.withEngine,
    });
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('calls chat:abort with sdkSessionId when persisted, emits session.stopped', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const persisted: PersistedSession = {
      tabId: 'tab-Z',
      sdkSessionId: 'sdk-Z',
      createdAt: 1,
      workspacePath: 'D:/test-workspace',
    };
    e.storageMap.set('sessions.tab-Z', persisted);
    const exit = await execute(
      { subcommand: 'stop', id: 'tab-Z' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    const abortCall = e.rpcCalls.find((c) => c.method === 'chat:abort');
    expect(abortCall?.params).toMatchObject({ sessionId: 'sdk-Z' });
    expect(
      f.notifications.find((n) => n.method === 'session.stopped'),
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 6. delete
// ---------------------------------------------------------------------------

describe('ptah session delete', () => {
  it('UsageError without <id>', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute({ subcommand: 'delete' }, baseGlobals, {
      formatter: f.formatter,
      stderr: stderrTrace.stderr,
      withEngine: e.withEngine,
    });
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('removes persisted entry on success', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const persisted: PersistedSession = {
      tabId: 'tab-D',
      sdkSessionId: 'sdk-D',
      createdAt: 1,
      workspacePath: 'D:/test-workspace',
    };
    e.storageMap.set('sessions.tab-D', persisted);
    e.scripted.set('session:delete', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      { subcommand: 'delete', id: 'tab-D' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(e.storageMap.has('sessions.tab-D')).toBe(false);
    expect(
      f.notifications.find((n) => n.method === 'session.deleted'),
    ).toBeDefined();
  });

  it('emits task.error and exits 1 when backend reports success:false', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    e.scripted.set('session:delete', {
      success: true,
      data: { success: false, error: 'no perms' },
    });
    const exit = await execute(
      { subcommand: 'delete', id: 'sdk-Q' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.GeneralError);
    expect(
      f.notifications.find((n) => n.method === 'task.error'),
    ).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. rename
// ---------------------------------------------------------------------------

describe('ptah session rename', () => {
  it('UsageError without <id>', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute(
      { subcommand: 'rename', to: 'new-name' },
      baseGlobals,
      {
        formatter: f.formatter,
        stderr: stderrTrace.stderr,
        withEngine: e.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('UsageError without --to', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute(
      { subcommand: 'rename', id: 's1' },
      baseGlobals,
      {
        formatter: f.formatter,
        stderr: stderrTrace.stderr,
        withEngine: e.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('persists new name and emits session.renamed', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const persisted: PersistedSession = {
      tabId: 'tab-R',
      sdkSessionId: 'sdk-R',
      createdAt: 1,
      workspacePath: 'D:/test-workspace',
      name: 'old',
    };
    e.storageMap.set('sessions.tab-R', persisted);
    e.scripted.set('session:rename', {
      success: true,
      data: { success: true },
    });
    const exit = await execute(
      { subcommand: 'rename', id: 'tab-R', to: 'new-name' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(e.storageMap.get('sessions.tab-R')).toMatchObject({
      name: 'new-name',
    });
    const renamed = f.notifications.find((n) => n.method === 'session.renamed');
    expect(renamed?.params).toMatchObject({ name: 'new-name' });
  });
});

// ---------------------------------------------------------------------------
// 8. load
// ---------------------------------------------------------------------------

describe('ptah session load', () => {
  it('UsageError without <id>', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute({ subcommand: 'load' }, baseGlobals, {
      formatter: f.formatter,
      stderr: stderrTrace.stderr,
      withEngine: e.withEngine,
    });
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('emits session.history', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    e.scripted.set('session:load', {
      success: true,
      data: {
        messages: [{ role: 'user', content: 'hi' }],
        agentSessions: [],
      },
    });
    const exit = await execute(
      { subcommand: 'load', id: 'sdk-L' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    const hist = f.notifications.find((n) => n.method === 'session.history');
    expect(hist).toBeDefined();
  });

  it('writes JSON to --out path when given', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    e.scripted.set('session:load', {
      success: true,
      data: { messages: [{ role: 'user', content: 'hi' }], agentSessions: [] },
    });
    const writeFile = jest.fn(
      async (_path: string, _data: string) => undefined,
    );
    const exit = await execute(
      { subcommand: 'load', id: 'sdk-L', out: 'D:/tmp/out.json' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine, writeFile },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(writeFile).toHaveBeenCalledTimes(1);
    const call = writeFile.mock.calls[0] as [string, string];
    expect(call[0]).toBe('D:/tmp/out.json');
    const parsed = JSON.parse(call[1]) as { messages: unknown[] };
    expect(parsed.messages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9. stats
// ---------------------------------------------------------------------------

describe('ptah session stats', () => {
  it('parses CSV --ids and forwards workspacePath', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    e.scripted.set('session:stats-batch', {
      success: true,
      data: {
        sessionStats: [
          { sessionId: 'a', count: 1 },
          { sessionId: 'b', count: 2 },
        ],
      },
    });
    const exit = await execute(
      { subcommand: 'stats', ids: 'a, b , ,c' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    const call = e.rpcCalls.find((c) => c.method === 'session:stats-batch');
    expect(call?.params).toMatchObject({
      sessionIds: ['a', 'b', 'c'],
      workspacePath: 'D:/test-workspace',
    });
    const stats = f.notifications.filter((n) => n.method === 'session.stats');
    expect(stats).toHaveLength(2);
  });

  it('handles empty CSV (no --ids)', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    e.scripted.set('session:stats-batch', {
      success: true,
      data: { sessionStats: [] },
    });
    const exit = await execute({ subcommand: 'stats' }, baseGlobals, {
      formatter: f.formatter,
      withEngine: e.withEngine,
    });
    expect(exit).toBe(ExitCode.Success);
    const call = e.rpcCalls.find((c) => c.method === 'session:stats-batch');
    expect(call?.params).toMatchObject({ sessionIds: [] });
  });
});

// ---------------------------------------------------------------------------
// 10. validate
// ---------------------------------------------------------------------------

describe('ptah session validate', () => {
  it('UsageError without <id>', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute({ subcommand: 'validate' }, baseGlobals, {
      formatter: f.formatter,
      stderr: stderrTrace.stderr,
      withEngine: e.withEngine,
    });
    expect(exit).toBe(ExitCode.UsageError);
  });

  it('emits session.valid with backend exists flag', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    e.scripted.set('session:validate', {
      success: true,
      data: { exists: true, filePath: 'D:/sessions/x.jsonl' },
    });
    const exit = await execute(
      { subcommand: 'validate', id: 'sdk-V' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    const valid = f.notifications.find((n) => n.method === 'session.valid');
    expect(valid?.params).toMatchObject({
      session_id: 'sdk-V',
      valid: true,
      filePath: 'D:/sessions/x.jsonl',
    });
  });
});

// ---------------------------------------------------------------------------
// 11. unknown sub-command + state round-trip
// ---------------------------------------------------------------------------

describe('ptah session — top-level dispatcher', () => {
  it('exits with UsageError on unknown sub-subcommand', async () => {
    const f = makeFormatter();
    const stderrTrace = makeStderr();
    const e = makeEngine();
    const exit = await execute(
      { subcommand: 'bogus' as unknown as SessionOptions['subcommand'] },
      baseGlobals,
      {
        formatter: f.formatter,
        stderr: stderrTrace.stderr,
        withEngine: e.withEngine,
      },
    );
    expect(exit).toBe(ExitCode.UsageError);
    expect(stderrTrace.buffer).toMatch(/unknown sub-command/);
  });

  it('full state round-trip: start → resume → delete', async () => {
    const e = makeEngine();
    // 1. start
    const f1 = makeFormatter();
    await execute({ subcommand: 'start' }, baseGlobals, {
      formatter: f1.formatter,
      withEngine: e.withEngine,
      randomUUID: () => 'tab-RT',
      installSigint: () => () => undefined,
    });
    expect(e.storageMap.has('sessions.tab-RT')).toBe(true);

    // 2. resume — finds the entry by tabId
    const f2 = makeFormatter();
    await execute({ subcommand: 'resume', id: 'tab-RT' }, baseGlobals, {
      formatter: f2.formatter,
      withEngine: e.withEngine,
    });
    const resumeCall = e.rpcCalls.find((c) => c.method === 'chat:resume');
    expect(resumeCall?.params).toMatchObject({ tabId: 'tab-RT' });

    // 3. delete — removes the entry
    e.scripted.set('session:delete', {
      success: true,
      data: { success: true },
    });
    const f3 = makeFormatter();
    await execute({ subcommand: 'delete', id: 'tab-RT' }, baseGlobals, {
      formatter: f3.formatter,
      withEngine: e.withEngine,
    });
    expect(e.storageMap.has('sessions.tab-RT')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. executeSessionStart public entry
// ---------------------------------------------------------------------------

describe('executeSessionStart()', () => {
  it('routes to start when no resumeId given', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const exit = await executeSessionStart({ task: undefined }, baseGlobals, {
      formatter: f.formatter,
      withEngine: e.withEngine,
      randomUUID: () => 'tab-ESS',
      installSigint: () => () => undefined,
    });
    expect(exit).toBe(ExitCode.Success);
    expect(
      f.notifications.find((n) => n.method === 'session.created'),
    ).toBeDefined();
  });

  it('routes to resume when resumeId given', async () => {
    const f = makeFormatter();
    const e = makeEngine();
    const exit = await executeSessionStart(
      { resumeId: 'sdk-RID' },
      baseGlobals,
      { formatter: f.formatter, withEngine: e.withEngine },
    );
    expect(exit).toBe(ExitCode.Success);
    expect(e.rpcCalls.find((c) => c.method === 'chat:resume')).toBeDefined();
  });
});
