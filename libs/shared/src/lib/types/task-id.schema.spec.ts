import {
  MAX_TASK_ID_LENGTH,
  TASK_ID_PATTERN,
  TASK_ID_TOKEN_SOURCE,
  TaskIdSchema,
} from './task-id.schema';

describe('task id grammar', () => {
  it.each(['TASK_2026_123', 'TASK_2026_1234', 'TASK_2026_1234_ab12', 'TASK_2026_001_9f77'])(
    'accepts %s',
    (id) => {
      expect(TASK_ID_PATTERN.test(id)).toBe(true);
      expect(TaskIdSchema.safeParse(id).success).toBe(true);
    },
  );

  it.each([
    'TASK_2026_12',
    'TASK_2026_123_AB12',
    'task_2026_123',
    'TASK_26_123',
    'TASK_2026_123_ab1',
    ' TASK_2026_123',
    'TASK_2026_123/..',
  ])('rejects %s', (id) => {
    expect(TASK_ID_PATTERN.test(id)).toBe(false);
    expect(TaskIdSchema.safeParse(id).success).toBe(false);
  });

  it('rejects anything longer than the cap even when the grammar matches', () => {
    const long = `TASK_2026_${'1'.repeat(MAX_TASK_ID_LENGTH)}`;
    expect(TASK_ID_PATTERN.test(long)).toBe(true);
    expect(TaskIdSchema.safeParse(long).success).toBe(false);
  });

  it('exposes an unanchored token source for bounded matching', () => {
    const re = new RegExp(TASK_ID_TOKEN_SOURCE, 'g');
    expect('wt-TASK_2026_1234-x'.match(re)).toEqual(['TASK_2026_1234']);
  });
});
