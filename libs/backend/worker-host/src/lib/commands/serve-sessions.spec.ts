import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import type {
  CliBootstrapResult,
  CliWebviewManagerAdapter,
} from '@ptah-extension/cli-engine';
import { serveCommand } from './serve';

jest.mock('@ptah-extension/platform-core', () => ({
  ...jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/platform-core',
  ),
  requestRelease: jest.fn(async () => 'not-held'),
}));

// Loading the engine graph under a shared verify lock can exceed 5 s.
const ENGINE_TIMEOUT = 60_000;

// Warm the engine module graph once, so the 60 s case timeouts measure the
// case and not the cold import (88.8 s on a CI shard). Same order as serve.ts:
// platform-core first.
beforeAll(async () => {
  await import('@ptah-extension/platform-core');
  await import('@ptah-extension/cli-agent-runtime');
  await import('@ptah-extension/cli-engine');
  await import('@ptah-extension/worker-runtime');
  await import('@ptah-extension/worker-protocol');
  await import('@ptah-extension/agent-sdk');
  await import('@ptah-extension/rpc-handlers');
}, 180_000);

const checks = {
  nodeVersion: () => '22.0.0',
  sqliteMemory: async () => undefined,
  ptahVersion: async () => '1.2.3',
};

interface Frame {
  v: 1;
  kind: 'res' | 'evt' | 'ctl';
  id?: string;
  ok?: boolean;
  result?: unknown;
  error?: { code: string };
  sessionId?: string;
  seq?: number;
  type?: string;
  payload?: Record<string, unknown>;
}

/** The engine seams serve composes: transport, push adapter, DI container. */
interface EngineBehaviour {
  /** ms before `session:id-resolved`; null never sends it. */
  resolveDelayMs?: number | null;
  /** Runs right after `session:id-resolved` is sent, in the same tick. */
  afterResolved?: (emit: Emit, tabId: string, sessionId: string) => void;
  /** Runs inside `chat:start`, before it returns. */
  duringStart?: (emit: Emit, tabId: string, sessionId: string) => void;
  /** Runs inside `chat:continue`, before it returns. */
  duringContinue?: (emit: Emit, sessionId: string) => void;
  abortRefused?: boolean;
  /** The persisted autopilot setting `config:autopilot-get` reports. */
  autopilot?: { enabled: boolean; permissionLevel: string };
}
type Emit = (type: string, payload: unknown) => void;

