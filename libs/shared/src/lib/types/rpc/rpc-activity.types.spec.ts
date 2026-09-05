/**
 * `rpc-activity.types` — guard specs (TASK_2026_380, component 14c).
 *
 * `isActivityEventPayload` is the ticker's only admission gate: the message
 * client resolves to `unknown`, so a guard that lets a malformed payload
 * through puts an unsortable or blank row into a ring the user cannot clear.
 * The negative cases below therefore matter more than the positive one.
 */

import type { MessagePayloadMap } from '../messages/payload-map';
import {
  ACTIVITY_LEVEL_VALUES,
  ACTIVITY_SOURCE_VALUES,
  isActivityEventPayload,
  isActivityLevel,
  isActivitySource,
  type ActivityEventPayload,
} from './rpc-activity.types';

describe('isActivitySource', () => {
  it.each(ACTIVITY_SOURCE_VALUES)('accepts %s', (value) => {
    expect(isActivitySource(value)).toBe(true);
  });

  it.each([['Memory'], ['db'], ['telemetry'], [''], [null], [undefined], [3]])(
    'rejects %p',
    (value) => {
      expect(isActivitySource(value)).toBe(false);
    },
  );

  it('lists every union member exactly once', () => {
    expect(new Set(ACTIVITY_SOURCE_VALUES).size).toBe(
      ACTIVITY_SOURCE_VALUES.length,
    );
    expect(ACTIVITY_SOURCE_VALUES).toEqual([
      'boot',
      'memory',
      'indexing',
      'skills',
      'cron',
      'harness',
      'sessions',
      'embedder',
      'vec',
      'database',
    ]);
  });
});

describe('isActivityLevel', () => {
  it.each(ACTIVITY_LEVEL_VALUES)('accepts %s', (value) => {
    expect(isActivityLevel(value)).toBe(true);
  });

  it('rejects error, which is deliberately not a ticker level', () => {
    // A ticker is passive and non-focus-stealing. Admitting 'error' would make
    // it the de facto error surface — the one place failures go and the one
    // place they cannot be seen.
    expect(isActivityLevel('error')).toBe(false);
    expect(ACTIVITY_LEVEL_VALUES).toEqual(['info', 'warn']);
  });
});

describe('isActivityEventPayload', () => {
  const valid: ActivityEventPayload = {
    source: 'cron',
    kind: 'cron-run',
    summary: 'Nightly memory curation finished in 4.2 s',
    timestamp: 1_700_000_000_000,
  };

  it('accepts a minimal valid payload', () => {
    expect(isActivityEventPayload(valid)).toBe(true);
  });

  it('accepts an explicit level', () => {
    expect(isActivityEventPayload({ ...valid, level: 'warn' })).toBe(true);
  });

  it('accepts an empty summary, because the renderer falls back to the source label', () => {
    expect(isActivityEventPayload({ ...valid, summary: '' })).toBe(true);
  });

  it.each([
    ['an unknown source', { ...valid, source: 'telemetry' }],
    ['a missing source', { ...valid, source: undefined }],
    ['a missing summary', { ...valid, summary: undefined }],
    ['a non-string summary', { ...valid, summary: 42 }],
    ['a missing kind', { ...valid, kind: undefined }],
    ['a NaN timestamp', { ...valid, timestamp: Number.NaN }],
    ['an Infinity timestamp', { ...valid, timestamp: Infinity }],
    ['a string timestamp', { ...valid, timestamp: '1700000000000' }],
    ['an error level', { ...valid, level: 'error' }],
  ])('rejects %s', (_label, payload) => {
    expect(isActivityEventPayload(payload)).toBe(false);
  });

  it.each([[null], [undefined], ['activity'], [7], [[]]])(
    'rejects the non-object %p',
    (payload) => {
      expect(isActivityEventPayload(payload)).toBe(false);
    },
  );

  it('is the payload-map shape for activity:event', () => {
    const message: MessagePayloadMap['activity:event'] = valid;

    expect(message.source).toBe('cron');
  });
});
