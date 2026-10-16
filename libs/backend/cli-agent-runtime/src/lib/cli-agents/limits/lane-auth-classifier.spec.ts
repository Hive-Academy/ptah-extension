import { matchesAuthFailure } from './lane-auth-classifier';

describe('matchesAuthFailure', () => {
  it.each([
    'HTTP 401',
    'Error: 401 Unauthorized',
    '{"status":401}',
    'Error: UNAUTHORIZED',
    'Status: unauthorised',
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
    'file.ts:401:15',
    'line 4012',
    'the user is unauthorized to access this resource',
  ])('rejects %s', (text) => {
    expect(matchesAuthFailure([text])).toBe(false);
  });
});
