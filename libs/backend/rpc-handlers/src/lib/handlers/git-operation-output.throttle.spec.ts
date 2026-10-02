/**
 * GitOperationOutputThrottle — unit specs (TASK_2026_576 Component 30).
 *
 * Fake timers drive the clock: pushes are counted per 100 ms window, sizes are
 * UTF-8 bytes, and `flush` must deliver everything still queued.
 */

import type { GitOperationOutputPayload } from '@ptah-extension/shared';

import {
  GitOperationOutputThrottle,
  OPERATION_OUTPUT_INTERVAL_MS,
  OPERATION_OUTPUT_MAX_PENDING_BYTES,
  OPERATION_OUTPUT_MAX_PUSH_BYTES,
} from './git-operation-output.throttle';

function build(): {
  throttle: GitOperationOutputThrottle;
  sent: GitOperationOutputPayload[];
  sentAt: number[];
} {
  const sent: GitOperationOutputPayload[] = [];
  const sentAt: number[] = [];
  const throttle = new GitOperationOutputThrottle('op-1', async (payload) => {
    sent.push(payload);
    sentAt.push(Date.now());
  });
  return { throttle, sent, sentAt };
}

const bytes = (text: string): number => Buffer.byteLength(text, 'utf8');
const joined = (sent: GitOperationOutputPayload[]): string =>
  sent.map((payload) => payload.chunk).join('');

describe('GitOperationOutputThrottle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends many small chunks at most once per 100 ms, in order, losing nothing', async () => {
    const { throttle, sent, sentAt } = build();
    let expected = '';

    // One chunk every 5 ms for 1 s: 200 chunks.
    for (let i = 0; i < 200; i++) {
      const chunk = `line ${i}\n`;
      expected += chunk;
      throttle.push('stdout', chunk);
      await jest.advanceTimersByTimeAsync(5);
    }
    const pushesWhileRunning = sent.length;
    await throttle.flush();

    // 1 s of output at one push per 100 ms is about ten pushes, never 200.
    expect(pushesWhileRunning).toBeGreaterThan(1);
    expect(pushesWhileRunning).toBeLessThanOrEqual(
      1000 / OPERATION_OUTPUT_INTERVAL_MS + 1,
    );
    for (let i = 1; i < pushesWhileRunning; i++) {
      expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(
        OPERATION_OUTPUT_INTERVAL_MS,
      );
    }
    expect(joined(sent)).toBe(expected);
    expect(sent.every((p) => p.operationId === 'op-1')).toBe(true);
  });

  it('splits a large chunk into pushes of at most 16 KiB', async () => {
    const { throttle, sent } = build();
    const big = 'x'.repeat(OPERATION_OUTPUT_MAX_PUSH_BYTES * 3 + 100);

    throttle.push('stderr', big);
    await jest.advanceTimersByTimeAsync(OPERATION_OUTPUT_INTERVAL_MS * 10);

    expect(sent).toHaveLength(4);
    for (const payload of sent) {
      expect(bytes(payload.chunk)).toBeLessThanOrEqual(
        OPERATION_OUTPUT_MAX_PUSH_BYTES,
      );
      expect(payload.stream).toBe('stderr');
    }
    expect(joined(sent)).toBe(big);
  });

  it('counts UTF-8 bytes and never splits a character', async () => {
    const { throttle, sent } = build();
    // 3-byte and 4-byte characters: a byte cut would land mid-character.
    const text = '€😀'.repeat(OPERATION_OUTPUT_MAX_PUSH_BYTES / 4);

    throttle.push('stdout', text);
    await throttle.flush();

    for (const payload of sent) {
      expect(bytes(payload.chunk)).toBeLessThanOrEqual(
        OPERATION_OUTPUT_MAX_PUSH_BYTES,
      );
      expect(payload.chunk).not.toContain('�');
    }
    expect(joined(sent)).toBe(text);
  });

  it('never mixes streams in one push and keeps arrival order', async () => {
    const { throttle, sent } = build();

    throttle.push('stdout', 'a');
    throttle.push('stderr', 'b');
    throttle.push('stdout', 'c');
    await throttle.flush();

    expect(sent.map((p) => [p.stream, p.chunk])).toEqual([
      ['stdout', 'a'],
      ['stderr', 'b'],
      ['stdout', 'c'],
    ]);
  });

  it('flush sends the remainder at once, then ignores later output', async () => {
    const { throttle, sent } = build();

    throttle.push('stdout', 'first');
    await jest.advanceTimersByTimeAsync(0);
    throttle.push('stdout', 'second');
    expect(sent.map((p) => p.chunk)).toEqual(['first']);

    await throttle.flush();
    expect(sent.map((p) => p.chunk)).toEqual(['first', 'second']);

    throttle.push('stdout', 'late');
    await jest.advanceTimersByTimeAsync(OPERATION_OUTPUT_INTERVAL_MS * 5);
    expect(sent.map((p) => p.chunk)).toEqual(['first', 'second']);
  });

  it('flush waits for pushes still in flight', async () => {
    let release: () => void = () => undefined;
    const throttle = new GitOperationOutputThrottle(
      'op-1',
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    throttle.push('stdout', 'x');

    let flushed = false;
    const flushing = throttle.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    release();
    await flushing;
    expect(flushed).toBe(true);
  });

  it('a rejected push does not reject flush', async () => {
    const throttle = new GitOperationOutputThrottle('op-1', async () => {
      throw new Error('webview gone');
    });
    throttle.push('stdout', 'x');

    await expect(throttle.flush()).resolves.toBeUndefined();
  });

  it('bounds the queue, dropping the oldest output with a note', async () => {
    const { throttle, sent } = build();
    const chunk = 'y'.repeat(64 * 1024);

    // 1 MiB queued at once, far past the pending cap.
    for (let i = 0; i < 16; i++) throttle.push('stdout', chunk);
    await throttle.flush();

    const total = sent.reduce((sum, p) => sum + bytes(p.chunk), 0);
    expect(total).toBeLessThanOrEqual(
      OPERATION_OUTPUT_MAX_PENDING_BYTES + 128,
    );
    expect(sent[0].chunk).toMatch(/^\[\.\.\. \d+ KiB of earlier output not shown \.\.\.\]\n/);
    for (const payload of sent) {
      expect(bytes(payload.chunk)).toBeLessThanOrEqual(
        OPERATION_OUTPUT_MAX_PUSH_BYTES,
      );
    }
  });
});
