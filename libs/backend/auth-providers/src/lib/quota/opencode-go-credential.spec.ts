import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

describe('hasOpenCodeGoCredentialSync · v2 credential store', () => {
  const statOk = () => ({ mtimeMs: 1, size: 1 });
  /** auth.json never exists in these homes; the file state reads 'absent'. */
  const noAuthFile = () => {
    throw enoent();
  };
  const readAuth = jest.fn(() => {
    throw new Error('auth.json must not be read');
  });

  function writeStoreDb(
    storeDir: string,
    rows: ReadonlyArray<{
      id: string;
      integration: string;
      value: unknown;
      active: number | null;
      time: number;
    }>,
  ): void {
    mkdirSync(storeDir, { recursive: true });
    // a fresh database per write, so rewrites change mtime and size
    rmSync(join(storeDir, 'opencode.db'), { force: true });
    const db = new DatabaseSync(join(storeDir, 'opencode.db'));
    try {
      db.exec(
        'CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT, value TEXT, ' +
          'connector_id TEXT, method_id TEXT, active INTEGER, time_created INTEGER, time_updated INTEGER)',
      );
      const insert = db.prepare(
        'INSERT INTO credential (id, integration_id, label, value, active, time_created) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const row of rows) {
        insert.run(
          row.id,
          row.integration,
          'label',
          JSON.stringify(row.value),
          row.active,
          row.time,
        );
      }
    } finally {
      db.close();
    }
  }

  function storeHome(rows: Parameters<typeof writeStoreDb>[1]): string {
    const dataHome = mkdtempSync(join(tmpdir(), 'ptah-credential-spec-'));
    writeStoreDb(join(dataHome, 'opencode'), rows);
    return dataHome;
  }

  it('detects an active opencode oauth credential when v1 has nothing', () => {
    const dataHome = storeHome([
      {
        id: 'older',
        integration: 'opencode',
        value: { type: 'key', key: 'stale-key' },
        active: 0,
        time: 1,
      },
      {
        id: 'active',
        integration: 'opencode',
        value: {
          type: 'oauth',
          methodID: 'device',
          refresh: 'refresh-material',
          access: 'access-material',
          expires: 4102444800000,
          metadata: { server: 'https://opencode.example', accountID: 'acc' },
        },
        active: 1,
        time: 2,
      },
    ]);
    expect(
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome },
        readAuth,
        noAuthFile,
      ),
    ).toBe(true);
  });

  it('detects an active opencode api-key credential as well', () => {
    const dataHome = storeHome([
      {
        id: 'key',
        integration: 'opencode',
        value: { type: 'key', key: 'go-key' },
        active: 1,
        time: 1,
      },
    ]);
    expect(
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome },
        readAuth,
        noAuthFile,
      ),
    ).toBe(true);
  });

  it('is false when the store holds no opencode key material', () => {
    const dataHome = storeHome([
      {
        id: 'external',
        integration: 'opencode',
        value: { type: 'external', methodID: 'm' },
        active: 1,
        time: 1,
      },
      {
        id: 'other',
        integration: 'github',
        value: { type: 'key', key: 'other-integration' },
        active: 1,
        time: 2,
      },
    ]);
    expect(
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome },
        readAuth,
        noAuthFile,
      ),
    ).toBe(false);
  });

  it('is false, never throwing, on a corrupt store database', () => {
    const dataHome = mkdtempSync(join(tmpdir(), 'ptah-credential-spec-'));
    mkdirSync(join(dataHome, 'opencode'), { recursive: true });
    writeFileSync(
      join(dataHome, 'opencode', 'opencode.db'),
      'definitely not sqlite',
    );
    expect(
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome },
        readAuth,
        noAuthFile,
      ),
    ).toBe(false);
  });

  it('keeps a usable v1 auth.json ahead of the store', () => {
    const dataHome = storeHome([
      {
        id: 'active',
        integration: 'opencode',
        value: { type: 'key', key: 'go-key' },
        active: 1,
        time: 1,
      },
    ]);
    // a corrupt store below a usable v1 file must not flip the answer: the
    // v1 'usable' state returns before the store is ever read.
    writeFileSync(
      join(dataHome, 'opencode', 'opencode.db'),
      'definitely not sqlite',
    );
    expect(
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome },
        () => GO_AUTH,
        statOk,
      ),
    ).toBe(true);
  });

  it('is false when an invalid v1 auth.json outranks the store', () => {
    const dataHome = storeHome([
      {
        id: 'active',
        integration: 'opencode',
        value: { type: 'key', key: 'go-key' },
        active: 1,
        time: 1,
      },
    ]);
    // v1 'invalid': the reader reports unavailable without ever reading v2,
    // so the owner check must not promote the store either.
    expect(
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome },
        () => '{bad',
        statOk,
      ),
    ).toBe(false);
  });

  it('caches the store outcome for 5 s, then re-reads on change', () => {
    const dataHome = mkdtempSync(join(tmpdir(), 'ptah-credential-spec-'));
    const storeDir = join(dataHome, 'opencode');
    writeStoreDb(storeDir, [
      {
        id: 'active',
        integration: 'opencode',
        value: { type: 'key', key: 'go-key' },
        active: 1,
        time: 1,
      },
    ]);
    let clock = 0;
    const check = () =>
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome },
        readAuth,
        noAuthFile,
        () => clock,
      );
    expect(check()).toBe(true);
    // the database loses its opencode material; the 5 s cache holds the
    // earlier answer, then the changed mtime/size forces a re-read.
    writeStoreDb(storeDir, [
      {
        id: 'other',
        integration: 'github',
        value: { type: 'key', key: 'other-integration' },
        active: 1,
        time: 2,
      },
    ]);
    clock = 4_999;
    expect(check()).toBe(true);
    clock = 5_000;
    expect(check()).toBe(false);
  });

  it('re-reads when the WAL changes while the database file does not', () => {
    const dataHome = mkdtempSync(join(tmpdir(), 'ptah-credential-spec-'));
    const storeDir = join(dataHome, 'opencode');
    writeStoreDb(storeDir, [
      {
        id: 'other',
        integration: 'github',
        value: { type: 'key', key: 'other-integration' },
        active: 1,
        time: 1,
      },
    ]);
    let clock = 0;
    const check = () =>
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome },
        readAuth,
        noAuthFile,
        () => clock,
      );
    const wal = new DatabaseSync(join(storeDir, 'opencode.db'));
    try {
      wal.exec('PRAGMA journal_mode = WAL');
      expect(check()).toBe(false);
      // A login lands in the WAL only: the database file's mtime and size
      // stay unchanged until a checkpoint, so only the WAL part of the
      // signature changes (review defect 2).
      wal
        .prepare(
          "INSERT INTO credential (id, integration_id, label, value, active, time_created) VALUES ('active', 'opencode', 'label', ?, 1, 2)",
        )
        .run(JSON.stringify({ type: 'key', key: 'go-key' }));
      clock = 5_000;
      expect(check()).toBe(true);
    } finally {
      wal.close();
    }
  });

  it('holds an unreadable store for 1 s only, then retries', () => {
    const dataHome = mkdtempSync(join(tmpdir(), 'ptah-credential-spec-'));
    const storeDir = join(dataHome, 'opencode');
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, 'opencode.db'), 'definitely not sqlite');
    let clock = 0;
    const check = () =>
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome },
        readAuth,
        noAuthFile,
        () => clock,
      );
    expect(check()).toBe(false);
    // the store becomes readable again well inside the 5 s TTL: `invalid`
    // is held for 1 s only, so the check sees it after that (review defect 2)
    writeStoreDb(storeDir, [
      {
        id: 'active',
        integration: 'opencode',
        value: { type: 'key', key: 'go-key' },
        active: 1,
        time: 1,
      },
    ]);
    clock = 500;
    expect(check()).toBe(false);
    clock = 1_000;
    expect(check()).toBe(true);
  });

  it('applies the reader precedence to a blank auth.json key: the store, never the env key', () => {
    const blankAuth = JSON.stringify({
      'opencode-go': { type: 'api', key: ' ' },
    });
    // blank + env key + no store: the reader finds nothing (the blank key
    // masks the env key before `.trim()`), so the owner check says false too
    expect(
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: resolve('xdg'), OPENCODE_API_KEY: 'env' },
        () => blankAuth,
        statOk,
      ),
    ).toBe(false);
    // blank + env key + a valid v2 store: the reader falls through to the
    // store, and so does the owner check (review defect 6)
    const dataHome = storeHome([
      {
        id: 'active',
        integration: 'opencode',
        value: { type: 'key', key: 'go-key' },
        active: 1,
        time: 1,
      },
    ]);
    expect(
      hasOpenCodeGoCredentialSync(
        { XDG_DATA_HOME: dataHome, OPENCODE_API_KEY: 'env' },
        () => blankAuth,
        statOk,
      ),
    ).toBe(true);
  });
});
