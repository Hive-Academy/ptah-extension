import { pluralCategory, type PluralI18nKeys } from './plural';

describe('pluralCategory', () => {
  it('is "one" for exactly 1', () => {
    expect(pluralCategory(1)).toBe('one');
  });

  it.each([0, 2, 3, 11, 100, 1.5, -1])('is "other" for %p', (count) => {
    expect(pluralCategory(count)).toBe('other');
  });

  it('indexes a one/other key pair', () => {
    const keys: PluralI18nKeys = { one: 'x.one', other: 'x.other' };
    expect(keys[pluralCategory(1)]).toBe('x.one');
    expect(keys[pluralCategory(4)]).toBe('x.other');
  });
});
