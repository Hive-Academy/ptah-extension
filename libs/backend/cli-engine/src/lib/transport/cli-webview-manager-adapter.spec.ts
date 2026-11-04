/**
 * CliWebviewManagerAdapter — batch de-multiplexing (TASK_2026_323 B7).
 *
 * Why this file exists: this transport uses the message `type` as the
 * EventEmitter event NAME, so every subscriber is bound to a concrete name.
 * Once `ChatStreamBroadcaster` began coalescing chunks into
 * `MESSAGE_TYPES.BATCH`, a transport that forwarded the batch verbatim would
 * deliver it to NOBODY — `chat-bridge`, `session-submit.service`,
 * `anthropic-proxy.service` and the TUI's `use-chat` all listen for
 * `'chat:chunk'` by name. The failure mode is silence, which is exactly the
 * kind of regression a test has to hold down.
 */

import {
  MESSAGE_TYPES,
  type SurfaceUpdatedPayload,
} from '@ptah-extension/shared';
import {
  createDashboardBroadcast,
  type DashboardSurfaceHost,
} from '@ptah-extension/vscode-lm-tools';

import {
  CliWebviewManagerAdapter,
  type CliWebviewManagerAdapterOptions,
} from './cli-webview-manager-adapter';

describe('CliWebviewManagerAdapter attention ingress', () => {
  it('observes a send before delivery even with zero views', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const order: string[] = [];
    const payload = { id: 'request-1' };
    const observe = jest.fn(() => order.push('observe'));
    adapter.setAttentionObserver({ observe });
    adapter.on(MESSAGE_TYPES.PERMISSION_REQUEST, () => order.push('deliver'));

    expect(adapter.getActiveWebviews()).toEqual([]);
    await adapter.sendMessage(
      'missing-view',
      MESSAGE_TYPES.PERMISSION_REQUEST,
      payload,
    );

    expect(observe).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledWith(
      MESSAGE_TYPES.PERMISSION_REQUEST,
      payload,
    );
    expect(order).toEqual(['observe', 'deliver']);
  });

  it('observes a broadcast once before every listener receives it', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const order: string[] = [];
    const observe = jest.fn(() => order.push('observe'));
    adapter.setAttentionObserver({ observe });
    adapter.on(MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST, () =>
      order.push('first'),
    );
    adapter.on(MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST, () =>
      order.push('second'),
    );

    await adapter.broadcastMessage(MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST, {});

    expect(observe).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['observe', 'first', 'second']);
  });

  it('detaches only the matching observer registration', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const first = jest.fn();
    const second = jest.fn();
    const oldRegistration = adapter.setAttentionObserver({ observe: first });
    const currentRegistration = adapter.setAttentionObserver({
      observe: second,
    });
    oldRegistration.dispose();
    await adapter.broadcastMessage(MESSAGE_TYPES.PERMISSION_REQUEST, {});
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    currentRegistration.dispose();
    await adapter.broadcastMessage(MESSAGE_TYPES.PERMISSION_REQUEST, {});
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('logs only the error name and still delivers when observation fails', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const error = jest.fn();
    const deliver = jest.fn();
    adapter.setAttentionObserver(
      {
        observe: () => {
          throw new TypeError('private request text');
        },
      },
      { error },
    );
    adapter.on(MESSAGE_TYPES.PERMISSION_REQUEST, deliver);

    await adapter.sendMessage('view', MESSAGE_TYPES.PERMISSION_REQUEST, {});

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      '[CliWebviewManagerAdapter] Attention observer failed: TypeError',
    );
  });
});

