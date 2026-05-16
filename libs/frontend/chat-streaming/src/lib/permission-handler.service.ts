/**
 * PermissionHandlerService - Permission & Question Request Management
 *
 * Extracted from ChatStore to handle permission-related operations:
 * - Managing permission requests (add/remove)
 * - Correlating permissions with tools (via toolUseId â†’ toolCallId)
 * - Identifying unmatched permissions for fallback display
 * - Managing AskUserQuestion requests
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 *
 * Race condition eliminated by reading real-time toolCallMap instead of
 * tab-change-only cache. Permissions now match within 1 frame of tool_start.
 *
 * AskUserQuestion handling for SDK's interactive question prompts. Similar
 * to permission requests but expects answers instead of approve/deny.
 */

import { Injectable, signal, computed, inject, effect } from '@angular/core';
import {
  PermissionRequest,
  PermissionResponse,
  ExecutionNode,
  MESSAGE_TYPES,
  UNKNOWN_AGENT_TOOL_CALL_ID,
} from '@ptah-extension/shared';
import {
  type AskUserQuestionRequest,
  type AskUserQuestionResponse,
} from '@ptah-extension/shared';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';

@Injectable({ providedIn: 'root' })
export class PermissionHandlerService {
  private readonly tabManager = inject(TabManagerService);
  private readonly vscodeService = inject(VSCodeService);

  // ============================================================================
  // STATE SIGNALS
  // ============================================================================

  /**
   * Active permission requests awaiting user response
   * Private writable signal, exposed as readonly
   */
  private readonly _permissionRequests = signal<PermissionRequest[]>([]);

  /**
   * Fan-out routing metadata.
   *
   * Per-prompt list of tab ids the prompt is targeted at, populated by
   * `StreamRouter.routePermissionPrompt` after a prompt arrives. The
   * StreamRouter cannot inject this service circularly, so we expose a
   * setter (`attachPromptTargets`) that StreamRouter calls. The map is
   * cleared when the prompt is removed (decision arrives, auto-resolve,
   * or session cleanup).
   *
   * Today the UI renders prompts globally (per-session filter intentionally
   * returns true), so per-tab visibility is not yet enforced through this
   * map. The data lives here for the cancel-on-decision broadcast and so
   * downstream surfaces (canvas grid, multi-pop-out) can begin reading it
   * without another routing pass.
   */
  private readonly _promptTargetTabs = new Map<string, readonly string[]>();

  /**
   * Decision broadcast.
   *
   * Bumps every time a permission decision is processed. Carries the
   * `promptId` and the `decidingTabId` (or null when the deciding tab
   * cannot be resolved — e.g. headless flows). The `seq` field forces a
   * fresh signal value on repeat decisions for the same prompt id.
   *
   * `StreamRouter` watches this via `effect()` and calls
   * `cancelPendingPromptOnOtherTabs(promptId, decidingTabId)` to fan a
   * cancellation out to every other bound tab. Layering is preserved
   * because PermissionHandler does not import StreamRouter.
   */
  private readonly _decisionPulse = signal<{
    seq: number;
    promptId: string;
    decidingTabId: string | null;
  } | null>(null);
  /**
   * Public read-only access to the decision pulse. Consumers (StreamRouter)
   * wrap this in `effect()` to react to each decision.
   */
  readonly decisionPulse = this._decisionPulse.asReadonly();
  private _decisionSeq = 0;

  /**
   * Tracks toolUseIds of hard permission denies (not deny_with_message).
   * Used by StreamingHandlerService to mark specific agent nodes as "interrupted".
   * Set-based to handle multiple concurrent denies correctly.
   *
   * Set<string> for targeted marking. When agentToolCallId is
   * UNKNOWN_AGENT_TOOL_CALL_ID, triggers legacy fallback.
   */
  private readonly _hardDenyToolUseIds = signal<Set<string>>(new Set());

  /**
   * Public readonly access to permission requests
   */
  readonly permissionRequests = this._permissionRequests.asReadonly();

  /**
   * Active AskUserQuestion requests awaiting user answers.
   * Similar to permission requests but for questions.
   * Private writable signal, exposed as readonly.
   */
  private readonly _questionRequests = signal<AskUserQuestionRequest[]>([]);

