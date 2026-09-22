import 'reflect-metadata';
import { SdkError } from '@ptah-extension/agent-sdk';
import { createMockAuthSecretsService } from '@ptah-extension/vscode-core/testing';
import { OpenCodeAuthService } from './opencode-auth.service';

describe('OpenCodeAuthService', () => {
  it.each(['opencode-zen', 'opencode-go'] as const)(
    '%s trims its own key and constructs Bearer headers',
    async (id) => {
      const secrets = createMockAuthSecretsService({
        providerKeys: { [id]: '  own-key  ' },
      });
      const auth = new OpenCodeAuthService(id, secrets);
      expect(await auth.isAuthenticated()).toBe(true);
      expect(await auth.getApiKey()).toBe('own-key');
      expect(await auth.getHeaders()).toEqual({
        Authorization: 'Bearer own-key',
        'Content-Type': 'application/json',
      });
      expect(secrets.getProviderKey).toHaveBeenCalledWith(id);
    },
  );

  it.each(['opencode-zen', 'opencode-go'] as const)(
    '%s never authenticates with the other subscription key',
    async (id) => {
      const other = id === 'opencode-zen' ? 'opencode-go' : 'opencode-zen';
      const secrets = createMockAuthSecretsService({
        providerKeys: { [other]: 'other-secret' },
      });
      const auth = new OpenCodeAuthService(id, secrets);
      expect(await auth.isAuthenticated()).toBe(false);
      expect(await auth.getApiKey()).toBeNull();
      await expect(auth.getHeaders()).rejects.toBeInstanceOf(SdkError);
      await expect(auth.getHeaders()).rejects.toThrow(
        'API key configured. Add one in Settings.',
      );
      expect(secrets.getProviderKey).not.toHaveBeenCalledWith(other);
    },
  );

  it('reads key rotation per request and normalizes blank keys to missing', async () => {
    const secrets = createMockAuthSecretsService();
    const auth = new OpenCodeAuthService('opencode-zen', secrets);
    secrets.getProviderKey.mockResolvedValue('  \n\t ');
    expect(await auth.getApiKey()).toBeNull();
    secrets.getProviderKey.mockResolvedValue('rotated');
    expect((await auth.getHeaders()).Authorization).toBe('Bearer rotated');
  });
});
