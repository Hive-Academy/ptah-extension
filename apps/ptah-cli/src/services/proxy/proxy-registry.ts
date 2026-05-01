/**
 * `proxy-registry` — persistent on-disk registry of running Anthropic-compatible
 * proxy processes (TASK_2026_108 T3).
 *
 * Layout: `<userDataPath>/proxies/<port>.json`. Sibling to the existing
 * `<userDataPath>/proxy/<port>.token` directory used by `proxy-auth.ts` —
 * they are intentionally NOT nested (`proxies/` is plural, `proxy/` is
 * singular). This keeps file-mode drift between token files and registry
 * entries impossible: token files stay 0o600 owned by `proxy-auth`, registry
 * entries stay 0o600 owned by this module, and neither cares about the other.
 *
 * Three responsibilities:
 *   1. **`register(entry)`** — write a single registry file atomically
 *      (`writeFile(tmp) → rename`) with mode `0o600`. Parent directory is
 *      created with mode `0o700`. Persists `pid`, `port`, `host`, `startedAt`,
 *      and a SHA-256 fingerprint of the bearer token (NEVER the raw token).
 *   2. **`unregister(port)`** — best-effort delete; idempotent on missing.
 *   3. **`list()` / `findStale()`** — read all `*.json` entries; partition by
 *      whether `process.kill(pid, 0)` proves the owning process is alive.
 *      `list()` filters out dead pids AND auto-unregisters them inline (the
 *      cheapest place to GC stale entries — every supervisor that calls
 *      `list()` cleans up after a previous process that died ungracefully).
 *      `findStale()` returns the dead-pid entries instead of GC'ing them.
 *
 * Pure functional module — no DI, no classes, no logger. Mirror of
 * `proxy-auth.ts`. All paths absolute. No `any`.
 *
 * Q3=A locked (TASK_2026_108 § 8): registry directory `~/.ptah/proxies/`
 * (plural). Token directory `~/.ptah/proxy/` (singular) is UNCHANGED — no
 * migration of existing `proxy-auth.ts` paths.
 */

import { createHash, randomBytes } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';

// Bind named methods through the namespace so ESM importers can `jest.spyOn`
// the original `fsPromises` exports without our re-export shadowing the
// binding. (jest.spyOn requires the property to be writable on the target —
// re-exported `import { rename }` bindings are read-only in ESM mode.)
const { mkdir, readFile, readdir, unlink, writeFile } = fsPromises;

/**
 * On-disk shape of a single registered proxy. All fields readonly because the
 * file is rewritten atomically — mutation in memory has no path back to disk.
 */
export interface ProxyRegistryEntry {
  /** OS process id of the owning proxy. Used by `process.kill(pid, 0)`. */
  readonly pid: number;
  /** TCP port the proxy bound to. Acts as the registry primary key. */
  readonly port: number;
  /** Bind host string (`'127.0.0.1'`, `'localhost'`, etc.). */
  readonly host: string;
  /** Epoch milliseconds at which the proxy completed bind. */
  readonly startedAt: number;
  /**
   * SHA-256 fingerprint (first 16 hex chars) of the bearer token. The raw
   * token NEVER touches the registry — only the fingerprint persists, so an
   * attacker reading `<port>.json` cannot reconstruct the token.
   */
  readonly tokenFingerprint: string;
}

/** Default base directory: `~/.ptah`. Override seam mirrors `proxy-auth.ts`. */
function defaultUserDataPath(): string {
  return path.join(homedir(), '.ptah');
}

/**
 * Resolve the absolute on-disk path for a registry entry.
 *
 * Layout: `<userDataPath>/proxies/<port>.json`. `userDataPath` defaults to
 * `~/.ptah` when omitted — matching the default computed by
 * `registerPlatformCliServices` in platform-cli.
 */
export function resolveRegistryPath(
  port: number,
  userDataPath?: string,
): string {
  return path.join(
    userDataPath ?? defaultUserDataPath(),
    'proxies',
    `${port}.json`,
  );
}

/** Resolve the registry directory (used internally by list/findStale). */
function resolveRegistryDir(userDataPath?: string): string {
  return path.join(userDataPath ?? defaultUserDataPath(), 'proxies');
}

/**
 * Persist a single registry entry atomically.
 *
 * Atomicity contract: writes to a randomly-suffixed `*.tmp.<rand>` sibling
 * first, then `rename()` swaps it into place. Concurrent `list()` calls
 * therefore observe either the previous file or the new file — never a
 * partial / truncated read.
 *
 * Parent directory is created with mode `0o700` (owner-only traversal); the
 * file itself with mode `0o600` (owner-only read/write). Mode bits are
 * best-effort on Windows (NTFS ACLs override POSIX mode), matching the
 * pattern set by `writeProxyTokenFile`.
 */
