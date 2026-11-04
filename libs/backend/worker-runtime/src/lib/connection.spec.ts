import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import { WorkerConnection } from './connection';
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
