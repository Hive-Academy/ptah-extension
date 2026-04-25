import { Injectable, signal, inject } from '@angular/core';
import { ClaudeRpcService, AuthStateService } from '@ptah-extension/core';
import { LicenseGetStatusResponse } from '@ptah-extension/shared';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { SessionLoaderService } from './session-loader.service';
import { StreamingHandlerService } from './streaming-handler.service';
import { CompactionLifecycleService } from './compaction-lifecycle.service';
import { TabState } from '@ptah-extension/chat-types';

/**
 * ChatLifecycleService - Cross-cutting reactive lifecycle work.
 *
 * Responsibilities (carved from ChatStore in Wave C7g):
 * - bootstrap: kick off async initialization (loadSessions,
 *   restoreCliSessionsForActiveTab, loadAuthStatus, fetchLicenseStatus)
 *   after services are ready; flips ChatStore._servicesReady via callback
 * - License status fetch with 3-attempt linear backoff (TASK_2025_142)
 * - handleAgentSummaryChunk: route agent JSONL chunks to per-tab streaming state
 *   (TASK_2025_099, TASK_2025_102)
 * - handleSessionIdResolved: replace placeholder tab IDs with real SDK UUIDs
 *   (TASK_2025_095)
 * - handleChatError: 3-tier tab routing, abort-finalize-before-clear, full state reset
 *   (TASK_2025_092, TASK_2025_COMPACT_FIX)
 *
 * All log strings preserved with `[ChatStore]` prefix to maintain debug
 * continuity with consumers and existing log analysis tooling.
 */
