/**
 * OpenCode Go credential lookup: one definition of "this machine has an
 * OpenCode Go key in the OpenCode store", shared by the Go plan-usage reader
 * (which needs the key) and the owner resolver (which needs only a yes/no).
 *
 * v1 is the `opencode-go` entry in `auth.json` plus the
 * `OPENCODE_AUTH_CONTENT` / `OPENCODE_API_KEY` fallbacks. v2 — where
 * `opencode auth login` has stored accounts since OpenCode 2.x, which no
 * longer writes `auth.json` — is the active `opencode` integration's
 * credential in `<data dir>/opencode.db`: `readOpenCodeGoStoreCredential`
 * (async, for the reader) and the cached sync check inside
 * `hasOpenCodeGoCredentialSync` (for owner resolution at spawn) share one
 * query helper, so the store SQL exists exactly once, here.
 *
 * The store is opened IN PLACE, read-only (`DatabaseSync` `readOnly` with a
 * short busy `timeout`): a WAL reader never blocks OpenCode's writer, and no
 * copy of sessions or messages ever lands in a temp directory. Verified live
 * with OpenCode running and a live WAL; a locked or unrecoverable store
 * degrades to the v1 fallbacks instead of throwing through the sync check.
 * `node:sqlite` is never imported statically — the async path imports it
 * lazily and the sync path loads it through `process.getBuiltinModule` — so
 * a host without it (the VS Code 1.100 extension-host floor runs Node
 * 20.18) degrades the same way instead of crashing.
 *
 * The key never leaves this module except as the reader functions' return
 * value. It is not logged, not cached and not part of any error.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const AuthSchema = z.object({
  'opencode-go': z
    .object({ type: z.literal('api'), key: z.string().min(1) })
    .optional(),
});

/**
 * OpenCode v2 `credential.value` shapes that carry key material. The active
 * credential's `access` (OAuth account) or `key` (API key) is the Bearer
 * token; other shapes (`external`) carry none. An OAuth value may carry the
 * access token's `expires` (ms epoch), which the reader turns into a
 * sign-in-again answer without making a request.
 */
const StoreValueSchema = z.union([
  z.object({ type: z.literal('key'), key: z.string().min(1) }),
  z.object({
    type: z.literal('oauth'),
    access: z.string().min(1),
    expires: z.number().optional(),
  }),
]);

const AUTH_FILE = 'auth.json';
const STORE_DB = 'opencode.db';
const CREDENTIAL_CACHE_TTL_MS = 5_000;
/**
 * An unreadable store is cached only this long: short enough that a released
 * lock shows at once, long enough that a burst of sync owner checks does not
 * reopen (and wait on) a locked database each time.
 */
const INVALID_STORE_RETRY_MS = 1_000;
/** The busy timeout for the read-only in-place store open (ms). */
const STORE_OPEN_TIMEOUT_MS = 500;
// OpenCode's own selection: active first, then newest (Credential.create and
// Credential.list ordering in sst/opencode). Shared by the async reader and
// the sync owner check, so it exists exactly once.
const STORE_CREDENTIAL_QUERY =
  "SELECT value FROM credential WHERE integration_id = 'opencode' ORDER BY active DESC, time_created DESC, id DESC";

type FileReader = (path: string, encoding: BufferEncoding) => string;
type FileStat = (path: string) => { mtimeMs: number; size: number };
type AsyncFileReader = (
  path: string,
  encoding: BufferEncoding,
) => Promise<string>;
type DatabaseSyncCtor = typeof import('node:sqlite').DatabaseSync;

/** What the auth file says about the Go key; `invalid` = unreadable or unparseable. */
type FileKeyState = 'usable' | 'blank' | 'absent' | 'invalid';

/**
 * What the v2 credential store says: `usable` = the query returned key
 * material; `absent` = no database (or a row without material, such as
 * `external`); `invalid` = present but unreadable (locked, or a WAL that
 * needs recovery with no writer running); `unknown` = this host cannot read
 * SQLite at all (`node:sqlite` missing), so the check has no opinion.
 */
type StoreKeyState = 'usable' | 'absent' | 'invalid' | 'unknown';

const credentialCache = new Map<
  string,
  {
    checkedAt: number;
    mtimeMs: number | null;
    size: number | null;
    state: FileKeyState;
  }
>();

