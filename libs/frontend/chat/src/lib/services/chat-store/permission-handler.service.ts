/**
 * PermissionHandlerService - Permission Request Management
 *
 * Extracted from ChatStore to handle permission-related operations:
 * - Managing permission requests (add/remove)
 * - Correlating permissions with tools (via toolUseId → toolCallId)
 * - Identifying unmatched permissions for fallback display
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 *
 * TASK_2025_097 FIX: Race condition eliminated by reading real-time toolCallMap
 * instead of tab-change-only cache. Permissions now match within 1 frame of tool_start.
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import {
  PermissionRequest,
  PermissionResponse,
  ExecutionNode,
  MESSAGE_TYPES,
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
   * Public readonly access to permission requests
   */
  readonly permissionRequests = this._permissionRequests.asReadonly();

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
    return this._permissionRequests().find((req) => req.toolUseId === toolId);
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

    const toolIdsInTree = this.toolIdsInExecutionTree();

    return allPermissions.filter((req) => {
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
   * Handle user response to permission request
   *
   * Removes request from pending list and sends response to backend.
   *
   * Extracted from chat.store.ts:1344-1364
   */
  handlePermissionResponse(response: PermissionResponse): void {
    console.log('[PermissionHandlerService] Permission response:', response);

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
}
