/**
 * `rpc-degradation.types` — guard specs (TASK_2026_383, component 1).
 *
 * `isDegradationEventPayload` is the admission gate for a channel whose whole
 * value is that its counts mean something. A payload with an empty or absent
 * `code` would open a bucket nothing can be attributed to, so the negative
 * cases below carry more weight than the positive one.
 */

import type { MessagePayloadMap } from '../messages/payload-map';
import { MESSAGE_TYPES } from '../messages/message-constants';
import {
  DEGRADATION_SEVERITY_VALUES,
  DEGRADATION_SOURCE_VALUES,
  isDegradationEventPayload,
  isDegradationSeverity,
  isDegradationSource,
  type DegradationEventPayload,
} from './rpc-degradation.types';

describe('isDegradationSource', () => {
  it.each(DEGRADATION_SOURCE_VALUES)('accepts %s', (value) => {
    expect(isDegradationSource(value)).toBe(true);
  });

  it.each([
    ['Database'],
    ['db'],
    ['telemetry'],
    [''],
    [null],
    [undefined],
    [3],
  ])('rejects %p', (value) => {
    expect(isDegradationSource(value)).toBe(false);
  });

  it('lists every union member exactly once', () => {
    expect(new Set(DEGRADATION_SOURCE_VALUES).size).toBe(
      DEGRADATION_SOURCE_VALUES.length,
    );
  });
});

describe('isDegradationSeverity', () => {
  it.each(DEGRADATION_SEVERITY_VALUES)('accepts %s', (value) => {
    expect(isDegradationSeverity(value)).toBe(true);
  });

  it('is exactly the three documented levels', () => {
    expect(DEGRADATION_SEVERITY_VALUES).toEqual([
      'expected',
      'degraded',
      'critical',
    ]);
  });

  it.each([['warn'], ['error'], ['info'], [''], [null], [1]])(
    'rejects %p',
    (value) => {
      expect(isDegradationSeverity(value)).toBe(false);
    },
  );
});

describe('isDegradationEventPayload', () => {
  const valid: DegradationEventPayload = {
    source: 'database',
    code: 'sqlite.backup.no-worker-factory',
    severity: 'critical',
    summary: 'No backup was taken: the database worker factory is unregistered',
    timestamp: 1_700_000_000_000,
  };

  it('accepts a minimal valid payload', () => {
    expect(isDegradationEventPayload(valid)).toBe(true);
  });

  it('accepts an optional detail', () => {
    expect(
      isDegradationEventPayload({ ...valid, detail: 'ENOENT: worker.mjs' }),
    ).toBe(true);
  });

  it('accepts an empty summary, because a reader falls back to the code', () => {
    expect(isDegradationEventPayload({ ...valid, summary: '' })).toBe(true);
  });

  it('rejects an empty code, because a count keyed on it means nothing', () => {
    expect(isDegradationEventPayload({ ...valid, code: '' })).toBe(false);
  });

  it.each([
    ['an unknown source', { ...valid, source: 'telemetry' }],
    ['a missing source', { ...valid, source: undefined }],
    ['a missing code', { ...valid, code: undefined }],
    ['a non-string code', { ...valid, code: 42 }],
    ['a missing severity', { ...valid, severity: undefined }],
    ['a log-level severity', { ...valid, severity: 'warn' }],
    ['a missing summary', { ...valid, summary: undefined }],
    ['a non-string summary', { ...valid, summary: 42 }],
    ['a NaN timestamp', { ...valid, timestamp: Number.NaN }],
    ['an Infinity timestamp', { ...valid, timestamp: Infinity }],
    ['a string timestamp', { ...valid, timestamp: '1700000000000' }],
    ['a non-string detail', { ...valid, detail: 42 }],
  ])('rejects %s', (_label, payload) => {
    expect(isDegradationEventPayload(payload)).toBe(false);
  });

  it.each([[null], [undefined], ['degradation'], [7], [[]]])(
    'rejects the non-object %p',
    (payload) => {
      expect(isDegradationEventPayload(payload)).toBe(false);
    },
  );

  it('rejects a null-prototype object rather than throwing on it', () => {
    expect(() =>
      isDegradationEventPayload(Object.create(null) as unknown),
    ).not.toThrow();
    expect(isDegradationEventPayload(Object.create(null) as unknown)).toBe(
      false,
    );
  });

  it('is the payload-map shape for degradation:event', () => {
    const message: MessagePayloadMap['degradation:event'] = valid;

    expect(message.code).toBe('sqlite.backup.no-worker-factory');
    expect(MESSAGE_TYPES.DEGRADATION_EVENT).toBe('degradation:event');
  });
});