  /**
   * Public readonly access to question requests
   */
  readonly questionRequests = this._questionRequests.asReadonly();

  /**
   * Per-question list of tab ids the question is targeted at, populated by
   * `StreamRouter.routeQuestionPrompt` after a question arrives. Mirrors
   * `_promptTargetTabs` for permissions. When unset for a given question id,
   * consumers fall back to global visibility (active-tab broadcast) so a
   * question is never silently dropped — the backend's `awaitQuestionResponse`
   * has no timeout (`timeoutAt: 0`) and would otherwise hang forever.
   */
  private readonly _questionTargetTabs = new Map<string, readonly string[]>();

  /**
   * Constructor - sets up cleanup effect for expired requests
   */
  constructor() {
    // Effect to clean up expired question requests automatically
    // Runs every time the signal changes, checks for timeouts
    effect(() => {
      const requests = this._questionRequests();
      if (requests.length === 0) return;

      // Schedule cleanup check
      // Guard: timeoutAt === 0 means "no timeout â€” block indefinitely"
      const now = Date.now();
      const expiredIds = requests
        .filter((r) => r.timeoutAt > 0 && r.timeoutAt <= now)
        .map((r) => r.id);

      if (expiredIds.length > 0) {
        this._questionRequests.update((reqs) =>
          reqs.filter((r) => r.timeoutAt <= 0 || r.timeoutAt > now),
        );
      }
    });
  }

  /**
   * Helper to extract tool IDs from execution tree (finalized messages)
   */
  private extractToolIds(node: ExecutionNode, set: Set<string>): void {
    if (node.toolCallId) {
      set.add(node.toolCallId);
    }
    node.children?.forEach((child) => this.extractToolIds(child, set));
  }

  // ============================================================================
  // MEMOIZATION CACHE for toolIdsInExecutionTree
  // ============================================================================

  /**
   * Cache keys for toolIdsInExecutionTree memoization.
   * The computed re-evaluates on every activeTab() change (frequent during streaming).
   * We track message count and a fingerprint of toolCallMap keys to skip the full
   * traversal when nothing relevant has changed. Using a key fingerprint (sorted+joined)
   * instead of just `.size` avoids stale cache when keys change but size stays the same.
   */
  private _lastToolIdsTabId: string | null = null;
  private _lastToolIdsMsgCount = -1;
  private _lastToolIdsKeyFingerprint = '';
  private _cachedToolIds = new Set<string>();

  /**
   * Check if a request should be visible in the UI.
   * Always returns true â€” permissions/questions must always be shown regardless
   * of which tab is active. Each request carries its own sessionId for response
   * routing, so the backend handles delivery to the correct session.
   * Hiding permissions behind tab matching caused them to be silently dropped
   * when the backend's sessionId (tabId) didn't match the tab's claudeSessionId.
   */
  private isRequestForActiveSession(_req: { sessionId?: string }): boolean {
    return true;
  }

  // ============================================================================
  // COMPUTED SIGNALS
  // ============================================================================

  /**
   * Get permission by tool ID
   * Replaced computed signal with method to avoid Map recreation
   *
   * CORRELATION LOGIC:
   * - Permission has `toolUseId` (from Claude's tool_use)
   * - ExecutionNode has `toolCallId` (same value)
   * - Lookup key = toolCallId
   *
   * Extracted from chat.store.ts:178-188
   */
  public getPermissionByToolId(toolId: string): PermissionRequest | undefined {
    return this._permissionRequests().find(
      (req) => req.toolUseId === toolId && this.isRequestForActiveSession(req),
    );
  }

