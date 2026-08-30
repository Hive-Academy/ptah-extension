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

import { StreamBatchBuffer } from './stream-batch-buffer';

interface Sent {
  readonly type: string;
  readonly payload: unknown;
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
