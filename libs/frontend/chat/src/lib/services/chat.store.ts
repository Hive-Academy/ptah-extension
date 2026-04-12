import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ExecutionNode,
  FlatStreamEventUnion,
  PermissionRequest,
  PermissionResponse,
  SessionId,
  MESSAGE_TYPES,
  LicenseGetStatusResponse,
  calculateSessionCostSummary,
} from '@ptah-extension/shared';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResponse,
} from '@ptah-extension/shared';
import { SessionManager } from './session-manager.service';
import { TabManagerService } from './tab-manager.service';
import { StreamingHandlerService } from './chat-store/streaming-handler.service';
import { CompletionHandlerService } from './chat-store/completion-handler.service';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { ConversationService } from './chat-store/conversation.service';
import { PermissionHandlerService } from './chat-store/permission-handler.service';
import {
  MessageSenderService,
  SendMessageOptions,
} from './message-sender.service';
import { ExecutionTreeBuilderService } from './execution-tree-builder.service';
import { TabState } from './chat.types';

/**
 * ChatStore - Facade for chat state management
 *
 * FACADE PATTERN:
 * ChatStore provides a unified public API while delegating implementation to specialized child services.
 * This maintains backward compatibility while achieving separation of concerns.
 *
 * Child Services (5):
 * 1. StreamingHandlerService - Execution tree building
 * 2. CompletionHandlerService - Chat completion handling and auto-send
 * 3. SessionLoaderService - Session loading, pagination, switching, ID resolution
 * 4. ConversationService - New/continue conversation, message sending, abort
 * 5. PermissionHandlerService - Permission request management and correlation
 *
 * Responsibilities:
 * - Expose child service signals as public readonly (facade pattern)
 * - Delegate method calls to appropriate child service
 * - Coordinate initialization and callback registration
 * - Maintain backward-compatible public API
 *
 * Refactoring Outcome:
 * - Reduced from ~1,537 lines to ~400 lines (74% reduction)
 * - 100% backward compatible (same public API)
 * - Improved testability (each service independently testable)
 * - Clean separation of concerns following SOLID principles
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  // ============================================================================
  // SERVICE DEPENDENCIES
  // ============================================================================

  private readonly _vscodeService = inject(VSCodeService);
  private readonly _claudeRpcService = inject(ClaudeRpcService);

  // Extracted services (Phase 6)
  private readonly sessionManager = inject(SessionManager);
  private readonly tabManager = inject(TabManagerService);

  // Extracted services (Phase 7 - Batch 4 refactoring)
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly completionHandler = inject(CompletionHandlerService);
  private readonly sessionLoader = inject(SessionLoaderService);
  private readonly conversation = inject(ConversationService);
  private readonly permissionHandler = inject(PermissionHandlerService);

  // Message sending mediator (Phase 8 - TASK_2025_054 Batch 3)
  private readonly messageSender = inject(MessageSenderService);

  // Tree builder for render-time ExecutionNode construction (TASK_2025_082 Batch 5)
  private readonly treeBuilder = inject(ExecutionTreeBuilderService);

  // Signal to track service initialization state
  private readonly _servicesReady = signal(false);
  readonly servicesReady = this._servicesReady.asReadonly();

  constructor() {
    // Eagerly initialize services to avoid race conditions
    this.initializeServices();
  }

  /**
   * Eagerly initialize services via dynamic import
   * This runs async but updates servicesReady signal when complete
   */
  private async initializeServices(): Promise<void> {
    try {
      // NOTE: Message routing is now handled by ChatMessageHandler via MessageRouterService.
      // No need to register ChatStore with VSCodeService.

      // NOTE: ALL callback registrations REMOVED in TASK_2025_054 Batch 3
      // MessageSenderService provides direct message sending without callbacks
      // CompletionHandlerService uses MessageSenderService directly for auto-send

      // Mark services as ready
      this._servicesReady.set(true);

      // Auto-load sessions after services are ready
      this.loadSessions().catch((err) => {
        console.error('[ChatStore] Failed to auto-load sessions:', err);
      });

      // Restore CLI agent sessions for the active tab (restored from localStorage)
      // so the agent monitor panel shows agents from the previous session.
      this.sessionLoader.restoreCliSessionsForActiveTab().catch((err) => {
        console.warn('[ChatStore] Failed to restore CLI sessions:', err);
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
   * Helper to get VSCodeService (with null check)
   */
  private get vscodeService(): VSCodeService | null {
    return this._vscodeService;
  }

  /**
   * Helper to get ClaudeRpcService (with null check)
   */
  private get claudeRpcService(): ClaudeRpcService | null {
    return this._claudeRpcService;
  }

  // ============================================================================
  // CORE SIGNALS (Facade Pattern - delegates to child services)
  // ============================================================================

  // Session signals (delegated to SessionLoaderService)
  readonly sessions = this.sessionLoader.sessions;
  readonly hasMoreSessions = this.sessionLoader.hasMoreSessions;
  readonly totalSessions = this.sessionLoader.totalSessions;
  readonly isLoadingMoreSessions = this.sessionLoader.isLoadingMoreSessions;

  // Guard signals (delegated to ConversationService)
  readonly isStopping = this.conversation.isStopping;
  readonly queueRestoreContent = this.conversation.queueRestoreSignal;

  // Permission signals (delegated to PermissionHandlerService)
  readonly permissionRequests = this.permissionHandler.permissionRequests;
  // permissionRequestsByToolId - DELETED in TASK_2025_078 (use getPermissionForTool() method)
  readonly unmatchedPermissions = this.permissionHandler.unmatchedPermissions;
  // TASK_2025_136: Question requests for AskUserQuestion tool
  readonly questionRequests = this.permissionHandler.questionRequests;

  // Resumable subagents signal (TASK_2025_213: delegated to SessionLoaderService)
  readonly resumableSubagents = this.sessionLoader.resumableSubagents;

  // License status signal (TASK_2025_142)
  private readonly _licenseStatus = signal<LicenseGetStatusResponse | null>(
    null,
  );
  readonly licenseStatus = this._licenseStatus.asReadonly();

  // Compaction state signals (TASK_2025_098)
  private readonly _isCompacting = signal<boolean>(false);
  readonly isCompacting = this._isCompacting.asReadonly();

  /**
   * Timeout ID for compaction safety fallback.
   *
   * DESIGN NOTE: This is intentionally stored as a class property rather than
   * a signal because:
   * 1. The timeout ID is not UI state - it's an internal cleanup mechanism
   * 2. setTimeout returns a number/NodeJS.Timeout, not a serializable value
   * 3. We only need to clear it, never read it in templates
   *
   * The associated `_isCompacting` signal IS the UI state that components observe.
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

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  // Active tab accessor (delegated to TabManager)
  readonly activeTab = computed(() => this.tabManager.activeTab());

  // Computed from active tab (delegated to TabManager fine-grained selectors)
  // These use reference-equality selectors so they don't re-notify during
  // streaming when only streamingState changes.
  readonly currentSessionId = this.tabManager.activeTabSessionId;
  readonly messages = this.tabManager.activeTabMessages;
  /**
   * PERFORMANCE OPTIMIZATION: Computed signal for current execution tree
   *
   * Uses memoized tree building in ExecutionTreeBuilderService.
   * The tree builder caches results based on streaming state fingerprint,
   * so this computed signal can be called frequently without rebuilding
   * the tree unless the underlying data has actually changed.
   *
   * Cache key is based on tab ID to allow per-tab caching.
   */
  /**
   * TASK_2025_096 FIX: Return ALL root nodes, not just the first one!
   *
   * When Claude uses tools, the SDK sends multiple assistant messages in one turn:
   * - Message 1: Contains tool calls (e.g., Glob)
   * - Message 2: Contains follow-up text and more tools after tool results
   *
   * Previously, only rootNodes[0] was returned, causing subsequent messages to be LOST!
   * Now we return ALL root nodes so they can all be rendered.
   */
  readonly currentExecutionTrees = computed((): ExecutionNode[] => {
    const streamingState = this.tabManager.activeTabStreamingState();
    if (!streamingState) return [];

    // PERFORMANCE: Use tab-specific cache key for memoization
    // This allows the tree builder to skip rebuilding when data hasn't changed
    const tabId = this.tabManager.activeTabId();
    const cacheKey = `tab-${tabId}`;
    return this.treeBuilder.buildTree(streamingState, cacheKey);
  });

  /**
   * @deprecated Use currentExecutionTrees for all root nodes.
   * This only returns the first root node for backwards compatibility.
   */
  readonly currentExecutionTree = computed((): ExecutionNode | null => {
    const trees = this.currentExecutionTrees();
    return trees.length > 0 ? trees[0] : null;
  });
  readonly isStreaming = computed(() => {
    const status = this.tabManager.activeTabStatus();
    return status === 'streaming' || status === 'resuming';
  });

  /**
   * Preloaded stats for old sessions (loaded from JSONL history)
   * Used by SessionStatsSummaryComponent to display cost/tokens without recalculation
   */
  readonly preloadedStats = this.tabManager.activeTabPreloadedStats;

  /**
   * Live model stats for current session (updated after each turn completion)
   * Includes context window info for percentage display and model name
   * Used by SessionStatsSummaryComponent to display context usage
   */
  readonly liveModelStats = this.tabManager.activeTabLiveModelStats;

  /**
   * Full per-model usage breakdown for collapsible display in session stats.
   * Contains all models used in the session with their individual cost/token stats.
   */
  readonly modelUsageList = this.tabManager.activeTabModelUsageList;

  /** Number of context compactions in the active session */
  readonly compactionCount = this.tabManager.activeTabCompactionCount;

  /** Queued content for the active tab. Uses fine-grained selector. */
  readonly queuedContent = this.tabManager.activeTabQueuedContent;

  /** Active tab's streaming state. Changes every tick during streaming (expected). */
  readonly activeStreamingState = this.tabManager.activeTabStreamingState;

  /**
   * Get permission request for a specific tool by its toolCallId
   * Delegates to PermissionHandlerService
   */
  getPermissionForTool(
    toolCallId: string | undefined,
  ): PermissionRequest | null {
    return this.permissionHandler.getPermissionForTool(toolCallId);
  }

  // ============================================================================
  // DERIVED COMPUTED SIGNALS
  // ============================================================================

  readonly currentSession = computed(() => {
    const sessionId = this.currentSessionId();
    return (
      this.sessionLoader.sessions().find((s) => s.id === sessionId) ?? null
    );
  });

  readonly messageCount = computed(() => this.messages().length);

  /**
   * Check if the active tab has an existing session that can be continued
   * Used to determine whether to start new or continue existing conversation
   *
   * IMPORTANT: Reads from active TAB state, not global SessionManager,
   * to ensure correct behavior in multi-tab scenarios
   */
  readonly hasExistingSession = computed(() => {
    const sessionId = this.tabManager.activeTabSessionId();
    const status = this.tabManager.activeTabStatus();
    // Has existing session if tab has a real Claude session ID and is in 'loaded' state
    return sessionId !== null && status === 'loaded';
  });

  // ============================================================================
  // STREAMING STATE TRACKING
  // ============================================================================

  // NOTE: currentMessageId is now tracked per-tab in TabState.currentMessageId
  // This enables proper multi-tab streaming support

  // ============================================================================
  // ACTIONS
  // ============================================================================

  /**
   * Clear current session state
   *
   * IMPORTANT: This method only clears session state - it does NOT create new tabs.
   * UI components (e.g., popovers, buttons) are responsible for creating tabs before calling this.
   * This separation prevents duplicate tab creation bugs.
   */
  clearCurrentSession(): void {
    this.sessionManager.clearSession();
  }

  /**
   * Load sessions from backend via RPC (with pagination)
   * Delegates to SessionLoaderService
   */
  async loadSessions(): Promise<void> {
    return this.sessionLoader.loadSessions();
  }

  /**
   * Load more sessions (pagination)
   * Delegates to SessionLoaderService
   */
  async loadMoreSessions(): Promise<void> {
    return this.sessionLoader.loadMoreSessions();
  }

  /**
   * Switch to a different session and load its messages via RPC
   * Delegates to SessionLoaderService
   */
  async switchSession(sessionId: string): Promise<void> {
    return this.sessionLoader.switchSession(sessionId);
  }

  /**
   * Remove a session from the local list (UI only) - TASK_2025_086
   * Called after successful backend deletion to update UI state
   * Delegates to SessionLoaderService
   */
  removeSessionFromList(sessionId: SessionId): void {
    return this.sessionLoader.removeSessionFromList(sessionId);
  }

  /**
   * Update a session's name in the local list (UI only)
   * Called after successful backend rename to update UI state
   * Delegates to SessionLoaderService
   */
  updateSessionName(sessionId: SessionId, name: string): void {
    return this.sessionLoader.updateSessionName(sessionId, name);
  }

  /**
   * Send a message - automatically determines whether to start new or continue
   * Delegates to MessageSenderService (TASK_2025_054 Batch 3 - eliminates callback indirection)
   */
  async sendMessage(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    return this.messageSender.send(content, options);
  }

  /**
   * Smart send or queue routing
   * Delegates to MessageSenderService for streaming check, ConversationService for queue
   * (TASK_2025_054 Batch 3 - eliminates callback indirection)
   */
  async sendOrQueueMessage(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    // Check target tab's streaming state — use explicit tabId if provided (canvas tile)
    const targetTabId = options?.tabId;
    const targetTab = targetTabId
      ? this.tabManager.tabs().find((t) => t.id === targetTabId)
      : null;
    const status = targetTab?.status ?? this.tabManager.activeTabStatus();
    const isStreaming = status === 'streaming' || status === 'resuming';

    if (isStreaming) {
      // Auto-deny active permissions with the user's message as context.
      // Uses deny_with_message (not hard deny) so the session continues
      // rather than being killed — the user's intent is "no, do this instead".
      const activePermissions = this.permissionHandler.permissionRequests();
      if (activePermissions.length > 0) {
        for (const perm of activePermissions) {
          this.permissionHandler.handlePermissionResponse({
            id: perm.id,
            decision: 'deny_with_message',
            reason: content,
          });
        }
      }

      // Queue the message with full options via ConversationService
      this.conversation.queueOrAppendMessage(content, options);
    } else {
      // Send normally via MessageSender
      await this.messageSender.send(content, options);
    }
  }

  /**
   * Start a brand new conversation with Claude
   * Delegates to ConversationService
   */
  async startNewConversation(content: string, files?: string[]): Promise<void> {
    return this.conversation.startNewConversation(content, files);
  }

  /**
   * Continue an existing conversation with Claude
   * Delegates to ConversationService
   */
  async continueConversation(content: string, files?: string[]): Promise<void> {
    return this.conversation.continueConversation(content, files);
  }

  // ============================================================================
  // SUBAGENT RESUME METHODS (TASK_2025_213)
  // ============================================================================

  /**
   * Clear the resumable subagents signal.
   * Delegates to SessionLoaderService.
   *
   * Called when the user triggers a resume action, so the banner
   * dismisses immediately while the backend processes the request.
   */
  clearResumableSubagents(): void {
    this.sessionLoader.clearResumableSubagents();
  }

  /**
   * Remove a single resumable subagent by toolCallId.
   * Delegates to SessionLoaderService.
   *
   * Called when the user resumes one specific agent so that only that
   * agent is removed from the banner while others remain visible.
   */
  removeResumableSubagent(toolCallId: string): void {
    this.sessionLoader.removeResumableSubagent(toolCallId);
  }

  // TASK_2025_109: handleSubagentResume method removed - now uses context injection
  // Subagent resumption is handled via context injection in chat:continue RPC.
  // When a parent session continues, interrupted subagent context is injected
  // into the prompt, allowing Claude to naturally resume agents through conversation.
  // Users can type "resume agent {agentId}" to trigger natural resumption.

  // ============================================================================
  // LICENSE STATUS (TASK_2025_142)
  // ============================================================================

  /**
   * Fetch the current license status from the backend with retry logic
   * Called during initialization to populate license information for trial banners
   *
   * TASK_2025_142: Added exponential backoff retry (3 attempts) to handle
   * transient network failures. Without retry, users see no trial banner
   * for the entire session if the initial fetch fails.
   *
   * @param retries - Number of retry attempts (default: 3)
   */
  async fetchLicenseStatus(retries = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this._claudeRpcService.call(
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
          // Exponential backoff: 1s, 2s, 3s...
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }
  }

  // ============================================================================
  // COMPACTION HANDLING (TASK_2025_098)
  // ============================================================================

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
    const activeSessionId = this.currentSessionId();

    // Only show compaction for the active session
    if (sessionId !== activeSessionId) {
      return;
    }

    // Clear any existing timeout
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }

    // Set compacting state — stays visible until compaction_complete event arrives
    this._isCompacting.set(true);

    // Safety fallback: dismiss if compaction_complete event is never received
    this.compactionTimeoutId = setTimeout(() => {
      this._isCompacting.set(false);
      this.compactionTimeoutId = null;
      console.warn(
        '[ChatStore] Compaction safety timeout reached — compaction_complete event may have been lost',
      );
    }, ChatStore.COMPACTION_SAFETY_TIMEOUT_MS);
  }

  /**
   * Clear compaction state (called when new message is received)
   * TASK_2025_098: SDK Session Compaction
   */
  private clearCompactionState(): void {
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }
    this._isCompacting.set(false);
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
   * Abort current streaming message via RPC
   * Delegates to ConversationService
   */
  async abortCurrentMessage(): Promise<void> {
    return this.conversation.abortCurrentMessage();
  }

  /**
   * Abort with confirmation when sub-agents are running
   * TASK_2025_185: Shows warning dialog if agents are active, allows user to cancel
   * @returns true if aborted, false if user cancelled
   */
  async abortWithConfirmation(): Promise<boolean> {
    return this.conversation.abortWithConfirmation();
  }

  /**
   * Clear queued content for active tab
   * Delegates to TabManagerService (simple facade)
   */
  clearQueuedContent(): void {
    const activeTabId = this.tabManager.activeTabId();
    if (!activeTabId) return;
    this.tabManager.updateTab(activeTabId, { queuedContent: null });
  }

  /**
   * Clear the queue restore signal after content has been restored to input.
   * Delegates to ConversationService to actually set the signal to null.
   */
  clearQueueRestoreSignal(): void {
    this.conversation.clearQueueRestoreSignal();
  }

  /**
   * Send queued message without interrupting current execution (graceful re-steering)
   *
   * TASK_2025_185: Replaces interruptAndSend. Instead of aborting the current
   * execution (which kills running sub-agents), we simply send the queued message.
   * The SDK handles message queueing natively - agents continue running while
   * the new user message is processed in order.
   *
   * @param tabId - Tab to send the queued message for
   * @param content - Message content to send
   */
  private async sendQueuedMessage(
    tabId: string,
    content: string,
  ): Promise<void> {
    try {
      // Retrieve stored options before clearing
      const tab = this.tabManager.tabs().find((t) => t.id === tabId);
      const queuedOptions = tab?.queuedOptions ?? undefined;

      // Clear the queue and options before sending
      this.tabManager.updateTab(tabId, {
        queuedContent: null,
        queuedOptions: null,
      });

      // TASK_2025_185: Call continueConversation directly instead of messageSender.send().
      // messageSender.send() checks tab.status === 'loaded' which is false during streaming,
      // causing it to incorrectly start a NEW conversation instead of continuing the existing one.
      // Pass files from stored options (effort is set at session config level, not per-message for continue).
      await this.conversation.continueConversation(
        content,
        queuedOptions?.files,
      );
    } catch (error) {
      console.error('[ChatStore] sendQueuedMessage failed:', error);
      // On error, restore content to queue so user doesn't lose it
      this.tabManager.updateTab(tabId, { queuedContent: content });
    }
  }

  // ============================================================================
  // EXECUTION NODE PROCESSING (SDK Path)
  // ============================================================================

  /**
   * Process flat streaming event from SDK
   * Delegates to StreamingHandlerService (Phase 7 extraction)
   *
   * TASK_2025_092: Now accepts tabId for routing and sessionId (real SDK UUID)
   * - tabId: Used to find the correct tab to route the event to
   * - sessionId: Real SDK UUID to store on the tab for future resume
   */
  processStreamEvent(
    event: FlatStreamEventUnion,
    tabId?: string,
    sessionId?: string,
  ): void {
    const result = this.streamingHandler.processStreamEvent(
      event,
      tabId,
      sessionId,
    );

    // Handle compaction complete: dismiss banner, reset tree, clear finalized messages
    if (result && result.compactionComplete && result.compactionSessionId) {
      this.clearCompactionState();
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
        });
      }
      return;
    }

    // TASK_2025_098: Handle compaction start notification via unified streaming path
    // Compaction events now flow through CHAT_CHUNK like all other streaming events
    if (result && result.compactionSessionId) {
      this.handleCompactionStart(result.compactionSessionId);
      return; // Compaction events don't need further processing
    }

    // TASK_2025_100 / TASK_2025_185: Handle re-steering via queued content on message_complete
    // When user sends a message during streaming, it's queued. On message_complete,
    // we send the queued message to re-steer Claude without aborting running agents.
    // The SDK handles message queueing natively - agents continue running.
    if (result && result.queuedContent) {
      const queuedContent = result.queuedContent;
      const resultTabId = result.tabId;

      // Send the queued message without interrupting running agents
      this.sendQueuedMessage(resultTabId, queuedContent);
    }
  }

  /**
   * Finalize the current streaming message
   * Delegates to StreamingHandlerService (Phase 7 extraction)
   */
  private finalizeCurrentMessage(tabId?: string): void {
    this.streamingHandler.finalizeCurrentMessage(tabId);
  }

  // ============================================================================
  // PERMISSION REQUEST HANDLING (Delegates to PermissionHandlerService)
  // ============================================================================

  /**
   * Handle incoming permission request from backend
   * Delegates to PermissionHandlerService
   */
  handlePermissionRequest(request: PermissionRequest): void {
    this.permissionHandler.handlePermissionRequest(request);
  }

  /**
   * Handle auto-resolved permission from backend ("Always Allow" sibling resolution)
   * Delegates to PermissionHandlerService
   */
  handlePermissionAutoResolved(payload: {
    id: string;
    toolName: string;
  }): void {
    this.permissionHandler.handlePermissionAutoResolved(payload);
  }

  /**
   * Cleanup all permission and question requests for a specific session.
   * Called when backend sends PERMISSION_SESSION_CLEANUP (session aborted).
   * Delegates to PermissionHandlerService
   */
  cleanupPermissionSession(sessionId: string): void {
    this.permissionHandler.cleanupSession(sessionId);
  }

  /**
   * Handle user response to permission request
   * Delegates to PermissionHandlerService
   */
  handlePermissionResponse(response: PermissionResponse): void {
    this.permissionHandler.handlePermissionResponse(response);
  }

  /**
   * Handle AskUserQuestion request from backend (TASK_2025_136)
   * Delegates to PermissionHandlerService
   */
  handleQuestionRequest(request: AskUserQuestionRequest): void {
    this.permissionHandler.handleQuestionRequest(request);
  }

  /**
   * Handle user response to AskUserQuestion request (TASK_2025_136)
   * Delegates to PermissionHandlerService
   */
  handleQuestionResponse(response: AskUserQuestionResponse): void {
    this.permissionHandler.handleQuestionResponse(response);
  }

  /**
   * Queue or append message based on streaming state
   * Facade delegation to ConversationService
   */
  public queueOrAppendMessage(
    content: string,
    options?: SendMessageOptions,
  ): void {
    this.conversation.queueOrAppendMessage(content, options);
  }

  /**
   * Move queued content to input field
   * Facade delegation to ConversationService
   */
  public moveQueueToInput(): void {
    const queuedContent = this.conversation.queueRestoreSignal();
    if (queuedContent) {
      // Emit restore event to input component
      this._vscodeService.postMessage({
        type: MESSAGE_TYPES.CHAT_RESTORE_INPUT,
        content: queuedContent,
      });
    }
  }

  // ============================================================================
  // SESSION STATS HANDLING
  // ============================================================================

  /**
   * Handle session stats update from backend
   * Delegates to StreamingHandlerService
   *
   * @param stats - Session statistics (cost, tokens, duration, modelUsage)
   */
  handleSessionStats(stats: {
    sessionId: string;
    cost: number;
    tokens: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheCreation?: number;
    };
    duration: number;
    modelUsage?: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      contextWindow: number;
      costUSD: number;
      cacheReadInputTokens?: number;
      lastTurnContextTokens?: number;
    }>;
  }): void {
    // TASK_2025_098: Clear compaction state when new message finishes
    // This indicates compaction (if any) has completed successfully
    this.clearCompactionState();

    // Resolve the target tab by sessionId first.
    // Fallback to activeTab() only as safety net — stats can't be dropped since
    // they're the only opportunity to record cost/token data for the turn.
    let targetTab = this.tabManager.findTabBySessionId(stats.sessionId);
    if (!targetTab) {
      targetTab = this.tabManager.activeTab();
      if (targetTab) {
        console.warn(
          '[ChatStore] handleSessionStats: findTabBySessionId failed, fell back to activeTab',
          { sessionId: stats.sessionId, activeTabId: targetTab.id },
        );
      }
    }

    // Process modelUsage to update liveModelStats for context display
    if (stats.modelUsage && stats.modelUsage.length > 0) {
      // Select the model with the highest cost as the user's primary model.
      // The live stream path sorts modelUsage[0] by initialModel match then
      // outputTokens, while the history path sorts by costUSD. As a unified
      // safety net we pick the highest-cost model, ensuring the user's main
      // model (e.g. Opus) is shown even when a cheaper subagent (e.g. Haiku)
      // produces more output tokens.
      const primaryModel =
        stats.modelUsage.length === 1
          ? stats.modelUsage[0]
          : stats.modelUsage.reduce((best, current) =>
              current.costUSD > best.costUSD ? current : best,
            );
      // Context usage: use last turn's actual prompt size (= real context fill),
      // NOT cumulative tokens across all turns. The SDK's modelUsage tokens are
      // summed across all API calls, but the context window only holds the current
      // conversation state. lastTurnContextTokens captures the last message_start's
      // input + cache_read, which IS the real context window fill level.
      // Falls back to cumulative tokens for backward compat (loaded sessions).
      const contextUsed =
        primaryModel.lastTurnContextTokens != null
          ? primaryModel.lastTurnContextTokens
          : primaryModel.inputTokens +
            (primaryModel.cacheReadInputTokens ?? 0) +
            primaryModel.outputTokens;
      const contextPercent =
        primaryModel.contextWindow > 0
          ? Math.round((contextUsed / primaryModel.contextWindow) * 1000) / 10
          : 0;

      if (targetTab) {
        this.tabManager.updateTab(targetTab.id, {
          liveModelStats: {
            model: primaryModel.model,
            contextUsed,
            contextWindow: primaryModel.contextWindow,
            contextPercent,
          },
          modelUsageList: stats.modelUsage,
        });
      }
    }

    // Bug 2 fix: Accumulate preloadedStats with new turn data
    // When a loaded historical session gets new messages, the preloadedStats
    // must be updated so the stats summary shows the combined totals.
    if (targetTab?.preloadedStats) {
      this.tabManager.updateTab(targetTab.id, {
        preloadedStats: {
          ...targetTab.preloadedStats,
          totalCost: targetTab.preloadedStats.totalCost + stats.cost,
          tokens: {
            input: targetTab.preloadedStats.tokens.input + stats.tokens.input,
            output:
              targetTab.preloadedStats.tokens.output + stats.tokens.output,
            cacheRead:
              targetTab.preloadedStats.tokens.cacheRead +
              (stats.tokens.cacheRead ?? 0),
            cacheCreation:
              targetTab.preloadedStats.tokens.cacheCreation +
              (stats.tokens.cacheCreation ?? 0),
          },
          messageCount: targetTab.preloadedStats.messageCount + 1,
        },
      });
    }

    // StreamingHandler finalizes the message and returns queued content info
    const result = this.streamingHandler.handleSessionStats(stats);

    // Refresh sidebar so session's lastActiveAt timestamp is updated
    this.sessionLoader.loadSessions().catch((err) => {
      console.warn('[ChatStore] Failed to refresh sessions after stats:', err);
    });

    // TASK_2025_101: Handle auto-send of queued content here to avoid circular dependency
    // (StreamingHandler → MessageSender → SessionLoader → StreamingHandler)
    // TASK_2025_185: Use sendQueuedMessage for consistent error handling with queue restoration
    if (result && result.queuedContent && result.queuedContent.trim()) {
      this.sendQueuedMessage(result.tabId, result.queuedContent);
    }
  }

  // ============================================================================
  // CHAT COMPLETION HANDLING
  // ============================================================================
  // NOTE: handleChatComplete was removed — chat:complete is no longer used
  // for streaming state management. SESSION_STATS (from type=result) is the
  // authoritative completion signal (TASK_2025_101).

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
    this.clearCompactionState();

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
    this.tabManager.updateTab(targetTabId, {
      status: 'loaded',
      currentMessageId: null,
    });
    this.sessionManager.setStatus('loaded');

    // Safety net: refresh sidebar in case session metadata was created before the error.
    // If the session exists on disk, it will now appear; if not, this is a harmless no-op.
    this.sessionLoader.loadSessions().catch((err) => {
      console.warn('[ChatStore] Failed to refresh sessions after error:', err);
    });
  }
}