/**
 * The store mirror of `credentialCache`. The signature covers BOTH the
 * database and its `-wal`: in WAL mode fresh logins land in `opencode.db-wal`
 * while the database file's mtime and size stay unchanged until a checkpoint,
 * so a db-only signature goes stale. An `invalid` state is kept only for
 * `INVALID_STORE_RETRY_MS` and never reused on a signature match.
 */
const storeCache = new Map<
  string,
  {
    checkedAt: number;
    dbMtimeMs: number | null;
    dbSize: number | null;
    walMtimeMs: number | null;
    walSize: number | null;
    state: StoreKeyState;
  }
>();

/**
 * The active `opencode` integration's key material, with the OAuth access
 * token's `expiresAt` (ms epoch) when the stored value carries an `expires`.
 * Only the material and the expiry leave the store; `refresh` tokens,
 * account ids, emails and org names never do.
 */
export interface OpenCodeStoreCredential {
  readonly key: string;
  readonly expiresAt?: number;
}

/**
 * OpenCode's data directory: `$XDG_DATA_HOME/opencode`, else
 * `<HOME | USERPROFILE | homedir()>/.local/share/opencode`.
 */
export function openCodeDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome =
    env['XDG_DATA_HOME']?.trim() ||
    join(env['HOME'] || env['USERPROFILE'] || homedir(), '.local', 'share');
  return join(dataHome, 'opencode');
}

/** The `opencode-go` key in auth contents; throws on unparseable or off-schema contents. */
function fileKey(contents: string | undefined): string | undefined {
  if (contents === undefined) return undefined;
  return AuthSchema.parse(JSON.parse(contents))['opencode-go']?.key;
}

/**
 * The trimmed Go key from auth contents (`undefined` = no auth file), with
 * `OPENCODE_API_KEY` as the fallback, or `undefined`. Throws on contents that
 * are not JSON or do not match the auth shape; callers map that to
 * "unavailable".
 */
export function openCodeGoKeyFromAuth(
  contents: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (fileKey(contents) || env['OPENCODE_API_KEY'])?.trim() || undefined;
}

/**
 * The Go key from `OPENCODE_AUTH_CONTENT`, else `auth.json` (a missing file
 * reads as empty). Rejects on an unreadable file or invalid contents.
 */
