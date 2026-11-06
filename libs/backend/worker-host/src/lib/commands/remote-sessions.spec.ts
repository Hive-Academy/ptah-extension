import type * as WorkerRuntime from '@ptah-extension/worker-runtime';
import type {
  HistoryReader,
  SessionLogWriter,
  WorkerPeer,
  WorkspaceRegistry,
} from '@ptah-extension/worker-runtime';
import type { ISessionDriverLock } from '@ptah-extension/platform-core';
import type { ISdkPermissionHandler } from '@ptah-extension/shared';
import {
  createRemoteSessions,
  type RemoteSessionDeps,
} from './remote-sessions';

type Message = { method: string; params: unknown; correlationId: string };
const param = (message: Message, key: string): unknown =>
  (message.params as Record<string, unknown>)[key];

// worker-runtime is lazy-loaded in worker-host (module boundaries), so the
// spec loads it the same way.
let runtime: typeof WorkerRuntime;
beforeAll(async () => {
  runtime = await import('@ptah-extension/worker-runtime');
});
const ok = (data: unknown = { success: true }) => ({ success: true, data });
const grant = { machineId: 'machine_1', workspaceIds: ['ws_1'] };
const peer: WorkerPeer = {
  id: 'peer-1',
  tokenId: 'tok-1',
  send: jest.fn(),
  afterReply: jest.fn(),
  onClose: jest.fn(),
  close: jest.fn(),
};

/** createRemoteSessions over fakes for the engine RPC, logs and lock. */
function setup(
  onCall: (message: Message, tap: Tap) => unknown,
  overrides: Partial<RemoteSessionDeps> = {},
) {
  const held = new Map<string, string>();
  const lock = {
    held: jest.fn(() =>
      [...held].map(([sessionId, nonce]) => ({ sessionId, nonce })),
    ),
    release: jest.fn(async (sessionId: string) => {
      held.delete(sessionId);
      return 'released' as const;
    }),
    holder: jest.fn(async () => null),
  };
  const writer = {
    enqueue: jest.fn(async () => ({ seq: 1 })),
    degraded: false,
  } as unknown as SessionLogWriter;
  const permissions = { handleResponse: jest.fn() };
  const requestRelease = jest.fn(async () => 'not-held');
  const log = jest.fn();
  let tap: Tap = () => undefined;
  const handleMessage = jest.fn(async (message: Message) => {
    if (message.method === 'session:list')
      // The engine lists its sessions whether or not this worker drives them.
      return ok({
        sessions: ['s1'].map((id) => ({
          id,
          name: id,
          messageCount: 1,
          createdAt: 1,
          lastActivityAt: 2,
          isActive: false,
        })),
        total: 1,
        hasMore: false,
      });
    return onCall(message, tap) ?? ok();
  });
  const deps: RemoteSessionDeps = {
    runtime,
    machineId: 'machine_1',
    maxActiveTurns: 4,
    registry: {
      list: () => [{ workspaceId: 'ws_1', path: '/w' }],
    } as unknown as WorkspaceRegistry,
    logs: {
      openSession: jest.fn(async () => writer),
      findWriter: jest.fn(() => writer),
    },
    rpc: { handleMessage },
    history: {
      readForResume: async () => ({ events: [] }),
    } as unknown as HistoryReader,
    metadata: { get: async () => null },
    permissions: permissions as unknown as ISdkPermissionHandler,
    lock: lock as unknown as ISessionDriverLock,
    workspaces: { addFolder: jest.fn() },
    providerReady: () => true,
    machineInfo: jest.fn(),
    revokedCloseCode: 4001,
    clientName: () => undefined,
    revokeToken: jest.fn(),
    requestRelease,
    log,
    resolveTimeoutMs: 20,
    ...overrides,
  };
  const sessions = createRemoteSessions(deps);
  tap = (type, payload) => sessions.tap(type, payload);
  return { sessions, held, lock, permissions, requestRelease, log, tap };
}
type Tap = (type: string, payload: unknown) => void;
const settle = () => new Promise((resolve) => setImmediate(resolve));