  /**
   * Real-time computed signal for tool IDs in execution tree.
   *
   * Replaces the stale _toolIdsCache that only updated on tab changes.
   * Now reads from BOTH:
   * 1. Finalized messages (historical tool IDs from msg.streamingState)
   * 2. Current streaming state (real-time tool IDs from streamingState.toolCallMap)
   *
   * This eliminates the race condition where permissions arrived before tool_start
   * events were visible in the cache, causing duplicate display (inline AND fallback).
   *
   * Pattern source: chat.store.ts:180-188 (currentExecutionTrees computed signal)
   */
  readonly toolIdsInExecutionTree = computed(() => {
    // Use fine-grained selectors instead of activeTab() to avoid re-evaluation
    // when unrelated tab fields (e.g., liveModelStats) change during streaming.
    const tabId = this.tabManager.activeTabId();
    if (!tabId) return new Set<string>();

    // activeTabMessages uses reference equality -- won't re-notify during streaming
    // when only streamingState changes (messages reference stays the same).
    const messages = this.tabManager.activeTabMessages();
    // activeTabStreamingState changes every tick during streaming (desired).
    const streamingState = this.tabManager.activeTabStreamingState();

    const msgCount = messages.length;
    const toolCallMap = streamingState?.toolCallMap;
    // Build fingerprint from actual keys â€” catches cases where size stays the
    // same but keys differ (e.g., one tool removed + another added simultaneously).
    const keyFingerprint = toolCallMap
      ? Array.from(toolCallMap.keys()).sort().join(',')
      : '';

    // Memoize by message count + toolCallMap key fingerprint.
    // These are the two inputs that change the result. When both are stable
    // (e.g., during streaming text deltas that don't add new tools),
    // we skip the full O(messages * children) traversal.
    if (
      tabId === this._lastToolIdsTabId &&
      msgCount === this._lastToolIdsMsgCount &&
      keyFingerprint === this._lastToolIdsKeyFingerprint
    ) {
      return this._cachedToolIds;
    }

    const toolIds = new Set<string>();

    // 1. Extract from finalized messages (historical tool IDs)
    messages.forEach((msg) => {
      if (msg.streamingState) {
        this.extractToolIds(msg.streamingState, toolIds);
      }
    });

    // 2. Extract from current streaming state (real-time tool IDs) - KEY FIX!
    // This is what eliminates the race condition: toolCallMap is updated
    // immediately when tool_start events arrive via streaming-handler,
    // so permissions can match within 1 frame instead of waiting for tab change.
    if (streamingState?.toolCallMap) {
      for (const toolCallId of streamingState.toolCallMap.keys()) {
        toolIds.add(toolCallId);
      }
    }

    // Update cache keys
    this._lastToolIdsTabId = tabId;
    this._lastToolIdsMsgCount = msgCount;
    this._lastToolIdsKeyFingerprint = keyFingerprint;
    this._cachedToolIds = toolIds;

    return toolIds;
  });

  /**
   * Permissions that couldn't be matched to any tool in the execution tree.
   * These need fallback display to ensure user can always respond.
   *
   * A permission is "unmatched" if:
   * 1. It has no toolUseId (can never match), OR
   * 2. Its toolUseId doesn't exist in any tool's toolCallId in the execution tree
   *
   * Extracted from chat.store.ts:264-278
   */
  readonly unmatchedPermissions = computed(() => {
    const allPermissions = this._permissionRequests();
    if (allPermissions.length === 0) return [];

    const sessionPermissions = allPermissions.filter((req) =>
      this.isRequestForActiveSession(req),
    );
    if (sessionPermissions.length === 0) return [];

    const toolIdsInTree = this.toolIdsInExecutionTree();

    return sessionPermissions.filter((req) => {
      // No toolUseId = can never match
      if (!req.toolUseId) return true;

      // Check if any tool in the execution tree has this permission's toolUseId as its toolCallId
      // If not found in tree, it's unmatched and needs fallback display
      return !toolIdsInTree.has(req.toolUseId);
    });
  });

  // ============================================================================
  // PUBLIC METHODS
  // ============================================================================

  /**
   * Handle incoming permission request from backend
   *
   * Adds request to pending list using immutable update pattern.
   *
   * Includes timing diagnostics for latency correlation. Logs receive
   * timestamp and calculates latency from request.timestamp to help
   * identify permission flow bottlenecks.
   *
   * Extracted from chat.store.ts:1335-1338
   */
  handlePermissionRequest(request: PermissionRequest): void {
    const receiveTime = Date.now();

    // Calculate latency from backend emission to frontend reception
    // request.timestamp is set by backend when permission is emitted
    const latencyMs =
      request.timestamp !== undefined ? receiveTime - request.timestamp : null;

    // Performance warning if latency exceeds expected threshold (100ms)
    if (latencyMs !== null && latencyMs > 100) {
      console.warn(
        '[PermissionHandlerService] High permission latency detected:',
        `${latencyMs}ms (expected < 100ms)`,
      );
    }

    this._permissionRequests.update((requests) => [...requests, request]);
  }

