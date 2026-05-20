/**
 * copilot-file-auth — unit specs.
 *
 * Covers the cross-platform GitHub token read/write helpers used by the
 * Copilot auth stack. Security-sensitive surface:
 *   - Path resolution MUST honour XDG_CONFIG_HOME → Windows LOCALAPPDATA →
 *     POSIX ~/.config precedence so tokens aren't read from the wrong folder.
 *   - Missing file (ENOENT) MUST be indistinguishable from corrupted JSON at
 *     the public API — both surface as `null` so callers can cleanly fall back
 *     to the device-code flow instead of leaking parse errors.
 *   - `writeCopilotToken` MUST preserve unrelated host entries and never
 *     throw — failures degrade silently to keep the auth flow alive.
 *
 * Follows the direct-constructor style of
 * `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.spec.ts` —
 * functional module, no DI.
 *
 * Source-under-test:
 *   `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-file-auth.ts`
 */

import 'reflect-metadata';

// node:fs/promises is mocked before import so readFile / writeFile / mkdir
// can be driven deterministically per test. ts-jest rewrites these calls at
// compile time so the `jest.mock(...)` hoists above the source import.
jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
}));

jest.mock('node:os', () => ({
  ...jest.requireActual('node:os'),
  homedir: jest.fn(() => '/home/testuser'),
}));

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  readCopilotToken,
  writeCopilotToken,
  getCopilotHostsPath,
  getCopilotAppsPath,
} from './copilot-file-auth';

// ---------------------------------------------------------------------------
// Typed mock handles — no `as any`.
// ---------------------------------------------------------------------------

const mockedReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockedWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockedMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockedHomedir = homedir as jest.MockedFunction<typeof homedir>;

// ---------------------------------------------------------------------------
// process.platform / process.env helpers.
// `process.platform` is a read-only non-configurable property on Node by
// default, so we snapshot + redefine it via `Object.defineProperty`.
// ---------------------------------------------------------------------------

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
    writable: false,
  });
}

function restorePlatform(): void {
  Object.defineProperty(process, 'platform', {
    value: ORIGINAL_PLATFORM,
    configurable: true,
    writable: false,
  });
}

// Windows path separator used by node:path when running on Windows. We
// compare using `toContain` on the trailing filename to stay portable across
// the CI matrix (tests run on Windows and Linux).
const HOSTS_FILENAME = 'hosts.json';
const APPS_FILENAME = 'apps.json';

