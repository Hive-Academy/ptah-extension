/**
 * StreamBatchBuffer — coalescing contract (TASK_2026_323 B7).
 *
 * What is pinned here:
 *   - A burst inside one tick costs ceil(N / maxEvents) sends, not N.
 *   - Order survives coalescing, including across a size-triggered flush.
 *   - A batch of one goes out BARE, matching the pre-batching wire format.
 *   - The window timer is unref'd — it must not hold `ptah-cli` open.
 *   - A failing sink is reported, never thrown, and never stalls the buffer.
 */

import 'reflect-metadata';

import {
  MESSAGE_TYPES,
  type BatchMessagePayload,
} from '@ptah-extension/shared';

import {
  STREAM_BATCH_MAX_IN_FLIGHT,
  StreamBatchBuffer,
} from './stream-batch-buffer';

interface Sent {
  readonly type: string;
  readonly payload: unknown;
}

class ControlledSink {
  readonly calls: Sent[] = [];
  readonly resolutionOrder: number[] = [];
  private readonly pending: Array<{
    readonly resolve: () => void;
    settled: boolean;
  }> = [];
  private released = false;

  readonly sink = (type: string, payload: unknown): Promise<void> => {
    this.calls.push({ type, payload });
    if (this.released) return Promise.resolve();

    return new Promise<void>((resolve) => {
      this.pending.push({ resolve, settled: false });
    });
  };

  release(index: number): void {
    const send = this.pending[index];
    if (send === undefined || send.settled) return;
    send.settled = true;
    this.resolutionOrder.push(index);
    send.resolve();
  }

  releaseAll(): void {
    this.released = true;
    for (let index = 0; index < this.pending.length; index++) {
      this.release(index);
    }
  }
}

function makeBuffer(overrides?: { maxEvents?: number; intervalMs?: number }) {
  const sent: Sent[] = [];
  const errors: unknown[] = [];
  const buffer = new StreamBatchBuffer({
    sink: (type, payload) => {
      sent.push({ type, payload });
      return Promise.resolve();
    },
    onError: (error) => errors.push(error),
    ...(overrides?.maxEvents !== undefined
      ? { maxEvents: overrides.maxEvents }
      : {}),
    ...(overrides?.intervalMs !== undefined
      ? { intervalMs: overrides.intervalMs }
      : {}),
  });
  return { buffer, sent, errors };
}

/** Flatten what the transport received back into the original message order. */
function delivered(sent: readonly Sent[]): Sent[] {
  const out: Sent[] = [];
  for (const message of sent) {
    if (message.type !== MESSAGE_TYPES.BATCH) {
      out.push(message);
      continue;
    }
    for (const inner of (message.payload as BatchMessagePayload).events) {
      out.push({ type: inner.type, payload: inner.payload });
    }
  }
  return out;
}

describe('StreamBatchBuffer — coalescing', () => {
  it('turns 200 messages pushed in one tick into ceil(200/64) sends', async () => {
    const { buffer, sent } = makeBuffer();

    for (let i = 0; i < 200; i++) {
      buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i } });
    }
    await buffer.flush();

    // 64 + 64 + 64 by the size cap, then 8 on the explicit flush.
    expect(sent).toHaveLength(Math.ceil(200 / 64));
    expect(delivered(sent)).toHaveLength(200);
  });

  it('preserves order across size-triggered and explicit flushes', async () => {
    const { buffer, sent } = makeBuffer({ maxEvents: 4 });

    for (let i = 0; i < 10; i++) {
      buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i } });
    }
    await buffer.flush();

    const order = delivered(sent).map((m) => (m.payload as { i: number }).i);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('sends a lone message BARE rather than wrapping it in a batch', async () => {
    const { buffer, sent } = makeBuffer();

    buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { only: true } });
    await buffer.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe(MESSAGE_TYPES.CHAT_CHUNK);
    expect(sent[0].payload).toEqual({ only: true });
  });

  it('wraps two or more messages in a BATCH envelope', async () => {
    const { buffer, sent } = makeBuffer();

    buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i: 0 } });
    buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i: 1 } });
    await buffer.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe(MESSAGE_TYPES.BATCH);
    expect((sent[0].payload as BatchMessagePayload).events).toHaveLength(2);
  });

  it('flushing an empty buffer sends nothing', async () => {
    const { buffer, sent } = makeBuffer();
    await buffer.flush();
    expect(sent).toHaveLength(0);
  });
});

