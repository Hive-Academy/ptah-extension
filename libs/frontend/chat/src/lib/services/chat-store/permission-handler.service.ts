/**
 * PermissionHandlerService - Permission & Question Request Management
 *
 * Extracted from ChatStore to handle permission-related operations:
 * - Managing permission requests (add/remove)
 * - Correlating permissions with tools (via toolUseId → toolCallId)
 * - Identifying unmatched permissions for fallback display
 * - Managing AskUserQuestion requests (TASK_2025_097 Batch 5)
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 *
 * TASK_2025_097 FIX: Race condition eliminated by reading real-time toolCallMap
 * instead of tab-change-only cache. Permissions now match within 1 frame of tool_start.
 *
 * TASK_2025_097 Batch 5: Added AskUserQuestion handling for SDK's interactive
 * question prompts. Similar to permission requests but expects answers instead
 * of approve/deny.
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
import { TabManagerService } from '../tab-manager.service';
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
   * Tracks toolUseIds of hard permission denies (not deny_with_message).
   * Used by StreamingHandlerService to mark specific agent nodes as "interrupted".
   * Set-based to handle multiple concurrent denies correctly.
   *
   * TASK_2025_213: Changed from boolean signal to Set<string> for targeted marking.
   * When agentToolCallId is UNKNOWN_AGENT_TOOL_CALL_ID, triggers legacy fallback.
   */
  private readonly _hardDenyToolUseIds = signal<Set<string>>(new Set());

  /**
   * Public readonly access to permission requests
   */
  readonly permissionRequests = this._permissionRequests.asReadonly();

  /**
   * Active AskUserQuestion requests awaiting user answers
   * TASK_2025_097 Batch 5: Similar to permission requests but for questions
   * Private writable signal, exposed as readonly
   */
  private readonly _questionRequests = signal<AskUserQuestionRequest[]>([]);

  /**
   * Public readonly access to question requests
   */
  readonly questionRequests = this._questionRequests.asReadonly();

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
      // Guard: timeoutAt === 0 means "no timeout — block indefinitely" (TASK_2025_215)
      const now = Date.now();
      const expiredIds = requests
        .filter((r) => r.timeoutAt > 0 && r.timeoutAt <= now)
        .map((r) => r.id);

      if (expiredIds.length > 0) {
        console.log(
          '[PermissionHandlerService] Cleaning up expired question requests:',
          expiredIds
        );
        this._questionRequests.update((reqs) =>
          reqs.filter((r) => r.timeoutAt <= 0 || r.timeoutAt > now)
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

  /**
   * Check if a request belongs to the currently active session.
   * Returns true if the request should be visible in the current tab.
   * - No sessionId on request -> show everywhere (backward compat)
   * - No active session -> show all
   * - sessionId matches active session -> show
   * - sessionId doesn't match -> hide
   */
  private isRequestForActiveSession(req: { sessionId?: string }): boolean {
    const activeSessionId = this.tabManager.activeTab()?.claudeSessionId;
    if (!req.sessionId) return true;
    if (!activeSessionId) return true;
    return req.sessionId === activeSessionId;
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
      (req) => req.toolUseId === toolId && this.isRequestForActiveSession(req)
    );
  }

  /**
   * TASK_2025_097 FIX: Real-time computed signal for tool IDs in execution tree.
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
    const activeTab = this.tabManager.activeTab();
    if (!activeTab) return new Set<string>();

    const toolIds = new Set<string>();

    // 1. Extract from finalized messages (historical tool IDs)
    const messages = activeTab.messages ?? [];
    messages.forEach((msg) => {
      if (msg.streamingState) {
        this.extractToolIds(msg.streamingState, toolIds);
      }
    });

    // 2. Extract from current streaming state (real-time tool IDs) - KEY FIX!
    // This is what eliminates the race condition: toolCallMap is updated
    // immediately when tool_start events arrive via streaming-handler,
    // so permissions can match within 1 frame instead of waiting for tab change.
    const streamingState = activeTab.streamingState;
    if (streamingState?.toolCallMap) {
      for (const toolCallId of streamingState.toolCallMap.keys()) {
        toolIds.add(toolCallId);
      }
    }

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
      this.isRequestForActiveSession(req)
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
   * TASK_2025_097: Added timing diagnostics for latency correlation.
   * Logs receive timestamp and calculates latency from request.timestamp
   * to help identify permission flow bottlenecks.
   *
   * Extracted from chat.store.ts:1335-1338
   */
  handlePermissionRequest(request: PermissionRequest): void {
    const receiveTime = Date.now();

    // Calculate latency from backend emission to frontend reception
    // request.timestamp is set by backend when permission is emitted
    const latencyMs =
      request.timestamp !== undefined ? receiveTime - request.timestamp : null;

    console.log('[PermissionHandlerService] Permission request received:', {
      requestId: request.id,
      toolName: request.toolName,
      toolUseId: request.toolUseId,
      receiveTime,
      backendTimestamp: request.timestamp ?? 'N/A',
      latencyMs: latencyMs !== null ? `${latencyMs}ms` : 'N/A',
      timeoutAt: request.timeoutAt,
    });

    // Performance warning if latency exceeds expected threshold (100ms)
    if (latencyMs !== null && latencyMs > 100) {
      console.warn(
        '[PermissionHandlerService] High permission latency detected:',
        `${latencyMs}ms (expected < 100ms)`
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
    console.log(
      '[PermissionHandlerService] Permission auto-resolved:',
      payload
    );
    this._permissionRequests.update((requests) =>
      requests.filter((r) => r.id !== payload.id)
    );
  }

  /**
   * Handle user response to permission request
   *
   * Removes request from pending list and sends response to backend.
   *
   * Extracted from chat.store.ts:1344-1364
   */
  handlePermissionResponse(response: PermissionResponse): void {
    console.log('[PermissionHandlerService] Permission response:', response);

    // Track hard deny IDs for targeted interrupted badge display.
    // TASK_2025_213: Prefer agentToolCallId (the parent Task tool's ID) over
    // toolUseId (the denied tool's own ID). The frontend's markAgentsAsInterruptedByToolCallIds
    // matches against agent node toolCallIds, which are Task tool IDs.
    // - agentToolCallId set & not sentinel: use it (targeted marking)
    // - agentToolCallId is sentinel: use sentinel (legacy fallback)
    // - agentToolCallId unset: no subagent context, use sentinel (legacy fallback)
    if (response.decision === 'deny') {
      const originalRequest = this._permissionRequests().find(
        (r) => r.id === response.id
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
      requests.filter((r) => r.id !== response.id)
    );

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
   * TASK_2025_213: Returns Set of agent toolCallIds (or UNKNOWN_AGENT_TOOL_CALL_ID sentinel).
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
    toolCallId: string | undefined
  ): PermissionRequest | null {
    if (!toolCallId) return null;

    const permission = this.getPermissionByToolId(toolCallId);

    // Debug logging for ID correlation issues
    if (!permission && this._permissionRequests().length > 0) {
      console.debug('[PermissionHandlerService] Permission lookup miss:', {
        lookupKey: toolCallId,
        availableToolUseIds: this._permissionRequests()
          .map((req) => req.toolUseId)
          .filter(Boolean),
        pendingCount: this._permissionRequests().length,
      });
    }

    return permission ?? null;
  }

  // ============================================================================
  // ASKUSERQUESTION METHODS (TASK_2025_097 Batch 5)
  // ============================================================================

  /**
   * Handle incoming AskUserQuestion request from backend
   *
   * Adds request to pending list for UI display.
   * Similar to handlePermissionRequest but for questions.
   *
   * TASK_2025_097 Batch 5: Implements SDK's AskUserQuestion tool support
   *
   * @param request The question request from backend
   */
  handleQuestionRequest(request: AskUserQuestionRequest): void {
    const receiveTime = Date.now();

    // Calculate latency from backend emission to frontend reception
    const latencyMs =
      request.timestamp !== undefined ? receiveTime - request.timestamp : null;

    console.log('[PermissionHandlerService] Question request received:', {
      id: request.id,
      questionCount: request.questions.length,
      toolUseId: request.toolUseId,
      receiveTime,
      backendTimestamp: request.timestamp ?? 'N/A',
      latencyMs: latencyMs !== null ? `${latencyMs}ms` : 'N/A',
      timeoutAt: request.timeoutAt,
    });

    // Performance warning if latency exceeds expected threshold (100ms)
    if (latencyMs !== null && latencyMs > 100) {
      console.warn(
        '[PermissionHandlerService] High question request latency detected:',
        `${latencyMs}ms (expected < 100ms)`
      );
    }

    this._questionRequests.update((requests) => [...requests, request]);
  }

  /**
   * Handle user response to AskUserQuestion request
   *
   * Removes request from pending list and sends response to backend.
   * Similar to handlePermissionResponse but sends answers instead of approve/deny.
   *
   * TASK_2025_097 Batch 5: Sends response via ASK_USER_QUESTION_RESPONSE message type
   *
   * @param response The user's answers to the questions
   */
  handleQuestionResponse(response: AskUserQuestionResponse): void {
    console.log('[PermissionHandlerService] Question response sent:', {
      id: response.id,
      answerCount: Object.keys(response.answers).length,
    });

    // Remove from pending requests
    this._questionRequests.update((requests) =>
      requests.filter((r) => r.id !== response.id)
    );

    // Send to backend via VSCodeService
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE,
      payload: response,
    });
  }

  /**
   * Get question request for a specific tool by its toolUseId
   *
   * @param toolUseId The tool's unique identifier
   * @returns AskUserQuestionRequest if one exists, null otherwise
   */
  getQuestionForTool(
    toolUseId: string | undefined
  ): AskUserQuestionRequest | null {
    if (!toolUseId) return null;
    return (
      this._questionRequests().find(
        (req) =>
          req.toolUseId === toolUseId && this.isRequestForActiveSession(req)
      ) ?? null
    );
  }

  /**
   * Remove all permission and question requests for a specific session.
   * Called when the backend notifies that a session has been aborted.
   * Prevents stale permission/question cards from lingering in the UI.
   */
  cleanupSession(sessionId: string): void {
    console.log('[PermissionHandlerService] Session cleanup:', sessionId);

    this._permissionRequests.update((requests) =>
      requests.filter((r) => r.sessionId !== sessionId)
    );

    this._questionRequests.update((requests) =>
      requests.filter((r) => r.sessionId !== sessionId)
    );
  }
}
