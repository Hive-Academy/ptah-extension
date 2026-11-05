/**
 * Protocol version and negotiation (plan W2).
 *
 * The client's first frame is `hello { protocol: { min, max } }`. The worker
 * picks the highest version both sides support, or answers `VERSION_MISMATCH`
 * and closes 4409. The client refuses to connect rather than failing
 * mid-session (design-spec 4.5 "Version skew").
 */

import { z } from 'zod';

/** The wire protocol version this build speaks. Phase 1 is version 1. */
export const PROTOCOL_VERSION = 1;

/** `{ min, max }` protocol range, as sent in `hello` and in `VERSION_MISMATCH`. */
export const ProtocolRangeSchema = z
  .object({
    min: z.number().int().min(1),
    max: z.number().int().min(1),
  })
  .refine((range) => range.min <= range.max, {
    message: 'min must not exceed max',
  });

export type ProtocolRange = z.infer<typeof ProtocolRangeSchema>;

/** The range this build accepts. Widen `min` only when a migration path exists. */
export const SUPPORTED_PROTOCOL_RANGE: Readonly<ProtocolRange> = Object.freeze({
  min: PROTOCOL_VERSION,
  max: PROTOCOL_VERSION,
});

export type ProtocolNegotiation =
  | { readonly ok: true; readonly version: number }
  | {
      readonly ok: false;
      readonly local: ProtocolRange;
      readonly remote: ProtocolRange;
    };

/**
 * Choose the highest protocol version inside both ranges.
 *
 * A malformed range (non-integer, below 1, or `min > max`) never matches: the
 * caller treats it as a mismatch, not as a crash.
 */
export function negotiateProtocol(
  local: ProtocolRange,
  remote: ProtocolRange,
): ProtocolNegotiation {
  if (!isValidRange(local) || !isValidRange(remote)) {
    return { ok: false, local, remote };
  }
  const low = Math.max(local.min, remote.min);
  const high = Math.min(local.max, remote.max);
  if (low > high) {
    return { ok: false, local, remote };
  }
  return { ok: true, version: high };
}

function isValidRange(range: ProtocolRange): boolean {
  return (
    Number.isInteger(range.min) &&
    Number.isInteger(range.max) &&
    range.min >= 1 &&
    range.min <= range.max
  );
}
