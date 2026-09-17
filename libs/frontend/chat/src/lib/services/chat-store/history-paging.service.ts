import { Injectable, inject, signal } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  HISTORY_TAIL_PAGE_EVENTS,
  type ChatResumeResult,
  type SessionId,
} from '@ptah-extension/shared';
import { SessionHistoryReplayer } from './session-history-replayer.service';

export type OlderHistoryLoadOutcome =
  | 'prepended'
  | 'none'
  | 'superseded'
  | 'stale'
  | 'failed';

@Injectable({ providedIn: 'root' })
export class HistoryPagingService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly replayer = inject(SessionHistoryReplayer);

  private readonly inFlight = new Map<
    string,
    Promise<OlderHistoryLoadOutcome>
  >();
  private readonly _loadingTabIds = signal<ReadonlySet<string>>(new Set());
  readonly loadingTabIds = this._loadingTabIds.asReadonly();

  tailRequest(): { readonly maxEvents: number } {
    return { maxEvents: HISTORY_TAIL_PAGE_EVENTS };
  }

  recordTail(tabId: string, result: ChatResumeResult | undefined): void {
    this.tabManager.setOlderHistoryCursor(
      tabId,
      result?.historyPage?.olderCursor ?? null,
    );
  }

  loadOlder(tabId: string): Promise<OlderHistoryLoadOutcome> {
    const existing = this.inFlight.get(tabId);
    if (existing) return existing;

    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
    if (!tab?.olderHistoryCursor || !tab.claudeSessionId) {
      return Promise.resolve('none');
    }
    const sessionId = tab.claudeSessionId as SessionId;
    if (
      !this.replayer.canReplayOlderPage(
        tabId,
        sessionId,
        tab.olderHistoryCursor,
      )
    ) {
      return Promise.resolve('superseded');
    }

    this.setLoading(tabId, true);
    const pending = this.runLoadOlder(
      tabId,
      sessionId,
      tab.olderHistoryCursor,
    ).finally(() => {
      if (this.inFlight.get(tabId) === pending) this.inFlight.delete(tabId);
      this.setLoading(tabId, false);
    });
    this.inFlight.set(tabId, pending);
    return pending;
  }

  private async runLoadOlder(
    tabId: string,
    sessionId: SessionId,
    requestCursor: string,
  ): Promise<OlderHistoryLoadOutcome> {
    let outcome: OlderHistoryLoadOutcome = 'failed';
    try {
      const result = await this.rpc.call('chat:history-page', {
        sessionId,
        cursor: requestCursor,
        workspacePath: this.vscode.config().workspaceRoot,
      });
      if (!result.success && result.errorCode === 'HISTORY_CURSOR_STALE') {
        this.tabManager.setOlderHistoryCursor(tabId, null);
        return 'stale';
      }
      if (!result.success || !result.data) return 'failed';

      outcome = await this.replayer.replayOlderPage(
        result.data.events,
        tabId,
        sessionId,
        requestCursor,
        result.data.olderCursor,
        [...result.data.resumableSubagents],
      );
    } catch (error: unknown) {
      console.error('[HistoryPagingService] failed to load older history', {
        tabId,
        error,
      });
    }
    return outcome;
  }

  private setLoading(tabId: string, loading: boolean): void {
    const next = new Set(this._loadingTabIds());
    if (loading) next.add(tabId);
    else next.delete(tabId);
    this._loadingTabIds.set(next);
  }
}
