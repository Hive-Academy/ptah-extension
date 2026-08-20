import { allocateTaskId } from './id-allocator';

describe('allocateTaskId', () => {
  it('returns 001 when no folders exist for the year', () => {
    expect(allocateTaskId([], 2026)).toBe('TASK_2026_001');
  });

  it('allocates max + 1 with zero-padding', () => {
    expect(
      allocateTaskId(['TASK_2026_001', 'TASK_2026_002', 'TASK_2026_003'], 2026),
    ).toBe('TASK_2026_004');
  });

  it('ignores numeric gaps and uses the max, not the count', () => {
    expect(allocateTaskId(['TASK_2026_005', 'TASK_2026_140'], 2026)).toBe(
      'TASK_2026_141',
    );
  });

  it('counts suffixed folder names by their numeric sequence', () => {
    expect(allocateTaskId(['TASK_2026_146_ORCHESTRA'], 2026)).toBe(
      'TASK_2026_147',
    );
  });

  it('ignores non-numeric legacy names', () => {
    expect(allocateTaskId(['TASK_2026_HERMES', 'TASK_2026_010'], 2026)).toBe(
      'TASK_2026_011',
    );
  });

  it('scopes allocation to the requested year (rollover)', () => {
    expect(allocateTaskId(['TASK_2026_157'], 2027)).toBe('TASK_2027_001');
  });

  it('does not pad beyond three digits', () => {
    expect(allocateTaskId(['TASK_2026_999'], 2026)).toBe('TASK_2026_1000');
  });

  it('ignores folders from other years', () => {
    expect(allocateTaskId(['TASK_2025_900', 'TASK_2026_002'], 2026)).toBe(
      'TASK_2026_003',
    );
  });
});
