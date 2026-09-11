/**
 * Bounded, exactly-validated cache of per-file usage ledgers.
 *
 * ## Validity is the file, not a clock
 *
 * An entry is keyed by absolute path and carries the `(size, mtimeMs)` of the
 * `fs.stat` taken before its projection, and the projection reads exactly
 * `size` bytes. A transcript is append-only: an appended turn moves the size
 * and a rewrite moves the mtime, so the pair is an exact validity token (the
 * same reasoning as `JsonlReaderService.readJsonlMessages`). There is no TTL.
 *
 * Directory membership — which subagent files belong to a session — is NOT
 * cached here. `SessionStatsReaderService` re-lists and re-stats it on every
 * request, so an added or removed subagent file is seen immediately.
 *
 * Cost is not cached either: ledgers hold tokens only and the aggregator
 * prices them at serve time, so a rate-card change needs no invalidation.
 *
 * ## Bounds and coalescing
 *
 * Least-recently-used eviction holds both an entry cap and an estimated byte
 * cap; a ledger larger than the byte cap on its own is served but not stored.
 * Concurrent requests for the same `(path, size, mtime)` share one projection.
 * A failed or aborted projection is never stored.
 *
 * ## A caller's outcome depends only on its own signal
 *
 * A shared projection runs under the signal of the caller that started it. If
 * that caller aborts, every waiter riding on the projection sees an
 * `AbortError` that is not theirs. A waiter whose own signal is still live
 * therefore never rethrows it: it re-checks the cache and joins (or starts) the
 * next projection, up to {@link MAX_COALESCE_ATTEMPTS} joins. After that it
 * stops trusting other callers' signals and runs a projection of its own, so
 * the loop is bounded and the only abort a caller can receive is its own.
 */

import type { SessionUsageLedger } from './session-usage-ledger';

/** Validity token for one transcript file. */
export interface TranscriptFileToken {
  readonly size: number;
  readonly mtimeMs: number;
}

export interface LedgerCacheLimits {
  readonly maxEntries: number;
  readonly maxBytes: number;
}

interface CacheEntry {
  readonly token: TranscriptFileToken;
  readonly ledger: SessionUsageLedger;
}

/**
 * Shared projections a waiter joins before it runs its own. Each failed join
 * was aborted by another caller; past this many, coalescing is costing the
 * waiter correctness instead of saving it work.
 */
export const MAX_COALESCE_ATTEMPTS = 3;

export const DEFAULT_LEDGER_CACHE_LIMITS: LedgerCacheLimits = {
  maxEntries: 512,
  maxBytes: 16 * 1024 * 1024,
};

export class SessionUsageLedgerCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<SessionUsageLedger>>();
  private bytes = 0;

  constructor(
    private readonly limits: LedgerCacheLimits = DEFAULT_LEDGER_CACHE_LIMITS,
  ) {}

  /** Number of stored ledgers. */
  get size(): number {
    return this.entries.size;
  }

  /** Sum of stored ledgers' estimated bytes. */
  get estimatedBytes(): number {
    return this.bytes;
  }

  /**
   * The ledger for `filePath` at `token`, projecting it with `project` on a
   * miss. Concurrent callers with the same path and token share one call.
   *
   * `project` must run under `signal`: when this caller ends up starting the
   * projection, other callers inherit that signal's outcome, and when it runs
   * its own after exhausting joins, nobody else does.
   */
  async getOrProject(
    filePath: string,
    token: TranscriptFileToken,
    project: () => Promise<SessionUsageLedger>,
    signal?: AbortSignal,
  ): Promise<SessionUsageLedger> {
    const cached = this.read(filePath, token);
    if (cached) return cached;

    // NUL cannot occur in a path, so the key cannot collide across fields.
    const key = `${filePath}\u0000${token.size}\u0000${token.mtimeMs}`;
    for (let joins = 0; joins < MAX_COALESCE_ATTEMPTS; joins++) {
      signal?.throwIfAborted();
      // A projection that settled while this caller waited may have stored.
      const settled = this.read(filePath, token);
      if (settled) return settled;
      const shared = this.inFlight.get(key);
      if (!shared) return this.startShared(key, filePath, token, project);
      try {
        return await shared;
      } catch (error: unknown) {
        // This caller's own abort is reported with its own reason, never with
        // whatever the shared projection happened to reject with.
        signal?.throwIfAborted();
        // A real failure of the file is everyone's failure.
        if (!isAbortError(error)) throw error;
        // Another caller's abort: not this caller's outcome. Try again.
      }
    }

    signal?.throwIfAborted();
    const settled = this.read(filePath, token);
    if (settled) return settled;
    if (!this.inFlight.has(key)) {
      return this.startShared(key, filePath, token, project);
    }
    // Joins kept being aborted by other callers: project privately, under this
    // caller's signal only. Not registered, so no one else can inherit it.
    const ledger = await project();
    this.store(filePath, token, ledger);
    return ledger;
  }

  /** Drop every stored ledger. In-flight projections are unaffected. */
  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  private async startShared(
    key: string,
    filePath: string,
    token: TranscriptFileToken,
    project: () => Promise<SessionUsageLedger>,
  ): Promise<SessionUsageLedger> {
    const running = project();
    this.inFlight.set(key, running);
    try {
      const ledger = await running;
      this.store(filePath, token, ledger);
      return ledger;
    } finally {
      // By identity: a newer projection for the same key must not be evicted.
      if (this.inFlight.get(key) === running) this.inFlight.delete(key);
    }
  }

  private read(
    filePath: string,
    token: TranscriptFileToken,
  ): SessionUsageLedger | null {
    const entry = this.entries.get(filePath);
    if (!entry) return null;
    if (
      entry.token.size !== token.size ||
      entry.token.mtimeMs !== token.mtimeMs
    ) {
      this.drop(filePath);
      return null;
    }
    this.entries.delete(filePath);
    this.entries.set(filePath, entry);
    return entry.ledger;
  }

  private store(
    filePath: string,
    token: TranscriptFileToken,
    ledger: SessionUsageLedger,
  ): void {
    this.drop(filePath);
    if (ledger.estimatedBytes > this.limits.maxBytes) return;
    this.entries.set(filePath, { token, ledger });
    this.bytes += ledger.estimatedBytes;
    for (const [key] of this.entries) {
      if (
        this.entries.size <= this.limits.maxEntries &&
        this.bytes <= this.limits.maxBytes
      ) {
        break;
      }
      this.drop(key);
    }
  }

  private drop(filePath: string): void {
    const entry = this.entries.get(filePath);
    if (!entry) return;
    this.entries.delete(filePath);
    this.bytes -= entry.ledger.estimatedBytes;
  }
}

/**
 * Shape check, not `instanceof`: `AbortSignal.throwIfAborted()` throws a
 * `DOMException`, which may come from a different realm than this module.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