export async function readOpenCodeGoKey(
  env: NodeJS.ProcessEnv = process.env,
  readAuth: AsyncFileReader = readFile,
): Promise<string | undefined> {
  let contents = env['OPENCODE_AUTH_CONTENT'];
  if (!contents) {
    try {
      contents = await readAuth(join(openCodeDataDir(env), AUTH_FILE), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      contents = undefined;
    }
  }
  return openCodeGoKeyFromAuth(contents, env);
}

/** The selected credential row parsed into material and expiry; `undefined` = no material row. Throws on a corrupt `value`. */
function storeCredentialFromRow(
  row: { value: unknown } | undefined,
): OpenCodeStoreCredential | undefined {
  const raw = row?.value;
  if (typeof raw !== 'string') return undefined;
  const value = StoreValueSchema.safeParse(JSON.parse(raw));
  if (!value.success) return undefined;
  if (value.data.type === 'key') {
    const key = value.data.key.trim();
    return key ? { key } : undefined;
  }
  const key = value.data.access.trim();
  if (!key) return undefined;
  return {
    key,
    ...(typeof value.data.expires === 'number' &&
    Number.isFinite(value.data.expires)
      ? { expiresAt: value.data.expires }
      : {}),
  };
}

/**
 * The selected credential from the LIVE store, opened in place read-only
 * with a short busy timeout. A WAL reader never blocks OpenCode's writer,
 * and no copy is ever taken, so sessions and messages never leave the data
 * directory and nothing can write to or lock the store. Throws when the
 * store cannot be opened or is corrupt; callers degrade.
 */
function storeCredentialFromInPlace(
  dbPath: string,
  DatabaseSync: DatabaseSyncCtor,
): OpenCodeStoreCredential | undefined {
  const db = new DatabaseSync(dbPath, {
    readOnly: true,
    timeout: STORE_OPEN_TIMEOUT_MS,
  });
  try {
    return storeCredentialFromRow(
      db.prepare(STORE_CREDENTIAL_QUERY).get() as
        { value: unknown } | undefined,
    );
  } finally {
    try {
      db.close();
    } catch {
      // read-only: nothing to clean up
    }
  }
}

/**
 * The active `opencode` integration's credential from OpenCode v2's
 * `opencode.db` `credential` table, or `undefined` when the store has none
 * (no database, no `opencode` row, or a value without material such as
 * `external`). A present but unreadable or corrupt store throws; the reader
 * maps that to `service-unavailable`.
 *
 * Only the key material (`key` / `access`) and the OAuth expiry leave the
 * stored value; `refresh` tokens, account ids, emails and org names never do.
 */
export async function readOpenCodeGoStoreCredential(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OpenCodeStoreCredential | undefined> {
  const dbPath = join(openCodeDataDir(env), STORE_DB);
  if (!existsSync(dbPath)) return undefined;
  // A host without `node:sqlite`
  // throws here and the reader reports service-unavailable, never crashes.
  const { DatabaseSync } = await import('node:sqlite');
  return storeCredentialFromInPlace(dbPath, DatabaseSync);
}

/**
 * `node:sqlite` for the synchronous owner check, or `null` on any host
 * without it — never throws. `process.getBuiltinModule` (Node 22.3+) is the
 * only synchronous loader that works in every module format; every Node with
 * `node:sqlite` (22.5+) has it, and hosts without either (Node 20.18) keep
 * their existing plain-opencode owner fallback.
 */
function loadStoreDatabaseSync(): DatabaseSyncCtor | null {
  if (typeof process.getBuiltinModule !== 'function') return null;
  try {
    const sqlite = process.getBuiltinModule('node:sqlite') as
      typeof import('node:sqlite') | undefined;
    return sqlite?.DatabaseSync ?? null;
  } catch {
    // degradation-audit: optional-capability - a host without `node:sqlite`
    // has no store reader; the caller treats `null` as "no opinion".
    return null;
  }
}

/** The store's answer read in place; never throws. */
function storeKeyStateFromStore(
  dbPath: string,
  DatabaseSync: DatabaseSyncCtor,
): StoreKeyState {
  try {
    const credential = storeCredentialFromInPlace(dbPath, DatabaseSync);
    return credential?.key ? 'usable' : 'absent';
  } catch {
    // degradation-audit: optional-capability - a locked store, or one whose
    // WAL needs recovery with no writer running, reads as "no opinion"
    // instead of throwing; `invalid` is cached only briefly, so a later
    // check retries.
    return 'invalid';
  }
}

/**
 * What the v2 store says about the Go key — the store mirror of
 * `fileKeyState`: cached for 5 s and re-read only when the db+WAL signature
 * changes. Never throws and never exposes the key.
 */
function storeKeyState(dbPath: string, now: () => number): StoreKeyState {
  const checkedAt = now();
  const cached = storeCache.get(dbPath);
  const ttl =
    cached?.state === 'invalid'
      ? INVALID_STORE_RETRY_MS
      : CREDENTIAL_CACHE_TTL_MS;
  if (cached && checkedAt - cached.checkedAt < ttl) {
    return cached.state;
  }
  let db: { mtimeMs: number; size: number } | null = null;
  let state: StoreKeyState;
  try {
    db = statSync(dbPath);
  } catch (error) {
    // degradation-audit: optional-capability - a missing database is "no
    // store" (v2 never installed); any other failure is undetectable.
    state =
      (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
        ? 'absent'
        : 'invalid';
    if (state === 'absent') {
      storeCache.set(dbPath, {
        checkedAt,
        dbMtimeMs: null,
        dbSize: null,
        walMtimeMs: null,
        walSize: null,
        state,
      });
    }
    // `invalid` is never cached: the next check retries (review defect 2).
    return state;
  }
  // In WAL mode fresh logins land in `opencode.db-wal` while the database
  // file's mtime and size stay unchanged until a checkpoint, so the WAL
  // belongs in the signature (review defect 2). ENOENT counts as 0s.
  const wal = statOrNull(dbPath + '-wal');
  if (
    cached &&
    cached.state !== 'invalid' &&
    cached.dbMtimeMs === db.mtimeMs &&
    cached.dbSize === db.size &&
    cached.walMtimeMs === (wal?.mtimeMs ?? null) &&
    cached.walSize === (wal?.size ?? null)
  ) {
    cached.checkedAt = checkedAt;
    return cached.state;
  }
  const DatabaseSync = loadStoreDatabaseSync();
  // Without `node:sqlite` the sync
  // check has no opinion, so owner resolution keeps its existing
  // plain-opencode fallback; the async reader still degrades separately.
  state = DatabaseSync
    ? storeKeyStateFromStore(dbPath, DatabaseSync)
    : 'unknown';
  // A lock or an unrecoverable WAL is transient, so `invalid` is held only
  // for `INVALID_STORE_RETRY_MS`; everything else caches under the db+WAL
  // signature.
  storeCache.set(dbPath, {
    checkedAt,
    dbMtimeMs: db.mtimeMs,
    dbSize: db.size,
    walMtimeMs: wal?.mtimeMs ?? null,
    walSize: wal?.size ?? null,
    state,
  });
  return state;
}

/**
 * True when the reader would find a Go key: v1 first
 * (`OPENCODE_AUTH_CONTENT`, then `auth.json`, then `OPENCODE_API_KEY`), and
 * — when v1 has nothing — the v2 credential store, exactly the reader's own
 * fallback order (`readOpenCodeGoKey` then `readOpenCodeGoStoreCredential`).
 * Synchronous for owner resolution at spawn; the file and store outcomes are
 * cached for 5 s and re-read only when their mtime or size changes. Never
 * throws (false on any error) and never exposes the key.
 */
export function hasOpenCodeGoCredentialSync(
  env: NodeJS.ProcessEnv = process.env,
  read: FileReader = readFileSync,
  stat: FileStat = statSync,
  now: () => number = Date.now,
): boolean {
  const envKey = Boolean(env['OPENCODE_API_KEY']?.trim());
  const inline = env['OPENCODE_AUTH_CONTENT'];
  if (inline) {
    try {
      if (openCodeGoKeyFromAuth(inline, env)) return true;
    } catch {
      // degradation-audit: optional-capability - invalid inline auth means the
      // reader reports unavailable, so the lane keeps the OpenCode owner.
      return false;
    }
  } else {
    switch (
      fileKeyState(join(openCodeDataDir(env), AUTH_FILE), read, stat, now)
    ) {
      case 'usable':
        return true;
      case 'absent':
        if (envKey) return true;
        break;
      case 'blank':
        // A blank entry masks the env key before `.trim()`
        // (`openCodeGoKeyFromAuth`: `' ' || envKey` keeps the blank), so the
        // reader consults the store next; the sync check applies the same
        // precedence (review defect 6).
        break;
      default:
        // 'invalid': the reader would report unavailable without ever
        // touching the store, so the owner check keeps the plain OpenCode
        // owner too — the same precedence on both paths (review defect 6).
        return false;
    }
  }
  // v1 found no key (no inline key, no `auth.json` key — or a blank one that
  // masks the env key — or no env key), so the reader falls back to the v2
  // store; the owner check must see it too.
  return storeKeyState(join(openCodeDataDir(env), STORE_DB), now) === 'usable';
}

/** Test seam for the module-level auth-file and store caches. */
export function resetOpenCodeGoCredentialCacheForTests(): void {
  credentialCache.clear();
  storeCache.clear();
}

function statOrNull(path: string): { mtimeMs: number; size: number } | null {
  try {
    return statSync(path);
  } catch {
    // degradation-audit: optional-capability - a missing file (no WAL yet)
    // and any other failure both count as 0s in the store signature
    return null;
  }
}

function fileKeyState(
  path: string,
  read: FileReader,
  stat: FileStat,
  now: () => number,
): FileKeyState {
  const checkedAt = now();
  const cached = credentialCache.get(path);
  if (cached && checkedAt - cached.checkedAt < CREDENTIAL_CACHE_TTL_MS) {
    return cached.state;
  }
  let metadata: { mtimeMs: number; size: number } | null = null;
  let state: FileKeyState;
  try {
    metadata = stat(path);
    if (cached?.mtimeMs === metadata.mtimeMs && cached.size === metadata.size) {
      cached.checkedAt = checkedAt;
      return cached.state;
    }
    const key = fileKey(read(path, 'utf8'));
    if (key === undefined) state = 'absent';
    else state = key.trim() ? 'usable' : 'blank';
  } catch (error) {
    // degradation-audit: optional-capability - a missing file is "no key";
    // any other failure means the reader reports unavailable.
    state =
      (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
        ? 'absent'
        : 'invalid';
  }
  credentialCache.set(path, {
    checkedAt,
    mtimeMs: metadata?.mtimeMs ?? null,
    size: metadata?.size ?? null,
    state,
  });
  return state;
}
