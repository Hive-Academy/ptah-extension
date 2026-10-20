import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import type { ChatSessionSummary, SessionListResult } from '@ptah-extension/shared';

interface RecentSessionsState {
  readonly workspacePath: string | null;
  readonly sessions: readonly ChatSessionSummary[];
  readonly loading: boolean;
  readonly confirmed: boolean;
  readonly error: string | null;
}

const LOAD_ERROR = 'Unable to load recent sessions.';

/** A compact history read independent of Previous sessions dialog filters. */
@Injectable({ providedIn: 'root' })
export class RecentSessionsStore {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  private readonly state = signal<RecentSessionsState>({
    workspacePath: null,
    sessions: [],
    loading: false,
    confirmed: false,
    error: null,
  });
  private requestSequence = 0;

  readonly workspacePath = computed(() => this.state().workspacePath);
  readonly sessions = computed(() => this.state().sessions);
  readonly loading = computed(() => this.state().loading);
  readonly confirmed = computed(() => this.state().confirmed);
  readonly error = computed(() => this.state().error);

  async load(workspacePath: string): Promise<void> {
    const request = ++this.requestSequence;
    const previous = this.state();
    const sameWorkspace = previous.workspacePath === workspacePath;
    this.state.set({
      workspacePath,
      sessions: sameWorkspace ? previous.sessions : [],
      loading: true,
      confirmed: sameWorkspace && previous.confirmed,
      error: null,
    });

    try {
      const [pinned, unpinned] = await Promise.all([
        this.rpc.call('session:list', {
          workspacePath,
          pinned: true,
          limit: 3,
          offset: 0,
          sort: 'lastActive',
        }),
        this.rpc.call('session:list', {
          workspacePath,
          pinned: false,
          limit: 3,
          offset: 0,
          sort: 'lastActive',
        }),
      ]);
      if (request !== this.requestSequence) return;

      if (!pinned.isSuccess() || !unpinned.isSuccess()) {
        this.logger.error('RecentSessionsStore', 'Session list RPC failed', {
          workspacePath,
          pinnedErrorCode: pinned.errorCode,
          unpinnedErrorCode: unpinned.errorCode,
        });
        this.state.set({ workspacePath, sessions: [], loading: false, confirmed: false, error: LOAD_ERROR });
        return;
      }

      this.state.set({
        workspacePath,
        sessions: this.topThree(pinned.data, unpinned.data),
        loading: false,
        confirmed: true,
        error: null,
      });
    } catch (error: unknown) {
      if (request !== this.requestSequence) return;
      this.logger.error('RecentSessionsStore', 'Session list RPC rejected', {
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      this.state.set({ workspacePath, sessions: [], loading: false, confirmed: false, error: LOAD_ERROR });
    }
  }

  async refresh(): Promise<void> {
    const workspacePath = this.workspacePath();
    if (workspacePath !== null) await this.load(workspacePath);
  }

  private topThree(
    pinned: SessionListResult,
    unpinned: SessionListResult,
  ): readonly ChatSessionSummary[] {
    const byId = new Map<string, ChatSessionSummary>();
    for (const row of [...pinned.sessions, ...unpinned.sessions]) {
      const current = byId.get(row.id);
      if (!current || row.lastActivityAt > current.lastActivityAt) {
        byId.set(row.id, row);
      }
    }
    return [...byId.values()]
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.id.localeCompare(b.id))
      .slice(0, 3);
  }
}