describe('StreamBatchBuffer — the window timer', () => {
  it('flushes on the interval without an explicit flush', async () => {
    jest.useFakeTimers();
    try {
      const { buffer, sent } = makeBuffer({ intervalMs: 16 });
      buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i: 0 } });
      buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i: 1 } });

      expect(sent).toHaveLength(0);
      jest.advanceTimersByTime(16);

      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe(MESSAGE_TYPES.BATCH);
    } finally {
      jest.useRealTimers();
    }
  });

  it('unrefs the window timer so it cannot hold the process open', () => {
    // Asserted against a spy rather than a real handle because the fact under
    // test is that `unref` is CALLED — a real `Timeout` gives no way to observe
    // that after the fact, and `hasRef()` on a fake-timer handle is a property
    // of the fake, not of this code.
    const unref = jest.fn();
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(
        () => ({ unref }) as unknown as ReturnType<typeof setTimeout>,
      );
    try {
      const { buffer } = makeBuffer();
      buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: {} });

      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(unref).toHaveBeenCalledTimes(1);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('arms only one timer for a run of pushes', () => {
    jest.useFakeTimers();
    try {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const { buffer } = makeBuffer();
      for (let i = 0; i < 10; i++) {
        buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i } });
      }
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('dispose() clears the pending timer so no flush lands later', () => {
    jest.useFakeTimers();
    try {
      const { buffer, sent } = makeBuffer();
      buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: {} });
      buffer.dispose();
      jest.advanceTimersByTime(1000);
      expect(sent).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('StreamBatchBuffer — failure posture', () => {
  it('reports a sink failure through onError and still resolves', async () => {
    const errors: unknown[] = [];
    const buffer = new StreamBatchBuffer({
      sink: () => Promise.reject(new Error('transport gone')),
      onError: (error) => errors.push(error),
    });

    buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: {} });
    await expect(buffer.flush()).resolves.toBeUndefined();

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('transport gone');
  });

  it('settle() waits for a size-triggered flush nobody awaited', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let completed = false;
    const buffer = new StreamBatchBuffer({
      sink: () =>
        gate.then(() => {
          completed = true;
        }),
      onError: () => undefined,
      maxEvents: 2,
    });

    // Trips the size cap, so this flush is in flight and un-awaited.
    buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: {} });
    buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: {} });
    expect(completed).toBe(false);

    release?.();
    await buffer.settle();
    expect(completed).toBe(true);
  });
});

