import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const rebuild = require('../../scripts/rebuild-native.js') as {
  getElectronRebuildEnv: (environment?: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
  resolveBetterSqliteRuntimeAddon: (
    root?: string,
    platform?: NodeJS.Platform,
    arch?: string,
  ) => string;
  promoteRebuiltAddon: (
    root?: string,
    platform?: NodeJS.Platform,
    arch?: string,
  ) => string;
  probeAddonWithElectron: (
    addonPath: string,
    electronVersion: string,
    expectedAbi: number,
  ) => { modules: string; napi: string; value: number; sqlite: string };
};

const packedVerifier = require('../../scripts/verify-packed-native.js') as {
  resolveBetterSqliteRuntimeAddon: (
    root?: string,
    platform?: NodeJS.Platform,
    arch?: string,
  ) => string;
  findPackedFiles: (dir: string, suffix: string, found: string[]) => void;
};

describe('better-sqlite3 native packaging', () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'ptah-better-sqlite3-'));
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('forces binding.gyp to compile even when a v13 platform prebuild exists', () => {
    expect(rebuild.getElectronRebuildEnv({ KEEP_ME: 'yes' })).toEqual(
      expect.objectContaining({
        KEEP_ME: 'yes',
        npm_config_force_build: '1',
      }),
    );
  });

  it('promotes the source build to the v13 loader-selected prebuild path', () => {
    const packageRoot = join(fixtureRoot, 'node_modules', 'better-sqlite3');
    const builtAddon = join(
      packageRoot,
      'build',
      'Release',
      'better_sqlite3.node',
    );
    const runtimeAddon = join(packageRoot, 'prebuilds', 'win32-x64.node');
    mkdirSync(dirname(builtAddon), { recursive: true });
    mkdirSync(dirname(runtimeAddon), { recursive: true });
    writeFileSync(builtAddon, 'electron-source-build');
    writeFileSync(runtimeAddon, 'npm-platform-prebuild');

    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(
      rebuild.resolveBetterSqliteRuntimeAddon(fixtureRoot, 'win32', 'x64'),
    ).toBe(runtimeAddon);
    expect(rebuild.promoteRebuiltAddon(fixtureRoot, 'win32', 'x64')).toBe(
      runtimeAddon,
    );
    expect(readFileSync(runtimeAddon, 'utf8')).toBe('electron-source-build');
    expect(
      packedVerifier.resolveBetterSqliteRuntimeAddon(
        fixtureRoot,
        'win32',
        'x64',
      ),
    ).toBe(runtimeAddon);
    log.mockRestore();
  });

  it('finds the packed v13 runtime prebuild inside app.asar.unpacked', () => {
    const packedAddon = join(
      fixtureRoot,
      'win-unpacked',
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
      'prebuilds',
      'win32-x64.node',
    );
    mkdirSync(dirname(packedAddon), { recursive: true });
    writeFileSync(packedAddon, 'native-binary');

    const found: string[] = [];
    packedVerifier.findPackedFiles(
      fixtureRoot,
      join('better-sqlite3', 'prebuilds', 'win32-x64.node'),
      found,
    );
    expect(found).toEqual([packedAddon]);
  });

  it('loads the selected runtime binary and executes SQLite under Electron 44', () => {
    const workspaceRoot = join(__dirname, '..', '..', '..', '..');
    const electronVersion = JSON.parse(
      readFileSync(
        join(workspaceRoot, 'node_modules', 'electron', 'package.json'),
        'utf8',
      ),
    ).version as string;
    expect(electronVersion.split('.')[0]).toBe('44');
    const addon = rebuild.resolveBetterSqliteRuntimeAddon(workspaceRoot);

    expect(rebuild.probeAddonWithElectron(addon, electronVersion, 149)).toEqual(
      expect.objectContaining({
        modules: '149',
        value: 42,
      }),
    );
  }, 30_000);
});
