/**
 * `IWorkspaceWatcher` — the recursive workspace change feed as a batched,
 * pre-filtered, overflow-signalling contract (TASK_2026_437 C7, INV-1).
 *
 * ## Why this is a separate port
 *
 * `IFileSystemProvider.createFileWatcher` delivers one callback per OS event.
 * That is fine for its scoped, low-volume consumers (`.ptah/specs`, agents,
 * commands) and fatal for a recursive watch of a whole workspace: on
 * 2026-09-14 removing ten agent worktrees delivered tens of thousands of
 * delete events to the Electron main thread, one JavaScript callback each.
 * This port never does that. A consumer receives at most one
 * {@link WorkspaceChangeBatch} per `minBatchIntervalMs` per subscription, each
 * holding at most `maxPathsPerBatch` paths, or a single `overflow` marker that
 * means "events were lost or suppressed — rescan".
 *
 * ## Adapters
 *
 * - Electron: `@parcel/watcher` in a supervised `utilityProcess` host.
 * - CLI: the same host core in a `child_process.fork` child. Not a
 *   `worker_threads` Worker: `@parcel/watcher` loads in one thread per
 *   process, so a restarted Worker host fails to load it.
 * - VS Code: `vscode.workspace.createFileSystemWatcher` (already out of
 *   process) feeding `WorkspaceChangeCoalescer` in the extension host.
 *
 * Every adapter runs `runWorkspaceWatcherContract`
 * (`@ptah-extension/platform-core/testing`), and every adapter batches through
 * `WorkspaceChangeCoalescer`, so the guarantees below are implemented once.
 *
 * ## Exclusions reach this port as parameters
 *
 * The workspace exclusion policy (`WATCH_IGNORED_DIRS`,
 * `NESTED_WORKSPACE_PATH_RULES`, `toWorkspaceExcludeGlobs`) lives in
 * `@ptah-extension/shared`, which platform-core must not import. Consumers
 * pass the policy in as data: directory names, segment rules and globs.
 */

import type { IDisposable } from '../types/platform.types';

/** What happened to a path. Engines that cannot tell create from update report `'update'`. */
export type WorkspaceChangeKind = 'create' | 'update' | 'delete';

/** One coalesced change. */
export interface WorkspaceChange {
  /**
   * Absolute path under the subscribed root, spelled as the watch engine
   * reported it (platform separators). Never excluded, never outside the root.
   */
  readonly path: string;
  /**
   * The most recent kind seen for the path inside this batch window, except
   * that a `'create'` followed by `'update'` stays `'create'`.
   */
  readonly kind: WorkspaceChangeKind;
}

/** What a subscription's listener receives. */
export interface WorkspaceChangeBatch {
  /** The root exactly as passed to {@link IWorkspaceWatcher.watch}. */
  readonly root: string;
  /**
   * Distinct changed paths, at most `maxPathsPerBatch`. Always empty when
   * {@link overflow} is true.
   */
  readonly changes: readonly WorkspaceChange[];
  /**
   * True when distinct paths beyond `maxPathsPerBatch` arrived in this window
   * and were dropped. `changes` is then incomplete; `droppedCount` says by how
   * much. Always false when {@link overflow} is true.
   */
  readonly truncated: boolean;
  /**
   * True when events were lost or deliberately suppressed — an event storm, a
   * native watcher error, a host restart, a degraded adapter. The consumer must
   * treat its view of the tree as stale and rescan once. Carries no paths.
   */
  readonly overflow: boolean;
  /**
   * Events not represented in `changes`: paths over the cap, events swallowed
   * by a storm, or events subsumed by an owed overflow. Zero on a complete
   * batch. A count of raw events, not of distinct paths, while storming.
   */
  readonly droppedCount: number;
}

