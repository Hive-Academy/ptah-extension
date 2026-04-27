import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '../di/tokens';
import { registerVscodeCoreMocks } from './tokens-guard';

describe('registerVscodeCoreMocks', () => {
  afterEach(() => {
    container.clearInstances();
    container.reset();
  });

  it('registers all vscode-core mocks at their real DI tokens', () => {
    const mocks = registerVscodeCoreMocks(container);

    expect(container.resolve(TOKENS.LOGGER)).toBe(mocks.logger);
    expect(container.resolve(TOKENS.CONFIG_MANAGER)).toBe(mocks.configManager);
    expect(container.resolve(TOKENS.AUTH_SECRETS_SERVICE)).toBe(
      mocks.authSecrets,
    );
    expect(container.resolve(TOKENS.SENTRY_SERVICE)).toBe(mocks.sentry);
    expect(container.resolve(TOKENS.RPC_HANDLER)).toBe(mocks.rpcHandler);
  });

  it('passes through overrides for seeded behavior', async () => {
    const mocks = registerVscodeCoreMocks(container, {
      configManagerOverrides: { values: { 'ptah.apiKey': 'sk-guard' } },
      authSecretsOverrides: { credentials: { apiKey: 'sk-seed' } },
      sentryOverrides: { initialized: true },
    });

    expect(mocks.configManager.get<string>('ptah.apiKey')).toBe('sk-guard');
    await expect(mocks.authSecrets.getCredential('apiKey')).resolves.toBe(
      'sk-seed',
    );
    expect(mocks.sentry.isInitialized()).toBe(true);
  });
});
