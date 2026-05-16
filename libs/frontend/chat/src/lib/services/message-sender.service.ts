/**
 * MessageSenderService - Centralized Message Sending Logic (Mediator Pattern)
 *
 * Eliminates 3-level callback indirection by providing direct message sending API.
 * Extracted from ConversationService to create clean separation of concerns.
 *
 * Responsibilities:
 * - Route messages to correct handler (new vs continue conversation)
 * - Check streaming state and queue if necessary
 * - Coordinate with RPC service for backend communication
 *
 * Benefits:
 * - Zero callback indirection (direct method calls)
 * - Clear service responsibility (message sending only)
 * - No circular dependencies (mediator pattern)
 * - Easy to test (mock dependencies)
 *
 * Extracted from ChatStore refactoring.
 */

import { Injectable, inject } from '@angular/core';
import {
  ClaudeRpcService,
  VSCodeService,
  ModelStateService,
  EffortStateService,
  PtahCliStateService,
} from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  SessionId,
  EffortLevel,
} from '@ptah-extension/shared';
import {
  ConversationRegistry,
  TabId,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import { SessionManager } from '@ptah-extension/chat-streaming';
import { MessageValidationService } from './message-validation.service';
import type { SendMessageOptions } from '@ptah-extension/chat-types';

/**
 * Centralized service for sending messages
 *
 * Replaces callback-based message sending with direct method calls.
 * This is the mediator that coordinates message flow between components.
 */
@Injectable({ providedIn: 'root' })
export class MessageSenderService {
  // ============================================================================
  // DEPENDENCIES
  // ============================================================================

  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly validator = inject(MessageValidationService);
  private readonly modelState = inject(ModelStateService);
  private readonly effortState = inject(EffortStateService);
  private readonly ptahCliState = inject(PtahCliStateService);
  // `placeholderSessionId` retired. The sessionId for a brand-new
  // conversation is sourced from the routing layer: if the tab is bound to
  // a conversation that already has a head session, reuse it; otherwise mint
  // a fresh id and let StreamRouter append it on the first event.
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly tabSessionBinding = inject(TabSessionBinding);

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Generate unique ID for messages/sessions
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Sourcing helper for the session id used in `startNewConversation`.
   * Replaces `tab.placeholderSessionId`.
   *
   * Resolves the active tab's bound conversation via `TabSessionBinding`,
   * then returns the head session id (last session in the conversation's
   * ordered list) from `ConversationRegistry`. Returns `null` when:
   *   - the tab id is not parseable as a `TabId` (legacy id format), OR
   *   - the tab is not bound to any conversation yet, OR
   *   - the bound conversation has no sessions (router will append one
   *     when the first stream event flows back).
   *
   * Callers fall back to `generateId()` when this returns null.
   */
  private headSessionForTab(tabId: string | undefined): string | null {
    if (!tabId) return null;
    const parsedTabId = TabId.safeParse(tabId);
    if (!parsedTabId) return null;
    const convId = this.tabSessionBinding.conversationFor(parsedTabId);
    if (!convId) return null;
    const record = this.conversationRegistry.getRecord(convId);
    if (!record || record.sessions.length === 0) return null;
    return record.sessions[record.sessions.length - 1] as string;
  }

  /**
   * Wait for services to be ready with timeout
   * @param timeoutMs - Timeout in milliseconds (default: 5000)
   * @returns Promise<boolean> - true if ready, false if timeout
   */
  private async waitForServices(timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();

    // Poll claudeRpcService and vscodeService availability with short intervals
    while (!this.claudeRpcService || !this.vscodeService) {
      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        return false;
      }

      // Wait 50ms before next check
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return true;
  }

  /**
   * Resolve effective effort level with three-state semantics:
   * - undefined on TabState = "not set, follow global"
   * - null on TabState = "explicitly SDK default" (send nothing)
   * - EffortLevel on TabState = explicit per-tab override
   *
   * Priority: explicit options > tab override > global state
   */
  private resolveEffort(
    optionsEffort: EffortLevel | undefined,
    tabOverride: EffortLevel | null | undefined,
  ): EffortLevel | undefined {
    if (optionsEffort !== undefined) return optionsEffort;
    if (tabOverride !== undefined) return tabOverride ?? undefined;
    return this.effortState.currentEffort();
  }

  /**
   * Wire an AbortSignal for a streaming tab so that aborting the signal
   * triggers a backend `chat:abort` RPC. The signal itself comes from
   * `TabManagerService.createAbortController(tabId)` and is fired by
   * `TabManagerService.closeTab(tabId)` when the user closes the tab while
   * streaming.
   *
   * This is the ONE place that knows BOTH the tabId (to look up the
   * AbortController) AND the SessionId (required by the chat:abort RPC),
   * so registering the listener here keeps TabManager free of any
   * session-resolution logic.
   *
   * Returns the signal so it can be threaded through to the streaming RPC.
   */
  private wireAbortDispatch(tabId: string): AbortSignal {
    const signal = this.tabManager.createAbortController(tabId);
    signal.addEventListener(
      'abort',
      () => {
        // Re-resolve the session id at abort time â€” when the stream first
        // started, claudeSessionId may not have been assigned yet.
        const tab = this.tabManager.tabs().find((t) => t.id === tabId);
        const sessionId = tab?.claudeSessionId;
        if (!sessionId) {
          // No backend session was established before abort â€” nothing to
          // cancel on the host side. The frontend RPC promise still
          // resolves with an aborted error via the signal.
          return;
        }
        // Fire-and-forget: the abort dispatch must not block tab close.
        this.claudeRpcService
          .call('chat:abort', { sessionId })
          .catch((error) => {
            console.warn(
              '[MessageSender] chat:abort dispatch failed on tab close',
              { tabId, sessionId, error },
            );
          });
      },
      { once: true },
    );
    return signal;
  }

  /**
   * Validate that a session file exists on disk
   *
   * Prevents "process exited with code 1" errors by checking
   * if the actual .jsonl file exists before attempting to resume.
   *
   * @param sessionId - Session ID to validate
   * @param workspacePath - Workspace path
   * @returns Promise<{ exists: boolean; filePath?: string }>
   */
  private async validateSessionExists(
    sessionId: SessionId,
    workspacePath: string,
  ): Promise<{ exists: boolean; filePath?: string }> {
    try {
      const result = await this.claudeRpcService.call('session:validate', {
        sessionId,
        workspacePath,
      });

      if (result.success && result.data) {
        return result.data;
      }

      console.warn(
        '[MessageSender] Session validation RPC failed',
        result.error,
      );
      return { exists: false };
    } catch (error) {
      console.error('[MessageSender] Session validation error', error);
      return { exists: false };
    }
  }

  // ============================================================================
  // PUBLIC API - Message Sending
  // ============================================================================

  /**
   * Send a message - automatically routes to new or continue conversation
   *
   * This is the main entry point for sending messages.
   * Validates content before sending, then checks if there's an existing session and routes accordingly.
   *
   * @param content - Message content
   * @param options - Optional send options (files, images, effort)
   */
  async send(content: string, options?: SendMessageOptions): Promise<void> {
    // Validate content BEFORE any processing
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      console.warn(
        `[MessageSender] Invalid message content: ${validation.reason}`,
      );
      return;
    }

    // Sanitize content (trim whitespace) â€” slash commands passed through as-is
    const sanitized = this.validator.sanitize(content);

    // When a tabId is provided (canvas tile context), use that specific tab
    // instead of the global activeTab. This prevents cross-tile message routing.
    const targetTabId = options?.tabId;
    const targetTab = targetTabId
      ? (this.tabManager.tabs().find((t) => t.id === targetTabId) ??
        this.tabManager.activeTab())
      : this.tabManager.activeTab();

    const sessionId = targetTab?.claudeSessionId;
    const hasExistingSession = targetTab && sessionId != null;

    if (hasExistingSession && sessionId) {
      await this.continueConversation(sanitized, sessionId, options);
    } else {
      await this.startNewConversation(sanitized, options);
    }
  }

  /**
   * Send message or queue if streaming
   *
   * Smart routing that checks streaming state:
   * - If streaming: Queue for later (delegated to ConversationService)
   * - If not streaming: Send immediately
   *
   * @param content - Message content
   * @param options - Optional send options (files, images, effort)
   */
  async sendOrQueue(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    // Check if streaming â€” use target tab if specified, otherwise global active tab
    const targetTabId = options?.tabId;
    const targetTab = targetTabId
      ? (this.tabManager.tabs().find((t) => t.id === targetTabId) ??
        this.tabManager.activeTab())
      : this.tabManager.activeTab();
    const isStreaming =
      targetTab?.status === 'streaming' || targetTab?.status === 'resuming';

    if (isStreaming) {
      // Queue for later - delegate to ConversationService via ChatStore
      // We don't queue directly to avoid circular dependency
      // Note: Queue handling is done by caller (ChatStore/ConversationService)
      // This method just checks the condition
      return;
    } else {
      // Send immediately
      await this.send(content, options);
    }
  }

  // ============================================================================
  // PRIVATE API - Conversation Logic (extracted from ConversationService)
  // ============================================================================

  /**
   * Start a brand new conversation with Claude
   *
   * Extracted from ConversationService.startNewConversation()
   * Creates a new session ID and calls chat:start RPC
   *
   * @param content - Message content
   * @param options - Optional send options (files, images, effort)
   */
  private async startNewConversation(
    content: string,
    options?: SendMessageOptions,
  ): Promise<void> {
    const files = options?.files;
    const images = options?.images;
    const effort = options?.effort;
    // Hoist target tab ID so catch block can use the canvas-scoped value
    let activeTabId = options?.tabId ?? this.tabManager.activeTabId();
    try {
      // Wait for services to be ready (with timeout)
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[MessageSender] startNewConversation: Services initialization timeout',
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[MessageSender] Services not available after initialization',
        );
        return;
      }

      // Workspace path may be empty during the gap between Angular bootstrap
      // and the async workspace-restore chain in electron-layout.service.ts
      // (restoreLayout → workspace:getInfo → workspace:switch →
      // updateWorkspaceRoot). Don't bail — the backend chat:start handler
      // falls back to IWorkspaceProvider.getWorkspaceRoot() when
      // params.workspacePath is missing. Omit the field so the backend
      // resolves it deterministically.
      const workspacePath = this.vscodeService.config().workspaceRoot;

      // Use hoisted activeTabId (already resolved from options.tabId or global)
      if (!activeTabId) {
        activeTabId = this.tabManager.createTab();
        this.tabManager.switchTab(activeTabId);
      }

      // Clear previous node maps to prevent stale references
      this.sessionManager.clearNodeMaps();

      // Resolve the target tab â€” use explicit tabId when provided (canvas tile)
      const activeTab =
        this.tabManager.tabs().find((t) => t.id === activeTabId) ??
        this.tabManager.activeTab();
      // Replaces `activeTab?.placeholderSessionId`.
      // Look up the routing layer: if the active tab is bound to a
      // conversation whose head session is known, reuse it (legacy
      // resume parity). Otherwise mint a fresh id; StreamRouter will
      // append it to the conversation when the first event flows back.
      const sessionId =
        this.headSessionForTab(activeTab?.id) ?? this.generateId();

      // Update tab with streaming status immediately so UI shows content
      // as it arrives. Previously, isStreaming() returned false until
      // session:id-resolved, hiding all streaming content.
      // Auto-name session from first message content (not "New Chat").
      // Only auto-name if user hasn't already set a custom name (preserve user renames).
      const currentName = activeTab?.name;
      const hasUserName = currentName && currentName !== 'New Chat';
      const autoName = hasUserName
        ? currentName
        : content.substring(0, 50).trim() || 'New Chat';
      this.tabManager.applyNewConversationStreaming(activeTabId, autoName);

      // Show streaming indicator (visual only - no side effects)
      this.tabManager.markTabStreaming(activeTabId);

      // Update SessionManager state - use new state machine API.
      // Use 'draft' state (session not yet confirmed by backend).
      // The 'streaming' is a SessionStatus, not SessionState.
      this.sessionManager.setSessionId(sessionId); // Default to 'draft' state
      this.sessionManager.setStatus('streaming'); // Start streaming status so UI shows content

      // Add user message immediately (sessionId omitted until SDK resolves the real UUID)
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        ...(images && images.length > 0 ? { imageCount: images.length } : {}),
        // sessionId omitted: real Claude UUID arrives via SESSION_ID_RESOLVED
      });

      // Update tab with user message (reuse activeTab from above)
      // Also clear stale streamingState from any previous session on this tab
      // to prevent handleSessionStats from seeing orphaned streaming state
      this.tabManager.appendUserMessageAndResetStreaming(activeTabId, [
        ...(activeTab?.messages ?? []),
        userMessage,
      ]);

      // Session ID will be initialized by StreamingHandler on first event
      // No tracking needed - removed PendingSessionManager

      // Call RPC to start NEW chat.
      // Use tabId for frontend correlation instead of placeholder sessionId.
      // Pass ptahCliId if a Ptah CLI agent is selected.
      const ptahCliId = this.ptahCliState.selectedAgentId() ?? undefined;
      const effectiveModel =
        activeTab?.overrideModel ?? this.modelState.currentModel();
      const effectiveEffort = this.resolveEffort(
        effort,
        activeTab?.overrideEffort,
      );
      // Register abort dispatch so closing the tab mid-stream cancels the
      // backend work via chat:abort.
      const abortSignal = this.wireAbortDispatch(activeTabId);
      const result = await this.claudeRpcService.call(
        'chat:start',
        {
          prompt: content,
          tabId: activeTabId, // Frontend correlation ID
          name: autoName, // Send message-derived name to backend (not stale activeTab reference)
          // Omit workspacePath when empty so backend falls back to
          // IWorkspaceProvider.getWorkspaceRoot() — handles the bootstrap
          // race where Send is clicked before workspace restore completes.
          ...(workspacePath ? { workspacePath } : {}),
          ptahCliId, // Route to Ptah CLI agent adapter
          options: {
            model: effectiveModel,
            ...(files ? { files } : {}),
            ...(images && images.length > 0 ? { images } : {}),
            ...(effectiveEffort ? { effort: effectiveEffort } : {}),
          },
        },
        { signal: abortSignal },
      );

      if (!result.success) {
        console.error('[MessageSender] Failed to start chat:', result.error);
        // Update tab status to loaded (failed)
        this.tabManager.markLoaded(activeTabId);
        this.sessionManager.setStatus('loaded');
        this.sessionManager.failSession();
      }
    } catch (error) {
      console.error('[MessageSender] Failed to start new conversation:', error);

      if (activeTabId) {
        this.tabManager.markLoaded(activeTabId);
      }
      this.sessionManager.setStatus('loaded');
      this.sessionManager.failSession();

      throw error;
    }
  }

  /**
   * Continue an existing conversation with Claude
   *
   * Extracted from ConversationService.continueConversation()
   * Uses the current session ID and calls chat:continue with --resume flag
   *
   * @param content - Message content
   * @param sessionId - Existing session ID
   * @param options - Optional send options (files, images, effort)
   */
  private async continueConversation(
    content: string,
    sessionId: SessionId,
    options?: SendMessageOptions,
  ): Promise<void> {
    const files = options?.files;
    const images = options?.images;
    const effort = options?.effort;
    // Hoist target tab ID so error paths use the canvas-scoped value
    const activeTabId = options?.tabId ?? this.tabManager.activeTabId();
    try {
      // Wait for services to be ready (with timeout)
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[MessageSender] continueConversation: Services initialization timeout',
        );
        return;
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[MessageSender] Services not available after initialization',
        );
        return;
      }

      // Workspace path may be empty during the bootstrap-restore race
      // (see startNewConversation comment). Don't bail — the backend
      // chat:continue handler falls back to IWorkspaceProvider.getWorkspaceRoot()
      // when params.workspacePath is missing. But we still want to run the
      // friendly "session was deleted → start a new one" recovery when we can,
      // so when the local cache is empty we ask the backend for the resolved
      // workspace via workspace:getInfo (one extra RPC roundtrip in the rare
      // race window) and feed THAT into validateSessionExists.
      const cachedWorkspacePath = this.vscodeService.config().workspaceRoot;
      let resolvedWorkspacePath = cachedWorkspacePath;

      if (!resolvedWorkspacePath) {
        try {
          const info = await this.claudeRpcService.call(
            'workspace:getInfo',
            {},
          );
          if (info.success && info.data) {
            resolvedWorkspacePath =
              info.data.activeFolder ?? info.data.folders[0] ?? '';
          }
        } catch (error) {
          console.warn(
            '[MessageSender] workspace:getInfo failed during continueConversation race recovery',
            error,
          );
        }
      }

      if (resolvedWorkspacePath) {
        // VALIDATE: Check if session file actually exists on disk
        const validationResult = await this.validateSessionExists(
          sessionId,
          resolvedWorkspacePath,
        );

        if (!validationResult.exists) {
          console.warn(
            `[MessageSender] Session ${sessionId} file not found on disk - starting new session instead`,
            { sessionId },
          );

          if (activeTabId) {
            this.tabManager.detachSessionAndMarkLoaded(activeTabId);
          }

          await this.startNewConversation(content, options);
          return;
        }
      }

      if (!activeTabId) {
        console.warn(
          '[MessageSender] No active tab for continuing conversation â€” starting new',
        );
        await this.startNewConversation(content, options);
        return;
      }

      const activeTab =
        this.tabManager.tabs().find((t) => t.id === activeTabId) ??
        this.tabManager.activeTab();

      // Update SessionManager state
      this.sessionManager.setStatus('resuming');

      // Update tab status
      this.tabManager.markResuming(activeTabId);

      // Add user message immediately
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        ...(images && images.length > 0 ? { imageCount: images.length } : {}),
        sessionId,
      });

      // Update tab with user message
      this.tabManager.setMessages(activeTabId, [
        ...(activeTab?.messages ?? []),
        userMessage,
      ]);

      // Call RPC to CONTINUE existing chat (uses --resume flag).
      // Include tabId for event routing.
      const effectiveModel =
        activeTab?.overrideModel ?? this.modelState.currentModel();
      const effectiveEffort = this.resolveEffort(
        effort,
        activeTab?.overrideEffort,
      );
      // Register abort dispatch so closing the tab mid-stream cancels the
      // backend work via chat:abort.
      const abortSignal = this.wireAbortDispatch(activeTabId);
      const result = await this.claudeRpcService.call(
        'chat:continue',
        {
          prompt: content,
          sessionId,
          tabId: activeTabId, // For event routing
          name: activeTab?.name, // Send session name (support late naming)
          // Omit workspacePath when still empty (workspace:getInfo also
          // failed) so backend falls back to IWorkspaceProvider.getWorkspaceRoot().
          // Otherwise pass the resolved path — either the renderer's cached
          // value or the freshly fetched one from workspace:getInfo.
          ...(resolvedWorkspacePath
            ? { workspacePath: resolvedWorkspacePath }
            : {}),
          model: effectiveModel,
          files: files ?? [],
          ...(images && images.length > 0 ? { images } : {}),
          ...(effectiveEffort ? { effort: effectiveEffort } : {}),
        },
        { signal: abortSignal },
      );

      if (!result.success) {
        console.error('[MessageSender] Failed to continue chat:', result.error);
        this.tabManager.markLoaded(activeTabId);
        this.tabManager.markTabIdle(activeTabId);
        this.sessionManager.setStatus('loaded');
      } else {
        this.sessionManager.setStatus('streaming');
        this.tabManager.markStreaming(activeTabId);
        this.tabManager.markTabStreaming(activeTabId);
      }
    } catch (error) {
      console.error('[MessageSender] Failed to continue conversation:', error);
      if (activeTabId) {
        this.tabManager.markLoaded(activeTabId);
        this.tabManager.markTabIdle(activeTabId);
      }
      this.sessionManager.setStatus('loaded');
    }
  }
}
