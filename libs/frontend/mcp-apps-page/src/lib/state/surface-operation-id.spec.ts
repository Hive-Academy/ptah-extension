import { SURFACE_OPERATION_ID_PATTERN } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  SURFACE_OPERATION_RANDOM_LENGTH,
  createSurfaceOperationId,
  randomAlphanumeric,
} from './surface-operation-id';
import type { RandomByteSource } from './surface-operation-id';

/** 13 digits, like every current `Date.now()` value. */
const FIXED_NOW = 1_769_000_000_000;

function byteSource(bytes: readonly number[]): RandomByteSource {
  return () => new Uint8Array(bytes);
}

describe('createSurfaceOperationId', () => {
  it('builds op-<now>-<random> for a fixed clock and an injected random part', () => {
    const id = createSurfaceOperationId(FIXED_NOW, 'abcdefghijklmnop');
    expect(id).toBe('op-1769000000000-abcdefghijklmnop');
    expect(id).toMatch(SURFACE_OPERATION_ID_PATTERN);
  });

  it('matches SURFACE_OPERATION_ID_PATTERN for a fixed clock with the default random source', () => {
    const id = createSurfaceOperationId(FIXED_NOW);
    expect(id).toMatch(SURFACE_OPERATION_ID_PATTERN);
    expect(id.startsWith(`op-${FIXED_NOW}-`)).toBe(true);
    expect(id).toHaveLength(
      `op-${FIXED_NOW}-`.length + SURFACE_OPERATION_RANDOM_LENGTH,
    );
  });

  it('creates a distinct id per call at the same clock', () => {
    const first = createSurfaceOperationId(FIXED_NOW);
    const second = createSurfaceOperationId(FIXED_NOW);
    expect(first).not.toBe(second);
    expect(first).toMatch(SURFACE_OPERATION_ID_PATTERN);
    expect(second).toMatch(SURFACE_OPERATION_ID_PATTERN);
  });

  it('creates a pattern-conforming id from the default clock', () => {
    expect(createSurfaceOperationId()).toMatch(SURFACE_OPERATION_ID_PATTERN);
  });
});

describe('randomAlphanumeric', () => {
  it('maps injected bytes onto [A-Za-z0-9] in order', () => {
    // Indices 0, 1, 2, 15, 61, 62, 63 -> A, B, C, P, 9, A, B.
    expect(
      randomAlphanumeric(7, byteSource([0, 1, 2, 15, 61, 62, 63])),
    ).toBe('ABCP9AB');
  });

  it('skips bytes at or above 248 instead of folding them with modulo bias', () => {
    // 248 and 255 are rejected; 247 % 62 = 61 -> '9'; 0 -> 'A'; 1 -> 'B'.
    expect(
      randomAlphanumeric(3, byteSource([248, 255, 247, 0, 1])),
    ).toBe('9AB');
  });

  it('keeps drawing until the requested length is reached', () => {
    // Every round accepts only byte 0, so 16 rounds yield 16 'A's.
    expect(randomAlphanumeric(16, byteSource([0, 248, 249, 255]))).toBe(
      'A'.repeat(16),
    );
  });

  it('terminates on a source that yields no bytes', () => {
    expect(randomAlphanumeric(16, byteSource([]))).toBe('');
  });

  it('returns an empty string for a non-positive length', () => {
    expect(randomAlphanumeric(0)).toBe('');
  });

  it('draws the default source from crypto.getRandomValues over the alphabet only', () => {
    const value = randomAlphanumeric(SURFACE_OPERATION_RANDOM_LENGTH);
    expect(value).toHaveLength(SURFACE_OPERATION_RANDOM_LENGTH);
    expect(value).toMatch(/^[A-Za-z0-9]+$/);
    // 200 draws make an alphabet leak (for example a biased modulo artifact)
    // practically impossible to miss.
    expect(randomAlphanumeric(200)).toMatch(/^[A-Za-z0-9]{200}$/);
  });
});