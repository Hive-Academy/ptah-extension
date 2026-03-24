/**
 * Copilot Permission Bridge
 * TASK_2025_162: Bidirectional async communication between the Copilot SDK's
 * permission hooks and the webview UI.
 *
 * Handles TWO SDK permission systems:
 * 1. `hooks.onPreToolUse` -- called before tool execution, returns permissionDecision
 * 2. `onPermissionRequest` -- called for shell/file operations, returns PermissionRequestResult
 *
 * Both are routed through the same internal mechanism:
 * - Store pending requests as Map<requestId, Promise resolver>
 * - Emit 'permission-request' event for RPC forwarding to webview
 * - Block indefinitely until user responds or cleanup resolves
 *
 * Auto-approves read-only tools and 'read' permission kinds to reduce friction.
 *
 * TASK_2025_215: Removed 5-minute setTimeout-based timeout. Permission requests
 * now block indefinitely until the user responds or cleanup resolves them
 * (matching Claude Code CLI behavior).
 */
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentPermissionRequest,
  AgentPermissionDecision,
} from '@ptah-extension/shared';

// ========================================
// Permission Policy
// ========================================

/**
 * Fine-grained permission policy for Copilot SDK tool/permission approval.
 * TASK_2025_177: Replaces boolean autoApprove with structured presets.
 */
export interface PermissionPolicy {
  readonly name: string;
  /** Tool names to auto-approve (case-sensitive). Ignored when autoApproveAll is true. */
  readonly autoApproveTools: ReadonlySet<string>;
  /** Permission kinds to auto-approve (e.g., 'read', 'write'). Ignored when autoApproveAll is true. */
  readonly autoApproveKinds: ReadonlySet<string>;
  /** When true, all requests are auto-approved regardless of tool/kind. */
  readonly autoApproveAll: boolean;
}

/** Read-only tools set shared by presets */
const READ_ONLY_TOOLS = new Set([
  'View',
  'Read',
  'Glob',
  'Grep',
  'LS',
  'view',
  'read',
  'glob',
  'grep',
  'ls',
  'list_directory',
  'read_file',
  'search_file_content',
]);

/** Safe write tools: read-only + file mutation tools */
const SAFE_WRITE_TOOLS = new Set([
  ...READ_ONLY_TOOLS,
  'Write',
  'Edit',
  'write',
  'edit',
  'write_file',
  'edit_file',
]);

/**
 * Built-in permission policy presets.
 */
export const PERMISSION_PRESETS = {
  /** Only auto-approve read-only tools and 'read' permission kind */
  readOnly: {
    name: 'readOnly',
    autoApproveTools: READ_ONLY_TOOLS,
    autoApproveKinds: new Set(['read']),
    autoApproveAll: false,
  } satisfies PermissionPolicy,

  /** Auto-approve read + file write tools, read + write permission kinds */
  safeWrite: {
    name: 'safeWrite',
    autoApproveTools: SAFE_WRITE_TOOLS,
    autoApproveKinds: new Set(['read', 'write']),
    autoApproveAll: false,
  } satisfies PermissionPolicy,

  /** Auto-approve everything (current default behavior) */
  fullAuto: {
    name: 'fullAuto',
    autoApproveTools: new Set<string>(),
    autoApproveKinds: new Set<string>(),
    autoApproveAll: true,
  } satisfies PermissionPolicy,
};

interface PendingRequest {
  readonly resolve: (decision: AgentPermissionDecision) => void;
}

export class CopilotPermissionBridge {
  /** Event emitter for RPC forwarding. Emits 'permission-request' events. */
  readonly events = new EventEmitter();

  /** Map of requestId -> { resolve } for pending permission requests */
  private readonly pending = new Map<string, PendingRequest>();

  /** Active permission policy (defaults to fullAuto for backward compatibility) */
  private _policy: PermissionPolicy = PERMISSION_PRESETS.fullAuto;

  /** Backward-compatible getter: true when policy is fullAuto */
  get autoApprove(): boolean {
    return this._policy.autoApproveAll;
  }

  /**
   * Backward-compatible setter.
   * true → fullAuto preset, false → readOnly preset.
   */
  setAutoApprove(value: boolean): void {
    this._policy = value
      ? PERMISSION_PRESETS.fullAuto
      : PERMISSION_PRESETS.readOnly;
  }

  /** Set a fine-grained permission policy. */
  setPolicy(policy: PermissionPolicy): void {
    this._policy = policy;
  }

  /** Get the current permission policy. */
  get policy(): PermissionPolicy {
    return this._policy;
  }