describe('CliWebviewManagerAdapter — batch unwrapping', () => {
  it('emits each inner message of a batch under its own type', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    const batches: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));
    adapter.on(MESSAGE_TYPES.BATCH, (payload) => batches.push(payload));

    await adapter.broadcastMessage(MESSAGE_TYPES.BATCH, {
      events: [
        { type: 'chat:chunk', payload: { i: 0 } },
        { type: 'chat:chunk', payload: { i: 1 } },
      ],
    });

    expect(chunks).toEqual([{ i: 0 }, { i: 1 }]);
    // The wrapper itself is consumed here, never forwarded.
    expect(batches).toHaveLength(0);
  });

  it('preserves order across a batch', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const seen: number[] = [];
    adapter.on('chat:chunk', (payload: { i: number }) => seen.push(payload.i));

    await adapter.broadcastMessage(MESSAGE_TYPES.BATCH, {
      events: Array.from({ length: 20 }, (_, i) => ({
        type: 'chat:chunk',
        payload: { i },
      })),
    });

    expect(seen).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('fans a heterogeneous batch out to the right listeners', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    const completes: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));
    adapter.on('chat:complete', (payload) => completes.push(payload));

    await adapter.broadcastMessage(MESSAGE_TYPES.BATCH, {
      events: [
        { type: 'chat:chunk', payload: { i: 0 } },
        { type: 'chat:complete', payload: { code: 0 } },
      ],
    });

    expect(chunks).toEqual([{ i: 0 }]);
    expect(completes).toEqual([{ code: 0 }]);
  });

  it('unwraps a batch sent through sendMessage too', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));

    await adapter.sendMessage('any-view', MESSAGE_TYPES.BATCH, {
      events: [{ type: 'chat:chunk', payload: { i: 7 } }],
    });

    expect(chunks).toEqual([{ i: 7 }]);
  });

  it('passes an ordinary message straight through, unchanged', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));

    await adapter.broadcastMessage('chat:chunk', { i: 0 });

    expect(chunks).toEqual([{ i: 0 }]);
  });

  it('ignores a malformed batch instead of throwing at the transport', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const chunks: unknown[] = [];
    adapter.on('chat:chunk', (payload) => chunks.push(payload));

    await expect(
      adapter.broadcastMessage(MESSAGE_TYPES.BATCH, undefined),
    ).resolves.toBeUndefined();
    await expect(
      adapter.broadcastMessage(MESSAGE_TYPES.BATCH, { events: 'nope' }),
    ).resolves.toBeUndefined();
    await expect(
      adapter.broadcastMessage(MESSAGE_TYPES.BATCH, { events: [null, 7] }),
    ).resolves.toBeUndefined();

    expect(chunks).toHaveLength(0);
  });
});

/**
 * TASK_2026_858 C5: the remote worker captures push events through a
 * synchronous tap that sees each de-batched event before local listeners do.
 */
