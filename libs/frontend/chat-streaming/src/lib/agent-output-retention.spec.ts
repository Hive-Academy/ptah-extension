/**
 * stdout/stderr byte-buffer helpers (TASK_2026_628 batch 4b).
 *
 * Live output is trimmed with slack: the buffer may grow to twice the cap
 * before it is cut back to the cap, so the ~cap-sized copy happens once per
 * ~cap characters of new output instead of once per delta.
 */

import {
  appendToBuffer,
  capBuffer,
  trimPendingOutput,
} from './agent-output-retention';

const MAX = 100;
const NOTICE =
  /^… (\d+) characters of earlier output were dropped to bound this card\.\n/;

function noticeCount(buffer: string): number {
  const match = NOTICE.exec(buffer);
  return match ? Number(match[1]) : 0;
}

function bodyOf(buffer: string): string {
  const match = NOTICE.exec(buffer);
  return match ? buffer.slice(match[0].length) : buffer;
}

function line(char: string, length: number): string {
  return `${char.repeat(length - 1)}\n`;
}

describe('appendToBuffer', () => {
  it('returns the same reference when nothing is pending', () => {
    const current = 'abc';
    expect(appendToBuffer(current, '', 0, MAX)).toBe(current);
  });

  it('only appends while the result stays within twice the cap', () => {
    const current = line('a', 120);
    const next = appendToBuffer(current, line('b', 70), 0, MAX);

    expect(next).toBe(current + line('b', 70));
    expect(noticeCount(next)).toBe(0);
  });

  it('trims back to the cap, on a line boundary, once past twice the cap', () => {
    let buffer = '';
    let received = 0;
    for (let i = 0; i < 25; i++) {
      const chunk = line(String.fromCharCode(97 + (i % 26)), 10);
      buffer = appendToBuffer(buffer, chunk, 0, MAX);
      received += chunk.length;
    }

    expect(noticeCount(buffer)).toBeGreaterThan(0);
    expect(bodyOf(buffer).length).toBeLessThanOrEqual(2 * MAX);
    expect(noticeCount(buffer)).toBe(received - bodyOf(buffer).length);
    // Every kept line is whole.
    for (const kept of bodyOf(buffer).split('\n').slice(0, -1)) {
      expect(kept).toHaveLength(9);
    }
  });

  it('keeps the notice count cumulative across repeated trims', () => {
    let buffer = '';
    let received = 0;
    const counts: number[] = [];
    for (let i = 0; i < 100; i++) {
      const chunk = line('x', 10);
      buffer = appendToBuffer(buffer, chunk, 0, MAX);
      received += chunk.length;
      counts.push(noticeCount(buffer));
    }

    expect(noticeCount(buffer)).toBe(received - bodyOf(buffer).length);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
  });

  it('adds bytes dropped from the queue to the head notice, written once at index 0', () => {
    const current = capBuffer(line('a', 150), MAX);
    const earlier = noticeCount(current);
    const next = appendToBuffer(current, line('b', 20), 33, MAX);

    // The applied body preceded the dropped queue bytes, so it is dropped
    // too: no hole in the middle of the buffer.
    expect(bodyOf(next)).toBe(line('b', 20));
    expect(noticeCount(next)).toBe(earlier + bodyOf(current).length + 33);
    expect(next.indexOf('characters of earlier output')).toBe(
      next.lastIndexOf('characters of earlier output'),
    );
  });
});

describe('trimPendingOutput', () => {
  it('keeps queued text untouched up to twice the cap', () => {
    const raw = 'q'.repeat(2 * MAX);
    expect(trimPendingOutput(raw, MAX)).toEqual({ kept: raw, dropped: 0 });
  });

  it('removes the front past twice the cap and reports the count, with no notice', () => {
    const raw = line('q', 10).repeat(25);
    const { kept, dropped } = trimPendingOutput(raw, MAX);

    expect(kept.length).toBeLessThanOrEqual(MAX);
    expect(dropped + kept.length).toBe(raw.length);
    expect(noticeCount(kept)).toBe(0);
  });
});

describe('capBuffer', () => {
  it('trims to the cap immediately (restored cards state their loss at once)', () => {
    const capped = capBuffer(line('r', 10).repeat(15), MAX);

    expect(bodyOf(capped).length).toBeLessThanOrEqual(MAX);
    expect(noticeCount(capped)).toBe(150 - bodyOf(capped).length);
  });

  it('returns the same reference when within the cap', () => {
    const small = 'small';
    expect(capBuffer(small, MAX)).toBe(small);
  });
});
