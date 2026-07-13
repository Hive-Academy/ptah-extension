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
  AuthStateService,
} from '@ptah-extension/core';
import type { RpcResult } from '@ptah-extension/core';
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
  private readonly claudeRpcService = inject(ClaudeRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly validator = inject(MessageValidationService);
  private readonly modelState = inject(ModelStateService);
  private readonly effortState = inject(EffortStateService);
  private readonly ptahCliState = inject(PtahCliStateService);
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly tabSessionBinding = inject(TabSessionBinding);
  private readonly authState = inject(AuthStateService);

  /**
   * Surface an inline re-auth banner when a chat RPC failed because the
   * provider needs (re-)authentication. The backend result-shapes this as
   * `data.errorCode === 'AUTH_REQUIRED'`; an RpcUserError throw would set it at
   * the envelope level instead, so check both.
   */
  private handleAuthRequired(
    result: RpcResult<{
      errorCode?: string;
      error?: string;
      providerId?: string;
    }>,
  ): boolean {
    const code = result.errorCode ?? result.data?.errorCode;
    if (code !== 'AUTH_REQUIRED') return false;
    this.authState.flagAuthRequired(
      result.data?.providerId ?? null,
      result.data?.error ?? result.error ?? 'Authentication required.',
    );
    return true;
  }

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
   * Guard against a stale model surviving a workspace switch (defense in depth).
   *
   * `ModelStateService.currentModel()` is a single global signal; after
   * switching to a workspace on a different provider the previously-selected
   * model may no longer be offered. Sending it verbatim makes the backend
   * reject the turn ("Model X is not available for the configured provider").
   * If `model` is not present in the freshly loaded `availableModels()`, fall
   * back to the provider's selected / `default` / first model; return
   * `undefined` (omit the field, let the backend default) only when the list is
   * empty of a usable candidate.
   */
  private resolveValidModel(model: string | undefined): string | undefined {
    if (!model) return undefined;
    const available = this.modelState.availableModels();
    // No list loaded yet — cannot validate, pass the model through unchanged.
    if (available.length === 0) return model;
    if (available.some((m) => m.id === model)) return model;
    const fallback =
      available.find((m) => m.isSelected) ??
      available.find((m) => m.id === 'default') ??
      available[0];
    return fallback?.id;
  }

  /**
   * Wait for services to be ready with timeout
   * @param timeoutMs - Timeout in milliseconds (default: 5000)
   * @returns Promise<boolean> - true if ready, false if timeout
   */
  private async waitForServices(timeoutMs = 5000): Promise<boolean> {
    const startTime = Date.now();
    while (!this.claudeRpcService || !this.vscodeService) {
      if (Date.now() - startTime > timeoutMs) {
        return false;
      }
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
        const tab = this.tabManager.tabs().find((t) => t.id === tabId);
        const sessionId = tab?.claudeSessionId;
        if (!sessionId) {
          return;
        }
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
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      console.warn(
        `[MessageSender] Invalid message content: ${validation.reason}`,
      );
      return;
    }
    const sanitized = this.validator.sanitize(content);
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
    let activeTabId = options?.tabId ?? this.tabManager.activeTabId();
    try {
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
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!activeTabId) {
        activeTabId = this.tabManager.createTab();
        this.tabManager.switchTab(activeTabId);
      }
      const activeTab =
        this.tabManager.tabs().find((t) => t.id === activeTabId) ??
        this.tabManager.activeTab();
      const sessionId =
        this.headSessionForTab(activeTab?.id) ?? this.generateId();
      // Give THIS conversation a clean node-map slate — scoped to its own
      // session id. A global `clearNodeMaps()` would also erase the agent/tool
      // node tracking for a session streaming in a BACKGROUND workspace (the
      // maps are a global singleton), cross-contaminating an unrelated
      // workspace. Scoping to `sessionId` avoids that while still resetting this
      // conversation (TASK_2026_154 Wave 2 revision).
      this.sessionManager.clearNodeMaps(sessionId);
      const currentName = activeTab?.name;
      const hasUserName = currentName && currentName !== 'New Chat';
      const autoName = hasUserName
        ? currentName
        : content.substring(0, 50).trim() || 'New Chat';
      this.tabManager.applyNewConversationStreaming(activeTabId, autoName);
      this.tabManager.markTabStreaming(activeTabId);
      this.sessionManager.setSessionId(sessionId); // Default to 'draft' state
      this.sessionManager.setStatus('streaming'); // Start streaming status so UI shows content
      // Hidden preamble (e.g. Tribunal council framing) is prepended to the
      // BACKEND prompt only; the visible bubble stays the user's plain text.
      const firstMessagePreamble =
        this.tabManager.consumeFirstMessagePreamble(activeTabId);
      const backendPrompt = firstMessagePreamble
        ? `${firstMessagePreamble}\n\n${content}`
        : content;
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        ...(images && images.length > 0 ? { imageCount: images.length } : {}),
      });
      this.tabManager.appendUserMessageAndResetStreaming(activeTabId, [
        ...(activeTab?.messages ?? []),
        userMessage,
      ]);
      const ptahCliId = this.ptahCliState.selectedAgentId() ?? undefined;
      const effectiveModel = this.resolveValidModel(
        activeTab?.overrideModel ?? this.modelState.currentModel(),
      );
      const effectiveEffort = this.resolveEffort(
        effort,
        activeTab?.overrideEffort,
      );
      const abortSignal = this.wireAbortDispatch(activeTabId);
      const result = await this.claudeRpcService.call(
        'chat:start',
        {
          prompt: backendPrompt,
          tabId: activeTabId, // Frontend correlation ID
          name: autoName, // Send message-derived name to backend (not stale activeTab reference)
          ...(workspacePath ? { workspacePath } : {}),
          ptahCliId, // Route to Ptah CLI agent adapter
          options: {
            ...(effectiveModel ? { model: effectiveModel } : {}),
            ...(files ? { files } : {}),
            ...(images && images.length > 0 ? { images } : {}),
            ...(effectiveEffort ? { effort: effectiveEffort } : {}),
          },
        },
        { signal: abortSignal },
      );

      const authFailed = this.handleAuthRequired(result);
      if (!result.success || authFailed || result.data?.success === false) {
        console.error(
          '[MessageSender] Failed to start chat:',
          result.data?.error ?? result.error,
        );
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
    const activeTabId = options?.tabId ?? this.tabManager.activeTabId();
    const abortSignal = activeTabId
      ? this.wireAbortDispatch(activeTabId)
      : undefined;
    return this.runContinueConversation(
      content,
      sessionId,
      options,
      abortSignal,
    );
  }

  /**
   * Continue an existing conversation for the post-stream queue flush.
   *
   * Same semantics as `continueConversation` but does NOT install a fresh
   * `AbortController` for the tab. The queue flush (`MessageDispatchService.
   * sendQueuedMessage`) fires on turn-end while the previous stream's
   * controller may still be tracked by `TabManagerService`. Calling
   * `createAbortController` there would abort that controller, firing the
   * previous `wireAbortDispatch` abort listener → a stray `chat:abort` RPC →
   * the session is killed and the queued message degrades to a full resume.
   *
   * Instead, reuses the existing `AbortSignal` (still tracked by
   * `TabManagerService`, so stop-button / tab-close keep working) or sends
   * with no signal when the controller was already cleared by finalization.
   *
   * @param content - Message content
   * @param sessionId - Existing session ID
   * @param options - Optional send options (files, images, effort, tabId)
   */
  async continueExistingSessionForQueueFlush(
    content: string,
    sessionId: SessionId,
    options?: SendMessageOptions,
  ): Promise<void> {
    const activeTabId = options?.tabId ?? this.tabManager.activeTabId();
    const abortSignal = activeTabId
      ? this.tabManager.getAbortSignal(activeTabId)
      : undefined;
    return this.runContinueConversation(
      content,
      sessionId,
      options,
      abortSignal,
    );
  }

  /**
   * Shared body for `continueConversation` and the queue-flush variant.
   *
   * The caller resolves the `AbortSignal` (or `undefined`) and passes it in,
   * keeping the abort-wiring policy out of the continue-conversation logic so
   * the user-initiated send and the post-stream queue flush can differ without
   * branching inside this method.
   */
  private async runContinueConversation(
    content: string,
    sessionId: SessionId,
    options: SendMessageOptions | undefined,
    abortSignal: AbortSignal | undefined,
  ): Promise<void> {
    const files = options?.files;
    const images = options?.images;
    const effort = options?.effort;
    const activeTabId = options?.tabId ?? this.tabManager.activeTabId();
    try {
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
      this.sessionManager.setStatus('resuming');
      this.tabManager.markResuming(activeTabId);
      const userMessage = createExecutionChatMessage({
        id: this.generateId(),
        role: 'user',
        rawContent: content,
        files,
        ...(images && images.length > 0 ? { imageCount: images.length } : {}),
        sessionId,
      });
      this.tabManager.setMessages(activeTabId, [
        ...(activeTab?.messages ?? []),
        userMessage,
      ]);
      const effectiveModel = this.resolveValidModel(
        activeTab?.overrideModel ?? this.modelState.currentModel(),
      );
      const effectiveEffort = this.resolveEffort(
        effort,
        activeTab?.overrideEffort,
      );
      const result = await this.claudeRpcService.call(
        'chat:continue',
        {
          prompt: content,
          sessionId,
          tabId: activeTabId, // For event routing
          name: activeTab?.name, // Send session name (support late naming)
          ...(resolvedWorkspacePath
            ? { workspacePath: resolvedWorkspacePath }
            : {}),
          ...(effectiveModel ? { model: effectiveModel } : {}),
          files: files ?? [],
          ...(images && images.length > 0 ? { images } : {}),
          ...(effectiveEffort ? { effort: effectiveEffort } : {}),
        },
        { signal: abortSignal },
      );

      const authFailed = this.handleAuthRequired(result);
      if (!result.success || authFailed || result.data?.success === false) {
        console.error(
          '[MessageSender] Failed to continue chat:',
          result.data?.error ?? result.error,
        );
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
