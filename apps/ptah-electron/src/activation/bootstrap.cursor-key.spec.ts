/**
 * TASK_2026_538: a plain-text Cursor key left in ~/.ptah/settings.json by an
 * older build must move into the secrets store at every start. The step needs
 * the file settings registered, so it has to follow the settings migrations.
 * Read from source, like bootstrap.network.spec.ts: running bootstrapElectron
 * needs a real Electron host.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(join(__dirname, 'bootstrap.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const BODY = SOURCE.slice(
  SOURCE.indexOf('export async function bootstrapElectron('),
);

describe('bootstrapElectron — Cursor key migration', () => {
  it('runs the Cursor key migration after settings migrations and their catch', () => {
    const migrations = BODY.indexOf('await migrationRunner.runMigrations()');
    const settingsCatch = BODY.indexOf('catch (settingsError)');
    const cursor = BODY.indexOf('await runCursorApiKeyMigration(container)');

    expect(migrations).toBeGreaterThan(-1);
    expect(cursor).toBeGreaterThan(migrations);
    expect(settingsCatch).toBeGreaterThan(migrations);
    expect(cursor).toBeGreaterThan(settingsCatch);
  });
});
