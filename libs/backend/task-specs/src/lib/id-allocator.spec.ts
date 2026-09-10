import { allocateTaskId } from './id-allocator';

describe('allocateTaskId', () => {
  const suffix = 'a1f2';

  it('returns 001 when no folders exist for the year', () => {
    expect(allocateTaskId([], suffix, 2026)).toBe('TASK_2026_001_a1f2');
  });

  it('allocates max + 1 with zero-padding', () => {
    expect(
      allocateTaskId(
        ['TASK_2026_001', 'TASK_2026_002', 'TASK_2026_003'],
        suffix,
        2026,
      ),
    ).toBe('TASK_2026_004_a1f2');
  });

  it('ignores numeric gaps and uses the max, not the count', () => {
    expect(
      allocateTaskId(['TASK_2026_005', 'TASK_2026_140'], suffix, 2026),
    ).toBe('TASK_2026_141_a1f2');
  });

  it('counts suffixed folder names by their numeric sequence', () => {
    expect(allocateTaskId(['TASK_2026_146_ORCHESTRA'], suffix, 2026)).toBe(
      'TASK_2026_147_a1f2',
    );
  });

  it('counts lowercase-hex suffixed folder names by their numeric sequence', () => {
    expect(allocateTaskId(['TASK_2026_403_a1f2'], suffix, 2026)).toBe(
      'TASK_2026_404_a1f2',
    );
  });

  it('ignores non-numeric legacy names', () => {
    expect(
      allocateTaskId(['TASK_2026_HERMES', 'TASK_2026_010'], suffix, 2026),
    ).toBe('TASK_2026_011_a1f2');
  });

  it('scopes allocation to the requested year (rollover)', () => {
    expect(allocateTaskId(['TASK_2026_157'], suffix, 2027)).toBe(
      'TASK_2027_001_a1f2',
    );
  });

  it('does not pad beyond three digits', () => {
    expect(allocateTaskId(['TASK_2026_999'], suffix, 2026)).toBe(
      'TASK_2026_1000_a1f2',
    );
  });

  it('ignores folders from other years', () => {
    expect(
      allocateTaskId(['TASK_2025_900', 'TASK_2026_002'], suffix, 2026),
    ).toBe('TASK_2026_003_a1f2');
  });

  it('includes the supplied suffix verbatim', () => {
    expect(allocateTaskId([], '0abc', 2026)).toBe('TASK_2026_001_0abc');
  });

  it.each(['', 'ABCD', 'abcde', 'xyz1'])(
    'throws for malformed suffix %j',
    (malformed) => {
      expect(() => allocateTaskId([], malformed, 2026)).toThrow();
    },
  );
});
