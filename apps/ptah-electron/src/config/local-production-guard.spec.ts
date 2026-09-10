import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { readCleanGitSha, sanitizedEnvironment, validateBaseConfig } =
  require('../../scripts/package-local-production.js') as {
    readCleanGitSha: (
      run: (file: string, args: string[]) => string,
      root: string,
    ) => string;
    sanitizedEnvironment: (
      source: NodeJS.ProcessEnv,
      sha: string,
    ) => Record<string, string>;
    validateBaseConfig: (config: string) => void;
  };
const { assertUnsignedStatuses, inspectSignatures } =
  require('../../scripts/verify-local-production-unsigned.js') as {
    assertUnsignedStatuses: (
      records: Array<{ Path: string; Status: string }>,
      paths: string[],
      options?: { unpackedRoot: string; sourceNodeModules: string },
    ) => void;
    inspectSignatures: (
      paths: string[],
      run?: (
        file: string,
        args: string[],
        options: { env: NodeJS.ProcessEnv },
      ) => string,
      environment?: NodeJS.ProcessEnv,
    ) => Array<{ Path: string; Status: string }>;
  };
const { resolveWindowsSystemExecutable } =
  require('../../scripts/windows-system-executable.js') as {
    resolveWindowsSystemExecutable: (
      relativePath: string,
      options?: {
        platform: NodeJS.Platform;
        environment: NodeJS.ProcessEnv;
        existsSync: (file: string) => boolean;
        statSync: (file: string) => { isFile: () => boolean };
        realpathSync: (file: string) => string;
      },
    ) => string;
  };

