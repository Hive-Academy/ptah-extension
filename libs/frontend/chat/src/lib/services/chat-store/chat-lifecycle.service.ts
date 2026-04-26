import { Injectable, signal, inject } from '@angular/core';
import { ClaudeRpcService, AuthStateService } from '@ptah-extension/core';
import { LicenseGetStatusResponse } from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { SessionLoaderService } from './session-loader.service';
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

    // TASK_2026_106 Phase 4b — fan out to ALL tabs bound to this session.
    // Canvas grid: every tile bound to the session needs its
    // streamingState.agentSummaryAccumulators updated, otherwise sub-agent
    // summaries appear on one tile and freeze on the others.
    //
    // Per-tab streamingState is a separate object per tab — so accumulators
    // are tracked independently. This means the same delta is appended to
    // each tab's accumulator, which is exactly what we want for per-tab
    // rendering parity.
    const targetTabs = this.tabManager.findTabsBySessionId(sessionId);
    const tabsWithStreaming = targetTabs.filter((t) => t.streamingState);
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
      this.tabManager.setStreamingState(tab.id, { ...state });
    }
  }

  /**
   * Handle session ID resolution from backend
   * Backend sends real SDK UUID after SDK returns it from system init message
   * Without this, tabs store placeholder IDs (msg_XXX) which SDK rejects on resume
   *
   * TASK_2025_095: Now uses tabId for direct routing - no temp ID lookup needed.
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

    // TASK_2025_095: Find tab directly by tabId - no temp ID lookup needed
    const targetTab = this.tabManager.tabs().find((t) => t.id === tabId);

    if (targetTab) {
      // Update the tab with the real session ID
      this.tabManager.attachSession(targetTab.id, realSessionId);
    } else {
      // Fallback: Check active tab if it's streaming without a real session ID
      const activeTab = this.tabManager.activeTab();
      if (
        activeTab &&
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

    // TASK_2025_092 / TASK_2026_106 Phase 4b: Route by tabId (primary, single
    // tab — the originating call site already knows which tab errored), or
    // fall back to sessionId lookup which fans out to ALL bound tabs.
    let targetTabs: readonly TabState[] = [];

    // Primary: Use tabId for direct routing
    if (data.tabId) {
      const directTab =
        this.tabManager.tabs().find((t) => t.id === data.tabId) ?? null;
      if (directTab) {
        targetTabs = [directTab];
      }
    }

    // Fallback: Find by sessionId if tabId not available (legacy support).
    // Phase 4b: fan out so canvas-grid tiles bound to the same session all
    // get reset rather than only the first one returned by the legacy lookup.
    if (targetTabs.length === 0 && data.sessionId) {
      targetTabs = this.tabManager.findTabsBySessionId(data.sessionId);
    }

    // Last resort: Use active tab
    if (targetTabs.length === 0) {
      const activeTab = this.tabManager.activeTab();

      // Warn if session ID doesn't match active tab
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

    // BUG FIX: Finalize streaming content BEFORE clearing state.
    // When abort triggers, handleChatError fires via streaming error callback
    // BEFORE abortCurrentMessage() can call finalizeCurrentMessage(tabId, true).
    // If we clear currentMessageId first, finalization returns early and
    // the interrupted badge never shows. By finalizing here, we ensure
    // partial streaming content is preserved with 'interrupted' status.
    //
    // Phase 4b: per-tab finalization — each bound tab has its own
    // streamingState.currentMessageId, so finalize each independently.
    for (const tab of targetTabs) {
      if (tab.streamingState?.currentMessageId) {
        this.streamingHandler.finalizeCurrentMessage(tab.id, true);
      }
      // Reset streaming state (including per-tab currentMessageId)
      // TASK_2025_COMPACT_FIX: Also clear queued content and visual streaming indicator
      // to prevent "Message queued" banner from persisting after slash command errors
      this.tabManager.applyErrorReset(tab.id);
      this.tabManager.markTabIdle(tab.id);
    }

    // Session status is global to the SDK session — set once.
    this.sessionManager.setStatus('loaded');

    // Safety net: refresh sidebar in case session metadata was created before the error.
    // If the session exists on disk, it will now appear; if not, this is a harmless no-op.
    this.sessionLoader.loadSessions().catch((err) => {
      console.warn('[ChatStore] Failed to refresh sessions after error:', err);
    });
  }
}
