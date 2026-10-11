import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  hasOpenCodeGoCredentialSync,
  openCodeDataDir,
  openCodeGoKeyFromAuth,
  readOpenCodeGoKey,
  resetOpenCodeGoCredentialCacheForTests,
} from './opencode-go-credential';

const GO_AUTH = JSON.stringify({ 'opencode-go': { type: 'api', key: 'go' } });

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

beforeEach(() => {
  resetOpenCodeGoCredentialCacheForTests();
});

describe('openCodeDataDir', () => {
  it('prefers a non-blank XDG_DATA_HOME, then HOME, USERPROFILE and homedir', () => {
    const xdg = resolve('xdg');
    const home = resolve('home');
    const profile = resolve('profile');
    expect(openCodeDataDir({ XDG_DATA_HOME: xdg, HOME: home })).toBe(
      join(xdg, 'opencode'),
    );
    expect(openCodeDataDir({ XDG_DATA_HOME: '  ', HOME: home })).toBe(
      join(home, '.local', 'share', 'opencode'),
    );
    expect(openCodeDataDir({ USERPROFILE: profile })).toBe(
      join(profile, '.local', 'share', 'opencode'),
    );
    expect(openCodeDataDir({})).toBe(
      join(homedir(), '.local', 'share', 'opencode'),
    );
  });
});

describe('openCodeGoKeyFromAuth', () => {
  it('returns the trimmed api key, else OPENCODE_API_KEY, else undefined', () => {
    expect(
      openCodeGoKeyFromAuth(
        JSON.stringify({ 'opencode-go': { type: 'api', key: ' go ' } }),
        { OPENCODE_API_KEY: 'env' },
      ),
    ).toBe('go');
    expect(openCodeGoKeyFromAuth('{}', { OPENCODE_API_KEY: ' env ' })).toBe(
      'env',
    );
    expect(openCodeGoKeyFromAuth(undefined, { OPENCODE_API_KEY: 'env' })).toBe(
      'env',
    );
    expect(openCodeGoKeyFromAuth('{}', {})).toBeUndefined();
  });

  it('throws on invalid JSON and on a non-api entry', () => {
    expect(() => openCodeGoKeyFromAuth('{not json', {})).toThrow();
    expect(() =>
      openCodeGoKeyFromAuth(
        JSON.stringify({ 'opencode-go': { type: 'oauth', key: 'go' } }),
        {},
      ),
    ).toThrow();
  });
});

describe('readOpenCodeGoKey', () => {
  it('reads OPENCODE_AUTH_CONTENT without touching the file', async () => {
    const readAuth = jest.fn(async () => '{}');
    await expect(
      readOpenCodeGoKey({ OPENCODE_AUTH_CONTENT: GO_AUTH }, readAuth),
    ).resolves.toBe('go');
    expect(readAuth).not.toHaveBeenCalled();
  });

  it('reads auth.json under the data directory', async () => {
    const xdg = resolve('xdg');
    const readAuth = jest.fn(async () => GO_AUTH);
    await expect(
      readOpenCodeGoKey({ XDG_DATA_HOME: xdg }, readAuth),
    ).resolves.toBe('go');
    expect(readAuth).toHaveBeenCalledWith(
      join(xdg, 'opencode', 'auth.json'),
      'utf8',
    );
  });

  it('treats a missing file as empty and falls back to OPENCODE_API_KEY', async () => {
    const readAuth = jest.fn(async () => {
      throw enoent();
    });
    await expect(
      readOpenCodeGoKey({ OPENCODE_API_KEY: 'env' }, readAuth),
    ).resolves.toBe('env');
    await expect(readOpenCodeGoKey({}, readAuth)).resolves.toBeUndefined();
  });

  it('rejects an unreadable file and invalid JSON', async () => {
    await expect(
      readOpenCodeGoKey({}, async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }),
    ).rejects.toThrow();
    await expect(readOpenCodeGoKey({}, async () => '{bad')).rejects.toThrow();
  });
});

describe('hasOpenCodeGoCredentialSync', () => {
  const env = { XDG_DATA_HOME: resolve('xdg') };
  const stat = () => ({ mtimeMs: 1, size: 1 });

  it('is true for an api entry and false for a non-api entry', () => {
    expect(hasOpenCodeGoCredentialSync(env, () => GO_AUTH, stat)).toBe(true);
    resetOpenCodeGoCredentialCacheForTests();
    expect(
      hasOpenCodeGoCredentialSync(
        env,
        () => JSON.stringify({ 'opencode-go': { type: 'oauth', key: 'go' } }),
        stat,
      ),
    ).toBe(false);
  });

  it('uses OPENCODE_AUTH_CONTENT before the file', () => {
    const read = jest.fn(() => '{}');
    expect(
      hasOpenCodeGoCredentialSync(
        { ...env, OPENCODE_AUTH_CONTENT: GO_AUTH },
        read,
        stat,
      ),
    ).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(
      hasOpenCodeGoCredentialSync(
        { ...env, OPENCODE_AUTH_CONTENT: '{bad' },
        read,
        stat,
      ),
    ).toBe(false);
  });

  it('falls back to OPENCODE_API_KEY only when the file has no Go entry', () => {
    const missing = () => {
      throw enoent();
    };
    expect(
      hasOpenCodeGoCredentialSync(
        { ...env, OPENCODE_API_KEY: 'env' },
        jest.fn(),
        missing,
      ),
    ).toBe(true);
    resetOpenCodeGoCredentialCacheForTests();
    expect(hasOpenCodeGoCredentialSync(env, jest.fn(), missing)).toBe(false);
    resetOpenCodeGoCredentialCacheForTests();
    expect(
      hasOpenCodeGoCredentialSync(
        { ...env, OPENCODE_API_KEY: 'env' },
        () => '{bad',
        stat,
      ),
    ).toBe(false);
  });

  it('never throws on an unreadable file', () => {
    expect(
      hasOpenCodeGoCredentialSync(
        env,
        () => {
          throw new Error('denied');
        },
        stat,
      ),
    ).toBe(false);
  });

  it('caches for 5 s, then re-reads only when mtime or size changes', () => {
    let clock = 0;
    let contents = GO_AUTH;
    let metadata = { mtimeMs: 1, size: 1 };
    const read = jest.fn(() => contents);
    const check = () =>
      hasOpenCodeGoCredentialSync(
        env,
        read,
        () => metadata,
        () => clock,
      );

    expect(check()).toBe(true);
    contents = '{}';
    clock = 4_999;
    expect(check()).toBe(true);
    clock = 5_000;
    expect(check()).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    metadata = { mtimeMs: 2, size: 1 };
    clock = 10_000;
    expect(check()).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