export async function register(
  entry: ProxyRegistryEntry,
  userDataPath?: string,
): Promise<void> {
  const finalPath = resolveRegistryPath(entry.port, userDataPath);
  const dir = path.dirname(finalPath);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  // Random tmp suffix prevents two simultaneous registers from clobbering
  // each other's tmp file before the rename. 8 hex chars = 32 bits of entropy
  // — collision-free for any realistic concurrency.
  const tmpPath = `${finalPath}.tmp.${randomBytes(4).toString('hex')}`;
  const payload = JSON.stringify(entry);
  await writeFile(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
  // Call rename via the namespace (`fsPromises.rename`) so `jest.spyOn` on
  // the namespace's `rename` property intercepts the call. A direct
  // destructured `rename` binding would be read-only in ESM and unspyable.
  await fsPromises.rename(tmpPath, finalPath);
}

/**
 * Best-effort delete of a registry entry. Swallows `ENOENT` only — every
 * other failure surfaces (callers may decide whether to swallow further;
 * `executeStart`'s `finally` block additionally `.catch(() => {})`s on its
 * call site to make double-call safe across both SIGTERM and `proxy.shutdown`
 * paths).
 *
 * Idempotency: calling `unregister(port)` twice is safe — the second call
 * sees `ENOENT` and returns without error.
 */
export async function unregister(
  port: number,
  userDataPath?: string,
): Promise<void> {
  const filePath = resolveRegistryPath(port, userDataPath);
  try {
    await unlink(filePath);
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      return;
    }
    throw err;
  }
}

/**
 * List every alive proxy in the registry. Performs inline GC of dead-pid
 * entries — they are auto-unregistered before returning. Files that fail
 * JSON parsing are logged to stderr (one-line warning) and skipped, but
 * NOT auto-deleted (a partial-write that recovered would otherwise vanish).
 *
 * Returns an empty array when the registry directory does not exist
 * (`ENOENT` is non-fatal — the proxy has simply never bound on this user).
 */
export async function list(
  userDataPath?: string,
): Promise<ProxyRegistryEntry[]> {
  const dir = resolveRegistryDir(userDataPath);
  const allEntries = await readAllEntries(dir);
  const alive: ProxyRegistryEntry[] = [];
  const dead: ProxyRegistryEntry[] = [];
  for (const entry of allEntries) {
    if (isPidAlive(entry.pid)) {
      alive.push(entry);
    } else {
      dead.push(entry);
    }
  }
  // Auto-GC dead entries inline. Failures are swallowed — the file may have
  // already been removed by another supervisor calling list() concurrently.
  for (const entry of dead) {
    await unregister(entry.port, userDataPath).catch(() => {
      /* swallow — concurrent unregister is benign */
    });
  }
  return alive;
}

/**
 * Return registry entries whose owning process is dead but whose file still
 * persists. Counterpart to `list()` — `list()` filters them out and GCs them,
 * `findStale()` returns them without side effects so callers can report the
 * cleanup decision (e.g. `ptah proxy stop --port <n>` reports
 * `removed stale registry entry on port <n>` when the entry is in this set).
 */
export async function findStale(
  userDataPath?: string,
): Promise<ProxyRegistryEntry[]> {
  const dir = resolveRegistryDir(userDataPath);
  const allEntries = await readAllEntries(dir);
  return allEntries.filter((entry) => !isPidAlive(entry.pid));
}

/**
 * Compute a stable sha256 fingerprint for a bearer token. The first 16 hex
 * chars (64 bits) are sufficient to fingerprint a freshly-minted token for
 * registry-side identity comparisons without persisting the raw token.
 *
 * Re-exported so `AnthropicProxyService.start()` can compute the fingerprint
 * inside the service (where the raw token already lives) without leaking the
 * token to the registry caller.
 */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Probe whether a process is alive without sending a real signal.
 * `process.kill(pid, 0)` returns true on success and throws otherwise:
 *   - `ESRCH` → process does not exist (definitively dead).
 *   - `EPERM` → process exists but we lack permission to signal it. Treat
 *               as ALIVE because the registry still represents a real
 *               process (typically only happens cross-user, which the proxy
 *               does not do anyway).
 *   - any other error → conservatively treat as DEAD (better to GC a stale
 *                       entry than to keep returning a phantom).
 */
function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'EPERM') {
      return true;
    }
    return false;
  }
}

/** Read + parse every `*.json` in the registry dir; tolerate ENOENT + bad JSON. */
async function readAllEntries(dir: string): Promise<ProxyRegistryEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isNodeErrnoException(err) && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  const out: ProxyRegistryEntry[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(dir, name);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch {
      // File might have been removed mid-readdir (concurrent unregister) —
      // skip silently.
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Single-line warning to stderr; don't auto-delete (a partial write
      // that another process is still rewriting would be wrongly clobbered).
      try {
        process.stderr.write(
          `[ptah] proxy registry: skipping malformed entry ${filePath}: ${detail}\n`,
        );
      } catch {
        /* swallow stderr write failure */
      }
      continue;
    }
    if (!isProxyRegistryEntry(parsed)) {
      try {
        process.stderr.write(
          `[ptah] proxy registry: skipping malformed entry ${filePath}: shape mismatch\n`,
        );
      } catch {
        /* swallow stderr write failure */
      }
      continue;
    }
    out.push(parsed);
  }
  return out;
}

/** Runtime guard for the parsed JSON shape — no `any`, no casts. */
function isProxyRegistryEntry(value: unknown): value is ProxyRegistryEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    typeof v['pid'] === 'number' &&
    Number.isFinite(v['pid']) &&
    typeof v['port'] === 'number' &&
    Number.isFinite(v['port']) &&
    typeof v['host'] === 'string' &&
    typeof v['startedAt'] === 'number' &&
    Number.isFinite(v['startedAt']) &&
    typeof v['tokenFingerprint'] === 'string'
  );
}

/** Type guard for `NodeJS.ErrnoException` — used to inspect `.code` safely. */
function isNodeErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as NodeJS.ErrnoException).code === 'string'
  );
}