describe('local-production packaging guard', () => {
  it('preserves production identity and rejects signing hooks', () => {
    const config = readFileSync(
      join(__dirname, '..', '..', 'electron-builder.yml'),
      'utf8',
    );
    expect(() => validateBaseConfig(config)).not.toThrow();
    expect(() =>
      validateBaseConfig(
        'appId: com.ptah.desktop\nproductName: Ptah\nafterSign: ./sign.js\n',
      ),
    ).toThrow('afterSign');
    expect(() =>
      validateBaseConfig(
        'appId: com.ptah.desktop\nproductName: Ptah\n  afterAllArtifactBuild : ./mutate.js\n',
      ),
    ).toThrow('afterAllArtifactBuild');
  });

  it('removes inherited signing credentials without exposing their values', () => {
    const env = sanitizedEnvironment(
      {
        PATH: 'safe',
        CSC_LINK: 'secret-one',
        WIN_CSC_KEY_PASSWORD: 'secret-two',
        AZURE_CLIENT_SECRET: 'secret-three',
        SSL_COM_PASSWORD: 'secret-four',
      },
      'a'.repeat(40),
    );
    expect(env).toEqual({
      PATH: 'safe',
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      PTAH_LOCAL_PRODUCTION_GIT_SHA: 'a'.repeat(40),
    });
  });

  it('refuses a dirty checkout and accepts only a full SHA', () => {
    const run = jest
      .fn()
      .mockReturnValueOnce(`${'a'.repeat(40)}\n`)
      .mockReturnValueOnce(' M source.ts\n');
    expect(() => readCleanGitSha(run, 'C:\\repo')).toThrow('clean checkout');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('requires the installer and Ptah executable to be unsigned', () => {
    const files = [
      'C:\\out\\Ptah Setup.exe',
      'C:\\out\\win-unpacked\\Ptah.exe',
    ];
    expect(() =>
      assertUnsignedStatuses(
        files.map((Path) => ({ Path, Status: 'NotSigned' })),
        files,
      ),
    ).not.toThrow();
    expect(() =>
      assertUnsignedStatuses(
        [
          { Path: files[0], Status: 'Valid' },
          { Path: files[1], Status: 'NotSigned' },
        ],
        files,
      ),
    ).toThrow('Expected unsigned');
  });

  describe('upstream signed dependencies', () => {
    let root: string;
    let unpackedRoot: string;
    let sourceNodeModules: string;
    let packed: string;
    let source: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'ptah-signature-fixture-'));
      unpackedRoot = join(root, 'win-unpacked');
      sourceNodeModules = join(root, 'node_modules');
      const packedVendor = join(
        unpackedRoot,
        'resources',
        'app.asar.unpacked',
        'node_modules',
        '@vendor',
        'cli',
      );
      const sourceVendor = join(sourceNodeModules, '@vendor', 'cli');
      mkdirSync(packedVendor, { recursive: true });
      mkdirSync(sourceVendor, { recursive: true });
      packed = join(packedVendor, 'cli.exe');
      source = join(sourceVendor, 'cli.exe');
      writeFileSync(packed, 'vendor binary');
      writeFileSync(source, 'vendor binary');
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const records = (Path: string, Status = 'Valid') => [{ Path, Status }];
    it('accepts a valid upstream signature only for byte-identical source', () => {
      expect(() =>
        assertUnsignedStatuses(records(packed), [packed], {
          unpackedRoot,
          sourceNodeModules,
        }),
      ).not.toThrow();
      writeFileSync(packed, 'modified binary');
      expect(() =>
        assertUnsignedStatuses(records(packed), [packed], {
          unpackedRoot,
          sourceNodeModules,
        }),
      ).toThrow('Expected unsigned');
    });

    it('rejects missing source, missing inspection and invalid signatures', () => {
      for (const status of ['HashMismatch', 'NotTrusted', 'UnknownError']) {
        expect(() =>
          assertUnsignedStatuses(records(packed, status), [packed], {
            unpackedRoot,
            sourceNodeModules,
          }),
        ).toThrow('Expected unsigned');
      }
      expect(() =>
        assertUnsignedStatuses([], [packed], {
          unpackedRoot,
          sourceNodeModules,
        }),
      ).toThrow('Expected unsigned');
      rmSync(source);
      expect(() =>
        assertUnsignedStatuses(records(packed), [packed], {
          unpackedRoot,
          sourceNodeModules,
        }),
      ).toThrow('Expected unsigned');
    });

    it('rejects signed Ptah executables and files outside unpacked node_modules', () => {
      for (const executable of [
        join(root, 'Ptah Setup.exe'),
        join(unpackedRoot, 'Ptah.exe'),
        join(unpackedRoot, 'resources', 'helper.exe'),
      ]) {
        writeFileSync(executable, 'vendor binary');
        expect(() =>
          assertUnsignedStatuses(records(executable), [executable], {
            unpackedRoot,
            sourceNodeModules,
          }),
        ).toThrow('Expected unsigned');
      }
    });

    it('rejects a dependency junction resolving outside source node_modules', () => {
      const outside = join(root, 'outside');
      mkdirSync(outside);
      writeFileSync(join(outside, 'cli.exe'), 'vendor binary');
      const sourceVendor = join(sourceNodeModules, '@vendor', 'cli');
      rmSync(sourceVendor, { recursive: true });
      symlinkSync(outside, sourceVendor, 'junction');
      expect(() =>
        assertUnsignedStatuses(records(packed), [packed], {
          unpackedRoot,
          sourceNodeModules,
        }),
      ).toThrow('Expected unsigned');
    });
  });

  const windowsIt = process.platform === 'win32' ? it : it.skip;
  windowsIt(
    'loads PS5 signature inspection with only verified system modules',
    () => {
      const powershell = resolveWindowsSystemExecutable(
        'System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      );
      const run = jest.fn(
        (file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
          const moduleKeys = Object.keys(options.env).filter(
            (key) => key.toLowerCase() === 'psmodulepath',
          );
          expect(moduleKeys).toEqual(['PSModulePath']);
          expect(options.env['PSModulePath']?.toLowerCase()).toBe(
            join(
              process.env['SystemRoot'] ?? '',
              'System32',
              'WindowsPowerShell',
              'v1.0',
              'Modules',
            ).toLowerCase(),
          );
          return execFileSync(file, args, {
            ...options,
            encoding: 'utf8',
            windowsHide: true,
          });
        },
      );
      const records = inspectSignatures([powershell], run, {
        ...process.env,
        PSModulePath: 'C:\\Program Files\\PowerShell\\7\\Modules',
        psmodulepath: 'C:\\incompatible-modules',
      });
      expect(records).toEqual([
        { Path: powershell, Status: expect.any(String) },
      ]);
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it('resolves system tools below matching absolute Windows roots only', () => {
    const options = {
      platform: 'win32' as NodeJS.Platform,
      environment: {
        SystemRoot: 'C:\\Windows',
        WINDIR: 'c:\\windows',
      },
      existsSync: () => true,
      statSync: () => ({ isFile: () => true }),
      realpathSync: (file: string) => file,
    };
    expect(
      resolveWindowsSystemExecutable(
        'System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        options,
      ),
    ).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(() =>
      resolveWindowsSystemExecutable('..\\fake.exe', options),
    ).toThrow('outside SystemRoot');
    expect(() =>
      resolveWindowsSystemExecutable('System32\\tool.exe', {
        ...options,
        environment: { SystemRoot: 'relative-windows' },
      }),
    ).toThrow('absolute Windows directory');
  });
});
