/**
 * Disk access for the Kimi Code CLI login: locate and read the token file,
 * coordinate refreshes between Ptah processes, and write rotated tokens back.
 *
 * SECURITY: nothing in this file logs a token, the credential file name (it
 * contains an id) or file content. Logs carry categories and counts only.
 */
import { randomUUID } from 'node:crypto';
import {
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  KIMI_CODE_CONFIG_MAX_BYTES,
  readKimiCodeOAuthConfig,
  type KimiCodeOAuthConfig,
} from './kimi-code-config.reader';
import {
  KIMI_CODE_TOKEN_SCOPE,
  kimiCodeDeviceIdSchema,
  kimiCodeRefreshLockSchema,
  kimiCodeRegionSchema,
  kimiCodeTokenFileSchema,
  type KimiCodeRegion,
  type KimiCodeTokenFile,
} from './kimi-code-credential.schemas';
import type { KimiCodeHomeResolver } from './kimi-code-home-resolver';

/** Read cache lifetime; mirrors the Codex auth cache. */
export const KIMI_CODE_CACHE_TTL_MS = 5_000;
/** Largest token file the store reads (64 KiB). */
export const KIMI_CODE_TOKEN_FILE_MAX_BYTES = 64 * 1024;
/**
 * A refresh lock older than this belongs to a dead process. A live refresh
 * never holds it this long: the refresher's total deadline
 * (`KIMI_CODE_REFRESH_DEADLINE_MS`) is below it.
 */
export const KIMI_CODE_LOCK_STALE_MS = 60_000;
/** How long a refresh waits for another Ptah process's lock. */
export const KIMI_CODE_LOCK_WAIT_MS = 35_000;
/**
 * A takeover guard older than this belongs to a process that died inside
 * the guard. A live holder keeps it for a few file operations only.
 */
export const KIMI_CODE_GUARD_STALE_MS = 10_000;
const LOCK_POLL_MS = 100;
const WINDOWS_RENAME_RETRY_MS = 25;
/** Largest lock or guard file read; bigger files parse as ownerless. */
const LOCK_FILE_MAX_BYTES = 1024;

/**
 * Owner nonces of the takeover guards this process holds right now, shared
 * by every store instance. A guard on disk with our pid but a nonce not in
 * here was left behind by a failed release and may be removed at once.
 */
const heldGuardOwners = new Set<string>();

/**
 * Guard paths that a store instance in this process is reclaiming right now
 * (inspect, remove, create again). Only one instance at a time may do this
 * for a given guard, so two instances never both judge the same own-pid
 * orphan abandoned and the later one never unlinks the earlier one's guard.
 */
const guardsBeingReclaimed = new Set<string>();

/** A lock or guard file as read from disk. */
interface KimiCodeLockFileState {
  readonly owner?: string;
  readonly pid?: number;
  readonly mtimeMs: number;
  /** It exists but could not be read: owner unknown, treat as held. */
  readonly unreadable?: true;
}

/** What is on disk right now. Never logged. */
export interface KimiCodeDetection {
  /** `~/.kimi-code` exists. */
  readonly cliDetected: boolean;
  /** Absolute path of the active token file, when one was found. */
  readonly file?: string;
  /** Parsed token file, when `file` is set. */
  readonly tokens?: KimiCodeTokenFile;
}

export type KimiCodeLockResult<T> =
  | { readonly acquired: true; readonly value: T }
  | { readonly acquired: false };

export type KimiCodeWriteOutcome = 'written' | 'cas-lost';

/** Fields a refresh replaces in the token file. */
export interface KimiCodeRotatedTokens {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_at: number;
  readonly expires_in?: number;
  readonly token_type?: string;
  readonly scope?: string;
}

export interface KimiCodeCredentialStoreOptions {
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly lockWaitMs?: number;
  /** Whether a takeover guard's holder still runs; defaults to a signal-0 probe. */
  readonly isProcessAlive?: (pid: number) => boolean;
}

export class KimiCodeCredentialStore {
  private cached: { at: number; detection: KimiCodeDetection } | null = null;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly lockWaitMs: number;
  private readonly isProcessAlive: (pid: number) => boolean;

  constructor(
    private readonly home: KimiCodeHomeResolver,
    private readonly logger: Logger,
    options: KimiCodeCredentialStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
    this.lockWaitMs = options.lockWaitMs ?? KIMI_CODE_LOCK_WAIT_MS;
    this.isProcessAlive = options.isProcessAlive ?? isProcessAlive;
  }

  /** Drop the read cache so the next `detect()` reads disk. */
  invalidate(): void {
    this.cached = null;
  }

