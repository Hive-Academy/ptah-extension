import { randomIdSuffix, TASK_ID_SUFFIX_RE } from './id-suffix';

describe('randomIdSuffix', () => {
  it('returns varying four-character lowercase hexadecimal suffixes', () => {
    const draws = Array.from({ length: 1_000 }, () => randomIdSuffix());

    expect(draws.every((draw) => TASK_ID_SUFFIX_RE.test(draw))).toBe(true);
    expect(new Set(draws).size).toBeGreaterThan(1);
  });
});
