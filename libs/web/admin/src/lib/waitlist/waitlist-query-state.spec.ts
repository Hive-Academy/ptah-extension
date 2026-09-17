import {
  needsWaitlistQueryCanonicalization,
  parseWaitlistQuery,
} from './waitlist-query-state';

describe('waitlist query state', () => {
  it.each([
    ['page', '2junk'],
    ['pageSize', '25abc'],
  ])('rejects a partially valid numeric %s value', (key, value) => {
    const parsed = parseWaitlistQuery({ [key]: value });

    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(25);
    expect(needsWaitlistQueryCanonicalization({ [key]: value }, parsed)).toBe(
      true,
    );
  });

  it.each([
    '2026-13-45',
    'March 3',
    '2026-02-30',
    '2026-04-31',
    '2026-02-29',
    '2026-09-17T24:00:00Z',
    '2026-09-17T12:60:00Z',
  ])('rejects a non-ISO or invalid createdFrom value: %s', (createdFrom) => {
    const parsed = parseWaitlistQuery({ createdFrom });

    expect(parsed.createdFrom).toBeUndefined();
    expect(needsWaitlistQueryCanonicalization({ createdFrom }, parsed)).toBe(
      true,
    );
  });

  it.each([
    '2028-02-29',
    '2026-09-17',
    '2026-09-17T14:30:45+02:00',
    '2026-09-17T14:30:45.123Z',
  ])('accepts a valid ISO date-time value: %s', (createdFrom) => {
    const parsed = parseWaitlistQuery({ createdFrom });

    expect(parsed.createdFrom).toBe(createdFrom);
    expect(needsWaitlistQueryCanonicalization({ createdFrom }, parsed)).toBe(
      false,
    );
  });
});