  /** Locate and read the active CLI login (5 s cache). */
  async detect(): Promise<KimiCodeDetection> {
    const cached = this.cached;
    if (cached && this.now() - cached.at < KIMI_CODE_CACHE_TTL_MS) {
      return cached.detection;
    }
    const detection = await this.readDetection();
    this.cached = { at: this.now(), detection };
    return detection;
  }

  /** `config.toml` values; defaults when the file is missing or unreadable. */
  async readConfig(): Promise<KimiCodeOAuthConfig> {
    const text = await this.readBoundedText(
      this.home.configFile,
      KIMI_CODE_CONFIG_MAX_BYTES,
    );
    return readKimiCodeOAuthConfig(text ?? '');
  }

  /** The CLI device id, or undefined when absent or not UUID-shaped. */
  async readDeviceId(): Promise<string | undefined> {
    const text = await this.readBoundedText(this.home.deviceIdFile, 256);
    const parsed = kimiCodeDeviceIdSchema.safeParse(text ?? '');
    return parsed.success ? parsed.data : undefined;
  }

  /** The CLI region; `global` unless the file says `mainland-cn`. */
  async readRegion(): Promise<KimiCodeRegion> {
    const text = await this.readBoundedText(this.home.regionFile, 256);
    const parsed = kimiCodeRegionSchema.safeParse((text ?? '').trim());
    return parsed.success ? parsed.data : 'global';
  }

  /** Re-read one token file, bypassing the cache. */
  async readTokenFile(file: string): Promise<KimiCodeTokenFile | undefined> {
    const text = await this.readBoundedText(file, KIMI_CODE_TOKEN_FILE_MAX_BYTES);
    if (text === undefined) return undefined;
    return parseTokenFile(text, this.logger);
  }

  /**
   * Run `fn` while holding `<file>.ptah-refresh.lock` (exclusive create).
   *
   * The lock coordinates Ptah processes (Electron, VS Code, CLI) refreshing
   * the same login. The Kimi Code CLI does not take it; {@link writeRotated}
   * only narrows the race with the CLI. The lock file carries a random owner
   * nonce. The lock path is only ever vacated by an unlink made while holding
   * the short takeover guard `<lock>.takeover`: release (only while the nonce
   * is still ours) and stale takeover (only of the exact lock judged stale)
   * are serialized by that guard, so a live lock is never removed or moved.
   * A lock older than {@link KIMI_CODE_LOCK_STALE_MS} is taken over. Gives
   * up after the wait budget with `{ acquired: false }`: every pass checks
   * the deadline, also after a takeover attempt, so a stale lock that cannot
   * be deleted never keeps the wait going.
   */
  async withRefreshLock<T>(
    file: string,
    fn: () => Promise<T>,
  ): Promise<KimiCodeLockResult<T>> {
    const lockPath = `${file}.ptah-refresh.lock`;
    const deadline = this.now() + this.lockWaitMs;
    const owner = randomUUID();
    for (;;) {
      if (await this.tryCreateLock(lockPath, owner)) break;
      if (
        (await this.removeIfStale(lockPath)) &&
        (await this.tryCreateLock(lockPath, owner))
      ) {
        break;
      }
      if (this.now() >= deadline) {
        this.logger.warn('[KimiCodeAuth] Refresh lock wait timed out');
        return { acquired: false };
      }
      await this.sleep(LOCK_POLL_MS);
    }
    try {
      return { acquired: true, value: await fn() };
    } finally {
      await this.releaseLock(lockPath, owner);
    }
  }

