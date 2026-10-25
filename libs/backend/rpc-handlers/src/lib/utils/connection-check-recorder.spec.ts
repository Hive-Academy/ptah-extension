/**
 * ConnectionCheckRecorder — in-memory last check per connection (TASK_2026_555 Batch 28c).
 */

import 'reflect-metadata';

import type { ConnectionCheckRecord } from '@ptah-extension/shared';
import { ConnectionCheckRecorder } from './connection-check-recorder';

function record(
  reason: ConnectionCheckRecord['reason'],
): ConnectionCheckRecord {
  return {
    status: reason === null ? 'verified' : 'failed',
    reason,
    latencyMs: reason === null ? 92 : null,
    checkedAt: '2026-10-01T12:00:00.000Z',
  };
}

describe('ConnectionCheckRecorder', () => {
  it('has no record for a connection that was never checked', () => {
    expect(new ConnectionCheckRecorder().get('kimi-code')).toBeUndefined();
  });

  it('keeps the result of a completed check', () => {
    const recorder = new ConnectionCheckRecorder();
    const ticket = recorder.begin('kimi-code');

    expect(recorder.complete(ticket, record(null))).toBe(true);
    expect(recorder.get('kimi-code')).toEqual(record(null));
  });

  it('an older check that finishes late never replaces a newer result', () => {
    const recorder = new ConnectionCheckRecorder();
    const older = recorder.begin('kimi-code');
    const newer = recorder.begin('kimi-code');

    expect(recorder.complete(newer, record(null))).toBe(true);
    expect(recorder.complete(older, record('timeout'))).toBe(false);
    expect(recorder.get('kimi-code')).toEqual(record(null));
  });

  it('a newer check replaces an older completed one', () => {
    const recorder = new ConnectionCheckRecorder();
    recorder.complete(recorder.begin('kimi-code'), record(null));
    recorder.complete(
      recorder.begin('kimi-code'),
      record('credential-rejected'),
    );

    expect(recorder.get('kimi-code')?.reason).toBe('credential-rejected');
  });

  it('keeps connections independent', () => {
    const recorder = new ConnectionCheckRecorder();
    const kimiCode = recorder.begin('kimi-code');
    recorder.complete(recorder.begin('z-ai'), record('unreachable'));
    recorder.complete(kimiCode, record(null));

    expect(recorder.get('kimi-code')?.status).toBe('verified');
    expect(recorder.get('z-ai')?.reason).toBe('unreachable');
  });

  describe('clear (revise round 1, S-1)', () => {
    it('forgets the record of the cleared connection only', () => {
      const recorder = new ConnectionCheckRecorder();
      recorder.complete(recorder.begin('kimi-code'), record(null));
      recorder.complete(recorder.begin('z-ai'), record(null));

      recorder.clear('kimi-code');

      expect(recorder.get('kimi-code')).toBeUndefined();
      expect(recorder.get('z-ai')).toEqual(record(null));
    });

    it('a check that started BEFORE the clear and finishes AFTER it is not recorded', () => {
      const recorder = new ConnectionCheckRecorder();
      const inFlight = recorder.begin('kimi-code');

      recorder.clear('kimi-code');

      expect(recorder.complete(inFlight, record(null))).toBe(false);
      expect(recorder.get('kimi-code')).toBeUndefined();
    });

    it('a check that starts after the clear is recorded', () => {
      const recorder = new ConnectionCheckRecorder();
      recorder.complete(recorder.begin('kimi-code'), record(null));
      recorder.clear('kimi-code');

      const after = recorder.begin('kimi-code');

      expect(recorder.complete(after, record('credential-rejected'))).toBe(
        true,
      );
      expect(recorder.get('kimi-code')?.reason).toBe('credential-rejected');
    });

    it('isCurrent turns false for a ticket taken before a clear (final review M-1)', () => {
      const recorder = new ConnectionCheckRecorder();
      const inFlight = recorder.begin('kimi-code');
      expect(recorder.isCurrent(inFlight)).toBe(true);

      recorder.clear('kimi-code');

      expect(recorder.isCurrent(inFlight)).toBe(false);
      expect(recorder.isCurrent(recorder.begin('kimi-code'))).toBe(true);
    });

    it('clearing a connection that was never checked is harmless', () => {
      const recorder = new ConnectionCheckRecorder();
      recorder.clear('kimi-code');
      expect(recorder.get('kimi-code')).toBeUndefined();
    });
  });
});