it('keeps the driver lock of a turn whose chat:abort was refused at shutdown, until the engine ends it', async () => {
  let refuseAbort = false;
  const fake = setup((message, tap) => {
    if (message.method === 'chat:start') {
      fake.held.set('s1', 'nonce-s1');
      tap('session:id-resolved', {
        tabId: param(message, 'tabId'),
        realSessionId: 's1',
      });
    }
    if (message.method === 'chat:abort' && refuseAbort)
      return { success: false, error: 'refused' };
    return undefined;
  });
  await fake.sessions.handle(
    'session.start',
    { workspaceId: 'ws_1', prompt: 'long' },
    grant,
    peer,
  );
  refuseAbort = true;
  await fake.sessions.drain();
  await fake.sessions.releaseLocks();
  expect(fake.lock.release).not.toHaveBeenCalled();
  expect(fake.requestRelease).not.toHaveBeenCalled();
  expect(fake.held.has('s1')).toBe(true);
  expect(fake.log).toHaveBeenCalledWith(
    expect.stringContaining('kept the driver lock of 1 turn'),
  );
  // The engine confirms the turn ended: the lock may go now.
  fake.tap('session:turnEnded', { sessionId: 's1' });
  await settle();
  await fake.sessions.releaseLocks();
  expect(fake.lock.release).toHaveBeenCalledWith('s1', 'nonce-s1');
  expect(fake.held.size).toBe(0);
});

it('binds a held tab-only permission request on a session:id-resolved that arrives after the start timed out', async () => {
  let tabId = '';
  const fake = setup((message, tap) => {
    if (message.method === 'chat:start') {
      tabId = String(param(message, 'tabId'));
      fake.held.set('s1', 'nonce-s1');
      tap('permission:request', {
        id: 'req-tab',
        toolName: 'Bash',
        toolInput: {},
        tabId,
      });
    }
    return undefined;
  });
  await expect(
    fake.sessions.handle(
      'session.start',
      { workspaceId: 'ws_1', prompt: 'run' },
      grant,
      peer,
    ),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
  fake.tap('session:id-resolved', { tabId, realSessionId: 's1' });
  await settle();
  await expect(
    fake.sessions.handle(
      'permission.respond',
      { sessionId: 's1', requestId: 'req-tab', decision: 'allow' },
      grant,
      peer,
    ),
  ).resolves.toEqual({ applied: true });
  expect(fake.permissions.handleResponse).toHaveBeenCalledWith('req-tab', {
    id: 'req-tab',
    decision: 'allow',
  });
});

it('keeps the lock of a start that never reported its session at shutdown and logs it', async () => {
  const fake = setup((message) => {
    // The engine bound the session's lock, but session:id-resolved is lost.
    if (message.method === 'chat:start') fake.held.set('s-new', 'nonce-new');
    return undefined;
  });
  await expect(
    fake.sessions.handle(
      'session.start',
      { workspaceId: 'ws_1', prompt: 'lost' },
      grant,
      peer,
    ),
  ).rejects.toMatchObject({ code: 'INTERNAL' });
  await fake.sessions.drain();
  await fake.sessions.releaseLocks();
  expect(fake.lock.release).not.toHaveBeenCalled();
  expect(fake.requestRelease).not.toHaveBeenCalled();
  expect(fake.held.has('s-new')).toBe(true);
  expect(fake.log).toHaveBeenCalledWith(
    expect.stringContaining(
      'kept 1 driver lock(s) that may belong to 1 start(s) that never reported a session',
    ),
  );
});

it('frees the slot and the lock of a start that never reported its session on its tab-only terminal event, once', async () => {
  const tabs: string[] = [];
  const fake = setup(
    (message, tap) => {
      if (message.method !== 'chat:start') return undefined;
      const tabId = String(param(message, 'tabId'));
      tabs.push(tabId);
      if (tabs.length === 1) {
        // Bound in the engine, never reported to the worker.
        fake.held.set('s-new', 'nonce-new');
        return undefined;
      }
      const sessionId = `s-${tabs.length}`;
      fake.held.set(sessionId, `nonce-${sessionId}`);
      tap('session:id-resolved', { tabId, realSessionId: sessionId });
      return undefined;
    },
    { maxActiveTurns: 1 },
  );
  const start = () =>
    fake.sessions.handle(
      'session.start',
      { workspaceId: 'ws_1', prompt: 'go' },
      grant,
      peer,
    );
  await expect(start()).rejects.toMatchObject({ code: 'INTERNAL' });
  // Its engine turn may still run: the slot stays taken.
  await expect(start()).rejects.toMatchObject({ code: 'WORKER_BUSY' });
  expect(fake.held.has('s-new')).toBe(true);
  fake.tap('session:turnEnded', { tabId: tabs[0] });
  fake.tap('chat:sessionEnded', { tabId: tabs[0] });
  await settle();
  expect(fake.lock.release).toHaveBeenCalledTimes(1);
  expect(fake.lock.release).toHaveBeenCalledWith('s-new', 'nonce-new');
  expect(fake.requestRelease).toHaveBeenCalledTimes(1);
  expect(fake.held.has('s-new')).toBe(false);
  await expect(start()).resolves.toMatchObject({ sessionId: 's-2' });
});
