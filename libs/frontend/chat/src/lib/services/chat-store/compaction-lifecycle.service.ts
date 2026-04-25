import { Injectable, inject } from '@angular/core';
import { calculateSessionCostSummary } from '@ptah-extension/shared';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { ExecutionTreeBuilderService } from '../execution-tree-builder.service';
import { SessionLoaderService } from './session-loader.service';

/**
 * CompactionLifecycleService - Owns the SDK session-compaction state machine.
 *
 * Responsibilities (carved from ChatStore in Wave C7g):
 * - Per-tab `isCompacting` flag management
 * - Compaction safety-fallback timeout (120s) — dismisses banner if backend
 *   never sends `compaction_complete`
 * - Compaction-complete reload flow: tree-cache clear, preloadedStats
 *   snapshot, message clear, sidebar refresh, session re-switch
 *
 * @see TASK_2025_098 — SDK Session Compaction
 */
@Injectable({ providedIn: 'root' })
export class CompactionLifecycleService {
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);
  private readonly sessionLoader = inject(SessionLoaderService);

  /**
   * Timeout ID for compaction safety fallback.
   *
   * DESIGN NOTE: This is intentionally stored as a class property rather than
   * a signal because:
   * 1. The timeout ID is not UI state - it's an internal cleanup mechanism
   * 2. setTimeout returns a number/NodeJS.Timeout, not a serializable value
   * 3. We only need to clear it, never read it in templates
   *
   * The associated `isCompacting` per-tab field IS the UI state that components observe.
   * @see TASK_2025_098
   */
  private compactionTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Safety fallback timeout for compaction notification (milliseconds).
   * The banner is normally dismissed by the `compaction_complete` event.
   * This timeout is a safety net in case the complete event is lost.
   * @see TASK_2025_098
   */
  private static readonly COMPACTION_SAFETY_TIMEOUT_MS = 120000;

  /**
   * Handle compaction start event from backend
   * TASK_2025_098: SDK Session Compaction
   *
   * Shows the compaction notification banner and sets auto-dismiss timeout.
   * Only activates if the sessionId matches the current active session.
   *
   * @param sessionId - The session ID where compaction is occurring
   */
  handleCompactionStart(sessionId: string): void {
    // Find the tab for this session — compaction state is per-tab, not global
    const tab = this.tabManager.findTabBySessionId(sessionId);
    if (!tab) {
      console.warn(
        '[ChatStore] handleCompactionStart: no tab found for sessionId',
        { sessionId },
      );
      return;
    }

    // Clear any existing timeout
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }

    // Set compacting state on the specific tab
    this.tabManager.updateTab(tab.id, { isCompacting: true });

    // Safety fallback: dismiss if compaction_complete event is never received
    const compactingTabId = tab.id;
    this.compactionTimeoutId = setTimeout(() => {
      this.tabManager.updateTab(compactingTabId, {
        isCompacting: false,
        status: 'loaded',
        streamingState: null,
        currentMessageId: null,
      });
      this.tabManager.markTabIdle(compactingTabId);
      this.sessionManager.setStatus('loaded');
      this.compactionTimeoutId = null;
      console.warn(
        '[ChatStore] Compaction safety timeout reached — compaction_complete event may have been lost',
      );
    }, CompactionLifecycleService.COMPACTION_SAFETY_TIMEOUT_MS);
  }

  /**
   * Handle compaction complete result from streaming-handler.
   *
   * Dismisses banner, clears tree-builder cache, snapshots preloadedStats,
   * clears messages on the tab, increments compactionCount, and reloads
   * the session from disk so the post-compaction state is visible.
   */
  handleCompactionComplete(result: {
    tabId: string;
    compactionSessionId: string;
  }): void {
    this.clearCompactionState(result.tabId);
    this.treeBuilder.clearCache();

    // Clear finalized messages for the tab - stale pre-compaction messages
    // Verify tab still exists before clearing (it may have been closed during compaction)
    const compactionTab = this.tabManager
      .tabs()
      .find((t) => t.id === result.tabId);
    if (compactionTab) {
      // Snapshot cumulative stats into preloadedStats before clearing messages.
      // Without this, fresh sessions (no preloadedStats) lose all cost/token
      // data because summary() falls back to calculateSessionCostSummary([]).
      let preloadedStats = compactionTab.preloadedStats;
      if (!preloadedStats && compactionTab.messages.length > 0) {
        const snapshot = calculateSessionCostSummary([
          ...compactionTab.messages,
        ]);
        preloadedStats = {
          totalCost: snapshot.totalCost,
          tokens: {
            input: snapshot.totalTokens.input,
            output: snapshot.totalTokens.output,
            cacheRead: snapshot.totalTokens.cacheRead ?? 0,
            cacheCreation: snapshot.totalTokens.cacheCreation ?? 0,
          },
          messageCount: snapshot.messageCount,
        };
      }

      this.tabManager.updateTab(result.tabId, {
        messages: [],
        preloadedStats,
        compactionCount: (compactionTab.compactionCount ?? 0) + 1,
        status: 'loaded',
        streamingState: null,
        currentMessageId: null,
        // TASK_2025_COMPACT_FIX: Clear any queued message so the
        // "Message queued (will send when Claude finishes)" banner disappears
        // and the next user message is sent fresh instead of draining a stale queue.
        queuedContent: null,
        queuedOptions: null,
      });

      // Also clear the visual streaming indicator and session manager state
      this.tabManager.markTabIdle(result.tabId);
      this.sessionManager.setStatus('loaded');

      // Reload session from disk to show the post-compaction state.
      // The SDK writes the compaction summary as a user message to the
      // session JSONL, but it's NOT emitted in the live stream. Without
      // this reload, the tab shows a clean slate until manually reopened.
      const reloadSessionId =
        compactionTab.claudeSessionId ?? result.compactionSessionId;
      if (reloadSessionId) {
        this.sessionLoader.switchSession(reloadSessionId).catch((err) => {
          console.warn(
            '[ChatStore] Failed to reload session after compaction:',
            err,
          );
        });
      }
    }
  }

  /**
   * Clear compaction state for a specific tab.
   * Public for use by ChatMessageHandler on CHAT_COMPLETE.
   */
  clearCompactionStateForTab(tabId: string): void {
    this.tabManager.updateTab(tabId, { isCompacting: false });
  }

  /**
   * Clear compaction state for a specific tab, or all compacting tabs if no tabId given.
   * TASK_2025_098: SDK Session Compaction
   */
  clearCompactionState(tabId?: string): void {
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }
    // Clear on the specific tab if provided, otherwise clear on all compacting tabs
    if (tabId) {
      this.tabManager.updateTab(tabId, { isCompacting: false });
    } else {
      // Fallback: clear isCompacting on any tab that has it set
      for (const tab of this.tabManager.tabs()) {
        if (tab.isCompacting) {
          this.tabManager.updateTab(tab.id, { isCompacting: false });
        }
      }
    }
  }
}