describe('CliWebviewManagerAdapter — push tap (TASK_2026_858 C5)', () => {
  const logger = { error: jest.fn() };

  it('taps a plain event before emitting it', async () => {
    const order: string[] = [];
    const adapter = new CliWebviewManagerAdapter({
      tap: (type, payload) =>
        order.push(`tap:${type}:${JSON.stringify(payload)}`),
      logger,
    });
    adapter.on('session:stats', (payload) =>
      order.push(`emit:session:stats:${JSON.stringify(payload)}`),
    );

    await adapter.sendMessage('view', 'session:stats', { n: 1 });

    expect(order).toEqual([
      'tap:session:stats:{"n":1}',
      'emit:session:stats:{"n":1}',
    ]);
  });

  it('taps each batch member in order, each immediately before its own emit', async () => {
    const order: string[] = [];
    const adapter = new CliWebviewManagerAdapter({
      tap: (type, payload) =>
        order.push(`tap:${type}:${(payload as { i: number }).i}`),
      logger,
    });
    adapter.on('chat:chunk', (payload: { i: number }) =>
      order.push(`emit:chat:chunk:${payload.i}`),
    );
    adapter.on('chat:complete', (payload: { i: number }) =>
      order.push(`emit:chat:complete:${payload.i}`),
    );

    await adapter.broadcastMessage(MESSAGE_TYPES.BATCH, {
      events: [
        { type: 'chat:chunk', payload: { i: 0 } },
        null,
        { type: 'chat:chunk', payload: { i: 1 } },
        { type: 'chat:complete', payload: { i: 2 } },
      ],
    });

    expect(order).toEqual([
      'tap:chat:chunk:0',
      'emit:chat:chunk:0',
      'tap:chat:chunk:1',
      'emit:chat:chunk:1',
      'tap:chat:complete:2',
      'emit:chat:complete:2',
    ]);
  });

  it('never taps the batch wrapper itself', async () => {
    const tap = jest.fn();
    const adapter = new CliWebviewManagerAdapter({ tap, logger });

    await adapter.broadcastMessage(MESSAGE_TYPES.BATCH, {
      events: [{ type: 'chat:chunk', payload: {} }],
    });

    expect(tap).toHaveBeenCalledTimes(1);
    expect(tap).toHaveBeenCalledWith('chat:chunk', {});
  });

  it('runs synchronously inside the send call', () => {
    const tap = jest.fn();
    const adapter = new CliWebviewManagerAdapter({ tap, logger });

    void adapter.sendMessage('view', 'session:stats', {});

    expect(tap).toHaveBeenCalledTimes(1);
  });

  it('refuses a tap without a logger at compile time', () => {
    const tap = jest.fn();
    // @ts-expect-error A throwing tap must have a logger to report to.
    const options: CliWebviewManagerAdapterOptions = { tap };
    expect(options.tap).toBe(tap);
  });

  it('isolates a throwing tap: emit and later events still run, only the name is logged', async () => {
    const error = jest.fn();
    const tapped: number[] = [];
    const adapter = new CliWebviewManagerAdapter({
      tap: (_type, payload) => {
        const i = (payload as { i: number }).i;
        tapped.push(i);
        if (i === 0) throw new RangeError('secret payload text');
      },
      logger: { error },
    });
    const emitted: number[] = [];
    adapter.on('chat:chunk', (payload: { i: number }) =>
      emitted.push(payload.i),
    );

    await adapter.broadcastMessage(MESSAGE_TYPES.BATCH, {
      events: [
        { type: 'chat:chunk', payload: { i: 0 } },
        { type: 'chat:chunk', payload: { i: 1 } },
      ],
    });

    expect(tapped).toEqual([0, 1]);
    expect(emitted).toEqual([0, 1]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      '[CliWebviewManagerAdapter] Push tap failed: RangeError',
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret');
  });

  it('logs a non-Error throw as UnknownError and still emits', async () => {
    const error = jest.fn();
    const deliver = jest.fn();
    const adapter = new CliWebviewManagerAdapter({
      tap: () => {
        throw 'raw string';
      },
      logger: { error },
    });
    adapter.on('session:stats', deliver);
    await adapter.sendMessage('view', 'session:stats', {});
    expect(error).toHaveBeenCalledWith(
      '[CliWebviewManagerAdapter] Push tap failed: UnknownError',
    );
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});

describe('CliWebviewManagerAdapter — surface enumeration (TASK_2026_538 Batch 2)', () => {
  it('reports no surfaces: the CLI and TUI render none', () => {
    const adapter = new CliWebviewManagerAdapter();

    expect(adapter.getActiveWebviews()).toEqual([]);
  });

  it('never throws when asked for surfaces', () => {
    const adapter = new CliWebviewManagerAdapter();

    expect(() => adapter.getActiveWebviews()).not.toThrow();
  });
});

/**
 * TASK_2026_538 Batch 14, Task 14.2 (Req 11.2, 11.4). The CLI and TUI render
 * no surfaces at all (see `getActiveWebviews` above), so the honest answer
 * through the real `createDashboardBroadcast` is a successful `no-surface` —
 * never a throw and never `failed`. Reachable from cli-engine only since the
 * vscode-lm-tools barrel export (Task 8.4).
 */
describe('CliWebviewManagerAdapter — through createDashboardBroadcast (TASK_2026_538 Batch 14, Req 11.2)', () => {
  const PAYLOAD: SurfaceUpdatedPayload = {
    routingId: 'tab-1',
    surfaceId: 'profile',
    revision: 1,
    origin: 'agent',
    change: { kind: 'deleted', reason: 'agent-deleted' },
  };

  it('reports no-surface and never throws', async () => {
    const adapter = new CliWebviewManagerAdapter();
    const broadcast = createDashboardBroadcast(() => adapter, {
      debug: jest.fn(),
    });

    await expect(
      broadcast(MESSAGE_TYPES.SURFACE_UPDATED, PAYLOAD),
    ).resolves.toEqual({ status: 'no-surface' });
  });

  it('type-checks as a DashboardSurfaceHost (Req 11.4)', () => {
    const adapter = new CliWebviewManagerAdapter();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time only
    const asHost: DashboardSurfaceHost = adapter;
    expect(asHost).toBe(adapter);
  });
});
