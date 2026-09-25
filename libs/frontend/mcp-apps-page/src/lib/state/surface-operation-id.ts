/**
 * Operation ids for `surface:change`, `surface:select` and `surface:action`.
 *
 * The shape is fixed by `SURFACE_OPERATION_ID_PATTERN`
 * (`op-[0-9]{13}-[A-Za-z0-9]{8,40}`): a 13-digit millisecond clock plus a random
 * alphanumeric part. There is ONE new id per user attempt. An id would be
 * reused only for a transport retry of the identical request, and this design
 * makes no automatic transport retries, so in practice ids are never reused.
 * The host clock-skew bound is `SURFACE_STORE_LIMITS.maxOperationClockSkewMs`
 * (5 min); a renderer clock beyond it is refused `operation-expired`.
 */

/** The random part every operation id carries after the timestamp. */
export const SURFACE_OPERATION_RANDOM_LENGTH = 16;

/** [A-Za-z0-9] — the alphabet `SURFACE_OPERATION_ID_PATTERN` accepts. */
const ALPHANUMERIC =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 62 alphabet characters times 4 = 248. A uniform byte below 248 lands on each
 * alphabet character exactly four times, so `byte % 62` stays uniform; bytes at
 * or above it are drawn again instead of being folded with a modulo bias.
 */
const UNBIASED_BYTE_MAX = 248;

/** Extra bytes drawn per round so a rejected byte rarely costs another draw. */
const DRAW_MARGIN = 8;

/** A uniform byte source; injectable so specs stay deterministic (A2). */
export type RandomByteSource = (count: number) => Uint8Array;

function defaultRandomBytes(count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * `length` characters drawn uniformly from [A-Za-z0-9] via
 * `crypto.getRandomValues`. Rejected bytes simply disappear, so every emitted
 * character keeps the same probability. A source that yields no bytes ends the
 * draw instead of spinning, so the call never hangs or throws.
 */
export function randomAlphanumeric(
  length: number,
  randomBytes: RandomByteSource = defaultRandomBytes,
): string {
  let result = '';
  while (result.length < length) {
    const bytes = randomBytes(length - result.length + DRAW_MARGIN);
    if (bytes.length === 0) {
      return result;
    }
    for (
      let index = 0;
      index < bytes.length && result.length < length;
      index++
    ) {
      const byte = bytes[index];
      if (byte < UNBIASED_BYTE_MAX) {
        result += ALPHANUMERIC.charAt(byte % ALPHANUMERIC.length);
      }
    }
  }
  return result;
}

/**
 * One operation id: `op-${now}-${16 alphanumeric characters}`. Both inputs are
 * injectable; the defaults are the wall clock and the platform crypto source.
 */
export function createSurfaceOperationId(
  now: number = Date.now(),
  random: string = randomAlphanumeric(SURFACE_OPERATION_RANDOM_LENGTH),
): string {
  return `op-${now}-${random}`;
}