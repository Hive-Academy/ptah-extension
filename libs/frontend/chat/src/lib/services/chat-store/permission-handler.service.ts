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

import { Injectable, signal, computed, inject, effect } from '@angular/core';
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
   * Cache for tool IDs to avoid recursive tree traversal on every read
   */
  private _toolIdsCache = new Set<string>();

  constructor() {
    // Update tool IDs cache when tab state changes
    effect(() => {
      const activeTab = this.tabManager.activeTab();
      const messages = activeTab?.messages ?? [];

      this._toolIdsCache.clear();
      messages.forEach((msg) => {
        if (msg.streamingState) {
          this.extractToolIds(msg.streamingState, this._toolIdsCache);
        }
      });
    });
  }

  /**
   * Helper to extract tool IDs from execution tree
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
   * Set of all toolCallIds currently present in execution trees.
   * Used to determine which permissions are matched vs unmatched.
   *
   * Performance optimized: Uses cached Set instead of recursive traversal.
   * Cache is updated via effect in constructor when tab state changes.
   *
   * Extracted from chat.store.ts:222-254
   */
  readonly toolIdsInExecutionTree = computed(() => this._toolIdsCache);

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
