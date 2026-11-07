/**
 * What the main connection knows about its WAL: who checkpoints it, and the
 * last size the scheduler measured. Owned by `SqliteConnectionService`.
 *
 * `wal_autocheckpoint` stays at SQLite's default unless a host-only scheduler
 * proves an off-main checkpointer works and sets it to 0. Two values are kept
 * apart on purpose:
 *  - `requested` — what the host asked for; re-applied on every open, so it
 *    outlives a database reset. Changed only by a verified apply (or, while
 *    no connection is open, by the request itself).
 *  - `effective` — what SQLite reported back on the CURRENT connection. A
 *    fresh connection starts at SQLite's default. Only this value answers
 *    "do commits still checkpoint?", so state never claims more than SQLite
 *    confirmed (review-11 finding 2).
 */

/** SQLite's compiled-in `wal_autocheckpoint` default, in pages. */
export const SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES = 1000;

/** Largest override accepted; far beyond any sane threshold. */
const MAX_WAL_AUTOCHECKPOINT_PAGES = 1_000_000;

/** Fields `[SQLite] slow statement` lines carry for WAL attribution. */
export type WalSlowStatementContext = {
  /** `worker` when commits no longer checkpoint; `sqlite-auto` otherwise. */
  readonly walCheckpoints: 'worker' | 'sqlite-auto';
  /** Last measured `-wal` file size, when a scheduler measures it. */
  readonly walBytes?: number;
  /** How long ago `walBytes` was measured. */
  readonly walMeasuredAgoMs?: number;
};

/**
 * Outcome of `SqliteConnectionService.setWalAutoCheckpoint`.
 *  - `applied`  — set on the open connection and read back as requested.
 *  - `deferred` — no connection is open; it is applied at the next open.
 *  - `failed`   — SQLite rejected it or read back another value. Nothing in
 *    the connection's state changed.
 */
export type WalAutoCheckpointOutcome =
  | { readonly status: 'applied'; readonly pages: number }
  | { readonly status: 'deferred' }
  | { readonly status: 'failed'; readonly error: Error };

/**
 * The INJECTION GUARD for the pragma text: a pragma argument cannot be bound,
 * so only a proved integer in range is ever interpolated.
 *
 * @throws RangeError when `pages` is not an integer in range.
 */
export function assertWalAutoCheckpointPages(pages: number | null): void {
  if (pages === null) return;
  if (
    !Number.isInteger(pages) ||
    pages < 0 ||
    pages > MAX_WAL_AUTOCHECKPOINT_PAGES
  ) {
    throw new RangeError(
      `wal_autocheckpoint must be an integer in 0..${MAX_WAL_AUTOCHECKPOINT_PAGES}, got ${String(pages)}`,
    );
  }
}

/** The page count a request means: `null` is SQLite's default. */
export function walAutoCheckpointPages(pages: number | null): number {
  return pages ?? SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES;
}

export class WalCheckpointState {
  private requestedPages: number | null = null;
  private effectivePages = SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES;
  private walBytes: number | null = null;
  private walMeasuredAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** `null` = SQLite's default; applied on every open when not null. */
  get requested(): number | null {
    return this.requestedPages;
  }

  /** True when SQLite confirmed that commits no longer checkpoint. */
  get checkpointsOffMainThread(): boolean {
    return this.effectivePages === 0;
  }

  /** A fresh connection runs at SQLite's default until a verified apply. */
  noteConnectionOpened(): void {
    this.effectivePages = SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES;
  }

  /** No connection: commits cannot checkpoint, and nothing is effective. */
  noteConnectionClosed(): void {
    this.effectivePages = SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES;
  }

  /** Record a request made while no connection is open. */
  defer(pages: number | null): void {
    this.requestedPages = pages;
  }

  /** Record a verified apply on the open connection. */
  confirm(pages: number | null, effectivePages: number): void {
    this.requestedPages = pages;
    this.effectivePages = effectivePages;
  }

  noteWalBytes(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes < 0) return;
    this.walBytes = bytes;
    this.walMeasuredAt = this.now();
  }

  slowStatementContext(): WalSlowStatementContext {
    const walCheckpoints = this.checkpointsOffMainThread
      ? 'worker'
      : 'sqlite-auto';
    if (this.walBytes === null) return { walCheckpoints };
    return {
      walCheckpoints,
      walBytes: this.walBytes,
      walMeasuredAgoMs: Math.max(0, this.now() - this.walMeasuredAt),
    };
  }
}
