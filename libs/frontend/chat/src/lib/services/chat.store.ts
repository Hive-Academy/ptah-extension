import { Injectable, signal, computed, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  ExecutionChatMessage,
  ChatSessionSummary,
  ExecutionNode,
  JSONLMessage,
  createExecutionChatMessage,
} from '@ptah-extension/shared';
import { SessionReplayService } from './session-replay.service';
import { SessionManager } from './session-manager.service';
import { JsonlMessageProcessor } from './jsonl-processor.service';

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
  private readonly _currentSessionId = signal<string | null>(null);
  private readonly _messages = signal<readonly ExecutionChatMessage[]>([]);
  private readonly _isStreaming = signal(false);

  // Current execution tree being built (for streaming assistant messages)
  private readonly _currentExecutionTree = signal<ExecutionNode | null>(null);

  // ============================================================================
  // PUBLIC READONLY SIGNALS
  // ============================================================================

  readonly sessions = this._sessions.asReadonly();
  readonly currentSessionId = this._currentSessionId.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();
  readonly currentExecutionTree = this._currentExecutionTree.asReadonly();

  // ============================================================================
  // DERIVED COMPUTED SIGNALS
  // ============================================================================

  readonly currentSession = computed(() => {
    const sessionId = this._currentSessionId();
    return this._sessions().find((s) => s.id === sessionId) ?? null;
  });

  readonly messageCount = computed(() => this._messages().length);

  /**
   * Check if we have an active session loaded from disk (not a fresh one)
   * Used to determine whether to start new or continue existing conversation
   */
  readonly hasExistingSession = computed(() => {
    return this.sessionManager.shouldContinueSession();
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
   * Does not load anything from backend - just resets local state
   */
  clearCurrentSession(): void {
    console.log('[ChatStore] Clearing current session for new conversation');
    this._currentSessionId.set(null);
    this._messages.set([]);
    this._isStreaming.set(false);
    this._currentExecutionTree.set(null);
    this.currentMessageId = null;

    // Clear SessionManager state
    this.sessionManager.clearSession();
  }

  /**
   * Load all sessions from backend via RPC
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

      const result = await this.claudeRpcService.call<ChatSessionSummary[]>(
        'session:list',
        { workspacePath }
      );

      if (result.success && result.data) {
        this._sessions.set(result.data);
        console.log('[ChatStore] Loaded sessions:', result.data.length);
      } else {
        console.error('[ChatStore] Failed to load sessions:', result.error);
      }
    } catch (error) {
      console.error('[ChatStore] Failed to load sessions:', error);
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

      this._currentSessionId.set(sessionId);

      // Clear streaming state before loading
      this._isStreaming.set(false);
      this._currentExecutionTree.set(null);
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

        this._messages.set(messages);

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
        this._messages.set([]);
      }
    } catch (error) {
      console.error('[ChatStore] Failed to switch session:', error);
      this._messages.set([]);
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

      // Clear previous session state including node maps
      // This prevents stale agent/tool references from a previously loaded session
      this._messages.set([]);
      this._currentExecutionTree.set(null);
      this.currentMessageId = null;
      this.sessionManager.clearNodeMaps();

      // Generate new session ID for new conversation
      const sessionId = this.generateId();
      this._currentSessionId.set(sessionId);

      // Update SessionManager state
      this.sessionManager.setSessionId(sessionId);
      this.sessionManager.setStatus('streaming');

      // Add user message immediately
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId,
      });

      this._messages.update((msgs) => [...msgs, userMessage]);

      // Start streaming
      this._isStreaming.set(true);

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
        this._isStreaming.set(false);
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
      this._isStreaming.set(false);
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

      // Get existing session ID
      const sessionId = this._currentSessionId();
      if (!sessionId) {
        console.error('[ChatStore] No session selected - cannot continue');
        // Fall back to starting new conversation
        return this.startNewConversation(content, files);
      }

      // Update SessionManager state
      this.sessionManager.setStatus('resuming');

      // Add user message immediately
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        sessionId,
      });

      this._messages.update((msgs) => [...msgs, userMessage]);

      // Start streaming
      this._isStreaming.set(true);

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
        this._isStreaming.set(false);
      } else {
        console.log('[ChatStore] Conversation continued:', result.data);
        this.sessionManager.setStatus('streaming');
      }
    } catch (error) {
      console.error('[ChatStore] Failed to continue conversation:', error);
      this._isStreaming.set(false);
    }
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

      const sessionId = this._currentSessionId();
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
      this._isStreaming.set(false);
      this.finalizeCurrentMessage();
    } catch (error) {
      console.error('[ChatStore] Failed to abort message:', error);
      this._isStreaming.set(false);
    }
  }

  // ============================================================================
  // JSONL PROCESSING (Delegated to JsonlMessageProcessor)
  // ============================================================================

  /**
   * Process a JSONL chunk from Claude CLI
   *
   * Delegates to JsonlMessageProcessor and updates state based on result.
   */
  processJsonlChunk(chunk: JSONLMessage): void {
    try {
      // Delegate to JsonlMessageProcessor
      const result = this.jsonlProcessor.processChunk(
        chunk,
        this._currentExecutionTree()
      );

      // Update state based on result
      if (result.newMessageStarted) {
        this.currentMessageId = result.messageId ?? null;
      }

      if (result.tree !== this._currentExecutionTree()) {
        this._currentExecutionTree.set(result.tree);
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
   * Converts the execution tree to a chat message and adds it to the message list.
   * This method stays in ChatStore because it directly updates signals.
   */
  private finalizeCurrentMessage(): void {
    const tree = this._currentExecutionTree();
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
      sessionId: this._currentSessionId() ?? undefined,
    });

    // Add to messages list
    this._messages.update((msgs) => [...msgs, assistantMessage]);

    // Clear streaming state
    this._isStreaming.set(false);
    this._currentExecutionTree.set(null);
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
}