function fakeEngine(behaviour: EngineBehaviour = {}) {
  let push: CliWebviewManagerAdapter | undefined;
  const emit = (type: string, payload: unknown): void => {
    if (!push) throw new Error('Push adapter not bootstrapped');
    void push.broadcastMessage(type, payload);
  };
  const sessionsByPath = new Map<string, string[]>();
  const held = new Map<string, string>();
  let started = 0;
  const lock = {
    setLiveRecordCheck: jest.fn(),
    setReleaseGate: jest.fn(),
    acquire: jest.fn(async () => ({ ok: true as const, nonce: 'refresh' })),
    annotate: jest.fn(),
    release: jest.fn(async (sessionId: string) => {
      held.delete(sessionId);
      return 'released' as const;
    }),
    holder: jest.fn(async () => null),
    held: jest.fn(() =>
      [...held].map(([sessionId, nonce]) => ({
        sessionId,
        nonce,
        purpose: 'drive' as const,
        state: 'held' as const,
        owner: {
          kind: 'worker' as const,
          hostname: 'h',
          pid: 1,
          label: 'w',
          acquiredAt: '',
          responding: true,
        },
      })),
    ),
    dispose: jest.fn(async () => undefined),
  };
  const permissions = {
    handleResponse: jest.fn(),
    handleQuestionResponse: jest.fn(),
    getPermissionLevel: jest.fn(() => 'ask'),
    cleanupPendingPermissions: jest.fn(),
  };
  const call = jest.fn(
    async (method: string, params: Record<string, unknown>) => {
      const path = String(params['workspacePath'] ?? '');
      if (method === 'session:list') {
        const ids = sessionsByPath.get(path) ?? [];
        return {
          success: true,
          data: {
            sessions: ids.map((id) => ({
              id,
              name: id,
              messageCount: 1,
              createdAt: 1,
              lastActivityAt: 2,
              isActive: false,
            })),
            total: ids.length,
            hasMore: false,
          },
        };
      }
      if (method === 'chat:start') {
        started += 1;
        const sessionId = `sess-new-${started}`;
        held.set(sessionId, `nonce-${sessionId}`);
        sessionsByPath.set(path, [
          ...(sessionsByPath.get(path) ?? []),
          sessionId,
        ]);
        const tabId = String(params['tabId']);
        // As in the engine, the session ID resolves after the RPC returns,
        // and a tab-keyed event can precede it.
        const resolve = () => {
          emit('chat:chunk', { tabId, delta: 'early' });
          emit('session:id-resolved', { tabId, realSessionId: sessionId });
          behaviour.afterResolved?.(emit, tabId, sessionId);
        };
        const delay = behaviour.resolveDelayMs;
        if (delay === undefined) setImmediate(resolve);
        else if (delay !== null) setTimeout(resolve, delay);
        behaviour.duringStart?.(emit, tabId, sessionId);
        return { success: true, data: { success: true } };
      }
      if (method === 'chat:continue') {
        behaviour.duringContinue?.(emit, String(params['sessionId']));
        return { success: true, data: { success: true } };
      }
      if (method === 'config:autopilot-get')
        return {
          success: true,
          data: behaviour.autopilot ?? {
            enabled: false,
            permissionLevel: 'ask',
          },
        };
      if (method === 'chat:abort')
        return behaviour.abortRefused
          ? { success: false, error: 'abort refused' }
          : { success: true, data: { success: true } };
      return { success: false, error: `unexpected ${method}` };
    },
  );
  const sdk = {
    initialize: jest.fn(async () => true),
    dispose: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const services = new Map<symbol, unknown>([
    [
      Symbol.for('ChatHistoryReadService'),
      { readForResume: async () => ({ events: [] }) },
    ],
    [Symbol.for('SdkSessionMetadataStore'), { get: async () => null }],
    [Symbol.for('SdkPermissionHandler'), permissions],
    [Symbol.for('PlatformSessionDriverLock'), lock],
    [
      Symbol.for('PlatformWorkspaceLifecycleProvider'),
      { addFolder: jest.fn() },
    ],
  ]);
  const container = {
    clearInstances: jest.fn(),
    resolve: jest.fn((token: symbol) => services.get(token) ?? sdk),
    isRegistered: jest.fn(() => false),
  };
  const bootstrap = jest.fn((options: { pushAdapter?: unknown }) => {
    push = options.pushAdapter as CliWebviewManagerAdapter;
    return {
      container,
      transport: { call },
      pushAdapter: options.pushAdapter,
      fireAndForget: { handlePermissionResponse: jest.fn() },
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    } as unknown as CliBootstrapResult;
  });
  return { bootstrap, call, emit, lock, permissions, sessionsByPath };
}

class Client {
  readonly frames: Frame[] = [];
  readonly closed: Promise<number>;
  private next = 0;
  private readonly listeners = new Set<() => void>();

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      this.frames.push(JSON.parse(data.toString()) as Frame);
      for (const listener of this.listeners) listener();
    });
    this.closed = new Promise((resolve) =>
      socket.once('close', (code) => resolve(code)),
    );
  }

  static async open(port: number): Promise<Client> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/rpc`);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return new Client(socket);
  }

  send(method: string, params: unknown = {}): string {
    this.next += 1;
    const id = String(this.next);
    this.socket.send(JSON.stringify({ v: 1, kind: 'req', id, method, params }));
    return id;
  }

  async call(method: string, params: unknown = {}): Promise<Frame> {
    const id = this.send(method, params);
    return this.waitFor((frame) => frame.kind === 'res' && frame.id === id);
  }

  waitFor(match: (frame: Frame) => boolean): Promise<Frame> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        const found = this.frames.find(match);
        if (!found) return false;
        this.listeners.delete(listener);
        clearTimeout(timer);
        resolve(found);
        return true;
      };
      const listener = (): void => {
        check();
      };
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error('Timed out waiting for a frame'));
      }, 10_000);
      if (!check()) this.listeners.add(listener);
    });
  }

  events(sessionId: string): Frame[] {
    return this.frames.filter(
      (frame) => frame.kind === 'evt' && frame.sessionId === sessionId,
    );
  }

  async authenticate(token: string): Promise<void> {
    await this.call('hello', {
      protocol: { min: 1, max: 1 },
      client: { name: 'test', version: '1' },
    });
    const auth = await this.call('auth', { token });
    expect(auth.ok).toBe(true);
  }
}

const homes: string[] = [];
const clients: Client[] = [];
const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.terminate();
  for (const stop of stops.splice(0)) await stop();
  for (const home of homes.splice(0))
    await rm(home, { recursive: true, force: true });
});

async function startWorker(
  maxActiveTurns = 4,
  behaviour: EngineBehaviour = {},
) {
  const home = await mkdtemp(join(tmpdir(), 'ptah-worker-sessions-'));
  homes.push(home);
  await mkdir(join(home, 'project'));
  await mkdir(join(home, 'outside'));
  await import('@ptah-extension/platform-core');
  const runtime = await import('@ptah-extension/worker-runtime');
  const paths = runtime.workerPaths(home);
  const registry = new runtime.WorkspaceRegistry(paths);
  await registry.load();
  const inside = await registry.register(join(home, 'project'));
  const outside = await registry.register(join(home, 'outside'));
  const machineId = `machine_${createHash('sha256').update(hostname()).digest('hex').slice(0, 16)}`;
  const tokens = new runtime.TokenStore(paths);
  await tokens.load();
  const { token, tokenId } = await tokens.issue('phone', {
    machineId,
    workspaceIds: [inside.workspaceId],
  });
  const engine = fakeEngine(behaviour);
  const shutdown = new AbortController();
  let ready!: (endpoint: { host: string; port: number }) => void;
  const endpointReady = new Promise<{ host: string; port: number }>(
    (resolve) => {
      ready = resolve;
    },
  );
  const serving = serveCommand({
    port: 0,
    maxActiveTurns,
    paths,
    argv: [],
    checks,
    bootstrap: engine.bootstrap,
    readiness: async () => ({ ready: true, checks: [] }),
    shutdown: shutdown.signal,
    onReady: ready,
  });
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    shutdown.abort();
    await serving;
  };
  stops.push(stop);
  const endpoint = await Promise.race([
    endpointReady,
    serving.then(() => {
      throw new Error('Worker stopped before listening');
    }),
  ]);
  const connect = async (): Promise<Client> => {
    const client = await Client.open(endpoint.port);
    clients.push(client);
    await client.authenticate(token);
    return client;
  };
  return {
    paths,
    inside,
    outside,
    engine,
    endpoint,
    connect,
    stop,
    token,
    tokenId,
  };
}

it(
  'starts a remote turn and streams logged and live events to an attached client',
  async () => {
    const worker = await startWorker();
    const client = await worker.connect();
    const start = await client.call('session.start', {
      workspaceId: worker.inside.workspaceId,
      prompt: 'hello',
    });
    expect(start).toMatchObject({
      ok: true,
      result: { sessionId: 'sess-new-1' },
    });
    expect(worker.engine.call).toHaveBeenCalledWith(
      'chat:start',
      expect.objectContaining({
        prompt: 'hello',
        workspacePath: worker.inside.path,
      }),
    );
    const attach = await client.call('session.attach', {
      sessionId: 'sess-new-1',
    });
    expect(attach).toMatchObject({ ok: true, result: { mode: 'log' } });
    await client.waitFor((frame) => frame.type === 'session:id-resolved');
    worker.engine.emit('chat:chunk', {
      sessionId: 'sess-new-1',
      delta: 'live',
    });
    worker.engine.emit('session:turnEnded', { sessionId: 'sess-new-1' });
    await client.waitFor((frame) => frame.type === 'worker:history-mark');
    const events = client.events('sess-new-1');
    // Log before send: one gap-free sequence, the early tab event after the
    // baseline and turn begin, live events after the replay.
    expect(events.map((frame) => frame.seq)).toEqual(
      events.map((_frame, index) => index + 1),
    );
    expect(events.map((frame) => frame.type)).toEqual([
      'worker:baseline',
      'worker:turn.begin',
      'chat:chunk',
      'session:id-resolved',
      'chat:chunk',
      'session:turnEnded',
      'worker:turn.end',
      'worker:history-mark',
    ]);
    expect(events[4]?.payload).toMatchObject({ delta: 'live' });
    const listed = await client.call('sessions.list', {
      workspaceId: worker.inside.workspaceId,
    });
    expect(listed.result).toEqual([
      expect.objectContaining({
        sessionId: 'sess-new-1',
        state: 'idle',
        logged: true,
      }),
    ]);
  },
  ENGINE_TIMEOUT,
);

it(
  'refuses an unauthenticated call and any resource outside the grant',
  async () => {
    const worker = await startWorker();
    const anonymous = await Client.open(worker.endpoint.port);
    clients.push(anonymous);
    await anonymous.call('hello', {
      protocol: { min: 1, max: 1 },
      client: { name: 'anon', version: '1' },
    });
    anonymous.send('sessions.list', { workspaceId: worker.inside.workspaceId });
    expect(await anonymous.closed).toBe(4403);

    worker.engine.sessionsByPath.set(worker.outside.path, ['sess-outside']);
    const client = await worker.connect();
    for (const [name, params] of [
      ['sessions.list', { workspaceId: worker.outside.workspaceId }],
      [
        'session.start',
        { workspaceId: worker.outside.workspaceId, prompt: 'x' },
      ],
      ['session.attach', { sessionId: 'sess-outside' }],
      ['session.continue', { sessionId: 'sess-outside', prompt: 'x' }],
      [
        'permission.respond',
        { sessionId: 'sess-outside', requestId: 'r', decision: 'allow' },
      ],
    ] as const) {
      const response = await client.call(name, params);
      expect({ name, response }).toMatchObject({
        name,
        response: { ok: false, error: { code: 'NOT_FOUND_OR_FORBIDDEN' } },
      });
    }
    const chatCalls = worker.engine.call.mock.calls.filter(([method]) =>
      method.startsWith('chat:'),
    );
    expect(chatCalls).toEqual([]);
  },
  ENGINE_TIMEOUT,
);

it(
  'refuses the turn past --max-active-turns until a turn ends',
  async () => {
    const worker = await startWorker(1);
    worker.engine.sessionsByPath.set(worker.inside.path, ['sess-old']);
    const client = await worker.connect();
    const first = await client.call('session.start', {
      workspaceId: worker.inside.workspaceId,
      prompt: 'one',
    });
    expect(first.ok).toBe(true);
    const second = await client.call('session.start', {
      workspaceId: worker.inside.workspaceId,
      prompt: 'two',
    });
    expect(second).toMatchObject({ ok: false, error: { code: 'WORKER_BUSY' } });
    const busy = await client.call('session.continue', {
      sessionId: 'sess-old',
      prompt: 'three',
    });
    expect(busy).toMatchObject({ ok: false, error: { code: 'WORKER_BUSY' } });
    expect(
      worker.engine.call.mock.calls.filter(
        ([method]) => method === 'chat:start' || method === 'chat:continue',
      ),
    ).toHaveLength(1);
    await client.call('session.attach', { sessionId: 'sess-new-1' });
    worker.engine.emit('session:turnEnded', { sessionId: 'sess-new-1' });
    // The slot frees once the turn end and its history mark are logged.
    await client.waitFor((frame) => frame.type === 'worker:history-mark');
    await new Promise((resolve) => setImmediate(resolve));
    const admitted = await client.call('session.continue', {
      sessionId: 'sess-old',
      prompt: 'four',
    });
    expect(admitted).toMatchObject({ ok: true });
  },
  ENGINE_TIMEOUT,
);

it(
  'round-trips a permission request to the SDK handler exactly once',
  async () => {
    const worker = await startWorker();
    const client = await worker.connect();
    await client.call('session.start', {
      workspaceId: worker.inside.workspaceId,
      prompt: 'run ls',
    });
    await client.call('session.attach', { sessionId: 'sess-new-1' });
    worker.engine.emit('permission:request', {
      id: 'req-1',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
      sessionId: 'sess-new-1',
    });
    await client.waitFor((frame) => frame.type === 'permission:request');
    const answer = await client.call('permission.respond', {
      sessionId: 'sess-new-1',
      requestId: 'req-1',
      decision: 'allow',
    });
    expect(answer).toMatchObject({ ok: true, result: { applied: true } });
    expect(worker.engine.permissions.handleResponse).toHaveBeenCalledWith(
      'req-1',
      { id: 'req-1', decision: 'allow' },
    );
    const answered = await client.waitFor(
      (frame) => frame.type === 'worker:permission.answered',
    );
    expect(answered.payload).toEqual({
      requestId: 'req-1',
      decision: 'allow',
      by: 'phone',
    });
    const again = await client.call('permission.respond', {
      sessionId: 'sess-new-1',
      requestId: 'req-1',
      decision: 'deny',
    });
    expect(again).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_ANSWERED' },
    });
    expect(worker.engine.permissions.handleResponse).toHaveBeenCalledTimes(1);
  },
  ENGINE_TIMEOUT,
);

it(
  'interrupts the driven turn and releases its driver lock on shutdown',
  async () => {
    const { requestRelease } = jest.requireMock<{
      requestRelease: jest.Mock;
    }>('@ptah-extension/platform-core');
    requestRelease.mockClear();
    const worker = await startWorker();
    const client = await worker.connect();
    await client.call('session.start', {
      workspaceId: worker.inside.workspaceId,
      prompt: 'long task',
    });
    expect(worker.engine.lock.held()).toHaveLength(1);
    await worker.stop();
    expect(worker.engine.call).toHaveBeenCalledWith('chat:abort', {
      sessionId: 'sess-new-1',
    });
    expect(requestRelease).toHaveBeenCalledWith('sess-new-1');
    expect(worker.engine.lock.release).toHaveBeenCalledWith(
      'sess-new-1',
      'nonce-sess-new-1',
    );
    expect(worker.engine.lock.held()).toEqual([]);
    const log = await readFile(
      join(worker.paths.events, 'sess-new-1.jsonl'),
      'utf8',
    );
    expect(log).toContain('"t":"worker:turn.interrupted"');
  },
  ENGINE_TIMEOUT,
);

describe('turn lifecycle (Batch 20)', () => {
  const seqTypes = (client: Client, sessionId: string) =>
    client.events(sessionId).map((frame) => frame.type);

  it(
    'answers session.start after a delayed session:id-resolved',
    async () => {
      const worker = await startWorker(4, { resolveDelayMs: 300 });
      const client = await worker.connect();
      const start = await client.call('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'hello',
      });
      expect(start).toMatchObject({
        ok: true,
        result: { sessionId: 'sess-new-1' },
      });
    },
    ENGINE_TIMEOUT,
  );

  it(
    'ends a turn whose terminal event arrives during start, once, and frees the slot',
    async () => {
      const worker = await startWorker(1, {
        afterResolved: (emit, _tabId, sessionId) =>
          emit('session:turnEnded', { sessionId }),
      });
      const client = await worker.connect();
      const start = await client.call('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'quick',
      });
      expect(start.ok).toBe(true);
      await client.call('session.attach', { sessionId: 'sess-new-1' });
      await client.waitFor((frame) => frame.type === 'worker:history-mark');
      const types = seqTypes(client, 'sess-new-1');
      expect(types.filter((type) => type === 'worker:turn.end')).toHaveLength(
        1,
      );
      expect(types.indexOf('worker:turn.begin')).toBeLessThan(
        types.indexOf('session:turnEnded'),
      );
      expect(types.indexOf('session:turnEnded')).toBeLessThan(
        types.indexOf('worker:turn.end'),
      );
      const next = await client.call('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'again',
      });
      expect(next.ok).toBe(true);
    },
    ENGINE_TIMEOUT,
  );

  it(
    'ends a turn whose terminal event arrives during continue, after the baseline and turn begin',
    async () => {
      const worker = await startWorker(1, {
        duringContinue: (emit, sessionId) => {
          emit('chat:chunk', { sessionId, delta: 'fast' });
          emit('session:turnEnded', { sessionId });
        },
      });
      worker.engine.sessionsByPath.set(worker.inside.path, ['sess-old']);
      const client = await worker.connect();
      const turn = await client.call('session.continue', {
        sessionId: 'sess-old',
        prompt: 'quick',
      });
      expect(turn.ok).toBe(true);
      await client.call('session.attach', { sessionId: 'sess-old' });
      await client.waitFor((frame) => frame.type === 'worker:history-mark');
      expect(seqTypes(client, 'sess-old')).toEqual([
        'worker:baseline',
        'worker:turn.begin',
        'chat:chunk',
        'session:turnEnded',
        'worker:turn.end',
        'worker:history-mark',
      ]);
      const again = await client.call('session.continue', {
        sessionId: 'sess-old',
        prompt: 'again',
      });
      expect(again.ok).toBe(true);
    },
    ENGINE_TIMEOUT,
  );

  it(
    'reports a refused chat:abort from session.stop and keeps the slot',
    async () => {
      const worker = await startWorker(1, { abortRefused: true });
      const client = await worker.connect();
      await client.call('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'long',
      });
      const stop = await client.call('session.stop', {
        sessionId: 'sess-new-1',
      });
      expect(stop).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
      const busy = await client.call('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'next',
      });
      expect(busy).toMatchObject({
        ok: false,
        error: { code: 'WORKER_BUSY' },
      });
      const log = await readFile(
        join(worker.paths.events, 'sess-new-1.jsonl'),
        'utf8',
      );
      expect(log).not.toContain('worker:turn.interrupted');
    },
    ENGINE_TIMEOUT,
  );

  it(
    'binds a tab-only permission request to its session on resolution and refuses another session',
    async () => {
      const worker = await startWorker(4, {
        duringStart: (emit, tabId) =>
          emit('permission:request', {
            id: 'req-tab',
            toolName: 'Bash',
            toolInput: {},
            tabId,
          }),
      });
      worker.engine.sessionsByPath.set(worker.inside.path, ['sess-old']);
      const client = await worker.connect();
      await client.call('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'run',
      });
      const wrong = await client.call('permission.respond', {
        sessionId: 'sess-old',
        requestId: 'req-tab',
        decision: 'allow',
      });
      expect(wrong).toMatchObject({
        ok: false,
        error: { code: 'ALREADY_ANSWERED' },
      });
      const answer = await client.call('permission.respond', {
        sessionId: 'sess-new-1',
        requestId: 'req-tab',
        decision: 'allow',
      });
      expect(answer).toMatchObject({ ok: true, result: { applied: true } });
      expect(worker.engine.permissions.handleResponse).toHaveBeenCalledWith(
        'req-tab',
        { id: 'req-tab', decision: 'allow' },
      );
    },
    ENGINE_TIMEOUT,
  );

  it(
    'shuts down promptly with a start still waiting for its session and releases its lock',
    async () => {
      const worker = await startWorker(4, { resolveDelayMs: null });
      const client = await worker.connect();
      client.send('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'never resolves',
      });
      await new Promise<void>((resolve) => {
        const poll = () =>
          worker.engine.call.mock.calls.some(([m]) => m === 'chat:start')
            ? resolve()
            : setTimeout(poll, 10);
        poll();
      });
      const began = Date.now();
      await worker.stop();
      expect(Date.now() - began).toBeLessThan(10_000);
      expect(worker.engine.lock.release).toHaveBeenCalledWith(
        'sess-new-1',
        'nonce-sess-new-1',
      );
      expect(worker.engine.lock.held()).toEqual([]);
    },
    ENGINE_TIMEOUT,
  );

  it(
    'refuses a start whose early-event queue overflows without failing the push tap',
    async () => {
      const worker = await startWorker(1, {
        // Only the first start floods its queue.
        duringStart: (emit, tabId, sessionId) => {
          if (sessionId !== 'sess-new-1') return;
          for (let i = 0; i <= 10_000; i += 1)
            emit('chat:chunk', { tabId, delta: String(i) });
        },
      });
      const client = await worker.connect();
      const start = await client.call('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'flood',
      });
      expect(start).toMatchObject({
        ok: false,
        error: { code: 'SESSION_LOG_FAILED' },
      });
      expect(worker.engine.call).toHaveBeenCalledWith('chat:abort', {
        sessionId: 'sess-new-1',
      });
      const next = await client.call('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'after',
      });
      expect(next.ok).toBe(true);
    },
    ENGINE_TIMEOUT,
  );
});

describe('security and stores (Batch 21)', () => {
  it.each(['yolo', 'auto-edit'])(
    'refuses to serve while autopilot is persisted at %s',
    async (permissionLevel) => {
      const home = await mkdtemp(join(tmpdir(), 'ptah-worker-sessions-'));
      homes.push(home);
      const runtime = await import('@ptah-extension/worker-runtime');
      const engine = fakeEngine({
        autopilot: { enabled: true, permissionLevel },
      });
      const onReady = jest.fn();
      await expect(
        serveCommand({
          port: 0,
          maxActiveTurns: 1,
          paths: runtime.workerPaths(home),
          argv: [],
          checks,
          bootstrap: engine.bootstrap,
          readiness: async () => ({ ready: true, checks: [] }),
          onReady,
        }),
      ).rejects.toThrow(`autopilot is enabled at level "${permissionLevel}"`);
      expect(onReady).not.toHaveBeenCalled();
      expect(engine.call).not.toHaveBeenCalledWith(
        'chat:start',
        expect.anything(),
      );
    },
    ENGINE_TIMEOUT,
  );

  it(
    'refuses a turn once autopilot is switched to an auto-approving level while serving',
    async () => {
      const behaviour: EngineBehaviour = {};
      const worker = await startWorker(4, behaviour);
      const client = await worker.connect();
      behaviour.autopilot = { enabled: true, permissionLevel: 'yolo' };
      const start = await client.call('session.start', {
        workspaceId: worker.inside.workspaceId,
        prompt: 'hello',
      });
      expect(start).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
      expect(worker.engine.call).not.toHaveBeenCalledWith(
        'chat:start',
        expect.anything(),
      );
    },
    ENGINE_TIMEOUT,
  );

  it(
    'token.revokeSelf closes every live connection of that token',
    async () => {
      const worker = await startWorker();
      const caller = await worker.connect();
      const other = await worker.connect();
      const revoke = await caller.call('token.revokeSelf');
      expect(revoke.ok).toBe(true);
      expect(await other.closed).toBe(4410);
      expect(await caller.closed).toBe(4410);
      const again = await Client.open(worker.endpoint.port);
      clients.push(again);
      await again.call('hello', {
        protocol: { min: 1, max: 1 },
        client: { name: 'test', version: '1' },
      });
      again.send('auth', { token: worker.token });
      expect(await again.closed).toBe(4401);
    },
    ENGINE_TIMEOUT,
  );

  it(
    'grants revoke closes the live connections; grants add reaches them without a reconnect',
    async () => {
      const worker = await startWorker();
      const { grantsCommand } = await import('./grants');
      const client = await worker.connect();
      const denied = await client.call('sessions.list', {
        workspaceId: worker.outside.workspaceId,
      });
      expect(denied.error?.code).toBe('NOT_FOUND_OR_FORBIDDEN');
      await expect(
        grantsCommand(worker.paths, 'add', worker.tokenId, [
          worker.outside.path,
        ]),
      ).resolves.toMatchObject({
        grant: {
          workspaceIds: [worker.inside.workspaceId, worker.outside.workspaceId],
        },
      });
      const allowed = await client.call('sessions.list', {
        workspaceId: worker.outside.workspaceId,
      });
      expect(allowed.ok).toBe(true);
      await expect(
        grantsCommand(worker.paths, 'revoke', worker.tokenId),
      ).resolves.toMatchObject({
        tokenId: worker.tokenId,
        revokedAt: expect.any(Number),
        connectionsClosed: 1,
      });
      expect(await client.closed).toBe(4410);
      expect(
        client.frames.some(
          (frame) =>
            frame.type === 'goodbye' && frame.payload?.['reason'] === 'revoked',
        ),
      ).toBe(true);
      await expect(
        grantsCommand(worker.paths, 'revoke', 'UNKNOWN00000'),
      ).rejects.toThrow('NOT_FOUND_OR_FORBIDDEN');
    },
    ENGINE_TIMEOUT,
  );

  it(
    'records lastUsedAt when a token authenticates',
    async () => {
      const worker = await startWorker();
      const { adminCall } = await import('./admin-client');
      const before = await adminCall(worker.paths, 'admin.grants.list', {});
      expect(before[0]?.lastUsedAt).toBeNull();
      await worker.connect();
      let grants = before;
      for (let i = 0; i < 200 && grants[0]?.lastUsedAt === null; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        grants = await adminCall(worker.paths, 'admin.grants.list', {});
      }
      expect(grants[0]?.lastUsedAt).toEqual(expect.any(Number));
    },
    ENGINE_TIMEOUT,
  );

  it(
    'workspace remove and add reach the running service at once',
    async () => {
      const worker = await startWorker();
      const { workspaceCommand } = await import('./workspace');
      const client = await worker.connect();
      const listed = await client.call('sessions.list', {
        workspaceId: worker.inside.workspaceId,
      });
      expect(listed.ok).toBe(true);
      await expect(
        workspaceCommand(worker.paths, 'remove', worker.inside.path),
      ).resolves.toMatchObject({ workspaceId: worker.inside.workspaceId });
      const removed = await client.call('sessions.list', {
        workspaceId: worker.inside.workspaceId,
      });
      expect(removed.error?.code).toBe('NOT_FOUND_OR_FORBIDDEN');
      const workspaces = await client.call('workspaces.list');
      expect(workspaces.result).toEqual([]);
      await expect(
        workspaceCommand(worker.paths, 'add', worker.inside.path),
      ).resolves.toMatchObject({ workspaceId: worker.inside.workspaceId });
      const restored = await client.call('sessions.list', {
        workspaceId: worker.inside.workspaceId,
      });
      expect(restored.ok).toBe(true);
      const file = JSON.parse(
        await readFile(worker.paths.workspaces, 'utf8'),
      ) as { workspaceId: string }[];
      expect(file.map((item) => item.workspaceId).sort()).toEqual(
        [worker.inside.workspaceId, worker.outside.workspaceId].sort(),
      );
    },
    ENGINE_TIMEOUT,
  );
});
