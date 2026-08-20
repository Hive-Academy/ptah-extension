/**
 * update-rpc.schema.spec.ts
 *
 * Unit tests for UpdateGetStateSchema and UpdateCheckNowSchema.
 * Both schemas accept empty objects. z.object({}) (without .strict())
 * strips unknown keys by default in Zod 3+.
 */

import {
  UpdateGetStateSchema,
  UpdateCheckNowSchema,
} from './update-rpc.schema';

describe('UpdateGetStateSchema', () => {
  it('parses an empty object successfully', () => {
    expect(() => UpdateGetStateSchema.parse({})).not.toThrow();
  });

  it('strips unknown extra fields (no .strict())', () => {
    const result = UpdateGetStateSchema.parse({ unknownField: 'ignored' });
    expect(result).toEqual({});
  });
});

describe('UpdateCheckNowSchema', () => {
  it('parses an empty object successfully', () => {
    expect(() => UpdateCheckNowSchema.parse({})).not.toThrow();
  });

  it('returns an empty object on success', () => {
    const result = UpdateCheckNowSchema.parse({});
    expect(result).toEqual({});
  });

  it('strips unknown extra fields (no .strict())', () => {
    const result = UpdateCheckNowSchema.parse({ unknownField: 'ignored' });
    expect(result).toEqual({});
    expect((result as Record<string, unknown>)['unknownField']).toBeUndefined();
  });
});
