import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type { IAuthSecretsService, Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { migrateCursorApiKeyToSecrets } from './cursor-api-key-migration';

const KEY = 'cursor-migration-test-key';
const SETTING = 'provider.cursor.apiKey';

function makeHarness(plain: unknown = KEY, secret?: string) {
  const settings = new Map<string, unknown>([[SETTING, plain]]);
  const storedSecrets = new Map<string, string>();
  if (secret !== undefined) storedSecrets.set('cursor', secret);
  const workspace = {
    getConfiguration: jest.fn((_section: string, key: string) =>
      settings.get(key),
    ),
    setConfiguration: jest.fn(
      async (_section: string, key: string, value: unknown) => {
        if (value === undefined) settings.delete(key);
        else settings.set(key, value);
      },
    ),
  };
  const secrets = {
    hasProviderKey: jest.fn(async (id: string) => storedSecrets.has(id)),
    setProviderKey: jest.fn(async (id: string, value: string) => {
      storedSecrets.set(id, value);
    }),
    deleteProviderKey: jest.fn(),
  };
  const logger = createMockLogger();
  const migrate = () =>
    migrateCursorApiKeyToSecrets(
      workspace as unknown as IWorkspaceProvider,
      secrets as unknown as IAuthSecretsService,
      logger as unknown as Logger,
    );
  return { settings, storedSecrets, workspace, secrets, logger, migrate };
}

describe('migrateCursorApiKeyToSecrets', () => {
  it('migrates a trimmed plain key and removes the plain setting after storing', async () => {
    const h = makeHarness(`  ${KEY}  `);
    h.secrets.setProviderKey.mockImplementation(async (id, value) => {
      expect(h.settings.get(SETTING)).toBe(`  ${KEY}  `);
      h.storedSecrets.set(id, value);
    });
    expect(await h.migrate()).toBe('migrated');
    expect(h.secrets.setProviderKey).toHaveBeenCalledWith('cursor', KEY);
    expect(h.workspace.setConfiguration).toHaveBeenCalledWith(
      'ptah',
      SETTING,
      undefined,
    );
    expect(h.settings.has(SETTING)).toBe(false);
    expect(h.storedSecrets.get('cursor')).toBe(KEY);
    expect(h.logger.info).toHaveBeenCalledWith('migrated');
  });

  it('clears the plain setting without overwriting an existing secret', async () => {
    const h = makeHarness(KEY, 'existing-secret');
    expect(await h.migrate()).toBe('cleared');
    expect(h.secrets.setProviderKey).not.toHaveBeenCalled();
    expect(h.secrets.deleteProviderKey).not.toHaveBeenCalled();
    expect(h.storedSecrets.get('cursor')).toBe('existing-secret');
    expect(h.settings.has(SETTING)).toBe(false);
    expect(h.logger.info).toHaveBeenCalledWith('cleared');
  });

  it.each(['', ' \t ', null, 42])(
    'returns none without writes for %p',
    async (plain) => {
      const h = makeHarness(plain);
      expect(await h.migrate()).toBe('none');
      expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
      expect(h.secrets.hasProviderKey).not.toHaveBeenCalled();
      expect(h.secrets.setProviderKey).not.toHaveBeenCalled();
      expect(h.secrets.deleteProviderKey).not.toHaveBeenCalled();
    },
  );

  it('returns none for an absent setting', async () => {
    const h = makeHarness();
    h.settings.delete(SETTING);
    expect(await h.migrate()).toBe('none');
    expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
    expect(h.secrets.hasProviderKey).not.toHaveBeenCalled();
  });

  it.each([undefined, 'existing-secret'])(
    'is idempotent with an initial secret of %p',
    async (secret) => {
      const h = makeHarness(KEY, secret);
      await h.migrate();
      expect(await h.migrate()).toBe('none');
      expect(h.workspace.setConfiguration).toHaveBeenCalledTimes(1);
      expect(h.secrets.hasProviderKey).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the plain setting and rethrows when storing the secret fails', async () => {
    const h = makeHarness();
    const error = new Error(KEY);
    h.secrets.setProviderKey.mockRejectedValue(error);
    await expect(h.migrate()).rejects.toBe(error);
    expect(h.settings.get(SETTING)).toBe(KEY);
    expect(h.workspace.setConfiguration).not.toHaveBeenCalled();
    expect(h.logger.info).not.toHaveBeenCalled();
  });

  it.each([undefined, 'existing-secret'])(
    'logs outcome words only, never the key (existing secret: %p)',
    async (secret) => {
      const h = makeHarness(KEY, secret);
      const outcome = await h.migrate();
      const calls = Object.values(h.logger).flatMap((fn) =>
        jest.isMockFunction(fn) ? fn.mock.calls : [],
      );
      expect(calls).toEqual([[outcome]]);
      expect(JSON.stringify(calls)).not.toContain(KEY);
      expect(JSON.stringify(calls)).not.toContain('existing-secret');
    },
  );
});
