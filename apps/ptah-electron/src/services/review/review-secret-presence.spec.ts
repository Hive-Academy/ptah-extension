import { ReviewSecretPresence } from './review-secret-presence';
import { REVIEW_GITHUB_TOKEN_KEY } from '@ptah-extension/review-github';

describe('ReviewSecretPresence', () => {
  it('returns only whether the configured GitHub credential exists', async () => {
    const secret = 'github_pat_very_private_value';
    const get = jest.fn(async () => secret);
    const presence = new ReviewSecretPresence({ get });

    await expect(presence.hasToken()).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith(REVIEW_GITHUB_TOKEN_KEY);
    await expect(new ReviewSecretPresence({ get: async () => '  ' }).hasToken()).resolves.toBe(false);
    await expect(new ReviewSecretPresence({ get: async () => undefined }).hasToken()).resolves.toBe(false);
  });
});
