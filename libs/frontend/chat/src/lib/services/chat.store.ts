import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ExecutionChatMessage,
  ChatSessionSummary,
  ExecutionNode,
  JSONLMessage,
  createExecutionChatMessage,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';
import { SessionReplayService } from './session-replay.service';
import { SessionManager } from './session-manager.service';
import { JsonlMessageProcessor } from './jsonl-processor.service';
import { TabManagerService } from './tab-manager.service';

/**
 * ChatStore - Signal-based reactive store for chat state
 *
 * Responsibilities:
 * - Maintain chat sessions list
 * - Track current session
 * - Manage message list for current session
 * - Coordinate JSONL processing via services
 * - Handle streaming state
 * - Wire to RPC for backend communication
 *
 * Architecture:
 * - Core signals (_sessions, _currentSessionId, _messages, _isStreaming)
 * - Derived computed signals (currentSession, messageCount, hasExistingSession)
 * - Async actions (loadSessions, switchSession, sendMessage)
 * - Service coordination (delegates to TreeBuilder, SessionReplay, SessionManager, JsonlProcessor)
 * - RPC integration (calls backend via ClaudeRpcService)
 *
 * Refactoring Phase 6 (FINAL):
 * - Extracted 1,200+ lines to 4 specialized services
 * - ChatStore now coordinates services instead of inline implementation
 * - Reduced from ~1,678 lines to ~400 lines
 */
@Injectable({ providedIn: 'root' })
export class ChatStore {
  // ============================================================================
  // SERVICE DEPENDENCIES
  // ============================================================================

  private readonly _vscodeService = inject(VSCodeService);
  private readonly _claudeRpcService = inject(ClaudeRpcService);

  // Extracted services (Phase 6)
  private readonly sessionReplay = inject(SessionReplayService);
  private readonly sessionManager = inject(SessionManager);
  private readonly jsonlProcessor = inject(JsonlMessageProcessor);
  private readonly tabManager = inject(TabManagerService);

  // Signal to track service initialization state
  private readonly _servicesReady = signal(false);
  readonly servicesReady = this._servicesReady.asReadonly();