  /**
   * Handle auto-resolved permission request from backend
   *
   * When "Always Allow" is clicked, the backend auto-resolves other pending
   * requests for the same tool. This removes those from the frontend UI.
   *
   * @param payload - Contains the request ID to remove
   */
  handlePermissionAutoResolved(payload: {
    id: string;
    toolName: string;
  }): void {
    this._permissionRequests.update((requests) =>
      requests.filter((r) => r.id !== payload.id),
    );
    this._promptTargetTabs.delete(payload.id);
  }

  /**
   * Fan-out target attachment.
   *
   * Called by `StreamRouter.routePermissionPrompt` once a prompt arrives,
   * with the resolved set of bound tab ids. No-op when `tabIds` is empty
   * (router could not resolve a conversation — fall back to legacy global
   * visibility).
   *
   * Must be called AFTER `handlePermissionRequest` to ensure the prompt
   * is in the queue. Order is enforced by ChatMessageHandler (handler
   * runs router *after* permission handler).
   */
  attachPromptTargets(promptId: string, tabIds: readonly string[]): void {
    if (!tabIds || tabIds.length === 0) return;
    this._promptTargetTabs.set(promptId, [...tabIds]);
  }

  /**
   * Read access to the per-prompt target tabs computed by `StreamRouter`.
   * Returns an empty array if the prompt has
   * no resolved tabs (router fall-back to global visibility) or has
   * already been resolved.
   */
  targetTabsFor(promptId: string): readonly string[] {
    return this._promptTargetTabs.get(promptId) ?? [];
  }

  /**
   * Cancellation API used by `StreamRouter` to remove a prompt that was
   * decided on another tab. Idempotent: removing
   * an already-removed prompt is a no-op. Does NOT emit `decisionPulse` —
   * the original decision already did, and we must avoid an infinite loop
   * with the router's effect.
   *
   * `_exceptTabId` is reserved for a future world where prompts have
   * per-tab queues — today the queue is global, so cancelling on "other
   * tabs" is the same as removing from the queue entirely. The argument
   * is kept on the signature so the router's broadcast contract reads
   * cleanly today and future per-tab queues drop in without API churn.
   */
  cancelPrompt(promptId: string, _exceptTabId: string | null): void {
    this._permissionRequests.update((requests) =>
      requests.filter((r) => r.id !== promptId),
    );
    this._promptTargetTabs.delete(promptId);
  }

