/**
 * update-rpc.schema.spec.ts
 *
 * Unit tests for UpdateCheckNowSchema and UpdateInstallNowSchema.
 * Both schemas accept empty objects. z.object({}) (without .strict())
 * strips unknown keys by default in Zod 3+.
 *
 * TASK_2026_117: Batch 5, Task 5.2
 */

import {
  UpdateCheckNowSchema,
  UpdateInstallNowSchema,
} from './update-rpc.schema';

describe('UpdateCheckNowSchema', () => {
  it('parses an empty object successfully', () => {
    expect(() => UpdateCheckNowSchema.parse({})).not.toThrow();
  });

  it('returns an empty object on success', () => {
    const result = UpdateCheckNowSchema.parse({});
    expect(result).toEqual({});
  });

  it('strips unknown extra fields (no .strict())', () => {
    // z.object({}) without .strict() silently strips extra fields
    const result = UpdateCheckNowSchema.parse({ unknownField: 'ignored' });
    expect(result).toEqual({});
    expect((result as Record<string, unknown>)['unknownField']).toBeUndefined();
  });
});

describe('UpdateInstallNowSchema', () => {
  it('parses an empty object successfully', () => {
    expect(() => UpdateInstallNowSchema.parse({})).not.toThrow();
  });

  it('returns an empty object on success', () => {
    const result = UpdateInstallNowSchema.parse({});
    expect(result).toEqual({});
  });

  it('strips unknown extra fields (no .strict())', () => {
    const result = UpdateInstallNowSchema.parse({ extra: 42, another: true });
    expect(result).toEqual({});
    expect((result as Record<string, unknown>)['extra']).toBeUndefined();
  });
});