/** Subscription options. */
export interface WorkspaceWatchOptions {
  /**
   * Globs matched (picomatch, `dot: true`) against the root-relative,
   * forward-slashed path. `**\/dist/**` also excludes the `dist` directory
   * entry itself.
   */
  readonly excludeGlobs: readonly string[];
  /**
   * Directory names matched EXACTLY (case-sensitive) against every single path
   * segment — the `WATCH_IGNORED_DIRS` channel. `node_modules` excludes
   * `pkg/node_modules/x` but not `pkg/Node_Modules/x`.
   */
  readonly excludeDirNames: readonly string[];
  /**
   * Segment-sequence rules — the `NESTED_WORKSPACE_PATH_RULES` channel: a path
   * is excluded when the names of one rule appear as CONSECUTIVE path segments
   * at any depth. `['.claude', 'worktrees']` keeps `.claude` watched while
   * excluding its `worktrees` child. Names match ASCII case-insensitively on
   * every platform; empty segments are skipped; an empty rule matches nothing.
   *
   * With {@link excludeDirNames} this answers exactly what shared
   * `isExcludedWorkspacePath(path, dirs, rules)` answers — pinned by
   * `workspace-exclusion-drift.spec.ts` in workspace-intelligence.
   */
  readonly excludeSegmentRules: readonly (readonly string[])[];
  /**
   * When true, a path whose first `.git` segment sits below the root
   * (`pkg/sub/.git`, a repository's `.git` directory or a worktree's `.git`
   * file) marks `pkg/sub` as a nested repository root, and every later path at
   * or below it is excluded for the life of the subscription.
   */
  readonly nestedRepoDetection: boolean;
  /**
   * Absolute nested repository / worktree roots known up front, normally from
   * `git worktree list`. The adapter never spawns git. Roots outside `root`
   * and `root` itself are ignored.
   */
  readonly nestedRepoRoots?: readonly string[];
  /**
   * Minimum gap between two listener calls. Default and floor 250 ms (INV-1:
   * at most 4 batches per second); smaller values are raised to the floor.
   *
   * It is also the leading-edge hold: the first change after a quiet period
   * is delivered `minBatchIntervalMs` after it arrives, not at once, so a burst
   * whose first event the engine reports alone (`@parcel/watcher` does, up to
   * 500 ms ahead of the rest) still reaches a storm as one incident. A
   * consumer that must see a storm as exactly one `overflow` picks an interval
   * longer than that gap.
   */
  readonly minBatchIntervalMs?: number;
  /**
   * Most distinct paths in one batch. Default and ceiling 500 (INV-1); larger
   * values are lowered to the ceiling, values below 1 use the default.
   */
  readonly maxPathsPerBatch?: number;
}

export type WorkspaceChangeListener = (batch: WorkspaceChangeBatch) => void;

/**
 * Recursive, batched workspace change feed.
 *
 * Guarantees, per subscription:
 * - the listener is called at most once per `minBatchIntervalMs`, and a change
 *   is delivered no later than `minBatchIntervalMs` after it arrives (the first
 *   batch after a quiet period is held for the full interval);
 * - never synchronously inside `watch`;
 * - excluded paths (directory names, segment rules, globs, nested repository
 *   roots) never appear in `changes`;
 * - one loss-of-events incident — a storm, an adapter failure, or both
 *   overlapping — yields one `overflow` batch;
 * - an adapter failure surfaces as one `overflow` batch, followed by
 *   resubscription;
 * - a DEGRADED adapter (its restart budget is spent) reports one
 *   `'workspace-watcher'` degradation per degraded episode, emits `overflow`
 *   immediately, and then repeats `overflow` on a fixed rescan cadence until it
 *   recovers or is disposed. Every adapter uses 60 s
 *   (`WORKSPACE_WATCH_SUPERVISION_DEFAULTS.degradedRescanIntervalMs`; VS Code
 *   applies it to a watcher that cannot be created). Consumers treat each `overflow`
 *   as "rescan once" and must make that rescan idempotent;
 * - after `dispose()` the listener is never called again, and `dispose()` is
 *   idempotent.
 */
export interface IWorkspaceWatcher {
  watch(
    root: string,
    options: WorkspaceWatchOptions,
    listener: WorkspaceChangeListener,
  ): IDisposable;
}
