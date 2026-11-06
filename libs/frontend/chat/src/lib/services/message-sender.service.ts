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
import type { AuthRequiredBannerOrigin, RpcResult } from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  SessionId,
  EffortLevel,
  normalizeWorkspaceRoot,
} from '@ptah-extension/shared';
import type { ChatContinueResult } from '@ptah-extension/shared';
import {
  ABORT_REASON_SUPERSEDED,
  ConversationRegistry,
  deriveSessionTitle,
  TabId,
  TabManagerService,
  TabSessionBinding,
  CommandCenterSendLockService,
  commandCenterPersonaFor,
  type QueuedFollowUpRef,
} from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { MessageValidationService } from './message-validation.service';
import { UltracodeStateService } from './ultracode-state.service';
import type {
  SendMessageOptions,
  TabState,
} from '@ptah-extension/chat-types';
import {
  CARRY_OVER_BUSY_TEXT,
  ProviderCarryOverService,
  type CarryOverCompactResult,
} from './provider-carry-over.service';

/**
 * `/compact` fails closed with this text when its carry-over check failed and
 * the tab's session is known to belong to another provider (decisions.md row
 * 38, P4 = A): today's path would compact on the old provider.
 */
export const CARRY_OVER_CHECK_FAILED_TEXT =
  "Couldn't check this conversation. Try /compact again.";

/**
 * Whether `content` is the `/compact` slash command, parsed as the host does
 * (E43): a leading `/` and a letter, and the command name up to the first
 * space (or the end) is exactly `compact`. Arguments are allowed but are not
 * forwarded to a carry-over (Decision K21).
 */
export function isCompactCommand(content: string): boolean {
  const text = content.trim();
  if (!/^\/[a-zA-Z]/.test(text)) return false;
  const end = text.indexOf(' ');
  return (end === -1 ? text.slice(1) : text.slice(1, end)) === 'compact';
}

/**
 * Structured outcome of a send attempt.
 *
 * `success: false` covers BOTH a thrown/transport failure AND a *structural*
 * backend rejection — a `chat:start`/`chat:continue` round trip that succeeds at
 * the transport layer but returns `data.success === false` (AUTH_REQUIRED,
 * model-unavailable, license gate). Callers that only care about fire-and-forget
 * ignore this; the Tasks Start-flow bridge branches on it so a structural
 * failure no longer resolves as success (TASK_2026_157 F-D2 — a phantom
 * `in_progress` transition on a session that never actually started).
 */
export interface SendOutcome {
  success: boolean;
  error?: string;
  /** Stop ended the operation; callers must not show delivery failure UI. */
  cancelled?: boolean;
  /** The backend already broadcast CHAT_ERROR; preserve its terminal state. */
  errorAlreadyShown?: boolean;
  /**
   * `error` is complete user-facing copy: show it as is, without the generic
   * delivery-failure prefix (the `/compact` check failure, P4).
   */
  errorIsFullText?: boolean;
  /**
   * Set when the message waits as a queued follow-up instead of starting a
   * turn now (TASK_2026_884). Follow it with `QueuedFollowUpStore.onSettled`
   * / `isPending`, or withdraw it with `FollowUpQueueService.withdraw`.
   */
  queued?: QueuedFollowUpRef;
}

/**
 * Text start and continue already show for a chat RPC failure code.
 * Resume activation uses the same mapping so a coded failure does not
 * disagree with the bubble those sends append.
 */