describe('StreamBatchBuffer — transport back-pressure', () => {
  it('caps unresolved transport sends at STREAM_BATCH_MAX_IN_FLIGHT', async () => {
    const controlled = new ControlledSink();
    const buffer = new StreamBatchBuffer({
      sink: controlled.sink,
      onError: () => undefined,
      maxEvents: 1,
    });

    for (let i = 0; i < STREAM_BATCH_MAX_IN_FLIGHT * 10; i++) {
      buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i } });
    }

    expect(buffer.inFlightCount).toBe(STREAM_BATCH_MAX_IN_FLIGHT);
    expect(controlled.calls).toHaveLength(STREAM_BATCH_MAX_IN_FLIGHT);

    controlled.releaseAll();
    await buffer.flush();
    await buffer.settle();
  });

  it('releases producer back-pressure when a transport send settles', async () => {
    const controlled = new ControlledSink();
    const buffer = new StreamBatchBuffer({
      sink: controlled.sink,
      onError: () => undefined,
      maxEvents: 1,
    });
    const total = STREAM_BATCH_MAX_IN_FLIGHT + 3;
    let produced = 0;

    const producer = (async () => {
      for (let i = 0; i < total; i++) {
        const backPressure = buffer.push({
          type: MESSAGE_TYPES.CHAT_CHUNK,
          payload: { i },
        });
        produced++;
        if (backPressure !== undefined) {
          await backPressure;
        }
      }
    })();

    expect(produced).toBe(STREAM_BATCH_MAX_IN_FLIGHT);
    controlled.releaseAll();
    await producer;
    await buffer.settle();
    expect(produced).toBe(total);
  });

  it('returns undefined below the cap without blocking the fast path', () => {
    const controlled = new ControlledSink();
    const buffer = new StreamBatchBuffer({
      sink: controlled.sink,
      onError: () => undefined,
    });

    const backPressure = buffer.push({
      type: MESSAGE_TYPES.CHAT_CHUNK,
      payload: {},
    });

    expect(backPressure).toBeUndefined();
    expect(buffer.pendingCount).toBe(1);
    expect(buffer.inFlightCount).toBe(0);
    buffer.dispose();
  });

  it('settle() waits for every send already handed to the transport', async () => {
    const controlled = new ControlledSink();
    const buffer = new StreamBatchBuffer({
      sink: controlled.sink,
      onError: () => undefined,
      maxEvents: 1,
    });
    for (let i = 0; i < STREAM_BATCH_MAX_IN_FLIGHT - 1; i++) {
      buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i } });
    }
    let settled = false;
    const settling = buffer.settle().then(() => {
      settled = true;
    });

    controlled.release(0);
    controlled.release(1);
    await Promise.resolve();
    expect(settled).toBe(false);

    controlled.releaseAll();
    await settling;
    expect(settled).toBe(true);
  });

  it('settle() also waits for a flush DEFERRED at the cap', async () => {
    // The teardown case. A batch deferred for capacity is not in `inFlight`,
    // so settling on that set alone returns while its events are still in
    // `pending` — and the caller ends the session on the next line. Deferral
    // happens exactly when the transport is slow, which is when this runs.
    const controlled = new ControlledSink();
    const buffer = new StreamBatchBuffer({
      sink: controlled.sink,
      onError: () => undefined,
      maxEvents: 1,
    });

    // Fill the window, then push one more so its flush has to defer.
    for (let i = 0; i < STREAM_BATCH_MAX_IN_FLIGHT + 1; i++) {
      void buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i } });
    }
    expect(buffer.inFlightCount).toBe(STREAM_BATCH_MAX_IN_FLIGHT);
    expect(buffer.pendingCount).toBeGreaterThan(0);

    buffer.dispose();
    let settled = false;
    const settling = buffer.settle().then(() => {
      settled = true;
    });

    // Release ONLY the in-flight window, one by one. `releaseAll` would also
    // unblock the deferred batch's own send, and then both answers look the
    // same — which is what makes this the discriminating step.
    for (let i = 0; i < STREAM_BATCH_MAX_IN_FLIGHT; i++) {
      controlled.release(i);
    }
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();

    // The deferred batch has now been handed to the sink but has NOT resolved.
    // Settling on `inFlight` alone would have returned here, with the caller
    // free to tear the session down under an undelivered batch.
    expect(controlled.calls).toHaveLength(STREAM_BATCH_MAX_IN_FLIGHT + 1);
    expect(settled).toBe(false);

    controlled.releaseAll();
    await settling;

    // Every event reached the sink — none was abandoned in `pending`.
    expect(settled).toBe(true);
    expect(buffer.pendingCount).toBe(0);
  });

  it('calls the sink in order when the first send settles after the second', async () => {
    const controlled = new ControlledSink();
    const buffer = new StreamBatchBuffer({
      sink: controlled.sink,
      onError: () => undefined,
      maxEvents: 1,
    });

    buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i: 0 } });
    buffer.push({ type: MESSAGE_TYPES.CHAT_CHUNK, payload: { i: 1 } });

    expect(controlled.calls.map(({ payload }) => payload)).toEqual([
      { i: 0 },
      { i: 1 },
    ]);
    controlled.release(1);
    controlled.release(0);
    await buffer.settle();
    expect(controlled.resolutionOrder).toEqual([1, 0]);
  });
});
