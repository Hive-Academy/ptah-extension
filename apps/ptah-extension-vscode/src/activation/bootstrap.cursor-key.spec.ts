/**
 * TASK_2026_538: a plain-text Cursor key left in ~/.ptah/settings.json by an
 * older build must move into the secrets store at every activation. The step
 * needs the file settings registered, so it has to follow the settings
 * migrations. Read from source: running bootstrapVscode needs a VS Code host.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(join(__dirname, 'bootstrap.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const BODY = SOURCE.slice(
  SOURCE.indexOf('export async function bootstrapVscode('),
);

describe('bootstrapVscode — Cursor key migration', () => {
  it('runs the Cursor key migration right after the settings migrations', () => {
    const migrations = BODY.indexOf('await migrationRunner.runMigrations()');
    const cursor = BODY.indexOf('await runCursorApiKeyMigration(diContainer)');

    expect(migrations).toBeGreaterThan(-1);
    expect(cursor).toBeGreaterThan(migrations);
  });
});
