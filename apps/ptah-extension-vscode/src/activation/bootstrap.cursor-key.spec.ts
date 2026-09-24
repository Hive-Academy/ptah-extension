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

describe('bootstrapVscode — Cursor key migration', () => {
  it('runs the Cursor key migration after settings migrations and their catch', () => {
    const migrations = BODY.indexOf('await migrationRunner.runMigrations()');
    const settingsCatch = BODY.indexOf('catch (settingsError)');
    const settingsCatchEnd = findCatchEnd(BODY, settingsCatch);
    const cursor = BODY.indexOf('await runCursorApiKeyMigration(diContainer)');

    expect(migrations).toBeGreaterThan(-1);
    expect(cursor).toBeGreaterThan(migrations);
    expect(settingsCatch).toBeGreaterThan(migrations);
    expect(cursor).toBeGreaterThan(settingsCatch);
    expect(settingsCatchEnd).toBeGreaterThan(settingsCatch);
    expect(cursor).toBeGreaterThan(settingsCatchEnd);
  });

  it('rejects a migration call inside the settings catch body', () => {
    const source = `try {} catch (settingsError) {
      if (settingsError) {}
      await runCursorApiKeyMigration(diContainer);
    }`;
    const settingsCatch = source.indexOf('catch (settingsError)');
    const settingsCatchEnd = findCatchEnd(source, settingsCatch);
    const cursor = source.indexOf('await runCursorApiKeyMigration(diContainer)');

    expect(settingsCatchEnd).toBe(source.lastIndexOf('}'));
    expect(cursor > settingsCatchEnd).toBe(false);
  });
});