@Injectable({ providedIn: 'root' })
export class ChatLifecycleService {
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly authState = inject(AuthStateService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly compactionLifecycle = inject(CompactionLifecycleService);

  // License status signal (TASK_2025_142)
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

      // Auto-load sessions after services are ready
      this.sessionLoader.loadSessions().catch((err) => {
        console.error('[ChatStore] Failed to auto-load sessions:', err);
      });

      // Restore CLI agent sessions for the active tab (restored from localStorage)
      // so the agent monitor panel shows agents from the previous session.
      this.sessionLoader.restoreCliSessionsForActiveTab().catch((err) => {
        console.warn('[ChatStore] Failed to restore CLI sessions:', err);
      });

      // Load auth state so persistedAuthMethod() is populated for slash command checks
      this.authState.loadAuthStatus().catch((err) => {
        console.error('[ChatStore] Failed to load auth status:', err);
      });

      // TASK_2025_142: Fetch license status for trial banners
      this.fetchLicenseStatus().catch((err) => {
        console.error('[ChatStore] Failed to fetch license status:', err);
      });
    } catch (error) {
      console.error('[ChatStore] Failed to initialize services:', error);
      // Services remain null, servicesReady stays false
    }
  }

  /**
   * Fetch the current license status from the backend with retry logic
   * Called during initialization to populate license information for trial banners
   *
   * TASK_2025_142: Added linear backoff retry (3 attempts) to handle
   * transient network failures. Without retry, users see no trial banner
   * for the entire session if the initial fetch fails.
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
          // RPC returned failure result
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
          // Linear backoff: 1s, 2s, 3s...
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
   * TASK_2025_099 FIX: Store in StreamingState instead of sessionManager.
   * The ExecutionTreeBuilderService reads from StreamingState, not sessionManager,
   * so summary content must be stored in StreamingState for the UI to render it.
   *
   * TASK_2025_099: Uses agentId (not toolUseId) as the lookup key because:
   * - Hook fires with UUID-format toolUseId (e.g., "b4139c0d-...")
   * - Complete message arrives with Anthropic format toolCallId (e.g., "toolu_012W...")
   * - These don't match, but agentId (e.g., "adcecb2") is stable across both
   *
   * TASK_2025_102: Now also stores structured content blocks for proper interleaving.
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

    // Route to the correct tab by sessionId (multi-tab safe).
    // If the session's tab was closed, drop the chunk rather than
    // corrupting an unrelated active tab.
    const targetTab = this.tabManager.findTabBySessionId(sessionId);
    if (!targetTab?.streamingState) {
      console.warn(
        '[ChatStore] No tab with streamingState for summary chunk:',
        { toolUseId, agentId, sessionId },
      );
      return;
    }

    const state = targetTab.streamingState;

    // TASK_2025_099: Use agentId as key for summary accumulation.
    // This is stable across hook (UUID toolUseId) and complete (toolu_* toolCallId).
    const currentSummary = state.agentSummaryAccumulators.get(agentId) || '';
    const newSummary = currentSummary + summaryDelta;
    state.agentSummaryAccumulators.set(agentId, newSummary);

    // TASK_2025_102: Also store structured content blocks for interleaving
    if (contentBlocks && contentBlocks.length > 0) {
      const currentBlocks = state.agentContentBlocksMap.get(agentId) || [];
      const newBlocks = [...currentBlocks, ...contentBlocks];
      state.agentContentBlocksMap.set(agentId, newBlocks);
    }

    // Trigger tab update to invalidate tree cache and re-render
    // Create shallow copy to trigger signal change detection
    this.tabManager.updateTab(targetTab.id, {
      streamingState: { ...state },
    });
  }

  /**
   * Handle session ID resolution from backend
   * Backend sends real SDK UUID after SDK returns it from system init message
   * Without this, tabs store placeholder IDs (msg_XXX) which SDK rejects on resume
   *
   * TASK_2025_095: Now uses tabId for direct routing - no temp ID lookup needed.
   *
   * Flow:
   * 1. User sends message → backend creates stream with tabId
   * 2. Backend SDK returns real UUID → sends SESSION_ID_RESOLVED with tabId
   * 3. This method finds tab directly by tabId and updates claudeSessionId
   * 4. Future resume attempts use valid UUID format
   */
  handleSessionIdResolved(data: {
    tabId: string;
    realSessionId: string;
  }): void {
    const { tabId, realSessionId } = data;

    // TASK_2025_095: Find tab directly by tabId - no temp ID lookup needed
    const targetTab = this.tabManager.tabs().find((t) => t.id === tabId);

    if (targetTab) {
      // Update the tab with the real session ID
      this.tabManager.updateTab(targetTab.id, {
        claudeSessionId: realSessionId,
      });
    } else {
      // Fallback: Check active tab if it's streaming without a real session ID
      const activeTab = this.tabManager.activeTab();
      if (
        activeTab &&
        (activeTab.status === 'streaming' || activeTab.status === 'draft')
      ) {
        this.tabManager.updateTab(activeTab.id, {
          claudeSessionId: realSessionId,
        });
      } else {
        console.warn('[ChatStore] No tab found for session ID resolution:', {
          tabId,
          realSessionId,
        });
      }
    }

    // Refresh sidebar session list now that metadata has been created on the backend
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
   * TASK_2025_092: Now routes by tabId (primary) instead of sessionId lookup
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
    // TASK_2025_098: Clear compaction state on error to avoid stale notification
    this.compactionLifecycle.clearCompactionState();

    console.error('[ChatStore] Chat error:', data);

    // TASK_2025_092: Route by tabId (primary) or fall back to sessionId lookup
    let targetTab: TabState | null = null;
    let targetTabId: string | null = null;

    // Primary: Use tabId for direct routing
    if (data.tabId) {
      targetTabId = data.tabId;
      targetTab =
        this.tabManager.tabs().find((t) => t.id === data.tabId) ?? null;
    }

    // Fallback: Find by sessionId if tabId not available (legacy support)
    if (!targetTab && data.sessionId) {
      targetTab = this.tabManager.findTabBySessionId(data.sessionId);
      if (targetTab) {
        targetTabId = targetTab.id;
      }
    }

    // Last resort: Use active tab
    if (!targetTab) {
      targetTabId = this.tabManager.activeTabId();
      targetTab = this.tabManager.activeTab();

      // Warn if session ID doesn't match active tab
      if (
        data.sessionId &&
        targetTab?.claudeSessionId &&
        targetTab.claudeSessionId !== data.sessionId
      ) {
        console.warn('[ChatStore] Error for unknown session', {
          sessionId: data.sessionId,
          activeTabSessionId: targetTab.claudeSessionId,
        });
        return;
      }
    }

    if (!targetTabId || !targetTab) {
      console.warn('[ChatStore] No target tab for chat error');
      return;
    }

    // BUG FIX: Finalize streaming content BEFORE clearing state.
    // When abort triggers, handleChatError fires via streaming error callback
    // BEFORE abortCurrentMessage() can call finalizeCurrentMessage(tabId, true).
    // If we clear currentMessageId first, finalization returns early and
    // the interrupted badge never shows. By finalizing here, we ensure
    // partial streaming content is preserved with 'interrupted' status.
    if (targetTab.streamingState?.currentMessageId) {
      this.streamingHandler.finalizeCurrentMessage(targetTabId, true);
    }

    // Reset streaming state (including per-tab currentMessageId)
    // TASK_2025_COMPACT_FIX: Also clear queued content and visual streaming indicator
    // to prevent "Message queued" banner from persisting after slash command errors
    this.tabManager.updateTab(targetTabId, {
      status: 'loaded',
      currentMessageId: null,
      queuedContent: null,
      queuedOptions: null,
    });
    this.tabManager.markTabIdle(targetTabId);
    this.sessionManager.setStatus('loaded');

    // Safety net: refresh sidebar in case session metadata was created before the error.
    // If the session exists on disk, it will now appear; if not, this is a harmless no-op.
    this.sessionLoader.loadSessions().catch((err) => {
      console.warn('[ChatStore] Failed to refresh sessions after error:', err);
    });
  }
}
