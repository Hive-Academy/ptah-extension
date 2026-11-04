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