  /**
   * Write rotated tokens into `file` if its refresh token still equals
   * `expectedRefreshToken`. Every other field of the current file is
   * preserved. Temp file + rename, mode 0600.
   *
   * This is not a true compare-and-swap: the Kimi Code CLI does not take the
   * Ptah lock, and a rename cannot be made conditional on file content. The
   * refresh token is compared twice, before the temp file is built and again
   * right before the rename, which narrows the window in which a concurrent
   * `kimi login` or CLI refresh can be overwritten. It does not eliminate it:
   * a CLI write between the second read and the rename is still replaced.
   *
   * @returns `'cas-lost'` when the file changed meanwhile (the CLI won); our
   *   tokens are then discarded and the disk file is adopted.
   * @throws on I/O failure, so the caller can retain the tokens and retry.
   */
  async writeRotated(
    file: string,
    expectedRefreshToken: string,
    next: KimiCodeRotatedTokens,
  ): Promise<KimiCodeWriteOutcome> {
    const text = await readFile(file, 'utf8');
    const current = parseTokenFile(text, this.logger);
    if (!current || current.refresh_token !== expectedRefreshToken) {
      this.invalidate();
      return 'cas-lost';
    }
    const merged: KimiCodeTokenFile = { ...current, ...next };
    const tmpPath = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, JSON.stringify(merged), {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      // Second compare, as late as possible: building the temp file took
      // time in which the CLI may have written.
      const latest = parseTokenFile(await readFile(file, 'utf8'), this.logger);
      if (!latest || latest.refresh_token !== expectedRefreshToken) {
        this.logger.info(
          '[KimiCodeAuth] Token file changed before the write; keeping the newer file',
        );
        this.invalidate();
        return 'cas-lost';
      }
      await this.renameWithRetry(tmpPath, file);
    } finally {
      await unlink(tmpPath).catch(() => {
        // degradation-audit: optional-capability - the rename normally consumed
        // the temp file; cleanup must not mask the write outcome.
      });
    }
    this.invalidate();
    return 'written';
  }

  private async readDetection(): Promise<KimiCodeDetection> {
    const cliDetected = await isDirectory(this.home.path);
    if (!cliDetected) return { cliDetected: false };

    const config = await this.readConfig();
    if (config.oauthKey) {
      const name = config.oauthKey.slice('oauth/'.length);
      const derived = join(this.home.credentialsDir, `${name}.json`);
      const tokens = await this.readTokenFile(derived);
      if (tokens) return { cliDetected, file: derived, tokens };
    }
    return { cliDetected, ...(await this.scanCredentials()) };
  }

