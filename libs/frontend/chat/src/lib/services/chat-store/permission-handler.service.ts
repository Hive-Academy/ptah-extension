/**
 * PermissionHandlerService - Permission Request Management
 *
 * Extracted from ChatStore to handle permission-related operations:
 * - Managing permission requests (add/remove)
 * - Correlating permissions with tools (via toolUseId → toolCallId)
 * - Identifying unmatched permissions for fallback display
 *
 * Part of ChatStore refactoring (Facade pattern) - ChatStore delegates here.
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import {
  PermissionRequest,
  PermissionResponse,
  ExecutionNode,
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

  // ============================================================================
  // COMPUTED SIGNALS
  // ============================================================================

  /**
   * Map of toolCallId → PermissionRequest
   *
   * Enables efficient lookup of permissions by tool ID.
   * Used to display permission UI inline with tool execution.
   *
   * CORRELATION LOGIC:
   * - Permission has `toolUseId` (from Claude's tool_use)
   * - ExecutionNode has `toolCallId` (same value)
   * - Map key = toolUseId, lookup key = toolCallId
   *
   * Extracted from chat.store.ts:178-188
   */
  readonly permissionRequestsByToolId = computed(() => {
    const requests = this._permissionRequests();
    const map = new Map<string, PermissionRequest>();

    requests.forEach((req) => {
      if (req.toolUseId) {
        map.set(req.toolUseId, req);
      }
    });

    return map;
  });

  /**
   * Set of all toolCallIds currently present in execution trees.
   * Used to determine which permissions are matched vs unmatched.
   *
   * Scans both:
   * 1. Current streaming execution tree (tools being executed now)
   * 2. All finalized messages' execution trees (completed tools)
   *
   * Extracted from chat.store.ts:222-254
   */
  private readonly toolIdsInExecutionTree = computed(() => {
    const toolIds = new Set<string>();
    const activeTab = this.tabManager.activeTab();
    const messages = activeTab?.messages ?? [];
    const currentTree = activeTab?.executionTree ?? null;

    const collectToolIds = (node: ExecutionNode | null): void => {
      if (!node) return;

      // Collect this node's toolCallId if it's a tool
      if (node.type === 'tool' && node.toolCallId) {
        toolIds.add(node.toolCallId);
      }

      // Recurse into children
      if (node.children) {
        for (const child of node.children) {
          collectToolIds(child);
        }
      }
    };

    // Scan current streaming tree
    collectToolIds(currentTree);

    // Scan all finalized messages' execution trees
    for (const msg of messages) {
      if (msg.executionTree) {
        collectToolIds(msg.executionTree);
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
   * Extracted from chat.store.ts:1335-1338
   */
  handlePermissionRequest(request: PermissionRequest): void {
    console.log(
      '[PermissionHandlerService] Permission request received:',
      request
    );
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
        '[PermissionHandlerService] VSCodeService not available for permission response'
      );
    }
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

    const permission = this.permissionRequestsByToolId().get(toolCallId);

    // Debug logging for ID correlation issues
    if (!permission && this._permissionRequests().length > 0) {
      console.debug('[PermissionHandlerService] Permission lookup miss:', {
        lookupKey: toolCallId,
        availableKeys: Array.from(this.permissionRequestsByToolId().keys()),
        pendingCount: this._permissionRequests().length,
      });
    }

    return permission ?? null;
  }
}
