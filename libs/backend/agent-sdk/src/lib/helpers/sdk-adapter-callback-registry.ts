import type {
  SessionIdResolvedCallback,
  ResultStatsCallback,
  CompactionStartCallback,
  WorktreeCreatedCallback,
  WorktreeRemovedCallback,
} from './index';

export class SdkAdapterCallbackRegistry {
  private sessionIdResolved: SessionIdResolvedCallback | null = null;
  private resultStats: ResultStatsCallback | null = null;
  private compactionStart: CompactionStartCallback | null = null;
  private worktreeCreated: WorktreeCreatedCallback | null = null;
  private worktreeRemoved: WorktreeRemovedCallback | null = null;

  setSessionIdResolved(cb: SessionIdResolvedCallback): void {
    this.sessionIdResolved = cb;
  }

  setResultStats(cb: ResultStatsCallback): void {
    this.resultStats = cb;
  }

  setCompactionStart(cb: CompactionStartCallback): void {
    this.compactionStart = cb;
  }

  setWorktreeCreated(cb: WorktreeCreatedCallback): void {
    this.worktreeCreated = cb;
  }

  setWorktreeRemoved(cb: WorktreeRemovedCallback): void {
    this.worktreeRemoved = cb;
  }

  getSessionIdResolved(): SessionIdResolvedCallback | undefined {
    return this.sessionIdResolved ?? undefined;
  }

  getResultStats(): ResultStatsCallback | undefined {
    return this.resultStats ?? undefined;
  }

  getCompactionStart(): CompactionStartCallback | undefined {
    return this.compactionStart ?? undefined;
  }

  getWorktreeCreated(): WorktreeCreatedCallback | undefined {
    return this.worktreeCreated ?? undefined;
  }

  getWorktreeRemoved(): WorktreeRemovedCallback | undefined {
    return this.worktreeRemoved ?? undefined;
  }

  emitSessionIdResolved(
    tabId: string | undefined,
    realSessionId: string,
  ): void {
    if (this.sessionIdResolved) {
      this.sessionIdResolved(tabId, realSessionId);
    }
  }

  hasSessionIdResolved(): boolean {
    return this.sessionIdResolved !== null;
  }

  clear(): void {
    this.sessionIdResolved = null;
    this.resultStats = null;
    this.compactionStart = null;
    this.worktreeCreated = null;
    this.worktreeRemoved = null;
  }
}