export function mapChatSendFailureText(
  code: string | undefined,
  error: string | undefined,
  fallback: string,
): string {
  switch (code) {
    case 'CODEX_BUSY':
      return 'Codex is busy, try again when the current operation finishes';
    case 'CODEX_UNAVAILABLE':
    case 'CODEX_RUNTIME_FAILED':
      return 'Codex chat could not start.';
    default:
      return error ?? fallback;
  }
}

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
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly validator = inject(MessageValidationService);
  private readonly modelState = inject(ModelStateService);
  private readonly effortState = inject(EffortStateService);
  private readonly ptahCliState = inject(PtahCliStateService);
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly tabSessionBinding = inject(TabSessionBinding);
  private readonly authState = inject(AuthStateService);
  private readonly ultracode = inject(UltracodeStateService);
  private readonly sendLock = inject(CommandCenterSendLockService);
  private readonly carryOver = inject(ProviderCarryOverService);

  private isHeld(
    options?: SendMessageOptions & { ownerToken?: string },
  ): boolean {
    const tabId = options?.tabId ?? this.tabManager.activeTabId();
    return tabId != null && this.sendLock.isHeld(tabId, options?.ownerToken);
  }

  /**
   * Whether a provider carry-over holds the target tab: no prompt may be sent
   * on it until the new chat is bound or the carry-over is over (AC 5.4).
   */
  private isCarryOverPending(
    options?: SendMessageOptions & { ownerToken?: string },
  ): boolean {
    const tabId = options?.tabId ?? this.tabManager.activeTabId();
    return tabId != null && this.carryOver.isPending(tabId);
  }

  /**
   * Surface an inline re-auth banner when a chat RPC failed because the
   * provider needs (re-)authentication. The backend result-shapes this as
   * `data.errorCode === 'AUTH_REQUIRED'`; an RpcUserError throw would set it at
   * the envelope level instead, so check both.
   *
   * With an `origin` (a continue of an existing chat), the banner is bound to
   * that chat and a carry-over offer is requested for it. The offer decision
   * uses the origin only, never the refusal text (AC 1.4).
   */
  private handleAuthRequired(
    result: RpcResult<{
      errorCode?: string;
      error?: string;
      providerId?: string;
    }>,
    origin?: AuthRequiredBannerOrigin,
  ): boolean {
    const code = result.errorCode ?? result.data?.errorCode;
    if (code !== 'AUTH_REQUIRED') return false;
    const providerId = result.data?.providerId ?? null;
    const message =
      result.data?.error ?? result.error ?? 'Authentication required.';
    if (!origin) {
      this.authState.flagAuthRequired(providerId, message);
      return true;
    }
    const generation = this.authState.flagAuthRequired(
      providerId,
      message,
      origin,
    );
    this.requestCarryOverOffer(generation);
    return true;
  }

  /** Not awaited: the refusal path must not wait for, or fail on, the check. */
  private requestCarryOverOffer(generation: number): void {
    const warn = (error: unknown): void => {
      console.warn('[MessageSender] carry-over offer check failed', {
        generation,
        error: error instanceof Error ? error.name : typeof error,
      });
    };
    try {
      // degradation-audit: reported — `warn` logs a failed offer check; the banner stays without a button.
      this.carryOver.offerFor(generation).catch(warn);
    } catch (error) {
      warn(error);
    }
  }

  /**
   * The `/compact` carry-over trigger. `null` means "run today's path".
   * An unexpected throw counts as a failed check, so a carry-over bug can
   * never break `/compact` itself.
   */
  private async tryCompactCarryOver(
    sessionId: SessionId,
    tabId: string,
    workspacePath: string,
    tab: TabState | null | undefined,
  ): Promise<SendOutcome | null> {
    let result: CarryOverCompactResult;
    try {
      result = await this.carryOver.tryCompact({
        sessionId,
        tabId,
        workspacePath,
        ...(tab?.name ? { name: tab.name } : {}),
      });
    } catch (error) {
      console.warn('[MessageSender] /compact carry-over check threw', {
        tabId,
        sessionId,
        error: error instanceof Error ? error.name : typeof error,
      });
      result = 'check-failed';
    }
    if (result === 'not-eligible') return null;
    if (result === 'busy') {
      return { success: false, error: CARRY_OVER_BUSY_TEXT };
    }
    if (result === 'check-failed') {
      return this.sessionProviderDiffers(tabId, tab)
        ? {
            success: false,
            error: CARRY_OVER_CHECK_FAILED_TEXT,
            errorIsFullText: true,
          }
        : null;
    }
    return { ...result };
  }

  /**
   * True only when the renderer KNOWS the tab's session belongs to another
   * provider than the active one: the tab carries its stored provider, the
   * active provider is loaded, and the tab is in the active workspace (the
   * auth state describes that workspace only). Unknown is not "differs".
   */
  private sessionProviderDiffers(
    tabId: string,
    tab: TabState | null | undefined,
  ): boolean {
    if (this.backgroundWorkspaceOf(tabId) !== null) return false;
    const stored = tab?.providerId;
    const active = this.authState.activeProviderId();
    return !!stored && !!active && stored !== active;
  }

  /**
   * Generate unique ID for messages/sessions
   */
  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private isCodexFailure(code: string | undefined): boolean {
    return (
      code === 'CODEX_BUSY' ||
      code === 'CODEX_UNSUPPORTED_OPTION' ||
      code === 'CODEX_UNAVAILABLE' ||
      code === 'CODEX_RUNTIME_FAILED'
    );
  }

  private sendFailureMessage(
    result: RpcResult<{ errorCode?: string; error?: string }>,
    fallback: string,
  ): string {
    return mapChatSendFailureText(
      result.errorCode ?? result.data?.errorCode,
      result.data?.error ?? result.error,
      fallback,
    );
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
        // A newer send replaced this controller (`createAbortController`): the
        // old turn is not being closed, and the new turn registers under the
        // same tab id, so a `chat:abort` here would end the NEW turn.
        if (signal.reason === ABORT_REASON_SUPERSEDED) return;
        const tab = this.tabManager.tabs().find((t) => t.id === tabId);
        // During the first turn the real session id is not bound yet. The
        // backend registers the live record under the tab id (chat:start
        // passes `tabId`, and its registry `find()` resolves by tab id or real
        // session id), so the tab id still ends that turn's process.
        const sessionId = tab?.claudeSessionId ?? (tabId as SessionId);
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
  /**
   * The workspace a tab belongs to when that is NOT the active workspace, else
   * `null` (the active workspace keeps using the host's configured root).
   */
  private backgroundWorkspaceOf(
    tabId: string | null | undefined,
  ): string | null {
    if (!tabId) return null;
    const lookup = this.tabManager.findTabByIdAcrossWorkspaces(tabId);
    if (!lookup?.workspacePath) return null;
    // Two spellings of one folder (separator, trailing slash, drive-letter
    // case) are the active workspace, not a background one.
    const active = this.tabManager.activeWorkspacePath;
    return active !== null &&
      normalizeWorkspaceRoot(lookup.workspacePath) ===
        normalizeWorkspaceRoot(active)
      ? null
      : lookup.workspacePath;
  }

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
  async send(
    content: string,
    options?: SendMessageOptions & { ownerToken?: string },
  ): Promise<SendOutcome> {
    if (this.isHeld(options))
      return { success: false, error: 'Message held by Command Center' };
    if (this.isCarryOverPending(options))
      return { success: false, error: CARRY_OVER_BUSY_TEXT };
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      console.warn(
        `[MessageSender] Invalid message content: ${validation.reason}`,
      );
      return {
        success: false,
        error: validation.reason ?? 'Invalid message content',
      };
    }
    // Ultracode mode stamps the outgoing text with the `ultracode` keyword so
    // the backend SDK plans a workflow per task. No-op (and idempotent) when
    // ultracode is off. Applied to the sanitized text so it flows to both the
    // visible bubble and the backend prompt.
    const sanitized = this.ultracode.applyKeyword(
      this.validator.sanitize(content),
    );
    const targetTabId = options?.tabId;
    // Across workspaces, not `tabs()`: an explicit tabId can name a canvas tile
    // or a tab parked in a background workspace, and the active-workspace
    // lookup silently fell through to `activeTab()` — so the send was judged
    // against, and its bubble appended to, the WRONG transcript
    // (TASK_2026_382 W4).
    const targetTab = targetTabId
      ? (this.tabManager.findTabByIdAcrossWorkspaces(targetTabId)?.tab ??
        this.tabManager.activeTab())
      : this.tabManager.activeTab();

    const sessionId = targetTab?.claudeSessionId;
    const hasExistingSession = targetTab && sessionId != null;

    if (hasExistingSession && sessionId) {
      return this.continueConversation(sanitized, sessionId, options);
    }
    return this.startNewConversation(sanitized, options);
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
    options?: SendMessageOptions & { ownerToken?: string },
  ): Promise<SendOutcome> {
    if (this.isHeld(options))
      return { success: false, error: 'Message held by Command Center' };
    const files = options?.files;
    const images = options?.images;
    const effort = options?.effort;
    let activeTabId = options?.tabId ?? this.tabManager.activeTabId();
    let consumedPreamble: string | null = null;
    try {
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[MessageSender] startNewConversation: Services initialization timeout',
        );
        return { success: false, error: 'Services initialization timeout' };
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[MessageSender] Services not available after initialization',
        );
        return { success: false, error: 'Services not available' };
      }
      const workspacePath = this.vscodeService.config().workspaceRoot;
      if (!activeTabId) {
        activeTabId = this.tabManager.createTab();
        this.tabManager.switchTab(activeTabId);
      }
      // Workspace-aware for the same reason as `continueConversation` below
      // (TASK_2026_382 W4).
      const activeTab =
        this.tabManager.findTabByIdAcrossWorkspaces(activeTabId)?.tab ??
        this.tabManager.activeTab();
      if (this.isHeld(options))
        return { success: false, error: 'Message held by Command Center' };
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
      const autoName =
        activeTab?.titleOrigin !== 'default' && currentName
          ? currentName
          : deriveSessionTitle(content) || currentName || 'New Chat';
      this.tabManager.applyNewConversationStreaming(activeTabId);
      this.tabManager.markTabStreaming(activeTabId);
      this.sessionManager.setSessionId(sessionId); // Default to 'draft' state
      this.sessionManager.setStatus('streaming'); // Start streaming status so UI shows content
      // Hidden preamble (e.g. Tribunal council framing) is prepended to the
      // BACKEND prompt only; the visible bubble stays the user's plain text.
      const firstMessagePreamble =
        this.tabManager.consumeFirstMessagePreamble(activeTabId);
      consumedPreamble = firstMessagePreamble;
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
      const systemPrompt = activeTab && commandCenterPersonaFor(activeTab);
      const abortSignal = this.wireAbortDispatch(activeTabId);
      const result = await this.claudeRpcService.call(
        'chat:start',
        {
          prompt: backendPrompt,
          tabId: activeTabId, // Frontend correlation ID
          name: autoName, // Send message-derived name to backend (not stale activeTab reference)
          ...(workspacePath ? { workspacePath } : {}),
          ptahCliId, // Route to Ptah CLI agent adapter
          // Electron's transcript renders `ptah-ui` fences as live surfaces;
          // VS Code sends no key at all (TASK_2026_610 comp. 11).
          ...(this.vscodeService.isElectron ? { ptahUiFence: true } : {}),
          options: {
            ...(effectiveModel ? { model: effectiveModel } : {}),
            ...(files ? { files } : {}),
            ...(images && images.length > 0 ? { images } : {}),
            ...(effectiveEffort ? { effort: effectiveEffort } : {}),
            ...(systemPrompt ? { systemPrompt } : {}),
          },
        },
        { signal: abortSignal },
      );

      if (result.data?.cancelled === true) {
        if (consumedPreamble) {
          this.tabManager.setFirstMessagePreamble(activeTabId, consumedPreamble);
        }
        this.tabManager.markLoaded(activeTabId);
        this.tabManager.markTabIdle(activeTabId);
        this.tabManager.setLastTerminalReason(
          activeTabId,
          activeTab?.lastTerminalReason ?? null,
        );
        this.sessionManager.setStatus('loaded');
        return { success: false, cancelled: true };
      }
      const authFailed = this.handleAuthRequired(result);
      if (!result.success || authFailed || result.data?.success === false) {
        if (consumedPreamble) {
          this.tabManager.setFirstMessagePreamble(
            activeTabId,
            consumedPreamble,
          );
        }
        console.error(
          '[MessageSender] Failed to start chat:',
          result.data?.error ?? result.error,
        );
        this.tabManager.markLoaded(activeTabId);
        // `markLoaded` writes `status` alone; the spinner/send-vs-queue set is a
        // separate store that only `markTabIdle` or a backend `turn_state`
        // clears. This turn never created a broadcaster, so no `turn_state` and
        // no CHAT_ERROR will ever arrive to repair it — the optimistic
        // `markTabStreaming` above must undo itself here, as
        // `continueConversation` already does (TASK_2026_360).
        this.tabManager.markTabIdle(activeTabId);
        this.sessionManager.setStatus('loaded');
        this.sessionManager.failSession();
        if (
          result.errorCode === 'SESSION_ENDED' ||
          result.data?.errorCode === 'SESSION_ENDED' ||
          this.isCodexFailure(result.errorCode ?? result.data?.errorCode)
        ) {
          this.tabManager.setLastTerminalReason(activeTabId, 'api_error');
        }
        // Structural failure: transport succeeded but the backend rejected the
        // turn. Signal it so the Start-flow bridge does not treat it as a
        // started session (F-D2). Callers ignoring the return are unaffected.
        return {
          success: false,
          error: this.sendFailureMessage(result, 'Failed to start chat'),
        };
      }
      return { success: true };
    } catch (error) {
      console.error('[MessageSender] Failed to start new conversation:', error);

      if (activeTabId) {
        if (consumedPreamble) {
          this.tabManager.setFirstMessagePreamble(
            activeTabId,
            consumedPreamble,
          );
        }
        this.tabManager.markLoaded(activeTabId);
        // Same reason as the structural exit above: a throw before the stream
        // starts (e.g. AuthRequiredError out of startChatSession) leaves nothing
        // downstream able to clear the optimistic streaming flag
        // (TASK_2026_360).
        this.tabManager.markTabIdle(activeTabId);
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
    options?: SendMessageOptions & { ownerToken?: string },
  ): Promise<SendOutcome> {
    if (this.isHeld(options))
      return { success: false, error: 'Message held by Command Center' };
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
   * Hand a follow-up to the backend queue of its captured session
   * (TASK_2026_884): `chat:continue` with `queueIntent: 'next-turn'`. The
   * backend holds it and admits it as the next turn of exactly `sessionId`,
   * whether or not any view shows the tab. Writes nothing to the tab: no
   * bubble, no status, no abort controller. The caller (`FollowUpQueueService`)
   * shows the item in the composer queue and appends the bubble on delivery.
   *
   * Never resolves the active tab: `tabId` and `sessionId` are the ones the
   * caller captured when the user typed the message.
   */
  async submitQueuedFollowUp(input: {
    readonly content: string;
    readonly sessionId: SessionId;
    readonly tabId: string;
    readonly clientMessageId: string;
    readonly options?: SendMessageOptions;
  }): Promise<RpcResult<ChatContinueResult>> {
    const { content, sessionId, tabId, clientMessageId, options } = input;
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
    const effectiveModel = this.resolveValidModel(
      tab?.overrideModel ?? this.modelState.currentModel(),
    );
    const effectiveEffort = this.resolveEffort(
      options?.effort,
      tab?.overrideEffort,
    );
    const systemPrompt = tab && commandCenterPersonaFor(tab);
    const images = options?.images;
    return this.claudeRpcService.call('chat:continue', {
      prompt: content,
      sessionId,
      tabId,
      clientMessageId,
      queueIntent: 'next-turn',
      name: tab?.name,
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(this.vscodeService.isElectron ? { ptahUiFence: true } : {}),
      ...(effectiveModel ? { model: effectiveModel } : {}),
      files: options?.files ?? [],
      ...(images && images.length > 0 ? { images } : {}),
      ...(effectiveEffort ? { effort: effectiveEffort } : {}),
    });
  }

  /**
   * Body of `continueConversation`. The caller resolves the `AbortSignal`
   * (or `undefined`) and passes it in, keeping the abort-wiring policy out of
   * the continue-conversation logic.
   */
  private async runContinueConversation(
    content: string,
    sessionId: SessionId,
    options: (SendMessageOptions & { ownerToken?: string }) | undefined,
    abortSignal: AbortSignal | undefined,
  ): Promise<SendOutcome> {
    const files = options?.files;
    const images = options?.images;
    const effort = options?.effort;
    const activeTabId = options?.tabId ?? this.tabManager.activeTabId();
    /** Set once the bubble + boundary are written, so every failure exit after it rolls back. */
    let sentPromptId: string | null = null;
    try {
      const ready = await this.waitForServices(5000);
      if (!ready) {
        console.error(
          '[MessageSender] continueConversation: Services initialization timeout',
        );
        return { success: false, error: 'Services initialization timeout' };
      }

      if (!this.claudeRpcService || !this.vscodeService) {
        console.error(
          '[MessageSender] Services not available after initialization',
        );
        return { success: false, error: 'Services not available' };
      }
      // A tab parked in a background workspace (review feedback, a queue flush
      // after its turn ends) owns a session that lives under THAT workspace;
      // validating it against the active root misses the session file and
      // detaches the tab into a fresh conversation in the wrong folder.
      const cachedWorkspacePath =
        this.backgroundWorkspaceOf(activeTabId) ??
        this.vscodeService.config().workspaceRoot;
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

          return this.startNewConversation(content, options);
        }
      }

      if (!activeTabId) {
        console.warn(
          '[MessageSender] No active tab for continuing conversation — starting new',
        );
        return this.startNewConversation(content, options);
      }

      // Workspace-aware (TASK_2026_382 W4). `setMessages` below writes the
      // resolved tab's message array back onto `activeTabId`; resolving against
      // the active-workspace `tabs()` only meant a background tab had the
      // ACTIVE tab's transcript stamped over it.
      const activeTab =
        this.tabManager.findTabByIdAcrossWorkspaces(activeTabId)?.tab ??
        this.tabManager.activeTab();
      if (this.isHeld(options))
        return { success: false, error: 'Message held by Command Center' };
      // A carry-over may have started on this tab during the awaits above.
      if (this.carryOver.isPending(activeTabId))
        return { success: false, error: CARRY_OVER_BUSY_TEXT };
      // `/compact` on a chat of another provider continues it in a new chat
      // on the active provider (decisions.md rows 20, 22). Every other result
      // runs today's `/compact` below, unchanged, so its refusal is too.
      if (resolvedWorkspacePath && isCompactCommand(content)) {
        const carried = await this.tryCompactCarryOver(
          sessionId,
          activeTabId,
          resolvedWorkspacePath,
          activeTab,
        );
        if (carried) return carried;
        if (this.isHeld(options))
          return { success: false, error: 'Message held by Command Center' };
      }
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
      this.streamingHandler.recordUserPromptBoundary(activeTabId, userMessage);
      sentPromptId = userMessage.id;
      const effectiveModel = this.resolveValidModel(
        activeTab?.overrideModel ?? this.modelState.currentModel(),
      );
      const effectiveEffort = this.resolveEffort(
        effort,
        activeTab?.overrideEffort,
      );
      const systemPrompt = activeTab && commandCenterPersonaFor(activeTab);
      const result = await this.claudeRpcService.call(
        'chat:continue',
        {
          prompt: content,
          sessionId,
          tabId: activeTabId, // For event routing
          clientMessageId: userMessage.id,
          name: activeTab?.name, // Send session name (support late naming)
          ...(systemPrompt ? { systemPrompt } : {}),
          ...(resolvedWorkspacePath
            ? { workspacePath: resolvedWorkspacePath }
            : {}),
          // Re-sent on every continue: the fence flag lives in the
          // in-memory session config (TASK_2026_610 comp. 11, L-820).
          ...(this.vscodeService.isElectron ? { ptahUiFence: true } : {}),
          ...(effectiveModel ? { model: effectiveModel } : {}),
          files: files ?? [],
          ...(images && images.length > 0 ? { images } : {}),
          ...(effectiveEffort ? { effort: effectiveEffort } : {}),
        },
        { signal: abortSignal },
      );

      if (result.data?.cancelled === true) {
        this.rollBackUnsentPrompt(activeTabId, userMessage.id);
        this.tabManager.markLoaded(activeTabId);
        this.tabManager.markTabIdle(activeTabId);
        this.sessionManager.setStatus('loaded');
        return { success: false, cancelled: true };
      }
      if (
        result.data?.settled === true &&
        (result.errorCode ?? result.data.errorCode) === 'CODEX_RUNTIME_FAILED'
      ) {
        this.streamingHandler.removeUserPromptBoundary(activeTabId, userMessage.id);
        // CHAT_ERROR already owns the terminal state and error message.
        return {
          success: false,
          errorAlreadyShown: true,
        };
      }
      const authFailed = this.handleAuthRequired(
        result,
        resolvedWorkspacePath
          ? { sessionId, tabId: activeTabId, workspacePath: resolvedWorkspacePath }
          : undefined,
      );
      if (!result.success || authFailed || result.data?.success === false) {
        console.error(
          '[MessageSender] Failed to continue chat:',
          result.data?.error ?? result.error,
        );
        this.rollBackUnsentPrompt(activeTabId, userMessage.id);
        this.tabManager.markLoaded(activeTabId);
        this.tabManager.markTabIdle(activeTabId);
        this.sessionManager.setStatus('loaded');
        return {
          success: false,
          error: this.sendFailureMessage(result, 'Failed to continue chat'),
        };
      }
      if (result.data?.settled === true) {
        this.streamingHandler.removeUserPromptBoundary(
          activeTabId,
          userMessage.id,
        );
        this.tabManager.markLoaded(activeTabId);
        this.tabManager.markTabIdle(activeTabId);
        this.sessionManager.setStatus('loaded');
        return { success: true };
      }
      if (result.data?.enqueued !== true) {
        this.streamingHandler.retirePendingPrompt?.(activeTabId, userMessage.id);
      }
      this.sessionManager.setStatus('streaming');
      this.tabManager.markStreaming(activeTabId);
      this.tabManager.markTabStreaming(activeTabId);
      return { success: true };
    } catch (error) {
      console.error('[MessageSender] Failed to continue conversation:', error);
      if (activeTabId) {
        if (sentPromptId) {
          this.rollBackUnsentPrompt(activeTabId, sentPromptId);
        }
        this.tabManager.markLoaded(activeTabId);
        this.tabManager.markTabIdle(activeTabId);
      }
      this.sessionManager.setStatus('loaded');
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Undo what a continue wrote before `chat:continue` failed: the backend
   * never received the prompt, so the live turn must not split at it. The
   * bubble stays, as the record of the failed send.
   */
  private rollBackUnsentPrompt(tabId: string, messageId: string): void {
    this.streamingHandler.removeUserPromptBoundary(tabId, messageId);
  }
}