describe('copilot-file-auth', () => {
  let originalXdg: string | undefined;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedHomedir.mockReturnValue('/home/testuser');

    originalXdg = process.env['XDG_CONFIG_HOME'];
    originalLocalAppData = process.env['LOCALAPPDATA'];
    delete process.env['XDG_CONFIG_HOME'];
    delete process.env['LOCALAPPDATA'];
  });

  afterEach(() => {
    restorePlatform();
    if (originalXdg !== undefined) {
      process.env['XDG_CONFIG_HOME'] = originalXdg;
    } else {
      delete process.env['XDG_CONFIG_HOME'];
    }
    if (originalLocalAppData !== undefined) {
      process.env['LOCALAPPDATA'] = originalLocalAppData;
    } else {
      delete process.env['LOCALAPPDATA'];
    }
  });

  // -------------------------------------------------------------------------
  // Path resolution
  // -------------------------------------------------------------------------

  describe('getCopilotHostsPath / getCopilotAppsPath', () => {
    it('prefers XDG_CONFIG_HOME on any platform', () => {
      setPlatform('linux');
      process.env['XDG_CONFIG_HOME'] = '/custom/xdg';

      expect(getCopilotHostsPath()).toMatch(/github-copilot/);
      expect(getCopilotHostsPath()).toMatch(/custom[\\/]xdg/);
      expect(getCopilotHostsPath().endsWith(HOSTS_FILENAME)).toBe(true);

      expect(getCopilotAppsPath().endsWith(APPS_FILENAME)).toBe(true);
      expect(getCopilotAppsPath()).toMatch(/custom[\\/]xdg/);
    });

    it('uses LOCALAPPDATA on win32 when XDG is unset', () => {
      setPlatform('win32');
      process.env['LOCALAPPDATA'] = 'C:\\Users\\test\\AppData\\Local';

      expect(getCopilotHostsPath()).toMatch(/AppData[\\/]Local/);
      expect(getCopilotHostsPath()).toMatch(/github-copilot/);
      expect(getCopilotHostsPath().endsWith(HOSTS_FILENAME)).toBe(true);
    });

    it('falls back to ~/.config/github-copilot on POSIX', () => {
      setPlatform('linux');
      // node:path joins with the host separator, so match using a regex
      // that accepts either `/` or `\\` — the CI matrix runs both.
      mockedHomedir.mockReturnValue('/home/alice');

      expect(getCopilotHostsPath()).toMatch(/home[\\/]alice/);
      expect(getCopilotHostsPath()).toMatch(/\.config[\\/]github-copilot/);
    });

    it('falls back to ~/.config on win32 when LOCALAPPDATA is unset', () => {
      setPlatform('win32');
      mockedHomedir.mockReturnValue('C:\\Users\\alice');
      // LOCALAPPDATA intentionally unset by beforeEach.

      expect(getCopilotHostsPath()).toContain('alice');
      expect(getCopilotHostsPath()).toMatch(/\.config[\\/]github-copilot/);
    });
  });

  // -------------------------------------------------------------------------
  // readCopilotToken
  // -------------------------------------------------------------------------

  describe('readCopilotToken', () => {
    beforeEach(() => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/testuser');
    });

    it('returns the github.com oauth_token from hosts.json', async () => {
      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify({
          'github.com': { oauth_token: 'gho_abc123' },
        }),
      );

      await expect(readCopilotToken()).resolves.toBe('gho_abc123');
      expect(mockedReadFile).toHaveBeenCalledTimes(1);
      const [path, encoding] = mockedReadFile.mock.calls[0] as [string, string];
      expect(path).toMatch(/hosts\.json$/);
      expect(encoding).toBe('utf-8');
    });

    it('falls back to any host entry with oauth_token (GHES support)', async () => {
      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify({
          'ghe.internal.example': { oauth_token: 'gho_enterprise' },
        }),
      );

      await expect(readCopilotToken()).resolves.toBe('gho_enterprise');
    });

    it('falls back from hosts.json (no token) to apps.json', async () => {
      // hosts.json present but empty → no token.
      mockedReadFile.mockResolvedValueOnce(JSON.stringify({}));
      // apps.json has a CLI token under a "github.com:app_id" key.
      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify({
          'github.com:12345': { oauth_token: 'gho_from_apps' },
        }),
      );

      await expect(readCopilotToken()).resolves.toBe('gho_from_apps');
      expect(mockedReadFile).toHaveBeenCalledTimes(2);
      const secondPath = mockedReadFile.mock.calls[1][0] as string;
      expect(secondPath.endsWith(APPS_FILENAME)).toBe(true);
    });

    it('returns null when hosts.json file is missing (ENOENT) and apps.json is also missing', async () => {
      // Missing file surfaces as null — do not distinguish from corruption
      // at the public API (keeps callers simple).
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockedReadFile.mockRejectedValueOnce(enoent);
      mockedReadFile.mockRejectedValueOnce(enoent);

      await expect(readCopilotToken()).resolves.toBeNull();
    });

    it('returns null when hosts.json contains corrupted JSON and apps.json is missing', async () => {
      mockedReadFile.mockResolvedValueOnce('{ not valid json');
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockedReadFile.mockRejectedValueOnce(enoent);

      await expect(readCopilotToken()).resolves.toBeNull();
    });

    it('returns null when both files parse but contain no oauth_token', async () => {
      mockedReadFile.mockResolvedValueOnce(JSON.stringify({}));
      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify({
          'github.com': { other_field: 'value' },
        }),
      );

      await expect(readCopilotToken()).resolves.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // writeCopilotToken
  // -------------------------------------------------------------------------

  describe('writeCopilotToken', () => {
    beforeEach(() => {
      setPlatform('linux');
      mockedHomedir.mockReturnValue('/home/testuser');
    });

    it('creates the config directory recursively before writing', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockedReadFile.mockRejectedValueOnce(enoent);
      mockedMkdir.mockResolvedValueOnce(undefined);
      mockedWriteFile.mockResolvedValueOnce(undefined);

      await writeCopilotToken('gho_new');

      expect(mockedMkdir).toHaveBeenCalledTimes(1);
      const [, opts] = mockedMkdir.mock.calls[0] as [
        string,
        { recursive?: boolean },
      ];
      expect(opts).toMatchObject({ recursive: true });
    });

    it('writes a fresh hosts.json when file does not exist', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockedReadFile.mockRejectedValueOnce(enoent);
      mockedMkdir.mockResolvedValueOnce(undefined);
      mockedWriteFile.mockResolvedValueOnce(undefined);

      await writeCopilotToken('gho_new');

      expect(mockedWriteFile).toHaveBeenCalledTimes(1);
      const [path, contents, encoding] = mockedWriteFile.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(path.endsWith(HOSTS_FILENAME)).toBe(true);
      expect(encoding).toBe('utf-8');
      const parsed = JSON.parse(contents) as Record<
        string,
        { oauth_token?: string }
      >;
      expect(parsed['github.com']).toEqual({ oauth_token: 'gho_new' });
    });

    it('preserves unrelated host entries when merging into an existing file', async () => {
      mockedReadFile.mockResolvedValueOnce(
        JSON.stringify({
          'github.com': { oauth_token: 'gho_old', user: 'alice' },
          'ghe.internal': { oauth_token: 'ghe_keepme' },
        }),
      );
      mockedMkdir.mockResolvedValueOnce(undefined);
      mockedWriteFile.mockResolvedValueOnce(undefined);

      await writeCopilotToken('gho_rotated');

      const [, contents] = mockedWriteFile.mock.calls[0] as [string, string];
      const parsed = JSON.parse(contents) as Record<
        string,
        Record<string, unknown>
      >;
      // Rotated token written.
      expect(parsed['github.com']['oauth_token']).toBe('gho_rotated');
      // Sibling fields on github.com preserved.
      expect(parsed['github.com']['user']).toBe('alice');
      // Other hosts untouched.
      expect(parsed['ghe.internal']).toEqual({ oauth_token: 'ghe_keepme' });
    });

    it('starts fresh when existing file is corrupted (does not throw)', async () => {
      mockedReadFile.mockResolvedValueOnce('not json at all');
      mockedMkdir.mockResolvedValueOnce(undefined);
      mockedWriteFile.mockResolvedValueOnce(undefined);

      await expect(writeCopilotToken('gho_new')).resolves.toBeUndefined();

      const [, contents] = mockedWriteFile.mock.calls[0] as [string, string];
      const parsed = JSON.parse(contents) as Record<
        string,
        { oauth_token?: string }
      >;
      expect(parsed['github.com']).toEqual({ oauth_token: 'gho_new' });
    });

    it('never throws when the filesystem write fails (best-effort persistence)', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockedReadFile.mockRejectedValueOnce(enoent);
      mockedMkdir.mockResolvedValueOnce(undefined);
      mockedWriteFile.mockRejectedValueOnce(new Error('EACCES'));

      await expect(writeCopilotToken('gho_new')).resolves.toBeUndefined();
    });

    it('never throws when mkdir fails', async () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockedReadFile.mockRejectedValueOnce(enoent);
      mockedMkdir.mockRejectedValueOnce(new Error('EPERM'));

      await expect(writeCopilotToken('gho_new')).resolves.toBeUndefined();
    });
  });
});
