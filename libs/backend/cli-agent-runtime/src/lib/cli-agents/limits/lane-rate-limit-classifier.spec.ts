import {
  matchesApiRateLimit,
  PTAH_API_RATE_LIMIT_SEGMENT,
} from './lane-rate-limit-classifier';

describe('matchesApiRateLimit', () => {
  it('exports the fixed ptah-cli marker', () => {
    expect(PTAH_API_RATE_LIMIT_SEGMENT).toBe('API rate limit (HTTP 429)');
  });

  it.each([
    'API Error: Request rejected (429) · Kimi Code API rate limit exceeded.',
    'API Error: Request rejected (429)',
    'API Error: 429 {"type":"rate_limit_error"}',
    '429 Kimi Code API rate limit',
    'rate limited (429)',
    'Rate-limit exceeded (429)',
    'HTTP 429: Too Many Requests',
    PTAH_API_RATE_LIMIT_SEGMENT,
  ])('matches %s', (text) => {
    expect(matchesApiRateLimit([text])).toBe(true);
  });

  it.each([
    '429',
    'rate limit',
    'rate',
    'HTTP 4290',
    'Request rejected (429)',
    'MODEL_CAPACITY_EXHAUSTED',
    'wrote D:/logs/429/build-output.txt',
    'rate limit reached\nHTTP 429',
    'usage limit reached ∙ resets 2am',
  ])('rejects %s', (text) => {
    expect(matchesApiRateLimit([text])).toBe(false);
  });

  it('matches a wording inside the cap of an oversized text', () => {
    const text = `API Error: Request rejected (429) ${'x'.repeat(8192)}`;
    expect(matchesApiRateLimit([text])).toBe(true);
  });

  it('stops reading a text at the cap', () => {
    const text = `${'x'.repeat(8192)} API Error: Request rejected (429)`;
    expect(matchesApiRateLimit([text])).toBe(false);
  });

  it('matches one wording among several texts', () => {
    const texts = ['wrote report.md', '', '429 Kimi Code API rate limit'];
    expect(matchesApiRateLimit(texts)).toBe(true);
  });

  it('rejects an empty text list', () => {
    expect(matchesApiRateLimit([])).toBe(false);
  });
});