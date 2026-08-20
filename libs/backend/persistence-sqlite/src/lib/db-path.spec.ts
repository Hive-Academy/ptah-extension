import * as os from 'node:os';
import * as path from 'node:path';

import { resolvePtahDbPath, resolvePtahDbProfile } from './db-path';

/**
 * The regression these pin (TASK_2026_291): the profile used to be
 * `NODE_ENV === 'development'` and nothing else, so `NODE_ENV=test` — the e2e
 * launcher's default, and Jest's — resolved to the production database. A
 * working-tree build opened `~/.ptah/state/ptah.sqlite`, applied its newer
 * migrations, and the installed build could no longer open its own data.
 */
describe('resolvePtahDbPath', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  const originalOverride = process.env['PTAH_DB_PATH'];

  const stateFile = (name: string): string =>
    path.join(os.homedir(), '.ptah', 'state', name);

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
    if (originalOverride === undefined) delete process.env['PTAH_DB_PATH'];
    else process.env['PTAH_DB_PATH'] = originalOverride;
  });

  it('keeps an unset NODE_ENV on production — packaged builds run that way', () => {
    delete process.env['NODE_ENV'];
    delete process.env['PTAH_DB_PATH'];

    expect(resolvePtahDbProfile()).toBe('production');
    expect(resolvePtahDbPath()).toBe(stateFile('ptah.sqlite'));
  });

  it('gives NODE_ENV=test its own file, never production', () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['PTAH_DB_PATH'];

    expect(resolvePtahDbProfile()).toBe('test');
    expect(resolvePtahDbPath()).toBe(stateFile('ptah-test.sqlite'));
  });

  it('gives NODE_ENV=development its own file, never the test one', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['PTAH_DB_PATH'];

    expect(resolvePtahDbProfile()).toBe('development');
    expect(resolvePtahDbPath()).toBe(stateFile('ptah-dev.sqlite'));
  });

  it('treats an unrecognised NODE_ENV as production', () => {
    process.env['NODE_ENV'] = 'staging';
    delete process.env['PTAH_DB_PATH'];

    expect(resolvePtahDbPath()).toBe(stateFile('ptah.sqlite'));
  });

  it('honours an explicit isDev over NODE_ENV', () => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['PTAH_DB_PATH'];

    expect(resolvePtahDbPath({ isDev: true })).toBe(
      stateFile('ptah-dev.sqlite'),
    );
    expect(resolvePtahDbPath({ isDev: false })).toBe(stateFile('ptah.sqlite'));
  });

  it('lets PTAH_DB_PATH win over every profile, including explicit isDev', () => {
    process.env['NODE_ENV'] = 'production';
    const target = path.join(os.tmpdir(), 'ptah-e2e-db', 'run.sqlite');
    process.env['PTAH_DB_PATH'] = target;

    expect(resolvePtahDbPath()).toBe(path.resolve(target));
    expect(resolvePtahDbPath({ isDev: false })).toBe(path.resolve(target));
  });

  it('ignores a blank PTAH_DB_PATH rather than resolving it to cwd', () => {
    delete process.env['NODE_ENV'];
    process.env['PTAH_DB_PATH'] = '   ';

    expect(resolvePtahDbPath()).toBe(stateFile('ptah.sqlite'));
  });
});
