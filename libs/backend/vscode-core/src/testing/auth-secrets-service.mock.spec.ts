import 'reflect-metadata';
import { createMockAuthSecretsService } from './auth-secrets-service.mock';

describe('createMockAuthSecretsService', () => {
  it('seeds credentials and honors set/delete via in-memory Map', async () => {
    const mock = createMockAuthSecretsService({
      credentials: { apiKey: 'sk-seed' },
      providerKeys: { openrouter: 'or-seed' },
    });

    await expect(mock.getCredential('apiKey')).resolves.toBe('sk-seed');
    await expect(mock.hasCredential('apiKey')).resolves.toBe(true);

    await mock.setCredential('apiKey', '   '); // empty-ish -> deletes
    await expect(mock.hasCredential('apiKey')).resolves.toBe(false);

    await expect(mock.getProviderKey('openrouter')).resolves.toBe('or-seed');
    await mock.deleteProviderKey('openrouter');
    await expect(mock.hasProviderKey('openrouter')).resolves.toBe(false);

    expect(mock.setCredential).toHaveBeenCalledWith('apiKey', '   ');
  });
});
