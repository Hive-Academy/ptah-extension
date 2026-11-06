import { MachineConnection } from './machine-connection';
import {
  WorkerClient,
  type WebSocketLike,
} from '@ptah-extension/worker-protocol';

describe('MachineConnection', () => {
  it('stays unpaired without a token and disposes idempotently', async () => {
    const connection = new MachineConnection({
      machineId: 'm',
      alias: 'host',
      ptahVersion: '1',
    });
    expect(connection.state).toBe('unpaired');
    await connection.connect();
    connection.dispose();
    connection.dispose();
    expect(connection.state).toBe('unpaired');
  });
  it('uses one timer with bounded jitter after failed opens', async () => {
    const delays: number[] = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const fake = new WorkerClient({
      createSocket: () => {
        throw new Error('offline');
      },
    });
    const connection = new MachineConnection({
      machineId: 'm',
      alias: 'host',
      token: 'token',
      workerMachineId: 'm',
      ptahVersion: '1',
      random: () => 0,
      createClient: () => fake,
      setTimer: (_callback, delay) => {
        delays.push(delay);
        const timer = {} as ReturnType<typeof setTimeout>;
        timers.add(timer);
        return timer;
      },
      clearTimer: (timer) => {
        timers.delete(timer);
      },
    });
    for (let i = 0; i < 6; i++)
      await expect(connection.connect()).rejects.toThrow();
    expect(delays).toEqual([800, 1600, 4000, 8000, 24000, 24000]);
    expect(timers.size).toBe(1);
    connection.dispose();
    expect(timers.size).toBe(0);
  });
});

it('reattaches after reconnect and replays from an explicit lower cursor', async () => {
  const attached: Array<{
    sessionId: string;
    afterSeq?: number;
    epoch?: string;
  }> = [];
  let socket: WebSocketLike | undefined;
  const events: number[] = [];
  const connection = new MachineConnection({
    machineId: 'm',
    alias: 'host',
    token: 'token',
    workerMachineId: 'm',
    ptahVersion: 'test',
    createClient: (callbacks) =>
      new WorkerClient({
        createSocket: () => {
          const next: WebSocketLike = {
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            send: (data) => {
              const request = JSON.parse(data) as {
                id: string;
                method: string;
                params: {
                  sessionId?: string;
                  afterSeq?: number;
                  epoch?: string;
                };
              };
              if (request.method === 'session.attach')
                attached.push({
                  sessionId: request.params.sessionId ?? '',
                  afterSeq: request.params.afterSeq,
                  epoch: request.params.epoch,
                });
              const result =
                request.method === 'hello'
                  ? {
                      protocol: 1,
                      worker: {
                        machineId: 'm',
                        displayName: 'host',
                        ptahVersion: 'test',
                      },
                    }
                  : request.method === 'auth'
                    ? {
                        role: 'client',
                        tokenId: 't',
                        grant: { machineId: 'm', workspaceIds: [] },
                      }
                    : {
                        mode: 'log',
                        epoch: 'epoch-1',
                        fromSeq: 0,
                        headSeq: 0,
                      };
              queueMicrotask(() =>
                next.onmessage?.({
                  data: JSON.stringify({
                    v: 1,
                    kind: 'res',
                    id: request.id,
                    ok: true,
                    result,
                  }),
                }),
              );
            },
            close: () => next.onclose?.({ code: 1000, reason: '' }),
          };
          socket = next;
          queueMicrotask(() => next.onopen?.());
          return next;
        },
        callbacks: {
          onEvent: callbacks.onEvent,
          onClose: (close) => callbacks.onClose(close.code),
        },
      }),
    setTimer: () => ({}) as ReturnType<typeof setTimeout>,
    clearTimer: () => undefined,
    onEvent: (event) => events.push(event.seq),
  });
  await connection.connect();
  await connection.attach('s1');
  await connection.attach('s2');
  if (!socket) throw new Error('socket missing');
  socket.onmessage?.({
    data: JSON.stringify({
      v: 1,
      kind: 'evt',
      sessionId: 's1',
      epoch: 'epoch-1',
      seq: 7,
      type: 'chat:chunk',
      ts: Date.now(),
      payload: {},
    }),
  });
  socket.onmessage?.({
    data: JSON.stringify({
      v: 1,
      kind: 'evt',
      sessionId: 's2',
      epoch: 'epoch-1',
      seq: 4,
      type: 'chat:chunk',
      ts: Date.now(),
      payload: {},
    }),
  });
  socket.onclose?.({ code: 1006, reason: '' });
  await connection.retry();
  expect(attached.slice(-2)).toEqual([
    { sessionId: 's1', afterSeq: 7, epoch: 'epoch-1' },
    { sessionId: 's2', afterSeq: 4, epoch: 'epoch-1' },
  ]);
  await connection.attach('s1', 0);
  expect(attached.at(-1)?.afterSeq).toBe(0);
  if (!socket) throw new Error('socket missing');
  for (const seq of [1, 2, 3])
    socket.onmessage?.({
      data: JSON.stringify({
        v: 1,
        kind: 'evt',
        sessionId: 's1',
        epoch: 'epoch-1',
        seq,
        type: 'chat:chunk',
        ts: Date.now(),
        payload: {},
      }),
    });
  expect(events).toEqual([7, 4, 1, 2, 3]);
  connection.dispose();
});

it('does not send a token without a stored worker identity', async () => {
  const createClient = jest.fn();
  const setTimer = jest.fn();
  const connection = new MachineConnection({
    machineId: 'm',
    alias: 'host',
    token: 'secret',
    ptahVersion: '1',
    createClient,
    setTimer,
  });
  await connection.connect();
  expect(connection.state).toBe('unpaired');
  expect(connection.reason).toMatch(/re-pair this machine/i);
  expect(createClient).not.toHaveBeenCalled();
  expect(setTimer).not.toHaveBeenCalled();
});

it('rejects pairing while connect is in flight without replacing its client', async () => {
  let firstSocket: WebSocketLike | undefined;
  const createClient = jest.fn(
    () =>
      new WorkerClient({
        createSocket: () => {
          const socket: WebSocketLike = {
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            send: jest.fn(),
            close: jest.fn(),
          };
          firstSocket = socket;
          return socket;
        },
      }),
  );
  const connection = new MachineConnection({
    machineId: 'm',
    alias: 'host',
    token: 'secret',
    workerMachineId: 'm',
    ptahVersion: '1',
    createClient,
  });
  const connecting = connection.connect();
  await expect(connection.exchange('code')).rejects.toThrow(
    /connection is in progress/i,
  );
  expect(createClient).toHaveBeenCalledTimes(1);
  connection.dispose();
  firstSocket?.onclose?.({ code: 1000, reason: '' });
  await connecting.catch(() => undefined);
});
