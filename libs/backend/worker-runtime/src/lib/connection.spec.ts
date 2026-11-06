import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { WorkerConnection, type WorkerPeer } from './connection';
import { WORKER_LIMITS } from '@ptah-extension/worker-protocol';
import type { PairingWindow } from './pairing-window';
import type { TokenStore } from './token-store';
import { PAIRING_REJECTION } from './pairing-window';

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  frames: unknown[] = [];
  code: number | undefined;
  send(text: string): void {
    this.frames.push(JSON.parse(text) as unknown);
  }
  ping(): void {
    /* liveness is driven by the connection timer */
  }
  close(code?: number): void {
    this.code = code;
    this.readyState = 3;
    this.emit('close');
  }
}

function frame(id: string, method: string, params: unknown): Buffer {
  return Buffer.from(JSON.stringify({ v: 1, kind: 'req', id, method, params }));
}

it('closes every non-hello method before dispatch', async () => {
  const socket = new FakeSocket();
  const handle = jest.fn();
  new WorkerConnection(socket as unknown as WebSocket, {
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: {} as PairingWindow,
    tokens: {} as TokenStore,
    handle,
  });
  socket.emit('message', frame('1', 'session.list', {}), false);
  await new Promise((resolve) => setImmediate(resolve));
  expect(socket.code).toBe(4403);
  expect(handle).not.toHaveBeenCalled();
});

it('maps an internal Codex refusal to fixed INTERNAL copy', async () => {
  const socket = new FakeSocket();
  const handle = jest
    .fn()
    .mockRejectedValue(
      Object.assign(new Error('private path'), { code: 'CODEX_UNAVAILABLE' }),
    );
  const tokens = {
    recordUse: jest.fn(async () => undefined),
    authenticate: () => ({
      tokenId: 't',
      grant: { machineId: 'm', workspaceIds: [] },
    }),
  } as unknown as TokenStore;
  const connection = new WorkerConnection(socket as unknown as WebSocket, {
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: {} as PairingWindow,
    tokens,
    handle,
  });
  socket.emit(
    'message',
    frame('1', 'hello', {
      protocol: { min: 1, max: 1 },
      client: { name: 'c', version: '1' },
    }),
    false,
  );
  socket.emit('message', frame('2', 'auth', { token: 't' }), false);
  socket.emit('message', frame('3', 'machine.info', {}), false);
  await new Promise((resolve) => setImmediate(resolve));
  expect(JSON.stringify(socket.frames)).toContain('INTERNAL');
  expect(JSON.stringify(socket.frames)).not.toContain('private path');
  connection.close();
});

it('throttles pairing on the third failure with the same wire rejection', async () => {
  const socket = new FakeSocket();
  const exchange = jest.fn().mockResolvedValue(PAIRING_REJECTION);
  const connection = new WorkerConnection(socket as unknown as WebSocket, {
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: { exchange } as unknown as PairingWindow,
    tokens: {} as TokenStore,
    handle: jest.fn(),
  });
  socket.emit(
    'message',
    frame('1', 'hello', {
      protocol: { min: 1, max: 1 },
      client: { name: 'c', version: '1' },
    }),
    false,
  );
  for (let i = 0; i < 3; i++)
    socket.emit(
      'message',
      frame(String(i + 2), 'pair.exchange', {
        code: 'AAAA-AAAA',
        clientName: 'c',
      }),
      false,
    );
  await new Promise<void>((resolve) => {
    const poll = setInterval(() => {
      if (socket.code === 4429) {
        clearInterval(poll);
        resolve();
      }
    }, 10);
  });
  expect(exchange).toHaveBeenCalledTimes(3);
  expect(
    socket.frames.filter((item) =>
      JSON.stringify(item).includes('PAIRING_REJECTED'),
    ),
  ).toHaveLength(3);
  connection.close();
});

