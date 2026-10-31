import 'reflect-metadata';

import type { SessionIdResolvedPayload } from './session-id-resolved-callback-registry';
import { NextTurnReminderQueue } from './next-turn-reminder.queue';

function setup() {
  const callbacks = new Set<(event: SessionIdResolvedPayload) => void>();
  const queue = new NextTurnReminderQueue({
    register(callback) {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
  });
  const resolve = (
    tabId: string | undefined,
    realSessionId: string,
    previousSessionId?: string,
  ) => {
    for (const callback of callbacks) {
      callback({
        tabId,
        realSessionId,
        previousSessionId,
        timestamp: Date.now(),
      });
    }
  };
  return { queue, resolve, callbacks };
}

describe('NextTurnReminderQueue', () => {
  it('replaces a pending reminder, caps text, and drains once', () => {
    const { queue } = setup();
    queue.put('tab', 'stale');
    queue.put('tab', 'x'.repeat(601));
    expect(queue.take('tab')).toBe('x'.repeat(600));
    expect(queue.take('tab')).toBeNull();
  });

  it('bounds pending entries at 200 and evicts the oldest', () => {
    const { queue } = setup();
    for (let i = 0; i < 201; i++) queue.put(`tab-${i}`, `text-${i}`);
    expect(queue.take('tab-0')).toBeNull();
    expect(queue.take('tab-200')).toBe('text-200');
  });

  it('moves a pre-resolution reminder and routes later tab puts to the SDK id', () => {
    const { queue, resolve } = setup();
    queue.put('tab', 'before');
    resolve('tab', 'sdk');
    expect(queue.take('sdk')).toBe('before');
    queue.put('tab', 'after');
    expect(queue.take('sdk')).toBe('after');
  });

  it('routes a put after resolution and keeps the newer entry on collision', () => {
    const { queue, resolve } = setup();
    resolve('tab', 'sdk');
    queue.put('tab', 'after');
    expect(queue.take('sdk')).toBe('after');

    queue.put('tab-2', 'older');
    queue.put('sdk-2', 'newer');
    resolve('tab-2', 'sdk-2');
    expect(queue.take('sdk-2')).toBe('newer');
  });

  it('rekeys a rotated session and flattens aliases', () => {
    const { queue, resolve } = setup();
    resolve('tab', 'old');
    queue.put('tab', 'pending');
    resolve('tab', 'new', 'old');
    expect(queue.take('new')).toBe('pending');
    queue.put('old', 'again');
    expect(queue.take('new')).toBe('again');
  });

  it('discard by tab clears a rekeyed reminder; missing keys are no-ops', () => {
    const { queue, resolve } = setup();
    queue.discard('absent');
    queue.put('tab', 'pending');
    resolve('tab', 'sdk');
    queue.discard('tab');
    expect(queue.take('sdk')).toBeNull();
    queue.put('tab', 'next');
    queue.discard('sdk');
    expect(queue.take('sdk')).toBeNull();
  });

  it('bounds aliases and releases its one registry subscription on dispose', () => {
    const { queue, resolve, callbacks } = setup();
    expect(callbacks.size).toBe(1);
    for (let i = 0; i < 201; i++) resolve(`tab-${i}`, `sdk-${i}`);
    queue.put('tab-0', 'evicted alias');
    expect(queue.take('sdk-0')).toBeNull();
    queue.put('tab-200', 'retained alias');
    expect(queue.take('sdk-200')).toBe('retained alias');
    queue.dispose();
    expect(callbacks.size).toBe(0);
  });

  it('discards only the entries of one owner, across tab and resolved keys', () => {
    const { queue, resolve } = setup();
    queue.put('tab-a', 'routing a', 'routing');
    resolve('tab-a', 'sdk-a');
    queue.put('tab-b', 'routing b', 'routing');
    queue.put('tab-c', 'other producer', 'other');
    queue.put('tab-d', 'untagged');
    queue.discardOwned('routing');
    expect(queue.take('sdk-a')).toBeNull();
    expect(queue.take('tab-b')).toBeNull();
    expect(queue.take('tab-c')).toBe('other producer');
    expect(queue.take('tab-d')).toBe('untagged');
  });
});
