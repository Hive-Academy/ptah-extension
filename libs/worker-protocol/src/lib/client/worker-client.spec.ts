import { WORKER_ERROR_MESSAGES } from '../errors';
import { WORKER_LIMITS, type ClientFrame } from '../frames';
import {
  PONG_TIMEOUT_CLOSE,
  WorkerClient,
  WorkerClientError,
  type WebSocketCloseEventLike,
  type WebSocketLike,
  type WebSocketMessageEventLike,
  type WorkerClientCallbacks,
} from './worker-client';

/** In-memory socket: records what the client sends, lets the test play the worker. */
class FakeSocket implements WebSocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((event: WebSocketMessageEventLike) => void) | null = null;
  onclose: ((event: WebSocketCloseEventLike) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onpong?: (() => void) | null = null;
  ping?: () => void;

  readonly sent: string[] = [];
  readonly closeCalls: Array<{ code?: number; reason?: string }> = [];
  pings = 0;

  constructor(withPing: boolean) {
    if (withPing) {
      this.ping = () => {
        this.pings += 1;
      };
    } else {
      delete this.onpong;
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  // Worker side.
  open(): void {
    this.onopen?.();
  }
  receive(data: unknown): void {
    this.onmessage?.({ data });
  }
  receiveFrame(frame: unknown): void {
    this.receive(JSON.stringify(frame));
  }
  peerClose(code: number, reason: string): void {
    this.onclose?.({ code, reason });
  }
  fail(): void {
    this.onerror?.(new Error('boom'));
  }
  pong(): void {
    this.onpong?.();
  }
  requests(): ClientFrame[] {
    return this.sent.map((text) => JSON.parse(text) as ClientFrame);
  }
  lastRequest(): ClientFrame {
    const all = this.requests();
    return all[all.length - 1];
  }
}

const HELLO_PARAMS = {
  protocol: { min: 1, max: 1 },
  client: { name: 'test-client', version: '1.0.0' },
};

const HELLO_RESULT = {
  protocol: 1,
  worker: { machineId: 'm-1', displayName: 'Box', ptahVersion: '1.2.3' },
};

function result(id: string, value: unknown) {
  return { v: 1, kind: 'res', id, ok: true, result: value };
}

interface Harness {
  client: WorkerClient;
  sockets: FakeSocket[];
  socket: () => FakeSocket;
  callbacks: Required<{
    [K in keyof WorkerClientCallbacks]: jest.Mock;
  }>;
}

function harness(options: { withPing?: boolean } = {}): Harness {
  const sockets: FakeSocket[] = [];
  const callbacks = {
    onEvent: jest.fn(),
    onControl: jest.fn(),
    onClose: jest.fn(),
  };
  const client = new WorkerClient({
    createSocket: () => {
      const socket = new FakeSocket(options.withPing ?? false);
      sockets.push(socket);
      return socket;
    },
    callbacks,
  });
  return {
    client,
    sockets,
    socket: () => sockets[sockets.length - 1],
    callbacks,
  };
}

async function connected(options: { withPing?: boolean } = {}) {
  const h = harness(options);
  const opening = h.client.connect();
  h.socket().open();
  await opening;
  return h;
}

function expectCode(code: string) {
  return expect.objectContaining({ name: 'WorkerClientError', code });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('WorkerClient connect', () => {
  it('resolves when the socket opens', async () => {
    const h = await connected();
    expect(h.client.state).toBe('open');
    expect(h.sockets).toHaveLength(1);
  });

  it('rejects CONNECTION_CLOSED when the socket closes before opening', async () => {
    const h = harness();
    const opening = h.client.connect();
    h.socket().peerClose(1006, '');
    await expect(opening).rejects.toEqual(expectCode('CONNECTION_CLOSED'));
    expect(h.client.state).toBe('closed');
    expect(h.callbacks.onClose).not.toHaveBeenCalled();
  });

  it('rejects CONNECTION_CLOSED with the cause when the factory throws', async () => {
    const cause = new Error('no transport');
    const client = new WorkerClient({
      createSocket: () => {
        throw cause;
      },
    });
    const error = await client.connect().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorkerClientError);
    expect((error as WorkerClientError).code).toBe('CONNECTION_CLOSED');
    expect((error as WorkerClientError).cause).toBe(cause);
  });

  it('rejects CALL_TIMEOUT and closes the socket when it never opens', async () => {
    const h = harness();
    const opening = h.client.connect();
    const assertion = expect(opening).rejects.toEqual(
      expectCode('CALL_TIMEOUT'),
    );
    jest.advanceTimersByTime(WORKER_LIMITS.callTimeoutMs);
    await assertion;
    expect(h.socket().closeCalls).toHaveLength(1);
    // A late open on the abandoned socket changes nothing.
    h.socket().open();
    expect(h.client.state).toBe('closed');
  });

  it('opens a new socket on reconnect and ignores the old one', async () => {
    const h = await connected();
    const first = h.socket();
    first.peerClose(1001, 'going-away');
    const reopening = h.client.connect();
    const second = h.socket();
    expect(second).not.toBe(first);
    second.open();
    await reopening;

    const call = h.client.call('hello', HELLO_PARAMS);
    const id = second.lastRequest().id;
    first.receiveFrame(result(id, { wrong: true }));
    second.receiveFrame(result(id, HELLO_RESULT));
    await expect(call).resolves.toEqual(HELLO_RESULT);
    expect(h.callbacks.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('WorkerClient request/response correlation', () => {
  it('sends a v1 req frame with the validated params', async () => {
    const h = await connected();
    void h.client.call('hello', HELLO_PARAMS);
    const frame = h.socket().lastRequest();
    expect(frame).toEqual({
      v: 1,
      kind: 'req',
      id: expect.any(String),
      method: 'hello',
      params: HELLO_PARAMS,
    });
    expect(frame.id.length).toBeLessThanOrEqual(
      WORKER_LIMITS.maxRequestIdLength,
    );
  });

  it('settles each call with its own answer when answers arrive out of order', async () => {
    const h = await connected();
    const hello = h.client.call('hello', HELLO_PARAMS);
    const stop = h.client.call('session.stop', { sessionId: 's-1' });
    const [helloReq, stopReq] = h.socket().requests();
    expect(helloReq.id).not.toBe(stopReq.id);

    h.socket().receiveFrame(result(stopReq.id, { stopped: true }));
    h.socket().receiveFrame(result(helloReq.id, HELLO_RESULT));

    await expect(stop).resolves.toEqual({ stopped: true });
    await expect(hello).resolves.toEqual(HELLO_RESULT);
    expect(h.client.inFlight).toBe(0);
  });

  it('rejects with the worker code, local fixed copy, ref and allow-listed detail', async () => {
    const h = await connected();
    const call = h.client.call('session.continue', {
      sessionId: 's-1',
      prompt: 'hi',
    });
    h.socket().receiveFrame({
      v: 1,
      kind: 'res',
      id: h.socket().lastRequest().id,
      ok: false,
      error: {
        code: 'SESSION_DRIVEN_ELSEWHERE',
        message: 'raw text from /home/user/secret',
        ref: 'r-42',
        detail: { holder: { label: 'Desktop', pid: 77 }, hostname: 'box' },
      },
    });
    const error = (await call.catch((e: unknown) => e)) as WorkerClientError;
    expect(error).toBeInstanceOf(WorkerClientError);
    expect(error.code).toBe('SESSION_DRIVEN_ELSEWHERE');
    expect(error.message).toBe(WORKER_ERROR_MESSAGES.SESSION_DRIVEN_ELSEWHERE);
    expect(error.ref).toBe('r-42');
    expect(error.detail).toEqual({ holder: { label: 'Desktop' } });
  });

  it('drops ref and detail on PAIRING_REJECTED', async () => {
    const h = await connected();
    const call = h.client.call('pair.exchange', {
      code: 'ABCD-EFGH',
      clientName: 'laptop',
    });
    h.socket().receiveFrame({
      v: 1,
      kind: 'res',
      id: h.socket().lastRequest().id,
      ok: false,
      error: {
        code: 'PAIRING_REJECTED',
        message: 'x',
        ref: 'r-1',
        detail: { sessionId: 's' },
      },
    });
    const error = (await call.catch((e: unknown) => e)) as WorkerClientError;
    expect(error.code).toBe('PAIRING_REJECTED');
    expect(error.ref).toBeUndefined();
    expect(error.detail).toBeUndefined();
  });

  it('rejects INTERNAL when the result does not match the method table', async () => {
    const h = await connected();
    const call = h.client.call('session.stop', { sessionId: 's-1' });
    h.socket().receiveFrame(
      result(h.socket().lastRequest().id, { stopped: 'yes' }),
    );
    await expect(call).rejects.toEqual(expectCode('INTERNAL'));
    expect(h.client.state).toBe('open');
  });

  it('rejects INVALID_PARAMS locally and sends nothing', async () => {
    const h = await connected();
    const call = h.client.call('session.stop', {
      sessionId: 's-1',
      extra: true,
    } as unknown as { sessionId: string });
    await expect(call).rejects.toEqual(expectCode('INVALID_PARAMS'));
    expect(h.socket().sent).toHaveLength(0);
  });

  it('rejects NOT_CONNECTED before connect and after close', async () => {
    const h = harness();
    await expect(h.client.call('hello', HELLO_PARAMS)).rejects.toEqual(
      expectCode('NOT_CONNECTED'),
    );
    const opened = await connected();
    opened.client.close();
    await expect(opened.client.call('hello', HELLO_PARAMS)).rejects.toEqual(
      expectCode('NOT_CONNECTED'),
    );
  });

  it('treats a send that throws as connection loss', async () => {
    const h = await connected();
    const first = h.client.call('hello', HELLO_PARAMS);
    const second = h.client.call('machine.info', {});
    const firstFails = expect(first).rejects.toEqual(
      expectCode('CONNECTION_CLOSED'),
    );
    const secondFails = expect(second).rejects.toEqual(
      expectCode('CONNECTION_CLOSED'),
    );
    const cause = new Error('socket closing');
    h.socket().send = () => {
      throw cause;
    };

    const error = (await h.client
      .call('hello', HELLO_PARAMS)
      .catch((e: unknown) => e)) as WorkerClientError;
    expect(error.code).toBe('CONNECTION_CLOSED');
    expect(error.cause).toBe(cause);
    // The other waiting calls fail at once, not after their 30 s timers.
    await firstFails;
    await secondFails;
    expect(h.client.inFlight).toBe(0);
    expect(h.client.state).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
    expect(h.socket().closeCalls).toHaveLength(1);
    expect(h.callbacks.onClose).toHaveBeenCalledTimes(1);
    expect(h.callbacks.onClose).toHaveBeenCalledWith({
      code: 1006,
      reason: 'socket-error',
      local: true,
    });
    await expect(h.client.call('hello', HELLO_PARAMS)).rejects.toEqual(
      expectCode('NOT_CONNECTED'),
    );
    // A close event the socket emits later is not reported again.
    h.socket().peerClose(1006, '');
    expect(h.callbacks.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('WorkerClient per-call timeout', () => {
  it('rejects CALL_TIMEOUT after 30 s and ignores the late answer', async () => {
    const h = await connected();
    const call = h.client.call('hello', HELLO_PARAMS);
    const id = h.socket().lastRequest().id;
    const assertion = expect(call).rejects.toEqual(expectCode('CALL_TIMEOUT'));

    jest.advanceTimersByTime(WORKER_LIMITS.callTimeoutMs - 1);
    expect(h.client.inFlight).toBe(1);
    jest.advanceTimersByTime(1);
    await assertion;
    expect(h.client.inFlight).toBe(0);

    h.socket().receiveFrame(result(id, HELLO_RESULT));
    expect(h.client.state).toBe('open');
    expect(h.socket().closeCalls).toHaveLength(0);
  });

  it('clears the timer of a call that was answered', async () => {
    const h = await connected();
    const call = h.client.call('hello', HELLO_PARAMS);
    h.socket().receiveFrame(result(h.socket().lastRequest().id, HELLO_RESULT));
    await call;
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('WorkerClient in-flight cap', () => {
  it('refuses the 65th waiting call and accepts again once one settles', async () => {
    const h = await connected();
    const calls = Array.from(
      { length: WORKER_LIMITS.maxInFlightRequests },
      () => h.client.call('session.stop', { sessionId: 's-1' }),
    );
    expect(h.client.inFlight).toBe(64);

    await expect(
      h.client.call('session.stop', { sessionId: 's-1' }),
    ).rejects.toEqual(expectCode('TOO_MANY_IN_FLIGHT'));
    expect(h.socket().sent).toHaveLength(64);

    h.socket().receiveFrame(
      result(h.socket().requests()[0].id, { stopped: true }),
    );
    await calls[0];
    void h.client.call('session.stop', { sessionId: 's-1' });
    expect(h.socket().sent).toHaveLength(65);
    expect(h.client.inFlight).toBe(64);
  });
});

describe('WorkerClient close and error paths', () => {
  it('fails pending calls and reports a peer close once', async () => {
    const h = await connected();
    const call = h.client.call('hello', HELLO_PARAMS);
    h.socket().peerClose(4409, 'version-mismatch');
    h.socket().peerClose(4409, 'version-mismatch');

    await expect(call).rejects.toEqual(expectCode('CONNECTION_CLOSED'));
    expect(h.callbacks.onClose).toHaveBeenCalledTimes(1);
    expect(h.callbacks.onClose).toHaveBeenCalledWith({
      code: 4409,
      reason: 'version-mismatch',
      local: false,
    });
    expect(h.client.state).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('closes locally with 1000 and fails pending calls', async () => {
    const h = await connected();
    const call = h.client.call('hello', HELLO_PARAMS);
    h.client.close();

    await expect(call).rejects.toEqual(expectCode('CONNECTION_CLOSED'));
    expect(h.socket().closeCalls).toEqual([
      { code: 1000, reason: 'client-close' },
    ]);
    expect(h.callbacks.onClose).toHaveBeenCalledWith({
      code: 1000,
      reason: 'client-close',
      local: true,
    });
    // The socket's own close event that follows is not reported again.
    h.socket().peerClose(1000, 'client-close');
    expect(h.callbacks.onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    [4409, 'version-mismatch'],
    [4410, 'revoked'],
    [1000, 'normal-closure'],
    [1001, 'going-away'],
    [1011, 'internal-error'],
    [3999, 'connection-closed'],
  ])(
    'reports close %d with the fixed reason %s, never the peer text',
    async (code, reason) => {
      const h = await connected();
      h.socket().peerClose(code, '/home/user/.ssh/id_ed25519 token=abc');
      expect(h.callbacks.onClose).toHaveBeenCalledWith({
        code,
        reason,
        local: false,
      });
    },
  );

  it('treats a socket error as the end of the connection', async () => {
    const h = await connected();
    const call = h.client.call('hello', HELLO_PARAMS);
    h.socket().fail();

    await expect(call).rejects.toEqual(expectCode('CONNECTION_CLOSED'));
    expect(h.socket().closeCalls).toHaveLength(1);
    expect(h.callbacks.onClose).toHaveBeenCalledWith({
      code: 1006,
      reason: 'socket-error',
      local: true,
    });
  });
});

describe('WorkerClient transport close that throws', () => {
  function throwingClose(socket: FakeSocket): void {
    socket.close = (code?: number, reason?: string) => {
      socket.closeCalls.push({ code, reason });
      throw new Error('close failed');
    };
  }

  it('still fails pending calls and reports once on a socket error', async () => {
    const h = await connected();
    throwingClose(h.socket());
    const call = h.client.call('hello', HELLO_PARAMS);
    expect(() => h.socket().fail()).not.toThrow();

    await expect(call).rejects.toEqual(expectCode('CONNECTION_CLOSED'));
    expect(h.socket().closeCalls).toHaveLength(1);
    expect(h.callbacks.onClose).toHaveBeenCalledTimes(1);
    expect(h.client.state).toBe('closed');
  });

  it('still rejects connect with CALL_TIMEOUT when the socket never opens', async () => {
    const h = harness();
    const opening = h.client.connect();
    throwingClose(h.socket());
    const assertion = expect(opening).rejects.toEqual(
      expectCode('CALL_TIMEOUT'),
    );
    expect(() =>
      jest.advanceTimersByTime(WORKER_LIMITS.callTimeoutMs),
    ).not.toThrow();
    await assertion;
    expect(h.socket().closeCalls).toHaveLength(1);
    expect(h.client.state).toBe('closed');
  });

  it('still closes locally and on a protocol error', async () => {
    const local = await connected();
    throwingClose(local.socket());
    expect(() => local.client.close()).not.toThrow();
    expect(local.callbacks.onClose).toHaveBeenCalledTimes(1);

    const broken = await connected();
    throwingClose(broken.socket());
    expect(() => broken.socket().receive('{nope')).not.toThrow();
    expect(broken.callbacks.onClose).toHaveBeenCalledWith({
      code: 4400,
      reason: 'protocol-error',
      local: true,
    });
  });
});

describe('WorkerClient malformed inbound frames', () => {
  const malformed: Array<[string, unknown]> = [
    ['not JSON', '{not json'],
    ['a binary message', new Uint8Array([1, 2, 3])],
    ['a JSON value of the wrong shape', JSON.stringify({ v: 1, kind: 'nope' })],
    ['a wrong envelope version', JSON.stringify({ ...result('1', {}), v: 2 })],
    [
      'an evt of a type outside SESSION_EVENT_TYPES',
      JSON.stringify({
        v: 1,
        kind: 'evt',
        sessionId: 's-1',
        epoch: 'e-1',
        seq: 1,
        type: 'chat:unknown',
        ts: 1,
        payload: {},
      }),
    ],
    [
      'a ctl frame with an invalid payload',
      JSON.stringify({ v: 1, kind: 'ctl', type: 'goodbye', payload: {} }),
    ],
    ['an oversized message', 'x'.repeat(WORKER_LIMITS.maxPayloadBytes + 1)],
    [
      'a message over 1 MiB in UTF-8 bytes but not in UTF-16 units',
      JSON.stringify({
        v: 1,
        kind: 'evt',
        sessionId: 's-1',
        epoch: 'e-1',
        seq: 1,
        type: 'chat:chunk',
        ts: 1,
        payload: { text: 'é'.repeat(WORKER_LIMITS.maxPayloadBytes / 2) },
      }),
    ],
  ];

  it.each(malformed)(
    'closes 4400 protocol-error on %s',
    async (_label, data) => {
      const h = await connected();
      const call = h.client.call('hello', HELLO_PARAMS);
      h.socket().receive(data);

      await expect(call).rejects.toEqual(expectCode('CONNECTION_CLOSED'));
      expect(h.socket().closeCalls).toEqual([
        { code: 4400, reason: 'protocol-error' },
      ]);
      expect(h.callbacks.onClose).toHaveBeenCalledWith({
        code: 4400,
        reason: 'protocol-error',
        local: true,
      });
      expect(h.callbacks.onEvent).not.toHaveBeenCalled();
    },
  );
});

describe('WorkerClient callbacks', () => {
  it('hands evt frames to onEvent and ctl frames to onControl', async () => {
    const h = await connected();
    const evt = {
      v: 1,
      kind: 'evt',
      sessionId: 's-1',
      epoch: 'e-1',
      seq: 3,
      type: 'chat:chunk',
      ts: 10,
      payload: { text: 'hi' },
    };
    const ctl = {
      v: 1,
      kind: 'ctl',
      type: 'resync-required',
      payload: { sessionId: 's-1' },
    };
    h.socket().receiveFrame(evt);
    h.socket().receiveFrame(ctl);
    expect(h.callbacks.onEvent).toHaveBeenCalledWith(evt);
    expect(h.callbacks.onControl).toHaveBeenCalledWith(ctl);
  });
});

describe('WorkerClient liveness', () => {
  it('pings every 20 s while pongs come back', async () => {
    const h = await connected({ withPing: true });
    jest.advanceTimersByTime(WORKER_LIMITS.pingIntervalMs - 1);
    expect(h.socket().pings).toBe(0);
    jest.advanceTimersByTime(1);
    expect(h.socket().pings).toBe(1);

    h.socket().pong();
    jest.advanceTimersByTime(WORKER_LIMITS.pingIntervalMs);
    expect(h.socket().pings).toBe(2);
    h.socket().pong();
    expect(h.client.state).toBe('open');
    expect(jest.getTimerCount()).toBe(1);
  });

  it('drops the connection when no pong arrives within 10 s', async () => {
    const h = await connected({ withPing: true });
    jest.advanceTimersByTime(WORKER_LIMITS.pingIntervalMs);
    expect(h.socket().pings).toBe(1);
    // A call made after the ping is still waiting when the pong deadline hits.
    const call = h.client.call('hello', HELLO_PARAMS);
    const assertion = expect(call).rejects.toEqual(
      expectCode('CONNECTION_CLOSED'),
    );
    jest.advanceTimersByTime(WORKER_LIMITS.pongTimeoutMs);

    await assertion;
    expect(h.client.state).toBe('closed');
    expect(h.socket().closeCalls).toHaveLength(1);
    expect(h.callbacks.onClose).toHaveBeenCalledWith(PONG_TIMEOUT_CLOSE);
  });

  it('treats a ping that throws as connection loss inside the timer', async () => {
    const h = await connected({ withPing: true });
    h.socket().ping = () => {
      throw new Error('transport gone');
    };
    const call = h.client.call('hello', HELLO_PARAMS);
    const assertion = expect(call).rejects.toEqual(
      expectCode('CONNECTION_CLOSED'),
    );

    expect(() =>
      jest.advanceTimersByTime(WORKER_LIMITS.pingIntervalMs),
    ).not.toThrow();
    await assertion;
    expect(h.client.state).toBe('closed');
    expect(jest.getTimerCount()).toBe(0);
    expect(h.socket().closeCalls).toHaveLength(1);
    expect(h.callbacks.onClose).toHaveBeenCalledTimes(1);
    expect(h.callbacks.onClose).toHaveBeenCalledWith({
      code: 1006,
      reason: 'socket-error',
      local: true,
    });
  });

  it('drops the connection on a pong timeout when close throws', async () => {
    const h = await connected({ withPing: true });
    h.socket().close = () => {
      throw new Error('close failed');
    };
    jest.advanceTimersByTime(WORKER_LIMITS.pingIntervalMs);
    expect(() =>
      jest.advanceTimersByTime(WORKER_LIMITS.pongTimeoutMs),
    ).not.toThrow();
    expect(h.client.state).toBe('closed');
    expect(h.callbacks.onClose).toHaveBeenCalledWith(PONG_TIMEOUT_CLOSE);
  });

  it('ignores an unsolicited pong', async () => {
    const h = await connected({ withPing: true });
    h.socket().pong();
    jest.advanceTimersByTime(WORKER_LIMITS.pingIntervalMs);
    expect(h.socket().pings).toBe(1);
  });

  it('runs no liveness timer on a socket without ping', async () => {
    const h = await connected({ withPing: false });
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(WORKER_LIMITS.pingIntervalMs * 3);
    expect(h.client.state).toBe('open');
  });
});
