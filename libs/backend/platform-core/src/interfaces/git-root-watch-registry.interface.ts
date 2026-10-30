/**
 * IGitRootWatchRegistry — the lease port behind `git:watchRoots`
 * (TASK_2026_855). Gated by the `gitRootWatch` capability; registered only by
 * hosts that can run secondary per-root git watchers (Electron).
 *
 * A lease is a renderer's declarative set of roots it wants live
 * `git:status-update` pushes for. Each call replaces the lease's whole set;
 * a lease that is not renewed expires on its own. Roots are validated by the
 * caller (`GitRootResolver`) before they reach the registry.
 */
export interface GitRootWatchLeaseOutcome {
  /** Roots of this lease that have a running watcher after the call. */
  readonly watched: readonly string[];
  /** Roots of this lease left unwatched by the global watcher cap. */
  readonly evicted: readonly string[];
}

export interface IGitRootWatchRegistry {
  /** Replace the canonical roots `leaseId` holds; roots are pre-validated. */
  setLease(leaseId: string, roots: readonly string[]): GitRootWatchLeaseOutcome;
}