  /** Newest schema-valid `credentials/*.json` with scope `kimi-code`. */
  private async scanCredentials(): Promise<{
    file?: string;
    tokens?: KimiCodeTokenFile;
  }> {
    let names: string[];
    try {
      names = await readdir(this.home.credentialsDir);
    } catch (error: unknown) {
      // degradation-audit: reported - no credentials directory means no CLI
      // login; the category is logged and the caller falls back to the key.
      this.logger.debug(
        `[KimiCodeAuth] No credentials directory (${errorCode(error)})`,
      );
      return {};
    }
    let best: { file: string; tokens: KimiCodeTokenFile; mtime: number } | null =
      null;
    let matches = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = join(this.home.credentialsDir, name);
      const tokens = await this.readTokenFile(file);
      if (!tokens || tokens.scope !== KIMI_CODE_TOKEN_SCOPE) continue;
      matches += 1;
      const mtime = (await statOrUndefined(file))?.mtimeMs ?? 0;
      if (!best || mtime > best.mtime) best = { file, tokens, mtime };
    }
    if (matches > 1) {
      this.logger.info(
        `[KimiCodeAuth] ${matches} Kimi Code logins found; using the newest`,
      );
    }
    return best ? { file: best.file, tokens: best.tokens } : {};
  }

  private async tryCreateLock(lockPath: string, owner: string): Promise<boolean> {
    try {
      await writeFile(
        lockPath,
        JSON.stringify({ owner, pid: process.pid, at: this.now() }),
        { encoding: 'utf8', mode: 0o600, flag: 'wx' },
      );
      return true;
    } catch (error: unknown) {
      if (errorCode(error) === 'EEXIST') return false;
      throw error;
    }
  }

  /**
   * Remove the lock, under the takeover guard, only while it still carries
   * our owner nonce. The guard keeps a stale takeover (and the new lock it
   * admits) from landing between our owner check and our unlink.
   */
  private async releaseLock(lockPath: string, owner: string): Promise<void> {
    const deadline = this.now() + KIMI_CODE_GUARD_STALE_MS + LOCK_POLL_MS;
    for (;;) {
      let unreadable = false;
      const released = await this.withTakeoverGuard(lockPath, async () => {
        const current = await this.readLockFile(lockPath);
        if (current?.unreadable) {
          unreadable = true; // Owner unknown: try again on the next pass.
          return;
        }
        if (current?.owner !== owner) {
          this.logger.warn(
            '[KimiCodeAuth] Refresh lock was taken over; leaving it to its new owner',
          );
          return;
        }
        await this.unlinkLock(lockPath, 'release');
      });
      if (released && !unreadable) return;
      if (this.now() >= deadline) {
        // A lock left behind only delays the next refresh until it is stale.
        this.logger.warn(
          '[KimiCodeAuth] Could not release refresh lock (guard busy or lock unreadable)',
        );
        return;
      }
      await this.sleep(LOCK_POLL_MS);
    }
  }

  /**
   * Take over a lock older than {@link KIMI_CODE_LOCK_STALE_MS}.
   *
   * The lock is judged stale outside the guard, then re-read inside it and
   * unlinked only if it is still that same lock (same owner nonce and
   * mtime) and still stale. A lock created meanwhile by another contender is
   * left in place; nothing is ever renamed aside, so a live lock path is
   * never vacant. Returns true when the next exclusive create may succeed;
   * false when the lock is live, the guard is busy, or the unlink failed.
   */
  private async removeIfStale(lockPath: string): Promise<boolean> {
    const judged = await this.readLockFile(lockPath);
    if (!judged) return true; // Released between our attempts: retry now.
    if (judged.unreadable) return false; // Owner unknown: never judged stale.
    if (this.now() - judged.mtimeMs < KIMI_CODE_LOCK_STALE_MS) return false;
    let removed = false;
    await this.withTakeoverGuard(lockPath, async () => {
      const current = await this.readLockFile(lockPath);
      if (!current) {
        removed = true;
        return;
      }
      if (
        current.unreadable ||
        current.owner !== judged.owner ||
        current.mtimeMs !== judged.mtimeMs ||
        this.now() - current.mtimeMs < KIMI_CODE_LOCK_STALE_MS
      ) {
        return; // Another contender already replaced it.
      }
      this.logger.info('[KimiCodeAuth] Taking over a stale refresh lock');
      removed = await this.unlinkLock(lockPath, 'takeover');
    });
    return removed;
  }

  /**
   * Run `fn` holding `<lock>.takeover` (exclusive create). Returns false
   * without running `fn` when another process holds the guard. A guard is
   * removed once (and the create retried) only when its holder is gone:
   * - it carries this process's pid but a nonce no guard holder in this
   *   process owns (its release unlink failed earlier): removed at once,
   *   while one with our pid and a held nonce is always respected;
   * - it is older than {@link KIMI_CODE_GUARD_STALE_MS} and either carries
   *   another pid that no longer runs, or parses without a `pid` (an older
   *   or torn file).
   * Age alone never frees it, so a holder that was merely paused cannot
   * resume and unlink a lock created after its guard was stolen. A guard
   * that exists but cannot be read is treated as held. Released in
   * `finally`, only while it still carries our nonce.
   *
   * Residual limits: the OS can reuse a dead holder's pid, which keeps its
   * guard until that unrelated process exits; two processes that both find
   * the same dead guard may race on its removal (both need a process that
   * died inside the guard); and a guard this process failed to release
   * blocks other processes until this process next touches the lock or
   * exits.
   */
  private async withTakeoverGuard(
    lockPath: string,
    fn: () => Promise<void>,
  ): Promise<boolean> {
    const guardPath = `${lockPath}.takeover`;
    const owner = randomUUID();
    // Registered before the create, so no other store in this process can
    // see our fresh guard as an orphan.
    heldGuardOwners.add(owner);
    try {
      if (!(await this.acquireGuard(guardPath, owner))) return false;
      try {
        await fn();
        return true;
      } finally {
        if ((await this.readLockFile(guardPath))?.owner === owner) {
          await this.unlinkLock(guardPath, 'guard release');
        }
      }
    } finally {
      // Whatever the unlink did: a guard left behind is now an orphan that
      // this process reclaims on its next attempt.
      heldGuardOwners.delete(owner);
    }
  }

  /** Exclusive-create the guard, removing an abandoned one at most once. */
  private async acquireGuard(guardPath: string, owner: string): Promise<boolean> {
    if (await this.tryCreateLock(guardPath, owner)) return true;
    // Another instance here is reclaiming it: same answer as a held guard.
    if (guardsBeingReclaimed.has(guardPath)) return false;
    guardsBeingReclaimed.add(guardPath);
    try {
      const guard = await this.readLockFile(guardPath);
      if (guard && !this.isGuardAbandoned(guard)) return false;
      if (guard) {
        this.logger.info('[KimiCodeAuth] Removing a stale refresh takeover guard');
        await this.unlinkLock(guardPath, 'stale guard');
      }
      return await this.tryCreateLock(guardPath, owner);
    } finally {
      guardsBeingReclaimed.delete(guardPath);
    }
  }

  private isGuardAbandoned(guard: KimiCodeLockFileState): boolean {
    if (guard.unreadable) return false;
    if (guard.pid === process.pid) {
      // Our pid is alive by definition; only the held set says whether a
      // holder here still owns it. Not held: a failed release left it.
      return guard.owner === undefined || !heldGuardOwners.has(guard.owner);
    }
    if (this.now() - guard.mtimeMs < KIMI_CODE_GUARD_STALE_MS) return false;
    return guard.pid === undefined || !this.isProcessAlive(guard.pid);
  }

  /**
   * Owner nonce and writer pid (each undefined when unparseable) and mtime
   * of a lock or guard file; undefined when the file does not exist.
   * `unreadable` when it exists but its content could not be read: its
   * owner is then unknown, not absent, and it must not be removed.
   */
  private async readLockFile(
    path: string,
  ): Promise<KimiCodeLockFileState | undefined> {
    const info = await statOrUndefined(path);
    if (!info) return undefined;
    let text = '';
    if (info.isFile() && info.size <= LOCK_FILE_MAX_BYTES) {
      try {
        text = await readFile(path, 'utf8');
      } catch (error: unknown) {
        // degradation-audit: reported - ENOENT means it is gone; any other
        // read error keeps the lock as held and callers retry within their
        // bounded wait.
        const code = errorCode(error);
        if (code === 'ENOENT') return undefined;
        this.logger.debug(`[KimiCodeAuth] Lock file unreadable (${code})`);
        return { mtimeMs: info.mtimeMs, unreadable: true };
      }
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // degradation-audit: optional-capability - an unparseable lock file has
      // no owner we recognise; it can still be taken over once stale.
      return { mtimeMs: info.mtimeMs };
    }
    const parsed = kimiCodeRefreshLockSchema.safeParse(json);
    return parsed.success
      ? { owner: parsed.data.owner, pid: parsed.data.pid, mtimeMs: info.mtimeMs }
      : { mtimeMs: info.mtimeMs };
  }

  /**
   * Unlink a lock or guard file. True when it is gone (removed now, or
   * already absent); false when the removal failed and the file remains.
   */
  private async unlinkLock(path: string, purpose: string): Promise<boolean> {
    try {
      await unlink(path);
      return true;
    } catch (error: unknown) {
      // degradation-audit: reported - ENOENT means it is already gone; on
      // any other error the file stays, callers treat false as "not
      // removed" and fall back to the bounded lock wait.
      const code = errorCode(error);
      if (code === 'ENOENT') return true;
      this.logger.warn(
        `[KimiCodeAuth] Could not remove refresh lock file: ${purpose} (${code})`,
      );
      return false;
    }
  }

  private async renameWithRetry(from: string, to: string): Promise<void> {
    try {
      await rename(from, to);
    } catch (error: unknown) {
      const code = errorCode(error);
      if (code !== 'EPERM' && code !== 'EBUSY') throw error;
      // Windows: a reader (the CLI, an editor, AV) briefly holds the target.
      this.logger.info(`[KimiCodeAuth] Retrying token write (${code})`);
      await this.sleep(WINDOWS_RENAME_RETRY_MS);
      await rename(from, to);
    }
  }

  /** UTF-8 text of `file` when it exists and is at most `maxBytes`. */
  private async readBoundedText(
    file: string,
    maxBytes: number,
  ): Promise<string | undefined> {
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > maxBytes) return undefined;
      return await readFile(file, 'utf8');
    } catch (error: unknown) {
      // degradation-audit: reported - a missing or unreadable file reads as
      // "absent"; every caller has a documented default or fallback.
      this.logger.debug(
        `[KimiCodeAuth] File unavailable (${errorCode(error)})`,
      );
      return undefined;
    }
  }
}

function parseTokenFile(
  text: string,
  logger: Logger,
): KimiCodeTokenFile | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // degradation-audit: reported - malformed JSON reads as "not logged in";
    // the category is logged, never the content.
    logger.warn('[KimiCodeAuth] Token file is not valid JSON');
    return undefined;
  }
  const parsed = kimiCodeTokenFileSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn('[KimiCodeAuth] Token file does not match the expected shape');
    return undefined;
  }
  return parsed.data;
}

async function isDirectory(path: string): Promise<boolean> {
  const info = await statOrUndefined(path);
  return info?.isDirectory() ?? false;
}

/** `stat`, or undefined when the path does not exist or cannot be read. */
async function statOrUndefined(
  path: string,
): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch {
    // degradation-audit: optional-capability - absence is the answer here;
    // every caller treats a missing path as "not there".
    return undefined;
  }
}

/**
 * Signal-0 probe: ESRCH means no such process. EPERM (exists, owned by
 * another user) and success both mean it still runs.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // degradation-audit: optional-capability - the error code is the answer;
    // anything but ESRCH is read as alive, which keeps the guard (safe side).
    return errorCode(error) !== 'ESRCH';
  }
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'unknown';
}
