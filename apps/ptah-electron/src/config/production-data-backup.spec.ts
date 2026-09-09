import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createBackup } =
  require('../../scripts/backup-local-production-data.js') as {
    createBackup: (options: {
      destination: string;
      sources: Array<{ label: string; path: string }>;
      checkClosed: () => void;
    }) => { files: Record<string, string> };
  };

describe('production data backup', () => {
  it('copies profile, settings, database and WAL together while excluding caches/backups', () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-backup-test-'));
    const profile = join(root, 'profile');
    const ptahHome = join(root, 'ptah-home');
    mkdirSync(join(profile, 'Cache'), { recursive: true });
    mkdirSync(join(ptahHome, 'models'), { recursive: true });
    mkdirSync(join(ptahHome, 'backups'), { recursive: true });
    writeFileSync(join(profile, 'Local State'), 'account');
    writeFileSync(join(profile, 'Cache', 'cache.bin'), 'skip');
    writeFileSync(join(ptahHome, 'settings.json'), '{"theme":"dark"}');
    writeFileSync(join(ptahHome, 'ptah.db'), 'db');
    writeFileSync(join(ptahHome, 'ptah.db-wal'), 'wal');
    writeFileSync(join(ptahHome, 'ptah.db-shm'), 'shm');
    writeFileSync(join(ptahHome, 'models', 'model.bin'), 'skip');
    const destination = join(root, 'backup-result');

    const manifest = createBackup({
      destination,
      sources: [
        { label: 'electron-user-data', path: profile },
        { label: 'ptah-home', path: ptahHome },
      ],
      checkClosed: () => undefined,
    });

    expect(
      readFileSync(join(destination, 'ptah-home', 'ptah.db-wal'), 'utf8'),
    ).toBe('wal');
    expect(existsSync(join(destination, 'electron-user-data', 'Cache'))).toBe(
      false,
    );
    expect(existsSync(join(destination, 'ptah-home', 'models'))).toBe(false);
    expect(existsSync(join(destination, 'ptah-home', 'backups'))).toBe(false);
    expect(Object.keys(manifest.files)).toEqual(
      expect.arrayContaining([
        'ptah-home/ptah.db',
        'ptah-home/ptah.db-wal',
        'ptah-home/ptah.db-shm',
      ]),
    );
  });

  it('refuses a destination inside production data before copying', () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-backup-test-'));
    const profile = join(root, 'profile');
    mkdirSync(profile);
    writeFileSync(join(profile, 'state.json'), '{}');
    const destination = join(profile, 'backups', 'bad');

    expect(() =>
      createBackup({
        destination,
        sources: [{ label: 'electron-user-data', path: profile }],
        checkClosed: () => undefined,
      }),
    ).toThrow('must not be inside');
    expect(existsSync(destination)).toBe(false);
  });

  it('resolves an existing symlink when checking for recursive destinations', () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-backup-test-'));
    const profile = join(root, 'profile');
    const alias = join(root, 'profile-alias');
    mkdirSync(profile);
    writeFileSync(join(profile, 'state.json'), '{}');
    symlinkSync(profile, alias, 'junction');

    expect(() =>
      createBackup({
        destination: join(alias, 'nested-backup'),
        sources: [{ label: 'electron-user-data', path: profile }],
        checkClosed: () => undefined,
      }),
    ).toThrow('must not be inside');
  });

  it('refuses a symbolic source root', () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-backup-test-'));
    const profile = join(root, 'profile');
    const alias = join(root, 'profile-alias');
    mkdirSync(profile);
    symlinkSync(profile, alias, 'junction');

    expect(() =>
      createBackup({
        destination: join(root, 'backup'),
        sources: [{ label: 'electron-user-data', path: alias }],
        checkClosed: () => undefined,
      }),
    ).toThrow('Refusing symbolic source root');
  });

  it('refuses the backup when the app-closed check fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-backup-test-'));
    const profile = join(root, 'profile');
    mkdirSync(profile);

    expect(() =>
      createBackup({
        destination: join(root, 'backup'),
        sources: [{ label: 'electron-user-data', path: profile }],
        checkClosed: () => {
          throw new Error('Ptah is running');
        },
      }),
    ).toThrow('Ptah is running');
    expect(existsSync(join(root, 'backup'))).toBe(false);
  });
});