  /**
   * Handle user response to permission request
   *
   * Removes request from pending list and sends response to backend.
   *
   * Extracted from chat.store.ts:1344-1364
   */
  handlePermissionResponse(response: PermissionResponse): void {
    // Track hard deny IDs for targeted interrupted badge display.
    // Prefer agentToolCallId (the parent Task tool's ID) over toolUseId
    // (the denied tool's own ID). The frontend's markAgentsAsInterruptedByToolCallIds
    // matches against agent node toolCallIds, which are Task tool IDs.
    // - agentToolCallId set & not sentinel: use it (targeted marking)
    // - agentToolCallId is sentinel: use sentinel (legacy fallback)
    // - agentToolCallId unset: no subagent context, use sentinel (legacy fallback)
    if (response.decision === 'deny') {
      const originalRequest = this._permissionRequests().find(
        (r) => r.id === response.id,
      );
      const denyId =
        originalRequest?.agentToolCallId &&
        originalRequest.agentToolCallId !== UNKNOWN_AGENT_TOOL_CALL_ID
          ? originalRequest.agentToolCallId
          : UNKNOWN_AGENT_TOOL_CALL_ID;
      this._hardDenyToolUseIds.update((ids) => {
        const next = new Set(ids);
        next.add(denyId);
        return next;
      });
    }

    // Remove from pending requests
    this._permissionRequests.update((requests) =>
      requests.filter((r) => r.id !== response.id),
    );

    // Broadcast the decision so StreamRouter can fan a cancellation out to
    // every other bound tab. We resolve the
    // deciding tab id from the active tab (the user clicked from there).
    // If no active tab, pass null — the router will still drop the prompt
    // from any per-tab queues globally.
    const decidingTabId = this.tabManager.activeTabId() ?? null;
    this._decisionSeq += 1;
    this._decisionPulse.set({
      seq: this._decisionSeq,
      promptId: response.id,
      decidingTabId,
    });
    this._promptTargetTabs.delete(response.id);

    // Use public VSCodeService.postMessage() API
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.SDK_PERMISSION_RESPONSE,
      response,
    });
  }

  /**
   * Consume the hard-deny toolUseIds (read and reset).
   * Called by StreamingHandlerService when session stats arrive to determine
   * which specific agent nodes to mark as "interrupted".
   *
   * Returns Set of agent toolCallIds (or UNKNOWN_AGENT_TOOL_CALL_ID sentinel).
   * If Set contains UNKNOWN_AGENT_TOOL_CALL_ID, caller should fall back to markLastAgentAsInterrupted.
   *
   * @returns Set of toolUseIds that were hard-denied since last consumption (empty if none)
   */
  consumeHardDenyToolUseIds(): Set<string> {
    const ids = this._hardDenyToolUseIds();
    if (ids.size > 0) {
      this._hardDenyToolUseIds.set(new Set());
    }
    return ids;
  }

  /**
   * Get permission request for a specific tool by its toolCallId
   *
   * @param toolCallId The tool's unique identifier (from ExecutionNode.toolCallId)
   * @returns PermissionRequest if one exists for this tool, null otherwise
   *
   * Extracted from chat.store.ts:195-212
   */
  getPermissionForTool(
    toolCallId: string | undefined,
  ): PermissionRequest | null {
    if (!toolCallId) return null;

    const permission = this.getPermissionByToolId(toolCallId);

    return permission ?? null;
  }

  // ============================================================================
  // ASKUSERQUESTION METHODS
  // ============================================================================

  /**
   * Handle incoming AskUserQuestion request from backend
   *
   * Adds request to pending list for UI display.
   * Similar to handlePermissionRequest but for questions.
   *
   * Implements SDK's AskUserQuestion tool support.
   *
   * @param request The question request from backend
   */
  handleQuestionRequest(request: AskUserQuestionRequest): void {
    const receiveTime = Date.now();

    // Calculate latency from backend emission to frontend reception
    const latencyMs =
      request.timestamp !== undefined ? receiveTime - request.timestamp : null;

    // Performance warning if latency exceeds expected threshold (100ms)
    if (latencyMs !== null && latencyMs > 100) {
      console.warn(
        '[PermissionHandlerService] High question request latency detected:',
        `${latencyMs}ms (expected < 100ms)`,
      );
    }

    // Collision guard. If a question with this id is already in the queue,
    // log a warning and return
    // without appending. Backend retries (e.g. session-resume re-emit)
    // would otherwise produce duplicate cards; the original entry must
    // win because it owns the router-resolved target tabs.
    const existing = this._questionRequests().find((r) => r.id === request.id);
    if (existing) {
      console.warn('question.duplicate-id', { id: request.id });
      return;
    }

    this._questionRequests.update((requests) => [...requests, request]);
  }

  /**
   * Handle user response to AskUserQuestion request
   *
   * Removes request from pending list and sends response to backend.
   * Similar to handlePermissionResponse but sends answers instead of approve/deny.
   *
   * Sends response via ASK_USER_QUESTION_RESPONSE message type.
   *
   * @param response The user's answers to the questions
   */
  handleQuestionResponse(response: AskUserQuestionResponse): void {
    // Remove from pending requests
    this._questionRequests.update((requests) =>
      requests.filter((r) => r.id !== response.id),
    );

    this._questionTargetTabs.delete(response.id);

    // Send to backend via VSCodeService
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE,
      payload: response,
    });
  }

  /**
   * Question routing fan-out — mirrors `attachPromptTargets` for permissions.
   * Called by `StreamRouter.routeQuestionPrompt` once a question arrives and
   * the resolved tab ids are known. No-op when `tabIds` is empty (router
   * could not resolve a tab — chat-view falls back to active-tab visibility).
   */
  attachQuestionTargets(questionId: string, tabIds: readonly string[]): void {
    if (!tabIds || tabIds.length === 0) return;
    // Collision guard. If targets for this question id were already
    // attached, log and skip. Preserve the original target — re-routing
    // flows call the dedicated refresh path that reads the existing list
    // before overwriting.
    if (this._questionTargetTabs.has(questionId)) {
      console.warn('question.duplicate-id', {
        id: questionId,
        scope: 'targets',
      });
      return;
    }
    this._questionTargetTabs.set(questionId, [...tabIds]);
    // Force signal-dependent computeds (e.g. `resolvedQuestionRequests`) to
    // re-evaluate now that targets are known. The Map mutation alone is not
    // observable, and routeQuestionPrompt runs immediately after the signal
    // update — without this nudge the filter stays on the fallback path
    // for one tick longer than necessary.
    this._questionRequests.update((reqs) => reqs.slice());
  }

  /**
   * Read access to per-question target tabs. Returns an empty array when
   * the router fell back to global visibility or the question has been
   * resolved.
   */
  questionTargetTabsFor(questionId: string): readonly string[] {
    return this._questionTargetTabs.get(questionId) ?? [];
  }

  /**
   * Drop the per-question target tab list without removing the question
   * itself. Used by the router's compaction-complete / SESSION_ID_RESOLVED
   * re-route paths so a fresh `attachQuestionTargets` call is not blocked
   * by the collision guard. Idempotent: clearing an already-cleared id is
   * a no-op.
   */
  clearQuestionTargets(questionId: string): void {
    this._questionTargetTabs.delete(questionId);
  }

  /**
   * Cancellation API used by `StreamRouter.cancelPendingQuestionOnOtherTabs`
   * to drop a question resolved on another tab. Mirrors `cancelPrompt` for
   * permissions. Idempotent: removing an already-removed question is a no-op.
   *
   * `_exceptTabId` is reserved for the future per-tab queue model — today
   * the queue is global, so cancelling on "other tabs" is the same as
   * removing from the queue entirely. The signature matches `cancelPrompt`
   * so future per-tab queues drop in without API churn.
   */
  cancelQuestion(questionId: string, _exceptTabId: string | null): void {
    this._questionRequests.update((requests) =>
      requests.filter((r) => r.id !== questionId),
    );
    this._questionTargetTabs.delete(questionId);
  }

  /**
   * Drop a pending question without sending a response to the backend.
   * Used by the auto-resolve broadcast (`ASK_USER_QUESTION_AUTO_RESOLVED`):
   * when the backend's idle timer fires and picks the recommended option,
   * it resolves the SDK promise itself, then notifies the webview to clear
   * the stale question card. Sending a response from the UI here would be
   * a duplicate.
   */
  dropQuestionRequest(questionId: string): void {
    this._questionRequests.update((requests) =>
      requests.filter((r) => r.id !== questionId),
    );
    this._questionTargetTabs.delete(questionId);
  }

  /**
   * Get question request for a specific tool by its toolUseId
   *
   * @param toolUseId The tool's unique identifier
   * @returns AskUserQuestionRequest if one exists, null otherwise
   */
  getQuestionForTool(
    toolUseId: string | undefined,
  ): AskUserQuestionRequest | null {
    if (!toolUseId) return null;
    return (
      this._questionRequests().find(
        (req) =>
          req.toolUseId === toolUseId && this.isRequestForActiveSession(req),
      ) ?? null
    );
  }

  /**
   * Remove all permission and question requests for a specific session.
   * Called when the backend notifies that a session has been aborted.
   * Prevents stale permission/question cards from lingering in the UI.
   */
  cleanupSession(sessionId: string): void {
    // Capture removed prompt ids first so we can drop their fan-out metadata.
    const removedIds = this._permissionRequests()
      .filter((r) => r.sessionId === sessionId)
      .map((r) => r.id);

    const removedQuestionIds = this._questionRequests()
      .filter((r) => r.sessionId === sessionId)
      .map((r) => r.id);

    this._permissionRequests.update((requests) =>
      requests.filter((r) => r.sessionId !== sessionId),
    );

    this._questionRequests.update((requests) =>
      requests.filter((r) => r.sessionId !== sessionId),
    );

    for (const id of removedIds) {
      this._promptTargetTabs.delete(id);
    }
    for (const id of removedQuestionIds) {
      this._questionTargetTabs.delete(id);
    }
  }
}
