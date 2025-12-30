import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ExecutionNode,
  FlatStreamEventUnion,
  PermissionRequest,
  PermissionResponse,
  SessionId,
  calculateMessageCost,
  createExecutionChatMessage,
  MESSAGE_TYPES,
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

  /**
   * Handle agent summary chunk from backend file watcher
   *
   * This is called when the AgentSessionWatcherService detects new content
   * in an agent's JSONL file during streaming. The summary content is
   * extracted from text blocks and appended to the agent node.
   *
   * @param payload - Contains toolUseId and summaryDelta
   */
  handleAgentSummaryChunk(payload: {
    toolUseId: string;
    summaryDelta: string;
  }): void {
    const { toolUseId, summaryDelta } = payload;

    // Find the agent node by toolUseId
    const agentNode = this.sessionManager.getAgent(toolUseId);
    if (!agentNode) {
      console.warn(
        '[ChatStore] Agent node not found for summary chunk:',
        toolUseId
      );
      return;
    }

    // Update agent node with appended summary content
    const updatedAgent: ExecutionNode = {
      ...agentNode,
      summaryContent: (agentNode.summaryContent || '') + summaryDelta,
    };

    // Register updated agent
    this.sessionManager.registerAgent(toolUseId, updatedAgent);

    // Update the agent in the current message's execution tree
    const activeTab = this.tabManager.activeTab();
    if (!activeTab) return;

    const currentMessages = activeTab.messages;
    if (currentMessages.length === 0) return;

    // Find the last assistant message and update the agent node in its tree
    const lastMsgIndex = currentMessages.length - 1;
    const lastMsg = currentMessages[lastMsgIndex];

    if (lastMsg.role !== 'assistant' || !lastMsg.streamingState) return;

    // Replace the agent node in the tree
    const updatedTree = this.replaceNodeInTree(
      lastMsg.streamingState,
      toolUseId,
      updatedAgent
    );

    if (updatedTree !== lastMsg.streamingState) {
      // Update the message with the new tree
      const updatedMessages = [...currentMessages];
      updatedMessages[lastMsgIndex] = {
        ...lastMsg,
        streamingState: updatedTree,
      };

      this.tabManager.updateTab(activeTab.id, {
        messages: updatedMessages,
      });
    }
  }

  /**
   * Recursively replace a node in the execution tree by ID
   *
   * @param tree - Root node of the tree
   * @param nodeId - ID of the node to replace
   * @param replacement - New node to insert
   * @returns Updated tree (new reference if changed)
   */
  private replaceNodeInTree(
    tree: ExecutionNode,
    nodeId: string,
    replacement: ExecutionNode
  ): ExecutionNode {
    // Check if this is the node to replace
    if (tree.id === nodeId || tree.toolCallId === nodeId) {
      return replacement;
    }

    // Recursively check children
    let childrenChanged = false;
    const newChildren = tree.children.map((child) => {
      const updated = this.replaceNodeInTree(child, nodeId, replacement);
      if (updated !== child) {
        childrenChanged = true;
      }
      return updated;
    });

    // Return same reference if nothing changed
    if (!childrenChanged) {
      return tree;
    }

    // Return new tree with updated children
    return {
      ...tree,
      children: newChildren,
    };
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
    this.streamingHandler.processStreamEvent(event, tabId, sessionId);
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
   * @param stats - Session statistics (cost, tokens, duration)
   */
  handleSessionStats(stats: {
    sessionId: string;
    cost: number;
    tokens: { input: number; output: number };
    duration: number;
  }): void {
    this.streamingHandler.handleSessionStats(stats);
  }

  // ============================================================================
  // CHAT COMPLETION HANDLING
  // ============================================================================

  /**
   * Handle chat completion signal from backend
   * Called when Claude CLI process exits (success or error)
   *
   * TASK_2025_092: Now routes by tabId (primary) instead of sessionId lookup
   * - tabId: Direct tab routing (preferred)
   * - sessionId: Real SDK UUID for reference
   *
   * Ensures UI state is reset to 'loaded' regardless of exit code.
   * FIX #1: Queue cleared AFTER auto-send starts (in .then callback)
   * FIX #6: Guard against recursive auto-send
   */
  handleChatComplete(data: {
    tabId?: string;
    sessionId?: string;
    code: number;
  }): void {
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
    }

    if (!targetTabId || !targetTab) {
      console.warn('[ChatStore] No target tab for chat completion');
      return;
    }

    // Only reset if tab is still in streaming/resuming state
    if (
      targetTab.status === 'streaming' ||
      targetTab.status === 'resuming' ||
      targetTab.status === 'draft'
    ) {
      // TASK_2025_093 FIX: DO NOT call finalizeCurrentMessage here!
      // chat:complete should ONLY update UI status, not mutate the event pipeline.
      //
      // Problem: tool_result events arrive AFTER message_complete, so calling
      // finalizeCurrentMessage here sets streamingState: null too early.
      // Subsequent tool_result events create a new streamingState that is never
      // finalized, causing tools to remain stuck in streaming state.
      //
      // Solution: Let streaming state persist. Events continue to accumulate.
      // Finalization happens lazily when:
      // 1. User sends next message (startNewMessage finalizes previous)
      // 2. Session is switched (lazy finalization on switch)
      // 3. Tab is closed (cleanup)
      //
      // This also aligns with user's requirement that streaming should be
      // UI-only (read-only status) and users can send messages while Claude works.

      // Ensure tab status is reset to loaded (UI allows input)
      this.tabManager.updateTab(targetTabId, { status: 'loaded' });
      this.sessionManager.setStatus('loaded');

      // ========== AUTO-SEND QUEUED CONTENT ==========
      // FIX #6: Guard against recursive auto-send (via ConversationService signal)
      if (this.conversation.isAutoSending()) {
        return;
      }

      // Check if this tab has queued content
      const queuedContent = targetTab.queuedContent;
      if (queuedContent && queuedContent.trim()) {
        // Auto-send via continueConversation (async, don't await)
        // ConversationService handles the _isAutoSending flag internally
        this.continueConversation(queuedContent)
          .then(() => {
            // Clear queue only after successful send start
            this.tabManager.updateTab(targetTabId!, { queuedContent: null });
          })
          .catch((error) => {
            console.error(
              '[ChatStore] Failed to auto-send queued content:',
              error
            );
            // Keep content in queue on error (no data loss)
            // No need to restore - it was never cleared
          });
      }
      // ========== END AUTO-SEND ==========
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
