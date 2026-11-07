/**
 * What the main connection knows about its WAL: who checkpoints it, and the
 * last size the scheduler measured. Owned by `SqliteConnectionService`.
 *
 * `wal_autocheckpoint` stays at SQLite's default unless a host-only scheduler
 * proves an off-main checkpointer works and sets it to 0. The setting outlives
 * a reopen (database reset), so it is re-applied on every open.
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

export class WalCheckpointState {
  private override: number | null = null;
  private walBytes: number | null = null;
  private walMeasuredAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** `null` = SQLite's default threshold; `0` = commits never checkpoint. */
  get autoCheckpointOverride(): number | null {
    return this.override;
  }

  /** True when commits on the main connection no longer checkpoint. */
  get checkpointsOffMainThread(): boolean {
    return this.override === 0;
  }

  /**
   * The INJECTION GUARD for {@link autoCheckpointPragma}: a pragma argument
   * cannot be bound, so only a proved integer in range is ever stored.
   */
  setAutoCheckpointOverride(pages: number | null): void {
    if (
      pages !== null &&
      !(
        Number.isInteger(pages) &&
        pages >= 0 &&
        pages <= MAX_WAL_AUTOCHECKPOINT_PAGES
      )
    ) {
      throw new RangeError(
        `wal_autocheckpoint must be an integer in 0..${MAX_WAL_AUTOCHECKPOINT_PAGES}, got ${String(pages)}`,
      );
    }
    this.override = pages;
  }

  /** The pragma that applies the current setting. */
  autoCheckpointPragma(): string {
    const pages = this.override ?? SQLITE_DEFAULT_WAL_AUTOCHECKPOINT_PAGES;
    return `wal_autocheckpoint = ${pages}`;
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
