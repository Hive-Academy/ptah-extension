/**
 * Pairing code format (plan W3, AD-15).
 *
 * A code is 8 Crockford base32 characters (40 bits), shown as `XXXX-XXXX`.
 * The alphabet leaves out `I`, `L`, `O` and `U`. Input is read the Crockford
 * way: case-insensitive, `I`/`L` read as `1`, `O` read as `0`, and hyphens and
 * spaces ignored, so a code typed from another screen still matches. `U` and
 * any other character make the input invalid.
 *
 * This file is isomorphic: the worker supplies the 5 random bytes from its
 * own CSPRNG, and the client only normalizes what the user typed.
 */

/** Crockford base32 alphabet (no I, L, O, U). Index = 5-bit value. */
export const PAIRING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Characters in a code. */
export const PAIRING_CODE_LENGTH = 8;

/** Random bytes behind one code: 8 characters x 5 bits = 40 bits. */
export const PAIRING_CODE_BYTES = 5;

/** Default lifetime of the code and its window, in seconds. */
export const PAIRING_TTL_DEFAULT_SEC = 300;
/** Smallest `--ttl` an operator may ask for. */
export const PAIRING_TTL_MIN_SEC = 60;
/** Largest `--ttl` an operator may ask for. */
export const PAIRING_TTL_MAX_SEC = 900;

/**
 * Longest raw input accepted (separators and spaces included). The
 * `pair.exchange` params schema uses the same bound.
 */
export const PAIRING_CODE_INPUT_MAX_LENGTH = 32;

const ASCII_ALPHANUMERIC = /^[0-9A-Za-z]$/;

const CROCKFORD_ALIASES: Readonly<Record<string, string>> = {
  I: '1',
  L: '1',
  O: '0',
};

/**
 * Encode 5 random bytes as an 8-character code (no separator).
 * Throws when the caller passes the wrong number of bytes: that is a
 * programming error, never a user input.
 */
export function encodePairingCode(bytes: Uint8Array): string {
  if (bytes.length !== PAIRING_CODE_BYTES) {
    throw new RangeError(
      `encodePairingCode needs exactly ${PAIRING_CODE_BYTES} bytes, got ${bytes.length}`,
    );
  }
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  let code = '';
  for (let index = PAIRING_CODE_LENGTH - 1; index >= 0; index -= 1) {
    const digit = Number((value >> BigInt(index * 5)) & 31n);
    code += PAIRING_CODE_ALPHABET[digit];
  }
  return code;
}

/**
 * Normalize user input to the canonical 8-character form, or `null` when the
 * input is not a code. Accepts `XXXX-XXXX`, `XXXXXXXX`, lower case, spaces,
 * and the Crockford aliases `I`/`L` -> `1`, `O` -> `0`.
 */
export function normalizePairingCode(input: string): string | null {
  if (input.length > PAIRING_CODE_INPUT_MAX_LENGTH) {
    return null;
  }
  let code = '';
  for (const raw of input) {
    if (raw === '-' || raw === ' ') {
      continue;
    }
    // ASCII letters and digits only, checked before upper-casing: some
    // non-ASCII letters upper-case to ASCII (`ı` -> `I`) and would otherwise
    // alias into a valid character.
    if (!ASCII_ALPHANUMERIC.test(raw)) {
      return null;
    }
    const upper = raw.toUpperCase();
    const char = CROCKFORD_ALIASES[upper] ?? upper;
    if (!PAIRING_CODE_ALPHABET.includes(char)) {
      return null;
    }
    code += char;
  }
  return code.length === PAIRING_CODE_LENGTH ? code : null;
}

/** Display form `XXXX-XXXX` of a canonical (or normalizable) code. */
export function formatPairingCode(code: string): string {
  const canonical = normalizePairingCode(code);
  if (canonical === null) {
    throw new RangeError('formatPairingCode needs a valid pairing code');
  }
  return `${canonical.slice(0, 4)}-${canonical.slice(4)}`;
}
