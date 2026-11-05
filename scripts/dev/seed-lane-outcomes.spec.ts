import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The dev scripts resolve the Ptah profile from HOME, then os.homedir().
 * A preload replaces os.homedir() so the test controls both sources without
 * touching the real account home. No database is opened: every case refuses
 * before that step.
 */
const SCRIPTS = resolve(__dirname);
const SEED = join(SCRIPTS, 'seed-lane-outcomes.mjs');
const CHECK = join(SCRIPTS, 'check-past-outcomes-live.mjs');

let dir: string;
let preload: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ptah-seed-home-'));
  preload = join(dir, 'homedir-preload.cjs');
  writeFileSync(
    preload,
    "require('node:os').homedir = () => process.env.TEST_HOMEDIR || '';\n",
  );
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(script: string, args: string[], homedir: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, TEST_HOMEDIR: homedir };
  delete env['HOME'];
  return spawnSync(process.execPath, ['--require', preload, script, ...args], {
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('dev lane-outcome scripts without HOME', () => {
  it('falls back to os.homedir() and still refuses the profile database', () => {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.ptah'), { recursive: true });
    const db = join(home, '.ptah', 'lanes.sqlite');
    const result = run(SEED, ['--db', db], home);
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe(`Refusing Ptah profile path: ${db}`);
  });

  it.each([
    ['seed', SEED],
    ['checker', CHECK],
  ])(
    '%s refuses with one line and exit 2 when no home is available',
    (_name, script) => {
      const result = run(script, ['--db', join(dir, 'x.sqlite')], '');
      expect(result.status).toBe(2);
      expect(result.stderr.trim()).toBe(
        'Refusing to run: HOME is unset and os.homedir() is unavailable',
      );
    },
  );

  it('checker refuses the profile database with exit 2 and no stack', () => {
    const home = join(dir, 'home');
    mkdirSync(join(home, '.ptah'), { recursive: true });
    const db = join(home, '.ptah', 'lanes.sqlite');
    const result = run(CHECK, ['--db', db], home);
    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe(`Refusing Ptah profile path: ${db}`);
  });
});
