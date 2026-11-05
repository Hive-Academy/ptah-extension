import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_BYTES,
  PAIRING_CODE_LENGTH,
  PAIRING_TTL_DEFAULT_SEC,
  PAIRING_TTL_MAX_SEC,
  PAIRING_TTL_MIN_SEC,
  encodePairingCode,
  formatPairingCode,
  normalizePairingCode,
} from './pairing-code';

describe('pairing code constants (AD-15)', () => {
  it('uses the 32-character Crockford alphabet without I, L, O, U', () => {
    expect(PAIRING_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(PAIRING_CODE_ALPHABET).size).toBe(32);
    for (const excluded of ['I', 'L', 'O', 'U']) {
      expect(PAIRING_CODE_ALPHABET).not.toContain(excluded);
    }
  });

  it('is 8 characters from 40 bits with a 300 s default and 60-900 s range', () => {
    expect(PAIRING_CODE_LENGTH).toBe(8);
    expect(PAIRING_CODE_BYTES * 8).toBe(PAIRING_CODE_LENGTH * 5);
    expect(PAIRING_TTL_DEFAULT_SEC).toBe(300);
    expect(PAIRING_TTL_MIN_SEC).toBe(60);
    expect(PAIRING_TTL_MAX_SEC).toBe(900);
  });
});

describe('encodePairingCode', () => {
  it('maps all-zero and all-one bytes to the alphabet ends', () => {
    expect(encodePairingCode(new Uint8Array(5))).toBe('00000000');
    expect(encodePairingCode(new Uint8Array(5).fill(0xff))).toBe('ZZZZZZZZ');
  });

  it('encodes big-endian 5-bit groups', () => {
    // 0x0000000001 -> last group 1; 0x8000000000 -> first group 16 ('G').
    expect(encodePairingCode(Uint8Array.of(0, 0, 0, 0, 1))).toBe('00000001');
    expect(encodePairingCode(Uint8Array.of(0x80, 0, 0, 0, 0))).toBe('G0000000');
  });

  it('always yields a canonical code that normalizes to itself', () => {
    const bytes = Uint8Array.of(0x12, 0x34, 0x56, 0x78, 0x9a);
    const code = encodePairingCode(bytes);
    expect(code).toHaveLength(8);
    expect(normalizePairingCode(code)).toBe(code);
  });

  it('refuses the wrong number of bytes', () => {
    expect(() => encodePairingCode(new Uint8Array(4))).toThrow(RangeError);
    expect(() => encodePairingCode(new Uint8Array(6))).toThrow(RangeError);
  });
});

describe('normalizePairingCode', () => {
  it('accepts the display form and the bare form', () => {
    expect(normalizePairingCode('ABCD-EFGH')).toBe('ABCDEFGH');
    expect(normalizePairingCode('ABCDEFGH')).toBe('ABCDEFGH');
  });

  it('is case-insensitive and ignores spaces and hyphens', () => {
    expect(normalizePairingCode(' abcd efgh ')).toBe('ABCDEFGH');
    expect(normalizePairingCode('ab-cd-ef-gh')).toBe('ABCDEFGH');
  });

  it('reads I and L as 1 and O as 0', () => {
    expect(normalizePairingCode('iLoO-1234')).toBe('11001234');
  });

  it('rejects U, punctuation and non-ASCII look-alikes', () => {
    expect(normalizePairingCode('ABCD-EFGU')).toBeNull();
    expect(normalizePairingCode('ABCD_EFGH')).toBeNull();
    // Dotless i upper-cases to ASCII I; it must not alias to 1.
    expect(normalizePairingCode('ıBCD-EFGH')).toBeNull();
    expect(normalizePairingCode('ＡBCD-EFGH')).toBeNull();
  });

  it('rejects the wrong length and over-long input', () => {
    expect(normalizePairingCode('')).toBeNull();
    expect(normalizePairingCode('ABCD-EFG')).toBeNull();
    expect(normalizePairingCode('ABCD-EFGHJ')).toBeNull();
    expect(normalizePairingCode(`${'-'.repeat(30)}ABCDEFGH`)).toBeNull();
  });
});

describe('formatPairingCode', () => {
  it('shows XXXX-XXXX', () => {
    expect(formatPairingCode('abcdefgh')).toBe('ABCD-EFGH');
  });

  it('refuses an invalid code', () => {
    expect(() => formatPairingCode('nope')).toThrow(RangeError);
  });
});
