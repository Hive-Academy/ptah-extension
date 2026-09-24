import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { runCursorApiKeyMigration } from './run-cursor-api-key-migration';

const KEY = 'run-cursor-migration-test-key';
const SETTING = 'provider.cursor.apiKey';

function makeContainer(opts: { setFails?: boolean } = {}) {
  const settings = new Map<string, unknown>([[SETTING, KEY]]);
  const secrets = new Map<string, string>();
  const logger = createMockLogger();
  const c = rootContainer.createChildContainer();
  c.registerInstance(TOKENS.LOGGER, logger);
  c.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    getConfiguration: (_section: string, key: string) => settings.get(key),
    setConfiguration: async (_section: string, key: string, value: unknown) => {
      if (value === undefined) settings.delete(key);
      else settings.set(key, value);
    },
  });
  c.registerInstance(TOKENS.AUTH_SECRETS_SERVICE, {
    hasProviderKey: async (id: string) => secrets.has(id),
    setProviderKey: async (id: string, value: string) => {
      if (opts.setFails) throw new Error(`secret store rejected ${value}`);
      secrets.set(id, value);
    },
  });
  return { c, settings, secrets, logger };
}

/** Every argument of every logger call, flattened to one string. */
function loggedText(logger: ReturnType<typeof createMockLogger>): string {
  return JSON.stringify(
    Object.values(logger).flatMap((fn) =>
      jest.isMockFunction(fn) ? fn.mock.calls : [],
    ),
  );
}

describe('runCursorApiKeyMigration', () => {
  it('moves the plain key into the secrets store and logs the outcome', async () => {
    const h = makeContainer();

    await runCursorApiKeyMigration(h.c);

    expect(h.secrets.get('cursor')).toBe(KEY);
    expect(h.settings.has(SETTING)).toBe(false);
    expect(h.logger.info).toHaveBeenCalledWith(
      '[CursorApiKeyMigration] plain setting migrated',
    );
    expect(loggedText(h.logger)).not.toContain(KEY);
  });

  it('is a no-op on the next start', async () => {
    const h = makeContainer();
    await runCursorApiKeyMigration(h.c);
    h.logger.info.mockClear();

    await runCursorApiKeyMigration(h.c);

    expect(h.secrets.get('cursor')).toBe(KEY);
    expect(h.logger.info).not.toHaveBeenCalled();
  });

  it('keeps the plain key and warns without it when the secret write fails', async () => {
    const h = makeContainer({ setFails: true });

    await expect(runCursorApiKeyMigration(h.c)).resolves.toBeUndefined();

    expect(h.settings.get(SETTING)).toBe(KEY);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(loggedText(h.logger)).not.toContain(KEY);
  });

  it('never throws when the container cannot resolve its dependencies', async () => {
    await expect(
      runCursorApiKeyMigration(rootContainer.createChildContainer()),
    ).resolves.toBeUndefined();
  });
});
