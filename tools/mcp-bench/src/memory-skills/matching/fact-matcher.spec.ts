import { matchesFact, normalizeFactText } from './fact-matcher';

const fact = {
  keyTokens: [['demo', 'example'], ['port', 'endpoint'], ['4173']],
  forbiddenTokens: ['staging'],
};

describe('fact matcher', () => {
  it('matches alternate required tokens across subject, content, and chunk', () => {
    expect(
      matchesFact(fact, {
        subject: 'Demo service',
        content: 'uses its endpoint',
        chunk: 'Port 4173 is public.',
      }),
    ).toBe(true);
  });

  it('lets a forbidden token block an otherwise complete match', () => {
    expect(
      matchesFact(fact, {
        subject: 'Demo port',
        content: '4173',
        chunk: 'not staging',
      }),
    ).toBe(false);
  });

  it('normalises Unicode, casing, whitespace, and missing fields', () => {
    expect(normalizeFactText('  CAFÉ\u212B\nPORT  ')).toBe('caféå port');
    expect(
      matchesFact(
        { keyTokens: [['caféå'], ['port']], forbiddenTokens: [] },
        { content: 'CAFÉÅ\t PORT', subject: null },
      ),
    ).toBe(true);
  });

  it('uses word boundaries for alphanumeric tokens and rejects empty keys', () => {
    expect(
      matchesFact(
        { keyTokens: [['api']], forbiddenTokens: [] },
        { content: 'capital city' },
      ),
    ).toBe(false);
    expect(
      matchesFact(
        { keyTokens: [['version']], forbiddenTokens: ['v1'] },
        { content: 'version v10' },
      ),
    ).toBe(true);
    expect(
      matchesFact(
        { keyTokens: [], forbiddenTokens: [] },
        { content: 'anything' },
      ),
    ).toBe(false);
  });
});
