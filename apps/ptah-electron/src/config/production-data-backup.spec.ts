import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { resolveWindowsSystemExecutable } =
  require('../../scripts/windows-system-executable.js') as {
    resolveWindowsSystemExecutable: (relativePath: string) => string;
  };

const { assertPtahClosed, createBackup, findPotentialWriters } =
  require('../../scripts/backup-local-production-data.js') as {
    assertPtahClosed: (
      sources: Array<{ label: string; path: string }>,
      run: (
        file: string,
        args: string[],
        options: { env: NodeJS.ProcessEnv },
      ) => string,
      resolveExecutable: (relativePath: string) => string,
      platform: NodeJS.Platform,
    ) => void;
    createBackup: (options: {
      destination: string;
      sources: Array<{ label: string; path: string }>;
      checkClosed: () => void;
    }) => { files: Record<string, string> };
    findPotentialWriters: (
      processes: Array<{
        ProcessId: number;
        Name: string;
        ExecutablePath: string | null;
        CommandLine: string | null;
      }>,
    ) => Array<{ ProcessId: number; Name: string }>;
  };

const processRecord = (
  Name: string,
  CommandLine: string | null,
  ProcessId = 42,
) => ({ ProcessId, Name, ExecutablePath: null, CommandLine });

describe('production data backup', () => {
  const windowsIt = process.platform === 'win32' ? it : it.skip;

  windowsIt.each([0, 1, 3])(
    'opens %i database files individually with real Windows PowerShell 5.1',
    (count) => {
      const root = mkdtempSync(join(tmpdir(), 'ptah-backup-ps51-'));
      try {
        for (const name of ['ptah.db', 'ptah.db-wal', 'ptah.db-shm'].slice(
          0,
          count,
        )) {
          writeFileSync(join(root, name), 'fixture');
        }
        expect(() =>
          assertPtahClosed(
            [{ label: 'ptah-home', path: root }],
            runWindowsInspection,
            resolveWindowsSystemExecutable,
            'win32',
          ),
        ).not.toThrow();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  windowsIt(
    'detects a real exclusive file lock with Windows PowerShell 5.1',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'ptah-backup-ps51-'));
      const database = join(root, 'ptah.db');
      const wal = join(root, 'ptah.db-wal');
      writeFileSync(database, 'fixture');
      writeFileSync(wal, 'fixture');
      try {
        expect(() =>
          assertPtahClosed(
            [{ label: 'ptah-home', path: root }],
            (file, args, options) =>
              runWindowsInspection(file, args, {
                env: { ...options.env, PTAH_TEST_LOCK_PATH: wal },
              }),
            resolveWindowsSystemExecutable,
            'win32',
          ),
        ).toThrow(
          `Ptah database files are locked; close every process using Ptah data: ${wal}`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

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

  it.each([
    [
      'Electron',
      processRecord('Ptah.exe', '"C:\\Program Files\\Ptah\\Ptah.exe"'),
    ],
    [
      'installed CLI',
      processRecord(
        'node.exe',
        'node "C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@hive-academy\\ptah-cli\\main.mjs" session',
      ),
    ],
    [
      'workspace TUI',
      processRecord('node.exe', 'node D:\\repo\\dist\\apps\\ptah-tui\\tui.mjs'),
    ],
    [
      'workspace TUI source',
      processRecord('node.exe', 'node D:\\repo\\apps\\ptah-tui\\src\\main.tsx'),
    ],
    ['VS Code host', processRecord('Code.exe', 'Code.exe --type=utility')],
  ])('identifies the %s host as a potential writer', (_label, record) => {
    expect(findPotentialWriters([record])).toEqual([record]);
  });

  it('refuses unavailable Node command lines and malformed process records', () => {
    expect(() =>
      findPotentialWriters([processRecord('node.exe', null)]),
    ).toThrow('Cannot verify whether Node process');
    expect(() =>
      findPotentialWriters([
        {
          ...processRecord('node.exe', 'node harmless.js'),
          ProcessId: 'not-a-pid',
        } as never,
      ]),
    ).toThrow('malformed data');
  });

  it('uses an absolute system PowerShell path and accepts a healthy offline fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-backup-test-'));
    const state = join(root, 'state');
    mkdirSync(state);
    const database = join(state, 'ptah.sqlite');
    writeFileSync(database, 'fixture');
    const resolveExecutable = jest.fn(
      () => 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
    const run = jest.fn(
      (_file: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
        const databasePathsJson = options.env['PTAH_BACKUP_DB_PATHS_JSON'];
        expect(databasePathsJson).toBeDefined();
        expect(JSON.parse(databasePathsJson ?? '')).toEqual([database]);
        return JSON.stringify({
          Processes: [processRecord('node.exe', 'node harmless.js')],
          LockedDatabaseFiles: [],
        });
      },
    );

    expect(() =>
      assertPtahClosed(
        [{ label: 'ptah-home', path: root }],
        run,
        resolveExecutable,
        'win32',
      ),
    ).not.toThrow();
    expect(run).toHaveBeenCalledWith(
      expect.stringMatching(/^C:\\Windows\\System32\\/),
      expect.any(Array),
      expect.any(Object),
    );
    expect(resolveExecutable).toHaveBeenCalledWith(
      'System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    );
  });

  it('fails closed when inspection fails, is malformed, or finds a database lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'ptah-backup-test-'));
    const source = [{ label: 'ptah-home', path: root }];
    const executable = () =>
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

    expect(() =>
      assertPtahClosed(
        source,
        () => {
          throw new Error('CIM unavailable');
        },
        executable,
        'win32',
      ),
    ).toThrow('Could not verify that Ptah data is offline');
    expect(() =>
      assertPtahClosed(source, () => '{bad json', executable, 'win32'),
    ).toThrow('Could not verify that Ptah data is offline');
    expect(() =>
      assertPtahClosed(
        source,
        () => JSON.stringify({ Processes: {}, LockedDatabaseFiles: [] }),
        executable,
        'win32',
      ),
    ).toThrow('malformed data');
    expect(() =>
      assertPtahClosed(
        source,
        () =>
          JSON.stringify({
            Processes: [],
            LockedDatabaseFiles: ['C:\\Users\\me\\.ptah\\state\\ptah.sqlite'],
          }),
        executable,
        'win32',
      ),
    ).toThrow('database files are locked');
  });
});

// Execute the production inspection script, substituting only the ambient
// process inventory so developer applications cannot affect this fixture.
function runWindowsInspection(
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv },
): string {
  const prelude = [
    "if($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1){throw 'Expected Windows PowerShell 5.1'}",
    "function Get-CimInstance { [pscustomobject]@{ProcessId=42;Name='fixture.exe';ExecutablePath=$null;CommandLine='fixture'} }",
    'if($env:PTAH_TEST_LOCK_PATH){$testHandle=[IO.File]::Open($env:PTAH_TEST_LOCK_PATH,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}',
  ].join(';');
  return execFileSync(
    file,
    [...args.slice(0, -1), `${prelude};${args[args.length - 1]}`],
    {
      ...options,
      encoding: 'utf8',
      windowsHide: true,
    },
  );
}