  constructor() {
    console.log('[ChatStore] Initializing...');
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

      // Mark services as ready
      this._servicesReady.set(true);
      console.log('[ChatStore] Services initialized and ready');

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
  // CORE SIGNALS
  // ============================================================================

  private readonly _sessions = signal<readonly ChatSessionSummary[]>([]);

  // Pagination state for sessions
  private readonly _hasMoreSessions = signal(false);
  private readonly _totalSessions = signal(0);
  private readonly _sessionsOffset = signal(0);
  private readonly _isLoadingMoreSessions = signal(false);
  private static readonly SESSIONS_PAGE_SIZE = 10;

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  readonly sessions = this._sessions.asReadonly();

  // Computed from active tab (delegated to TabManager)
  readonly currentSessionId = computed(
    () => this.tabManager.activeTab()?.claudeSessionId ?? null
  );
  readonly messages = computed(
    () => this.tabManager.activeTab()?.messages ?? []
  );
  readonly currentExecutionTree = computed(
    () => this.tabManager.activeTab()?.executionTree ?? null
  );
  readonly isStreaming = computed(() => {
    const tab = this.tabManager.activeTab();
    return tab?.status === 'streaming' || tab?.status === 'resuming';
  });

  readonly hasMoreSessions = this._hasMoreSessions.asReadonly();
  readonly totalSessions = this._totalSessions.asReadonly();
  readonly isLoadingMoreSessions = this._isLoadingMoreSessions.asReadonly();

  // Permission requests
  private readonly _permissionRequests = signal<PermissionRequest[]>([]);
  readonly permissionRequests = this._permissionRequests.asReadonly();

  // ============================================================================
  // DERIVED COMPUTED SIGNALS
  // ============================================================================

  readonly currentSession = computed(() => {
    const sessionId = this.currentSessionId();
    return this._sessions().find((s) => s.id === sessionId) ?? null;
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

  // Track currently building message
  private currentMessageId: string | null = null;

  // ============================================================================
  // ACTIONS
  // ============================================================================

  /**
   * Clear current session to start a new conversation
   * Creates a new tab instead of clearing state
   */
  clearCurrentSession(): void {
    console.log('[ChatStore] Clearing current session for new conversation');

    // Create new tab instead of just clearing state
    const newTabId = this.tabManager.createTab('New Chat');
    this.tabManager.switchTab(newTabId);

    this.currentMessageId = null;
    this.sessionManager.clearSession();
  }

  /**
   * Load sessions from backend via RPC (with pagination)
   * Resets pagination and loads first page
   */
  async loadSessions(): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      if (!this._servicesReady()) {
        console.log('[ChatStore] Waiting for services to initialize...');
        const ready = await this.waitForServices(5000);
        if (!ready) {
          console.error(
            '[ChatStore] loadSessions: Services initialization timeout'
          );
          return;
        }
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ChatStore] Services not available after initialization'
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ChatStore] No workspace path available');
        return;
      }

      // Reset pagination state
      this._sessionsOffset.set(0);

      const result = await this.claudeRpcService.call<{
        sessions: ChatSessionSummary[];
        total: number;
        hasMore: boolean;
      }>('session:list', {
        workspacePath,
        limit: ChatStore.SESSIONS_PAGE_SIZE,
        offset: 0,
      });

      if (result.success && result.data) {
        this._sessions.set(result.data.sessions);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(result.data.sessions.length);
        console.log(
          '[ChatStore] Loaded sessions:',
          result.data.sessions.length,
          'of',
          result.data.total
        );
      } else {
        console.error('[ChatStore] Failed to load sessions:', result.error);
      }
    } catch (error) {
      console.error('[ChatStore] Failed to load sessions:', error);
    }
  }

  /**
   * Load more sessions (pagination)
   */
  async loadMoreSessions(): Promise<void> {
    if (!this._hasMoreSessions() || this._isLoadingMoreSessions()) {
      return;
    }

    try {
      this._isLoadingMoreSessions.set(true);

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error('[ChatStore] Services not available');
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        return;
      }

      const currentOffset = this._sessionsOffset();

      const result = await this.claudeRpcService.call<{
        sessions: ChatSessionSummary[];
        total: number;
        hasMore: boolean;
      }>('session:list', {
        workspacePath,
        limit: ChatStore.SESSIONS_PAGE_SIZE,
        offset: currentOffset,
      });

      if (result.success && result.data) {
        // Append new sessions to existing
        this._sessions.update((current) => [
          ...current,
          ...result.data!.sessions,
        ]);
        this._totalSessions.set(result.data.total);
        this._hasMoreSessions.set(result.data.hasMore);
        this._sessionsOffset.set(currentOffset + result.data.sessions.length);
        console.log(
          '[ChatStore] Loaded more sessions:',
          result.data.sessions.length,
          ', total now:',
          this._sessions().length
        );
      }
    } catch (error) {
      console.error('[ChatStore] Failed to load more sessions:', error);
    } finally {
      this._isLoadingMoreSessions.set(false);
    }
  }

  /**
   * Switch to a different session and load its messages via RPC
   */
  async switchSession(sessionId: string): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      if (!this._servicesReady()) {
        console.log('[ChatStore] Waiting for services to initialize...');
        const ready = await this.waitForServices(5000);
        if (!ready) {
          console.error(
            '[ChatStore] switchSession: Services initialization timeout'
          );
          return;
        }
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ChatStore] Services not available after initialization'
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ChatStore] No workspace path available');
        return;
      }

      // Clear streaming state before loading
      this.currentMessageId = null;

      // Load messages for this session via RPC
      const result = await this.claudeRpcService.call<{
        sessionId: string;
        messages: JSONLMessage[];
        agentSessions?: Array<{ agentId: string; messages: JSONLMessage[] }>;
      }>('session:load', { sessionId, workspacePath });

      if (result.success && result.data) {
        console.log(
          '[ChatStore] Loaded session:',
          result.data.messages.length,
          'messages,',
          result.data.agentSessions?.length ?? 0,
          'agent sessions'
        );

        // Use SessionReplayService to process JSONL messages
        const { messages, nodeMaps } = this.sessionReplay.replaySession(
          result.data.messages,
          result.data.agentSessions ?? []
        );

        // Open or switch to tab for this session (prevents duplicate tabs)
        const title =
          messages[0]?.rawContent?.substring(0, 50) ||
          sessionId.substring(0, 50);
        const activeTabId = this.tabManager.openSessionTab(sessionId, title);

        // Update tab with loaded messages
        this.tabManager.updateTab(activeTabId, {
          messages,
          executionTree: null,
          status: 'loaded',
          title,
        });

        // Update SessionManager with node maps and state
        this.sessionManager.setNodeMaps(nodeMaps);
        this.sessionManager.setSessionId(sessionId);
        this.sessionManager.setStatus('loaded');

        console.log(
          '[ChatStore] Processed into',
          messages.length,
          'chat messages,',
          nodeMaps.agents.size,
          'agents registered,',
          nodeMaps.tools.size,
          'tools registered'
        );
      } else {
        console.error('[ChatStore] Failed to load session:', result.error);
      }
    } catch (error) {
      console.error('[ChatStore] Failed to switch session:', error);
    }
  }

  /**
   * Send a message - automatically determines whether to start new or continue
   * @deprecated Use startNewConversation() or continueConversation() for explicit control
   */
  async sendMessage(content: string, files?: string[]): Promise<void> {
    if (this.hasExistingSession()) {
      return this.continueConversation(content, files);
    } else {
      return this.startNewConversation(content, files);
    }
  }

  /**
   * Start a brand new conversation with Claude
   * Creates a new session ID and calls chat:start
   */
  async startNewConversation(content: string, files?: string[]): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      if (!this._servicesReady()) {
        console.log('[ChatStore] Waiting for services to initialize...');
        const ready = await this.waitForServices(5000);
        if (!ready) {
          console.error(
            '[ChatStore] startNewConversation: Services initialization timeout'
          );
          return;
        }
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ChatStore] Services not available after initialization'
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ChatStore] No workspace path available');
        return;
      }

      // Get or create active tab
      let activeTabId = this.tabManager.activeTabId();
      if (!activeTabId) {
        activeTabId = this.tabManager.createTab();
        this.tabManager.switchTab(activeTabId);
      }

      // Clear previous node maps to prevent stale references
      this.sessionManager.clearNodeMaps();

      // Generate placeholder session ID for new conversation
      const sessionId = this.generateId();

      // Update tab with draft status
      this.tabManager.updateTab(activeTabId, {
        title: content.substring(0, 50) || 'New Chat',
        status: 'draft',
        isDirty: false,
      });

      // Update SessionManager state
      this.sessionManager.setSessionId(sessionId);
      this.sessionManager.clearClaudeSessionId(); // Clear previous real ID
      this.sessionManager.setStatus('draft'); // Start in draft state (no real session ID yet)

      // Add user message immediately (with null sessionId - will be updated when resolved)
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId: null as any, // Will be updated when session:id-resolved arrives
      });

      // Update tab with user message
      const activeTab = this.tabManager.activeTab();
      this.tabManager.updateTab(activeTabId, {
        messages: [...(activeTab?.messages ?? []), userMessage],
      });

      this.currentMessageId = null;

      console.log('[ChatStore] Starting NEW conversation:', { sessionId });

      // Call RPC to start NEW chat
      const result = await this.claudeRpcService.call<{ sessionId: string }>(
        'chat:start',
        {
          prompt: content,
          sessionId,
          workspacePath,
          options: files ? { files } : undefined,
        }
      );

      if (!result.success) {
        console.error('[ChatStore] Failed to start chat:', result.error);
        // Update tab status to loaded (failed)
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      } else {
        console.log('[ChatStore] New conversation started:', result.data);

        // Add placeholder session immediately for UI responsiveness
        const now = Date.now();
        const newSession: ChatSessionSummary = {
          id: sessionId,
          name: content.substring(0, 50) || 'New Session',
          createdAt: now,
          lastActivityAt: now,
          messageCount: 1,
          isActive: true,
        };
        this._sessions.update((sessions) => [newSession, ...sessions]);

        // Refresh sessions from backend (async, updates with accurate data)
        this.loadSessions().catch((err) => {
          console.warn('[ChatStore] Failed to refresh sessions:', err);
        });
      }
    } catch (error) {
      console.error('[ChatStore] Failed to start new conversation:', error);
      // Update tab status to loaded (error)
      const activeTabId = this.tabManager.activeTabId();
      if (activeTabId) {
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      }
    }
  }

  /**
   * Continue an existing conversation with Claude
   * Uses the current session ID and calls chat:continue with --resume flag
   */
  async continueConversation(content: string, files?: string[]): Promise<void> {
    try {
      // Wait for services to be ready (with timeout)
      if (!this._servicesReady()) {
        console.log('[ChatStore] Waiting for services to initialize...');
        const ready = await this.waitForServices(5000);
        if (!ready) {
          console.error(
            '[ChatStore] continueConversation: Services initialization timeout'
          );
          return;
        }
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[ChatStore] Services not available after initialization'
        );
        return;
      }

      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!workspacePath) {
        console.warn('[ChatStore] No workspace path available');
        return;
      }

      // Get REAL Claude session ID from the ACTIVE TAB (not global SessionManager)
      // This is critical for multi-tab support - each tab has its own session
      const activeTab = this.tabManager.activeTab();
      const sessionId = activeTab?.claudeSessionId;
      if (!sessionId) {
        console.warn(
          '[ChatStore] No Claude session ID on active tab - starting new conversation'
        );
        return this.startNewConversation(content, files);
      }

      // Get active tab
      const activeTabId = this.tabManager.activeTabId();
      if (!activeTabId) {
        console.warn('[ChatStore] No active tab for continuing conversation');
        return this.startNewConversation(content, files);
      }

      // Update SessionManager state
      this.sessionManager.setStatus('resuming');

      // Update tab status
      this.tabManager.updateTab(activeTabId, { status: 'resuming' });

      // Add user message immediately
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId,
      });

      // Update tab with user message (reuse activeTab from above)
      this.tabManager.updateTab(activeTabId, {
        messages: [...(activeTab?.messages ?? []), userMessage],
      });

      console.log('[ChatStore] Continuing EXISTING session:', { sessionId });

      // Call RPC to CONTINUE existing chat (uses --resume flag)
      const result = await this.claudeRpcService.call<{ sessionId: string }>(
        'chat:continue',
        {
          prompt: content,
          sessionId,
          workspacePath,
        }
      );

      if (!result.success) {
        console.error('[ChatStore] Failed to continue chat:', result.error);
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      } else {
        console.log('[ChatStore] Conversation continued:', result.data);
        this.sessionManager.setStatus('streaming');
        this.tabManager.updateTab(activeTabId, { status: 'streaming' });
      }
    } catch (error) {
      console.error('[ChatStore] Failed to continue conversation:', error);
      const activeTabId = this.tabManager.activeTabId();
      if (activeTabId) {
        this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      }
    }
  }

  /**
   * Handle session ID resolution from backend
   * Called when backend extracts real Claude CLI session UUID from JSONL stream
   */
  handleSessionIdResolved(data: {
    sessionId: string;
    realSessionId: string;
  }): void {
    console.log('[ChatStore] Session ID resolved:', data);

    const { realSessionId } = data;
    const activeTabId = this.tabManager.activeTabId();

    if (!activeTabId) {
      console.warn('[ChatStore] No active tab for session ID resolution');
      return;
    }

    const activeTab = this.tabManager.activeTab();
    if (activeTab?.status !== 'draft') {
      console.warn(
        '[ChatStore] Ignoring session ID resolution for non-draft tab'
      );
      return;
    }

    // Update tab with real session ID
    this.tabManager.resolveSessionId(activeTabId, realSessionId);

    // Update messages with real session ID
    const updatedMessages = activeTab.messages.map((msg) => ({
      ...msg,
      sessionId: msg.sessionId === null ? realSessionId : msg.sessionId,
    }));

    this.tabManager.updateTab(activeTabId, {
      messages: updatedMessages,
    });

    // Update SessionManager
    this.sessionManager.setClaudeSessionId(realSessionId);

    // Refresh session list to show new session in sidebar
    this.loadSessions().catch((err) => {
      console.warn(
        '[ChatStore] Failed to refresh sessions after ID resolution:',
        err
      );
    });
  }

  /**
   * Abort current streaming message via RPC
   */
  async abortCurrentMessage(): Promise<void> {
    try {
      if (!this.claudeRpcService) {
        console.warn('[ChatStore] RPC service not initialized');
        return;
      }

      const sessionId = this.currentSessionId();
      if (!sessionId) {
        console.warn('[ChatStore] No active session to abort');
        return;
      }

      // Call RPC to abort
      const result = await this.claudeRpcService.call<void>('chat:abort', {
        sessionId,
      });

      if (result.success) {
        console.log('[ChatStore] Chat aborted successfully');
      } else {
        console.error('[ChatStore] Failed to abort chat:', result.error);
      }

      // Finalize current message regardless of RPC result
      this.finalizeCurrentMessage();
    } catch (error) {
      console.error('[ChatStore] Failed to abort message:', error);
    }
  }

  // ============================================================================
  // JSONL PROCESSING (Delegated to JsonlMessageProcessor)
  // ============================================================================

  /**
   * Process a JSONL chunk from Claude CLI
   *
   * Delegates to JsonlMessageProcessor and updates active tab's execution tree.
   */
  processJsonlChunk(chunk: JSONLMessage): void {
    try {
      const activeTabId = this.tabManager.activeTabId();
      if (!activeTabId) {
        console.warn('[ChatStore] No active tab for JSONL processing');
        return;
      }

      const activeTab = this.tabManager.activeTab();

      // Delegate to JsonlMessageProcessor
      const result = this.jsonlProcessor.processChunk(
        chunk,
        activeTab?.executionTree ?? null
      );

      // Update state based on result
      if (result.newMessageStarted) {
        this.currentMessageId = result.messageId ?? null;
      }

      if (result.tree !== activeTab?.executionTree) {
        this.tabManager.updateTab(activeTabId, {
          executionTree: result.tree,
        });
      }

      if (result.streamComplete) {
        this.finalizeCurrentMessage();
      }
    } catch (error) {
      console.error('[ChatStore] Error processing JSONL chunk:', error, chunk);
    }
  }

  /**
   * Finalize the current streaming message
   *
   * Converts the execution tree to a chat message and adds it to active tab's messages.
   */
  private finalizeCurrentMessage(): void {
    const activeTabId = this.tabManager.activeTabId();
    if (!activeTabId) return;

    const activeTab = this.tabManager.activeTab();
    const tree = activeTab?.executionTree;

    if (!tree || !this.currentMessageId) return;

    // Mark all streaming nodes as complete
    const finalizeNode = (node: ExecutionNode): ExecutionNode => ({
      ...node,
      status: node.status === 'streaming' ? 'complete' : node.status,
      children: node.children.map(finalizeNode),
    });

    const finalTree = finalizeNode(tree);

    // Create chat message with execution tree
    const assistantMessage = createExecutionChatMessage({
      id: this.currentMessageId,
      role: 'assistant',
      executionTree: finalTree,
      sessionId: activeTab.claudeSessionId ?? undefined,
    });

    // Add to active tab's messages
    this.tabManager.updateTab(activeTabId, {
      messages: [...activeTab.messages, assistantMessage],
      executionTree: null,
      status: 'loaded',
    });

    this.currentMessageId = null;

    // Update SessionManager status
    this.sessionManager.setStatus('loaded');
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Wait for services to be ready with timeout
   * @param timeoutMs - Timeout in milliseconds (default: 5000)
   * @returns Promise resolving to true if ready, false if timeout
   */
  private async waitForServices(timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();

    // Poll servicesReady signal with short intervals
    while (!this._servicesReady()) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        return false;
      }

      // Wait 50ms before next check
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return true;
  }

  // ============================================================================
  // PERMISSION REQUEST HANDLING
  // ============================================================================

  /**
   * Handle incoming permission request from backend
   * Adds request to pending permission requests list
   */
  handlePermissionRequest(request: PermissionRequest): void {
    console.log('[ChatStore] Permission request received:', request);
    this._permissionRequests.update((requests) => [...requests, request]);
  }

  /**
   * Handle user response to permission request
   * Removes request from pending list and sends response to backend
   */
  handlePermissionResponse(response: PermissionResponse): void {
    console.log('[ChatStore] Permission response:', response);

    // Remove from pending requests
    this._permissionRequests.update((requests) =>
      requests.filter((r) => r.id !== response.id)
    );

    // Send to backend via VSCodeService
    // Access the private vscode API via type assertion (same pattern as ClaudeRpcService)
    const vscodeService = this.vscodeService as any;
    if (vscodeService?.vscode) {
      vscodeService.vscode.postMessage({
        type: 'permission:response',
        payload: response,
      });
    } else {
      console.error(
        '[ChatStore] VSCodeService not available for permission response'
      );
    }
  }

  // ============================================================================
  // CHAT COMPLETION HANDLING
  // ============================================================================

  /**
   * Handle chat completion signal from backend
   * Called when Claude CLI process exits (success or error)
   * Ensures UI state is reset to 'loaded' regardless of exit code
   */
  handleChatComplete(data: { sessionId: string; code: number }): void {
    console.log('[ChatStore] Chat complete:', data);

    const activeTabId = this.tabManager.activeTabId();
    if (!activeTabId) {
      console.warn('[ChatStore] No active tab for chat completion');
      return;
    }

    const activeTab = this.tabManager.activeTab();

    // Only reset if tab is still in streaming/resuming state
    if (
      activeTab?.status === 'streaming' ||
      activeTab?.status === 'resuming' ||
      activeTab?.status === 'draft'
    ) {
      // Finalize any pending message
      this.finalizeCurrentMessage();

      // Ensure tab status is reset to loaded
      this.tabManager.updateTab(activeTabId, { status: 'loaded' });
      this.sessionManager.setStatus('loaded');

      console.log(
        '[ChatStore] Chat state reset to loaded (exit code:',
        data.code,
        ')'
      );
    }
  }

  /**
   * Handle chat error signal from backend
   * Called when an error occurs during chat (CLI error, network error, etc.)
   * Resets streaming state and optionally displays error
   */
  handleChatError(data: { sessionId: string; error: string }): void {
    console.error('[ChatStore] Chat error:', data);

    const activeTabId = this.tabManager.activeTabId();
    if (!activeTabId) {
      console.warn('[ChatStore] No active tab for chat error');
      return;
    }

    // Reset streaming state
    this.tabManager.updateTab(activeTabId, { status: 'loaded' });
    this.sessionManager.setStatus('loaded');
    this.currentMessageId = null;

    console.log('[ChatStore] Chat state reset due to error');
  }
}
