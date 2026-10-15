import { matchesAuthFailure } from './lane-auth-classifier';

describe('matchesAuthFailure', () => {
  it.each([
    'HTTP 401',
    'UNAUTHORIZED',
    'unauthorised',
    'not logged in',
    'invalid API key',
    'Authentication failed',
    'authentication required',
    'please run codex login',
  ])('matches %s', (text) => {
    expect(matchesAuthFailure([text])).toBe(true);
  });
  it.each([
    'HTTP 403',
    'quota exceeded',
    'login succeeded',
    'authentication complete',
    '4012',
  ])('rejects %s', (text) => {
    expect(matchesAuthFailure([text])).toBe(false);
  });
});