  /**
   * Request permission for a tool use (from hooks.onPreToolUse).
   * Returns the PreToolUseHookOutput format expected by the SDK.
   *
   * @param params.agentId - The Ptah agent ID requesting permission
   * @param params.toolName - Tool name from PreToolUseHookInput
   * @param params.toolArgs - Tool arguments (unknown from SDK, serialized to JSON string)
   * @returns PreToolUseHookOutput with permissionDecision and optional reason
   */
  async requestToolPermission(params: {
    agentId: string;
    toolName: string;
    toolArgs: unknown;
  }): Promise<{
    permissionDecision: 'allow' | 'deny';
    permissionDecisionReason?: string;
  }> {
    if (
      this._policy.autoApproveAll ||
      this._policy.autoApproveTools.has(params.toolName)
    ) {
      return { permissionDecision: 'allow' };
    }

    const decision = await this.requestPermissionInternal({
      agentId: params.agentId,
      kind: 'write',
      toolName: params.toolName,
      toolArgs:
        typeof params.toolArgs === 'string'
          ? params.toolArgs
          : JSON.stringify(params.toolArgs ?? {}),
      description: `Copilot wants to use ${params.toolName}`,
    });

    return {
      permissionDecision: decision.decision === 'allow' ? 'allow' : 'deny',
      permissionDecisionReason: decision.reason,
    };
  }

  /**
   * Request permission for a shell/file operation (from onPermissionRequest).
   * Returns the PermissionRequestResult format expected by the SDK.
   *
   * @param params.agentId - The Ptah agent ID requesting permission
   * @param params.kind - Permission kind: "shell", "write", "mcp", "read", "url"
   * @param params.toolCallId - Optional tool call ID from the SDK
   * @param params.details - Additional details about the operation
   * @returns PermissionRequestResult with kind field
   */
  async requestFilePermission(params: {
    agentId: string;
    kind: string;
    toolCallId?: string;
    details: Record<string, unknown>;
  }): Promise<{
    kind: 'approved' | 'denied-interactively-by-user';
  }> {
    if (
      this._policy.autoApproveAll ||
      this._policy.autoApproveKinds.has(params.kind)
    ) {
      return { kind: 'approved' };
    }

    const decision = await this.requestPermissionInternal({
      agentId: params.agentId,
      kind: params.kind,
      toolName: params.kind,
      toolArgs: JSON.stringify(params.details),
      description: `Copilot requests ${params.kind} permission`,
    });

    return {
      kind:
        decision.decision === 'allow'
          ? 'approved'
          : 'denied-interactively-by-user',
    };
  }

  /**
   * Internal permission request mechanism shared by both hook handlers.
   * Creates a Promise, stores the resolver, emits an event, and waits
   * indefinitely for resolution (no timeout).
   */
  private async requestPermissionInternal(params: {
    agentId: string;
    kind: string;
    toolName: string;
    toolArgs: string;
    description: string;
  }): Promise<AgentPermissionDecision> {
    const requestId = uuidv4();
    const now = Date.now();
    const request: AgentPermissionRequest = {
      requestId,
      agentId: params.agentId,
      kind: params.kind,
      toolName: params.toolName,
      toolArgs: params.toolArgs,
      description: params.description,
      timestamp: now,
      timeoutAt: 0,
    };

    return new Promise<AgentPermissionDecision>((resolve) => {
      this.pending.set(requestId, {
        resolve: (decision: AgentPermissionDecision) => {
          this.pending.delete(requestId);
          resolve(decision);
        },
      });

      // Emit event for RPC forwarding to webview
      this.events.emit('permission-request', request);
    });
  }

  /**
   * Resolve a pending permission request.
   * Called from the RPC handler when the user responds via the webview UI.
   *
   * @param requestId - The request ID to resolve
   * @param decision - The user's decision (allow or deny)
   */
  resolvePermission(
    requestId: string,
    decision: AgentPermissionDecision
  ): void {
    const entry = this.pending.get(requestId);
    if (entry) {
      entry.resolve(decision);
    }
  }

  /**
   * Cleanup all pending requests by resolving them with 'deny'.
   * Called on agent abort/exit to prevent hanging SDK hooks.
   */
  cleanup(): void {
    for (const [id, entry] of this.pending) {
      entry.resolve({
        requestId: id,
        decision: 'deny',
        reason: 'Agent stopped',
      });
    }
    this.pending.clear();
  }

  /** Number of pending requests (for testing/diagnostics) */
  get pendingCount(): number {
    return this.pending.size;
  }
}
