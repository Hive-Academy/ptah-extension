import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ExecutionNode,
  FlatStreamEventUnion,
  PermissionRequest,
  PermissionResponse,
  SessionId,
  MESSAGE_TYPES,
  SubagentRecord,
} from '@ptah-extension/shared';
import { SessionManager } from './session-manager.service';
import { TabManagerService } from './tab-manager.service';
import { StreamingHandlerService } from './chat-store/streaming-handler.service';
import { CompletionHandlerService } from './chat-store/completion-handler.service';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { ConversationService } from './chat-store/conversation.service';
import { PermissionHandlerService } from './chat-store/permission-handler.service';
import { MessageSenderService } from './message-sender.service';
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
      // Register ChatStore with VSCodeService for message routing
      this._vscodeService?.setChatStore(this);

      // NOTE: ALL callback registrations REMOVED in TASK_2025_054 Batch 3
      // MessageSenderService provides direct message sending without callbacks
      // CompletionHandlerService uses MessageSenderService directly for auto-send

      // Mark services as ready
      this._servicesReady.set(true);

      // Auto-load sessions after services are ready
      this.loadSessions().catch((err) => {
        console.error('[ChatStore] Failed to auto-load sessions:', err);
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

  // Resumable subagents signals (TASK_2025_103)
  private readonly _resumableSubagents = signal<SubagentRecord[]>([]);
  readonly resumableSubagents = this._resumableSubagents.asReadonly();

  // Compaction state signals (TASK_2025_098)
  private readonly _isCompacting = signal<boolean>(false);
  readonly isCompacting = this._isCompacting.asReadonly();

  /**
   * Timeout ID for compaction auto-dismiss.
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
   * Auto-dismiss timeout for compaction notification (milliseconds).
   * SDK compaction typically completes within 5-8 seconds based on testing.
   * The 10-second timeout provides buffer while ensuring UX doesn't hang.
   * @see TASK_2025_098
   */
  private static readonly COMPACTION_AUTO_DISMISS_MS = 10000;

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  // Active tab accessor (delegated to TabManager)
  readonly activeTab = computed(() => this.tabManager.activeTab());

  // Computed from active tab (delegated to TabManager)
  readonly currentSessionId = computed(
    () => this.tabManager.activeTab()?.claudeSessionId ?? null
  );
  readonly messages = computed(
    () => this.tabManager.activeTab()?.messages ?? []
  );
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
    const activeTab = this.tabManager.activeTab();
    if (!activeTab?.streamingState) return [];

    // PERFORMANCE: Use tab-specific cache key for memoization
    // This allows the tree builder to skip rebuilding when data hasn't changed
    const cacheKey = `tab-${activeTab.id}`;
    return this.treeBuilder.buildTree(activeTab.streamingState, cacheKey);
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
    const tab = this.tabManager.activeTab();
    return tab?.status === 'streaming' || tab?.status === 'resuming';
  });

  /**
   * Preloaded stats for old sessions (loaded from JSONL history)
   * Used by SessionStatsSummaryComponent to display cost/tokens without recalculation
   */
  readonly preloadedStats = computed(
    () => this.tabManager.activeTab()?.preloadedStats ?? null
  );

  /**
   * Live model stats for current session (updated after each turn completion)
   * Includes context window info for percentage display and model name
   * Used by SessionStatsSummaryComponent to display context usage
   */
  readonly liveModelStats = computed(
    () => this.tabManager.activeTab()?.liveModelStats ?? null
  );

  /**
   * Get permission request for a specific tool by its toolCallId
   * Delegates to PermissionHandlerService
   */
  getPermissionForTool(
    toolCallId: string | undefined
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
    const tab = this.tabManager.activeTab();
    // Has existing session if tab has a real Claude session ID and is in 'loaded' state
    return tab?.claudeSessionId !== null && tab?.status === 'loaded';
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
   * Send a message - automatically determines whether to start new or continue
   * Delegates to MessageSenderService (TASK_2025_054 Batch 3 - eliminates callback indirection)
   */
  async sendMessage(content: string, files?: string[]): Promise<void> {
    return this.messageSender.send(content, files);
  }

  /**
   * Smart send or queue routing
   * Delegates to MessageSenderService for streaming check, ConversationService for queue
   * (TASK_2025_054 Batch 3 - eliminates callback indirection)
   */
  async sendOrQueueMessage(
    content: string,
    filePaths?: string[]
  ): Promise<void> {
    // Check if streaming via active tab status
    const activeTab = this.tabManager.activeTab();
    const isStreaming =
      activeTab?.status === 'streaming' || activeTab?.status === 'resuming';

    if (isStreaming) {
      // Queue the message via ConversationService
      this.conversation.queueOrAppendMessage(content);
    } else {
      // Send normally via MessageSender
      await this.messageSender.send(content, filePaths);
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
  // SUBAGENT RESUME METHODS (TASK_2025_103)
  // ============================================================================

  /**
   * Refresh the list of resumable subagents from the backend registry
   * Should be called when entering a session or after session events
   */
  async refreshResumableSubagents(): Promise<void> {
    try {
      const result = await this._claudeRpcService.querySubagents();
      if (result.isSuccess()) {
        this._resumableSubagents.set(result.data.subagents);
        console.log('[ChatStore] Resumable subagents refreshed:', {
          count: result.data.subagents.length,
        });
      } else {
        console.error('[ChatStore] Failed to query subagents:', result.error);
        this._resumableSubagents.set([]);
      }
    } catch (error) {
      console.error('[ChatStore] Error refreshing resumable subagents:', error);
      this._resumableSubagents.set([]);
    }
  }

  // TASK_2025_109: handleSubagentResume method removed - now uses context injection
  // Subagent resumption is handled via context injection in chat:continue RPC.
  // When a parent session continues, interrupted subagent context is injected
  // into the prompt, allowing Claude to naturally resume agents through conversation.
  // Users can type "resume agent {agentId}" to trigger natural resumption.

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
      console.log('[ChatStore] Ignoring compaction for non-active session:', {
        sessionId,
        activeSessionId,
      });
      return;
    }

    console.log('[ChatStore] Compaction started for session:', { sessionId });

    // Clear any existing timeout
    if (this.compactionTimeoutId) {
      clearTimeout(this.compactionTimeoutId);
      this.compactionTimeoutId = null;
    }

    // Set compacting state
    this._isCompacting.set(true);

    // Auto-dismiss after timeout (compaction typically completes quickly)
    this.compactionTimeoutId = setTimeout(() => {
      this._isCompacting.set(false);
      this.compactionTimeoutId = null;
      console.log('[ChatStore] Compaction auto-dismissed after timeout');
    }, ChatStore.COMPACTION_AUTO_DISMISS_MS);
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
    contentBlocks?: Array<{
      type: 'text' | 'tool_ref';
      text?: string;
      toolUseId?: string;
      toolName?: string;
    }>;
  }): void {
    const { toolUseId, summaryDelta, agentId, contentBlocks } = payload;

    // DIAGNOSTIC: Log receipt of summary chunk
    console.log('[ChatStore] handleAgentSummaryChunk called:', {
      toolUseId,
      agentId, // TASK_2025_099: Stable key for lookup
      deltaLength: summaryDelta.length,
      deltaPreview: summaryDelta.slice(0, 50),
      hasContentBlocks: !!contentBlocks,
      contentBlocksCount: contentBlocks?.length ?? 0,
    });

    // Find the active tab with streaming state
    const activeTab = this.tabManager.activeTab();
    if (!activeTab?.streamingState) {
      console.warn(
        '[ChatStore] No active tab with streamingState for summary chunk:',
        { toolUseId, agentId }
      );
      return;
    }

    const state = activeTab.streamingState;

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

      console.log('[ChatStore] Content blocks accumulated:', {
        agentId,
        previousBlocksCount: currentBlocks.length,
        newBlocksCount: contentBlocks.length,
        totalBlocksCount: newBlocks.length,
        blockTypes: contentBlocks.map((b) => b.type),
      });
    }

    console.log('[ChatStore] Agent summary accumulated in StreamingState:', {
      agentId, // TASK_2025_099: Now keyed by agentId
      toolUseId, // Keep for debugging
      previousLength: currentSummary.length,
      newTotalLength: newSummary.length,
    });

    // Trigger tab update to invalidate tree cache and re-render
    // Create shallow copy to trigger signal change detection
    this.tabManager.updateTab(activeTab.id, {
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
   * Clear queued content for active tab
   * Delegates to TabManagerService (simple facade)
   */
  clearQueuedContent(): void {
    const activeTabId = this.tabManager.activeTabId();
    if (!activeTabId) return;
    this.tabManager.updateTab(activeTabId, { queuedContent: null });
  }

  /**
   * Clear the queue restore signal after content has been restored to input
   * This is a no-op now since queueRestoreSignal is exposed directly from ConversationService
   * Kept for backward compatibility
   */
  clearQueueRestoreSignal(): void {
    // No-op: components should read queueRestoreSignal directly
    // This method exists for backward compatibility only
  }

  /**
   * Interrupt current execution and send a new message (re-steering)
   *
   * TASK_2025_100: This enables mid-execution re-steering. When user sends
   * a message during streaming, we queue it. On message_complete, we:
   * 1. Abort/interrupt the current execution (stops Claude's current plan)
   * 2. Send the queued message (re-steers Claude to new direction)
   *
   * Without the interrupt, Claude would continue its previous plan and
   * potentially ignore or delay processing the new user input.
   *
   * @param tabId - Tab to interrupt and send to
   * @param content - Message content to send after interrupt
   */
  private async interruptAndSend(
    tabId: string,
    content: string
  ): Promise<void> {
    try {
      console.log('[ChatStore] interruptAndSend: aborting current execution');

      // Clear the queue first to prevent abort from trying to restore it to input
      this.tabManager.updateTab(tabId, { queuedContent: null });

      // Abort current execution - this signals SDK to stop
      await this.abortCurrentMessage();

      console.log(
        '[ChatStore] interruptAndSend: abort complete, sending new message'
      );

      // Small delay to ensure abort is processed before new message
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now send the queued message to re-steer Claude
      await this.messageSender.send(content);

      console.log('[ChatStore] interruptAndSend: re-steering message sent');
    } catch (error) {
      console.error('[ChatStore] interruptAndSend failed:', error);
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
    sessionId?: string
  ): void {
    const result = this.streamingHandler.processStreamEvent(
      event,
      tabId,
      sessionId
    );

    // TASK_2025_098: Handle compaction notification via unified streaming path
    // Compaction events now flow through CHAT_CHUNK like all other streaming events
    if (result && result.compactionSessionId) {
      console.log('[ChatStore] Handling compaction via streaming path', {
        compactionSessionId: result.compactionSessionId,
      });
      this.handleCompactionStart(result.compactionSessionId);
      return; // Compaction events don't need further processing
    }

    // TASK_2025_100: Handle re-steering via queued content on message_complete
    // When user sends a message during streaming, it's queued. On message_complete,
    // we INTERRUPT the current execution and send the queued message to re-steer Claude.
    // Without interrupt, Claude continues its previous plan ignoring the new input.
    if (result && result.queuedContent) {
      console.log(
        '[ChatStore] Re-steering: interrupting and sending queued content'
      );
      // Store queued content before abort (abort may clear queue state)
      const queuedContent = result.queuedContent;
      const resultTabId = result.tabId;

      // First: Interrupt current execution so Claude stops its current plan
      // Then: Send the queued message to re-steer Claude
      this.interruptAndSend(resultTabId, queuedContent);
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
   * Handle user response to permission request
   * Delegates to PermissionHandlerService
   */
  handlePermissionResponse(response: PermissionResponse): void {
    this.permissionHandler.handlePermissionResponse(response);
  }

  /**
   * Queue or append message based on streaming state
   * Facade delegation to ConversationService
   */
  public queueOrAppendMessage(content: string): void {
    this.conversation.queueOrAppendMessage(content);
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
    tokens: { input: number; output: number };
    duration: number;
    modelUsage?: Array<{
      model: string;
      inputTokens: number;
      outputTokens: number;
      contextWindow: number;
    }>;
  }): void {
    // TASK_2025_098: Clear compaction state when new message finishes
    // This indicates compaction (if any) has completed successfully
    this.clearCompactionState();

    // Process modelUsage to update liveModelStats for context display
    if (stats.modelUsage && stats.modelUsage.length > 0) {
      // Use the first model's data (primary model)
      const primaryModel = stats.modelUsage[0];
      const contextUsed = primaryModel.inputTokens + primaryModel.outputTokens;
      const contextPercent =
        primaryModel.contextWindow > 0
          ? Math.round((contextUsed / primaryModel.contextWindow) * 1000) / 10
          : 0;

      // Find active tab and update liveModelStats
      const activeTab = this.tabManager.activeTab();
      if (activeTab) {
        this.tabManager.updateTab(activeTab.id, {
          liveModelStats: {
            model: primaryModel.model,
            contextUsed,
            contextWindow: primaryModel.contextWindow,
            contextPercent,
          },
        });
        console.log('[ChatStore] Updated liveModelStats:', {
          model: primaryModel.model,
          contextUsed,
          contextWindow: primaryModel.contextWindow,
          contextPercent,
        });
      }
    }

    // StreamingHandler finalizes the message and returns queued content info
    const result = this.streamingHandler.handleSessionStats(stats);

    // TASK_2025_101: Handle auto-send of queued content here to avoid circular dependency
    // (StreamingHandler → MessageSender → SessionLoader → StreamingHandler)
    if (result && result.queuedContent && result.queuedContent.trim()) {
      console.log('[ChatStore] Auto-sending queued content after finalization');
      this.messageSender
        .send(result.queuedContent)
        .then(() => {
          // Clear queue only after successful send start
          this.tabManager.updateTab(result.tabId, { queuedContent: null });
          console.log('[ChatStore] Auto-send started, queue cleared');
        })
        .catch((error) => {
          console.error(
            '[ChatStore] Failed to auto-send queued content:',
            error
          );
          // Keep content in queue on error (no data loss)
        });
    }
  }

  // ============================================================================
  // CHAT COMPLETION HANDLING
  // ============================================================================

  /**
   * Handle chat completion signal from backend
   * Called when Claude CLI process exits (success or error)
   *
   * TASK_2025_101: This event is NO LONGER used to control streaming state.
   * The chat:complete event fires multiple times during tool execution (once per
   * message_complete), making it unreliable for determining when streaming truly ends.
   *
   * Streaming finalization is now handled by handleSessionStats(), which receives
   * the authoritative SESSION_STATS event derived from SDK's type=result message.
   * That event fires exactly once per turn and contains final cost/token data.
   *
   * This method now only logs the event for debugging purposes.
   */
  handleChatComplete(data: {
    tabId?: string;
    sessionId?: string;
    code: number;
  }): void {
    // TASK_2025_101: chat:complete is no longer used for streaming state management.
    // It fires multiple times (once per message_complete during tool execution).
    // SESSION_STATS (from type=result) is the authoritative completion signal.
    console.log(
      '[ChatStore] chat:complete received (no-op, streaming managed by SESSION_STATS):',
      data
    );
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

    // Reset streaming state (including per-tab currentMessageId)
    this.tabManager.updateTab(targetTabId, {
      status: 'loaded',
      currentMessageId: null,
    });
    this.sessionManager.setStatus('loaded');
  }
}
