/**
 * Drift guard (TASK_2026_658): the Settings page bounds the memory retention
 * and lifecycle fields with the shared `ADVANCED_SETTINGS` table, and the
 * `settings:set` RPC refuses values outside it. The runtime clamps them with
 * the ranges below. If the two disagree, a value the UI accepts is silently
 * clamped to something else (or a value the runtime accepts cannot be
 * entered), so both the ranges and the defaults must match exactly.
 */
import { findAdvancedSetting } from '@ptah-extension/shared';
import type { AdvancedNumberSetting } from '@ptah-extension/shared';
import {
  MEMORY_RETENTION_DEFAULTS,
  MEMORY_RETENTION_KEYS,
  MEMORY_RETENTION_SETTING_RANGES,
} from './memory-retention-config';
import {
  MEMORY_LIFECYCLE_DEFAULTS,
  MEMORY_LIFECYCLE_KEYS,
  MEMORY_LIFECYCLE_SETTING_RANGES,
} from './memory-lifecycle-config';

interface ClampedField {
  readonly key: string;
  readonly range: { readonly min: number; readonly max: number };
  readonly fallback: number;
}

function described(key: string): AdvancedNumberSetting {
  const setting = findAdvancedSetting(key);
  if (setting?.kind !== 'number') {
    throw new Error(`${key} has no number descriptor in ADVANCED_SETTINGS`);
  }
  return setting;
}

const retentionFields = (
  Object.keys(MEMORY_RETENTION_SETTING_RANGES) as Array<
    keyof typeof MEMORY_RETENTION_SETTING_RANGES
  >
).map((field): ClampedField => ({
  key: MEMORY_RETENTION_KEYS[field],
  range: MEMORY_RETENTION_SETTING_RANGES[field],
  fallback: MEMORY_RETENTION_DEFAULTS[field],
}));

const lifecycleFields = (
  Object.keys(MEMORY_LIFECYCLE_SETTING_RANGES) as Array<
    keyof typeof MEMORY_LIFECYCLE_SETTING_RANGES
  >
).map((field): ClampedField => ({
  key: MEMORY_LIFECYCLE_KEYS[field],
  range: MEMORY_LIFECYCLE_SETTING_RANGES[field],
  fallback: MEMORY_LIFECYCLE_DEFAULTS[field],
}));

describe('memory clamps vs the shared Settings descriptors', () => {
  it('covers all six clamped fields', () => {
    expect([...retentionFields, ...lifecycleFields].map((f) => f.key)).toEqual([
      'memory.retention.processedDays',
      'memory.retention.stuckDays',
      'memory.retention.batchSize',
      'memory.lifecycle.archiveAfterDays',
      'memory.lifecycle.deleteAfterDays',
      'memory.lifecycle.maxPerWorkspace',
    ]);
  });

  it.each(
    [...retentionFields, ...lifecycleFields].map(
      (field) => [field.key, field] as const,
    ),
  )('%s: descriptor bounds and default equal the clamp', (_key, field) => {
    const setting = described(field.key);
    expect(setting.min).toBe(field.range.min);
    expect(setting.max).toBe(field.range.max);
    expect(setting.default).toBe(field.fallback);
    // The clamp truncates to an integer, so the field must refuse fractions.
    expect(setting.integer).toBe(true);
  });
});
