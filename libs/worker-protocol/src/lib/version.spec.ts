import {
  PROTOCOL_VERSION,
  ProtocolRangeSchema,
  SUPPORTED_PROTOCOL_RANGE,
  negotiateProtocol,
} from './version';

describe('protocol version', () => {
  it('is version 1 in Phase 1 and accepts only it', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect(SUPPORTED_PROTOCOL_RANGE).toEqual({ min: 1, max: 1 });
    expect(Object.isFrozen(SUPPORTED_PROTOCOL_RANGE)).toBe(true);
  });
});

describe('negotiateProtocol', () => {
  it('chooses the highest version in both ranges', () => {
    expect(negotiateProtocol({ min: 1, max: 3 }, { min: 2, max: 5 })).toEqual({
      ok: true,
      version: 3,
    });
    expect(
      negotiateProtocol(SUPPORTED_PROTOCOL_RANGE, { min: 1, max: 1 }),
    ).toEqual({ ok: true, version: 1 });
  });

  it('reports both ranges when they do not overlap', () => {
    const local = { min: 1, max: 1 };
    const remote = { min: 2, max: 4 };
    expect(negotiateProtocol(local, remote)).toEqual({
      ok: false,
      local,
      remote,
    });
  });

  it('treats a malformed range as a mismatch, not a crash', () => {
    const local = { min: 1, max: 1 };
    for (const remote of [
      { min: 2, max: 1 },
      { min: 0, max: 1 },
      { min: 1.5, max: 2 },
      { min: Number.NaN, max: 1 },
    ]) {
      expect(negotiateProtocol(local, remote).ok).toBe(false);
    }
  });
});

describe('ProtocolRangeSchema', () => {
  it('accepts an ordered integer range', () => {
    expect(ProtocolRangeSchema.safeParse({ min: 1, max: 2 }).success).toBe(
      true,
    );
  });

  it('rejects reversed, zero and fractional ranges', () => {
    expect(ProtocolRangeSchema.safeParse({ min: 3, max: 2 }).success).toBe(
      false,
    );
    expect(ProtocolRangeSchema.safeParse({ min: 0, max: 1 }).success).toBe(
      false,
    );
    expect(ProtocolRangeSchema.safeParse({ min: 1, max: 1.5 }).success).toBe(
      false,
    );
  });
});
