/**
 * TASK_2026_538: a plain-text Cursor key left in ~/.ptah/settings.json by an
 * older build must move into the secrets store at every start. The step needs
 * the file settings registered, so it has to follow the settings migrations.
 * Read from source, like bootstrap.network.spec.ts: running bootstrapElectron
 * needs a real Electron host.
 */
import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { container as rootContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  SettingsPersistError,
} from '@ptah-extension/platform-core';
import { runCursorApiKeyMigration } from '@ptah-extension/rpc-handlers';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { TOKENS } from '@ptah-extension/vscode-core';

const LEGACY_KEY = 'electron-553-plain-cursor-key';

/**
 * The container bootstrapElectron hands to runCursorApiKeyMigration, with a
 * workspace provider whose file-settings write rejects the way
 * PtahFileSettingsManager.set() does when settings.json cannot be written.
 */
function makeRejectingContainer() {
  const logger = createMockLogger();
  const setConfiguration = jest.fn(async () => {
    throw new SettingsPersistError('EACCES');
  });
  const container = rootContainer.createChildContainer();
  container.registerInstance(TOKENS.LOGGER, logger);
  container.registerInstance(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    getConfiguration: (_section: string, key: string) =>
      key === 'provider.cursor.apiKey' ? LEGACY_KEY : undefined,
    setConfiguration,
  });
  container.registerInstance(TOKENS.AUTH_SECRETS_SERVICE, {
    hasProviderKey: async () => false,
    setProviderKey: async () => undefined,
  });
  return { container, logger, setConfiguration };
}

/** Every argument of every logger call, flattened to one string. */
function loggedText(logger: ReturnType<typeof createMockLogger>): string {
  return JSON.stringify(
    Object.values(logger).flatMap((fn) =>
      jest.isMockFunction(fn) ? fn.mock.calls : [],
    ),
  );
}

const SOURCE = readFileSync(join(__dirname, 'bootstrap.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const BODY = SOURCE.slice(
  SOURCE.indexOf('export async function bootstrapElectron('),
);

function findCatchEnd(source: string, catchIndex: number): number {
  if (catchIndex < 0) return -1;
  const openingBrace = source.indexOf('{', catchIndex);
  if (openingBrace < 0) return -1;

  let depth = 0;
  for (let index = openingBrace; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

describe('bootstrapElectron — Cursor key migration', () => {
  it('runs the Cursor key migration after settings migrations and their catch', () => {
    const migrations = BODY.indexOf('await migrationRunner.runMigrations()');
    const settingsCatch = BODY.indexOf('catch (settingsError)');
    const settingsCatchEnd = findCatchEnd(BODY, settingsCatch);
    const cursor = BODY.indexOf('await runCursorApiKeyMigration(container)');

    expect(migrations).toBeGreaterThan(-1);
    expect(cursor).toBeGreaterThan(migrations);
    expect(settingsCatch).toBeGreaterThan(migrations);
    expect(cursor).toBeGreaterThan(settingsCatch);
    expect(settingsCatchEnd).toBeGreaterThan(settingsCatch);
    expect(cursor).toBeGreaterThan(settingsCatchEnd);
  });

  describe('startup survives a rejecting settings write (TASK_2026_553)', () => {
    it('the settings catch around runMigrations() logs and never rethrows', () => {
      const settingsCatch = BODY.indexOf('catch (settingsError)');
      const catchBody = BODY.slice(settingsCatch, findCatchEnd(BODY, settingsCatch));
      const tryStart = BODY.lastIndexOf(
        'try {',
        BODY.indexOf('await migrationRunner.runMigrations()'),
      );

      expect(tryStart).toBeGreaterThan(-1);
      expect(tryStart).toBeLessThan(settingsCatch);
      expect(catchBody).toContain('console.warn(');
      expect(catchBody).not.toMatch(/\bthrow\b/);
    });

    it('the Cursor key step resolves and warns without the key when setConfiguration rejects', async () => {
      const h = makeRejectingContainer();

      await expect(runCursorApiKeyMigration(h.container)).resolves.toBeUndefined();

      expect(h.setConfiguration).toHaveBeenCalledWith(
        'ptah',
        'provider.cursor.apiKey',
        undefined,
      );
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[CursorApiKeyMigration] failed; the plain setting is kept and retried next start',
        { errorType: 'SettingsPersistError' },
      );
      expect(loggedText(h.logger)).not.toContain(LEGACY_KEY);
    });
  });

  it('rejects a migration call inside the settings catch body', () => {
    const source = `try {} catch (settingsError) {
      if (settingsError) {}
      await runCursorApiKeyMigration(container);
    }`;
    const settingsCatch = source.indexOf('catch (settingsError)');
    const settingsCatchEnd = findCatchEnd(source, settingsCatch);
    const cursor = source.indexOf('await runCursorApiKeyMigration(container)');

    expect(settingsCatchEnd).toBe(source.lastIndexOf('}'));
    expect(cursor > settingsCatchEnd).toBe(false);
  });
});
