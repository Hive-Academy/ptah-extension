import { Injectable, signal, inject } from '@angular/core';
import {
  ClaudeRpcService,
  AuthStateService,
  VSCodeService,
} from '@ptah-extension/core';
import { LicenseGetStatusResponse, SessionId } from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import { SessionLivenessReconcilerService } from './session-liveness-reconciler.service';
import { TabState } from '@ptah-extension/chat-types';

/**
 * ChatLifecycleService - Cross-cutting reactive lifecycle work.
 *
 * Responsibilities:
 * - bootstrap: kick off async initialization (loadSessions,
 *   restoreCliSessionsForActiveTab, loadAuthStatus, fetchLicenseStatus)
 *   after services are ready; flips ChatStore._servicesReady via callback
 * - License status fetch with 3-attempt linear backoff
 * - handleAgentSummaryChunk: route agent JSONL chunks to per-tab streaming state
 * - handleSessionIdResolved: replace placeholder tab IDs with real SDK UUIDs
 * - handleChatError: 3-tier tab routing, abort-finalize-before-clear, full state reset
 *
 * All log strings preserved with `[ChatStore]` prefix to maintain debug
 * continuity with consumers and existing log analysis tooling.
 */
@Injectable({ providedIn: 'root' })
export class ChatLifecycleService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly authState = inject(AuthStateService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly compactionLifecycle = inject(CompactionLifecycleService);
  private readonly livenessReconciler = inject(
    SessionLivenessReconcilerService,
  );
  private readonly _licenseStatus = signal<LicenseGetStatusResponse | null>(
    null,
  );
  readonly licenseStatus = this._licenseStatus.asReadonly();

  /**
   * Eagerly initialize services via dynamic import
   * This runs async but updates servicesReady signal when complete
   */
  async bootstrap(setServicesReady: () => void): Promise<void> {
    try {
      setServicesReady();
      const workspaceRoot = this.vscodeService.config().workspaceRoot;
      if (workspaceRoot) {
        this.sessionLoader.loadSessions().catch((err) => {
          console.error('[ChatStore] Failed to auto-load sessions:', err);
        });
        this.sessionLoader.restoreCliSessionsForActiveTab().catch((err) => {
          console.warn('[ChatStore] Failed to restore CLI sessions:', err);
        });
        this.livenessReconciler.reconcileRestoredTabs().catch((err) => {
          console.warn(
            '[ChatStore] Failed to reconcile session liveness:',
            err,
          );
        });
      }
      this.authState.loadAuthStatus().catch((err) => {
        console.error('[ChatStore] Failed to load auth status:', err);
      });
      this.fetchLicenseStatus().catch((err) => {
        console.error('[ChatStore] Failed to fetch license status:', err);
      });
    } catch (error) {
      console.error('[ChatStore] Failed to initialize services:', error);
    }
  }

  /**
   * Fetch the current license status from the backend with retry logic.
   * Called during initialization to populate the membership card (settings
   * panel) with license/membership identity — there are no trial banners or
   * gating UI; that surface was removed (licensing is identity-only).
   *
   * Linear backoff retry (3 attempts) to handle transient network failures.
   * Without retry, the membership card would show stale/loading state for
   * the entire session if the initial fetch fails.
   *
   * @param retries - Number of retry attempts (default: 3)
   */
  async fetchLicenseStatus(retries = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this.claudeRpcService.call(
          'license:getStatus',
          {} as Record<string, never>,
        );

        if (result.isSuccess()) {
          this._licenseStatus.set(result.data);
          return;
        } else {
          if (attempt === retries) {
            console.error(
              '[ChatStore] Failed to fetch license status after retries:',
              result.error,
            );
            this._licenseStatus.set(null);
          }
        }
      } catch (error) {
        if (attempt === retries) {
          console.error(
            '[ChatStore] Error fetching license status after retries:',
            error,
          );
          this._licenseStatus.set(null);
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
  }

  /**
   * Handle agent summary chunk from backend file watcher
   *
   * This is called when the AgentSessionWatcherService detects new content
   * in an agent's JSONL file during streaming. The summary content is
   * stored in StreamingState.agentSummaryAccumulators for the tree builder
   * to read at render time.
   *
   * Stores in StreamingState instead of sessionManager. The
   * ExecutionTreeBuilderService reads from StreamingState, not
   * sessionManager, so summary content must be stored in StreamingState for
   * the UI to render it.
   *
   * Uses agentId (not toolUseId) as the lookup key because:
   * - Hook fires with UUID-format toolUseId (e.g., "b4139c0d-...")
   * - Complete message arrives with Anthropic format toolCallId (e.g., "toolu_012W...")
   * - These don't match, but agentId (e.g., "adcecb2") is stable across both
   *
   * Also stores structured content blocks for proper interleaving.
   *
   * @param payload - Contains toolUseId, summaryDelta, agentId, and optionally contentBlocks
   */
  handleAgentSummaryChunk(payload: {
    toolUseId: string;
    summaryDelta: string;
    agentId: string;
    sessionId: string;
    contentBlocks?: Array<{
      type: 'text' | 'tool_ref';
      text?: string;
      toolUseId?: string;
      toolName?: string;
    }>;
  }): void {
    const { toolUseId, summaryDelta, agentId, sessionId, contentBlocks } =
      payload;
    const targetTabs = this.tabManager.findTabsBySessionId(
      SessionId.from(sessionId),
    );
    let tabsWithStreaming = targetTabs.filter((t) => t.streamingState);
    if (tabsWithStreaming.length === 0) {
      // `findTabsBySessionId` resolves active-workspace tabs only. When the
      // owning session is streaming in a BACKGROUND workspace its summary
      // deltas would be silently dropped — resolve the owner across workspaces
      // and write through the workspace-aware `setStreamingState` (which routes
      // background tabs to the partition update path).
      const lookup =
        this.tabManager.findTabBySessionIdAcrossWorkspaces(sessionId);
      if (lookup?.tab.streamingState) {
        tabsWithStreaming = [lookup.tab];
      }
    }
    if (tabsWithStreaming.length === 0) {
      console.warn(
        '[ChatStore] No tab with streamingState for summary chunk:',
        { toolUseId, agentId, sessionId },
      );
      return;
    }

    for (const tab of tabsWithStreaming) {
      const state = tab.streamingState;
      if (!state) continue;
      const currentSummary = state.agentSummaryAccumulators.get(agentId) || '';
      const newSummary = currentSummary + summaryDelta;
      state.agentSummaryAccumulators.set(agentId, newSummary);
      if (contentBlocks && contentBlocks.length > 0) {
        const currentBlocks = state.agentContentBlocksMap.get(agentId) || [];
        const newBlocks = [...currentBlocks, ...contentBlocks];
        state.agentContentBlocksMap.set(agentId, newBlocks);
      }
      this.tabManager.setStreamingState(tab.id, { ...state });
    }
  }

  /**
   * Handle session ID resolution from backend
   * Backend sends real SDK UUID after SDK returns it from system init message
   * Without this, tabs store placeholder IDs (msg_XXX) which SDK rejects on resume
   *
   * Uses tabId for direct routing - no temp ID lookup needed.
   *
   * Flow:
   * 1. User sends message â†’ backend creates stream with tabId
   * 2. Backend SDK returns real UUID â†’ sends SESSION_ID_RESOLVED with tabId
   * 3. This method finds tab directly by tabId and updates claudeSessionId
   * 4. Future resume attempts use valid UUID format
   */
  handleSessionIdResolved(data: {
    tabId: string;
    realSessionId: string;
  }): void {
    const { tabId, realSessionId } = data;

    // Resolve the OWNING tab across ALL workspaces by tab id. Tab ids are
    // global UUIDs, so a background-workspace owner is invisible to the
    // active-only `tabs()` signal. Attaching via the owner's id lets the
    // workspace-aware `attachSession` write to the correct partitioned
    // TabState (active signal OR background partition) instead of clobbering
    // the active tab's live session with a foreign workspace's session id.
    const owner = this.tabManager.findTabByIdAcrossWorkspaces(tabId);

    if (owner) {
      this.tabManager.attachSession(owner.tab.id, realSessionId);
    } else {
      // Last-resort fallback for the genuine "brand-new draft, tab id not yet
      // in any partition" case. Guarded by `!activeTab.claudeSessionId` so it
      // can NEVER overwrite a tab that already owns a live session — that
      // guard is the fix for the cross-workspace clobber.
      const activeTab = this.tabManager.activeTab();
      if (
        activeTab &&
        !activeTab.claudeSessionId &&
        (activeTab.status === 'streaming' || activeTab.status === 'draft')
      ) {
        this.tabManager.attachSession(activeTab.id, realSessionId);
      } else {
        console.warn('[ChatStore] No tab found for session ID resolution:', {
          tabId,
          realSessionId,
        });
      }
    }
    this.sessionLoader.loadSessions().catch((err) => {
      console.warn(
        '[ChatStore] Failed to refresh sessions after ID resolved:',
        err,
      );
    });
  }

  /**
   * Handle chat error signal from backend
   * Called when an error occurs during chat (CLI error, network error, etc.)
   *
   * Routes by tabId (primary) instead of sessionId lookup:
   * - tabId: Direct tab routing (preferred)
   * - sessionId: Real SDK UUID for reference and fallback
   *
   * Resets streaming state and optionally displays error.
   */
  handleChatError(data: {
    tabId?: string;
    sessionId?: string;
    error: string;
  }): void {
    this.compactionLifecycle.clearCompactionState();

    console.error('[ChatStore] Chat error:', data);
    let targetTabs: readonly TabState[] = [];
    if (data.tabId) {
      const directTab =
        this.tabManager.tabs().find((t) => t.id === data.tabId) ?? null;
      if (directTab) {
        targetTabs = [directTab];
      }
    }
    if (targetTabs.length === 0 && data.sessionId) {
      targetTabs = this.tabManager.findTabsBySessionId(
        SessionId.from(data.sessionId),
      );
    }
    if (targetTabs.length === 0) {
      const activeTab = this.tabManager.activeTab();
      if (
        data.sessionId &&
        activeTab?.claudeSessionId &&
        activeTab.claudeSessionId !== data.sessionId
      ) {
        console.warn('[ChatStore] Error for unknown session', {
          sessionId: data.sessionId,
          activeTabSessionId: activeTab.claudeSessionId,
        });
        return;
      }

      if (activeTab) {
        targetTabs = [activeTab];
      }
    }

    if (targetTabs.length === 0) {
      console.warn('[ChatStore] No target tab for chat error');
      return;
    }
    for (const tab of targetTabs) {
      if (tab.streamingState?.currentMessageId) {
        this.streamingHandler.finalizeCurrentMessage(tab.id, true);
      }
      this.tabManager.applyErrorReset(tab.id);
      this.tabManager.markTabIdle(tab.id);
    }
    this.sessionManager.setStatus('loaded');
    this.sessionLoader.loadSessions().catch((err) => {
      console.warn('[ChatStore] Failed to refresh sessions after error:', err);
    });
  }
}