describe('liveness timers', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function make(socket: FakeSocket): WorkerConnection {
    return new WorkerConnection(socket as unknown as WebSocket, {
      identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
      pairing: {} as PairingWindow,
      tokens: {} as TokenStore,
      handle: jest.fn(),
    });
  }

  it('holds the auth and ping timers while open and releases them on close', () => {
    const connection = make(new FakeSocket());
    expect(jest.getTimerCount()).toBe(2);
    connection.close();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('releases every timer including a pending pong deadline when the peer closes', () => {
    const socket = new FakeSocket();
    make(socket);
    jest.advanceTimersByTime(WORKER_LIMITS.pingIntervalMs);
    // auth timer already fired (authTimeoutMs < pingIntervalMs); pong deadline pending
    socket.emit('close');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('closes an unauthenticated connection when the auth timeout elapses', () => {
    const socket = new FakeSocket();
    make(socket);
    jest.advanceTimersByTime(WORKER_LIMITS.authTimeoutMs);
    expect(socket.code).toBe(4401);
    expect(jest.getTimerCount()).toBe(0);
  });
});

it('gives the handler a peer whose reply tasks run after the response and whose close listeners run once', async () => {
  const socket = new FakeSocket();
  const closed = jest.fn();
  const handle = jest.fn(
    async (
      _method: string,
      _params: unknown,
      _grant: unknown,
      _admin: boolean,
      peer: WorkerPeer,
    ) => {
      expect(peer.tokenId).toBe('t');
      peer.afterReply(() =>
        peer.send({
          v: 1,
          kind: 'ctl',
          type: 'session-state',
          payload: { sessionId: 's' },
        }),
      );
      peer.onClose(closed);
      return { machineId: 'm' };
    },
  );
  const tokens = {
    recordUse: jest.fn(async () => undefined),
    authenticate: () => ({
      tokenId: 't',
      grant: { machineId: 'm', workspaceIds: [] },
    }),
  } as unknown as TokenStore;
  const connection = new WorkerConnection(socket as unknown as WebSocket, {
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: {} as PairingWindow,
    tokens,
    handle,
  });
  socket.emit(
    'message',
    frame('1', 'hello', {
      protocol: { min: 1, max: 1 },
      client: { name: 'c', version: '1' },
    }),
    false,
  );
  socket.emit('message', frame('2', 'auth', { token: 't' }), false);
  socket.emit('message', frame('3', 'machine.info', {}), false);
  await new Promise((resolve) => setImmediate(resolve));
  const kinds = socket.frames
    .slice(2)
    .map((item) => (item as { kind: string }).kind);
  expect(kinds).toEqual(['res', 'ctl']);
  connection.close();
  connection.close();
  expect(closed).toHaveBeenCalledTimes(1);
});

it('answers session.stop and permission.respond while a session.start on the same connection is pending, and keeps order otherwise', async () => {
  const socket = new FakeSocket();
  let finishStart!: () => void;
  const order: string[] = [];
  const handle = jest.fn(async (method: string) => {
    order.push(method);
    if (method === 'session.start')
      await new Promise<void>((resolve) => {
        finishStart = resolve;
      });
    if (method === 'session.start') return { sessionId: 's', turnId: 't' };
    if (method === 'session.stop') return { stopped: true };
    if (method === 'permission.respond') return { applied: true };
    return {};
  });
  const tokens = {
    recordUse: jest.fn(async () => undefined),
    authenticate: () => ({
      tokenId: 't',
      grant: { machineId: 'm', workspaceIds: ['w'] },
    }),
  } as unknown as TokenStore;
  const connection = new WorkerConnection(socket as unknown as WebSocket, {
    identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
    pairing: {} as PairingWindow,
    tokens,
    handle,
  });
  socket.emit(
    'message',
    frame('1', 'hello', {
      protocol: { min: 1, max: 1 },
      client: { name: 'c', version: '1' },
    }),
    false,
  );
  socket.emit('message', frame('2', 'auth', { token: 't' }), false);
  await new Promise((resolve) => setImmediate(resolve));
  socket.emit(
    'message',
    frame('3', 'session.start', { workspaceId: 'w', prompt: 'p' }),
    false,
  );
  socket.emit('message', frame('4', 'workspaces.list', {}), false);
  socket.emit('message', frame('5', 'session.stop', { sessionId: 's' }), false);
  socket.emit(
    'message',
    frame('6', 'permission.respond', {
      sessionId: 's',
      requestId: 'r',
      decision: 'allow',
    }),
    false,
  );
  await new Promise((resolve) => setImmediate(resolve));
  const answered = () =>
    socket.frames
      .filter((item) => (item as { kind: string }).kind === 'res')
      .map((item) => (item as { id: string }).id);
  expect(answered()).toEqual(['1', '2', '5', '6']);
  finishStart();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  expect(answered()).toEqual(['1', '2', '5', '6', '3', '4']);
  // The serialized calls keep their order; the two concurrent ones overtook.
  expect(order.indexOf('session.start')).toBeLessThan(
    order.indexOf('workspaces.list'),
  );
  connection.close();
});

describe('Batch 21 connection bounds and token state', () => {
  function authedConnection(handle: jest.Mock) {
    const socket = new FakeSocket();
    const recordUse = jest.fn(async () => undefined);
    const tokens = {
      recordUse,
      authenticate: () => ({
        tokenId: 'tok',
        grant: { machineId: 'm', workspaceIds: ['w1'] },
      }),
    } as unknown as TokenStore;
    const connection = new WorkerConnection(socket as unknown as WebSocket, {
      identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
      pairing: {} as PairingWindow,
      tokens,
      handle,
    });
    socket.emit(
      'message',
      frame('h', 'hello', {
        protocol: { min: 1, max: 1 },
        client: { name: 'c', version: '1' },
      }),
      false,
    );
    socket.emit('message', frame('a', 'auth', { token: 't' }), false);
    return { socket, connection, recordUse };
  }
  const responses = (socket: FakeSocket) =>
    socket.frames.filter(
      (item) => (item as { kind: string }).kind === 'res',
    ) as { id: string; ok: boolean; error?: { code: string } }[];

  it('refuses frames past the in-flight cap with WORKER_BUSY instead of queueing them', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = jest.fn(async () => {
      await blocked;
      return [];
    });
    const { socket, connection } = authedConnection(handle);
    await new Promise((resolve) => setImmediate(resolve));
    const max = WORKER_LIMITS.maxInFlightRequests;
    for (let i = 0; i < max + 2; i += 1)
      socket.emit('message', frame(`q${i}`, 'workspaces.list', {}), false);
    await new Promise((resolve) => setImmediate(resolve));
    const busy = responses(socket).filter(
      (item) => item.error?.code === 'WORKER_BUSY',
    );
    expect(busy.map((item) => item.id)).toEqual([`q${max}`, `q${max + 1}`]);
    release();
    for (let i = 0; i < 5; i += 1)
      await new Promise((resolve) => setImmediate(resolve));
    expect(handle).toHaveBeenCalledTimes(max);
    // Room again once the queue drained.
    socket.emit('message', frame('after', 'workspaces.list', {}), false);
    for (let i = 0; i < 3; i += 1)
      await new Promise((resolve) => setImmediate(resolve));
    expect(responses(socket).find((item) => item.id === 'after')?.ok).toBe(
      true,
    );
    connection.close();
  });

  it('closes an unauthenticated flood past the cap with THROTTLED', () => {
    const socket = new FakeSocket();
    const exchange = jest.fn(() => new Promise(() => undefined));
    new WorkerConnection(socket as unknown as WebSocket, {
      identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
      pairing: { exchange } as unknown as PairingWindow,
      tokens: {} as TokenStore,
      handle: jest.fn(),
    });
    for (let i = 0; i <= WORKER_LIMITS.maxInFlightRequests; i += 1)
      socket.emit(
        'message',
        frame(String(i), 'hello', {
          protocol: { min: 1, max: 1 },
          client: { name: 'c', version: '1' },
        }),
        false,
      );
    expect(socket.code).toBe(4429);
  });

  it('records the token use on auth and exposes the token for revocation', async () => {
    const grants: unknown[] = [];
    const handle = jest.fn(
      async (_method: string, _params: unknown, grant: unknown) => {
        grants.push(grant);
        return [];
      },
    );
    const { socket, connection, recordUse } = authedConnection(handle);
    await new Promise((resolve) => setImmediate(resolve));
    expect(recordUse).toHaveBeenCalledWith('tok');
    expect(connection.authenticatedTokenId).toBe('tok');
    expect(typeof connection.connectionId).toBe('string');
    connection.refreshGrant({ machineId: 'm', workspaceIds: ['w1', 'w2'] });
    socket.emit('message', frame('1', 'workspaces.list', {}), false);
    await new Promise((resolve) => setImmediate(resolve));
    expect(grants).toEqual([{ machineId: 'm', workspaceIds: ['w1', 'w2'] }]);
    connection.close();
  });
});

describe('auth races and the admin proof (revise round 1)', () => {
  const hello = frame('h', 'hello', {
    protocol: { min: 1, max: 1 },
    client: { name: 'c', version: '1' },
  });
  const settle = async () => {
    for (let i = 0; i < 3; i += 1)
      await new Promise((resolve) => setImmediate(resolve));
  };

  /** A connection whose `recordUse` stays pending until `finish()`. */
  function pausedInAuth() {
    const socket = new FakeSocket();
    let finish!: () => void;
    const recorded = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const state: {
      record:
        | {
            tokenId: string;
            grant: { machineId: string; workspaceIds: string[] };
          }
        | undefined;
    } = {
      record: {
        tokenId: 'tok',
        grant: { machineId: 'm', workspaceIds: ['w1'] },
      },
    };
    const tokens = {
      recordUse: jest.fn(() => recorded),
      authenticate: () => state.record,
    } as unknown as TokenStore;
    const handle = jest.fn(
      async (_method: string, _params: unknown, grant: unknown) => grant,
    );
    const connection = new WorkerConnection(socket as unknown as WebSocket, {
      identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
      pairing: {} as PairingWindow,
      tokens,
      handle,
    });
    socket.emit('message', hello, false);
    socket.emit('message', frame('a', 'auth', { token: 't' }), false);
    return { socket, connection, state, finish, handle };
  }

  it('refuses a token revoked while its use was being recorded', async () => {
    const { socket, connection, state, finish, handle } = pausedInAuth();
    await settle();
    // A revocation scan now cannot see this connection: no token ID yet.
    expect(connection.authenticatedTokenId).toBeNull();
    state.record = undefined;
    finish();
    await settle();
    expect(socket.code).toBe(4401);
    socket.emit('message', frame('1', 'workspaces.list', {}), false);
    await settle();
    expect(handle).not.toHaveBeenCalled();
  });

  it('enters client with the grant current after the recorded use', async () => {
    const { socket, connection, state, finish } = pausedInAuth();
    await settle();
    state.record = {
      tokenId: 'tok',
      grant: { machineId: 'm', workspaceIds: ['w1', 'w2'] },
    };
    finish();
    await settle();
    const auth = socket.frames.find(
      (item) => (item as { id?: string }).id === 'a',
    ) as { ok: boolean; result: { grant: unknown } };
    expect(auth.ok).toBe(true);
    expect(auth.result.grant).toEqual({
      machineId: 'm',
      workspaceIds: ['w1', 'w2'],
    });
    expect(connection.authenticatedTokenId).toBe('tok');
    connection.close();
  });

  it('accepts only an HMAC over this connection challenge as admin proof', async () => {
    const { adminProof } = await import('./admin-key');
    const key = Buffer.alloc(32, 7);
    const open = () => {
      const socket = new FakeSocket();
      const connection = new WorkerConnection(socket as unknown as WebSocket, {
        identity: { machineId: 'm', displayName: 'machine', ptahVersion: '1' },
        pairing: {} as PairingWindow,
        tokens: {} as TokenStore,
        adminKey: key,
        handle: jest.fn(),
      });
      socket.emit('message', hello, false);
      return { socket, connection };
    };
    const challengeOf = (socket: FakeSocket) =>
      (socket.frames[0] as { result: { adminChallenge: string } }).result
        .adminChallenge;

    const good = open();
    await settle();
    const challenge = challengeOf(good.socket);
    good.socket.emit(
      'message',
      frame('a', 'auth', { adminProof: adminProof(key, challenge) }),
      false,
    );
    await settle();
    expect(good.socket.frames[1]).toMatchObject({
      ok: true,
      result: { role: 'admin' },
    });
    good.connection.close();

    // A proof replayed on another connection meets a different challenge.
    const replay = open();
    await settle();
    expect(challengeOf(replay.socket)).not.toBe(challenge);
    replay.socket.emit(
      'message',
      frame('a', 'auth', { adminProof: adminProof(key, challenge) }),
      false,
    );
    await settle();
    expect(replay.socket.code).toBe(4401);
  });
});
