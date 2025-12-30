/**
 * Permission handling types for MCP approval_prompt tool
 *
 * TASK_2025_026: MCP Permission Prompt Integration
 *
 * These types support the MCP server's approval_prompt tool, allowing Claude CLI
 * to request user permission for tool execution via VS Code webview UI.
 */

import { z } from 'zod';

/**
 * Permission request sent from MCP server to webview
 *
 * Represents a pending permission request that requires user approval.
 * The MCP server creates this when Claude CLI invokes the approval_prompt tool.
 */
export interface PermissionRequest {
  /** Unique request ID (UUID) */
  readonly id: string;

  /** Tool name requesting permission (e.g., "Bash", "Write", "Read") */
  readonly toolName: string;

  /** Tool input parameters (arbitrary JSON-serializable object) */
  readonly toolInput: Readonly<Record<string, unknown>>;

  /** Claude's tool_use_id for correlation (optional) */
  readonly toolUseId?: string;

  /** Request timestamp (Unix epoch milliseconds) */
  readonly timestamp: number;

  /** Human-readable description of the permission request */
  readonly description: string;

  /** Timeout deadline (Unix epoch milliseconds) - auto-deny after this time */
  readonly timeoutAt: number;
}

/**
 * Permission response sent from webview to MCP server
 *
 * Represents the user's decision on a permission request.
 * The webview sends this back to the extension when the user clicks a button.
 */
export interface PermissionResponse {
  /** Must match request ID from PermissionRequest */
  readonly id: string;

  /** User's decision: allow (once), deny, or always_allow (create rule) */
  readonly decision: 'allow' | 'deny' | 'always_allow';

  /** Modified tool input parameters (optional, user may edit before approval) */
  readonly modifiedInput?: Readonly<Record<string, unknown>>;

  /** Optional reason for deny decision (shown in logs) */
  readonly reason?: string;
}

/**
 * Interface for SDK Permission Handler
 *
 * Allows vscode-core to call handleResponse without importing agent-sdk directly.
 * This breaks the circular dependency between vscode-core and agent-sdk.
 */
export interface ISdkPermissionHandler {
  /**
   * Handle permission response from webview
   * @param requestId - The permission request ID
   * @param response - The user's response
   */
  handleResponse(requestId: string, response: PermissionResponse): void;

  /**
   * Handle question response from webview (for AskUserQuestion tool)
   * @param response - The user's answers
   */
  handleQuestionResponse(response: {
    id: string;
    answers: Record<string, string>;
  }): void;
}

/**
 * Permission rule for "Always Allow" patterns
 *
 * Stored in workspace state to automatically approve matching requests.
 * Created when user clicks "Always Allow" on a permission request.
 */
export interface PermissionRule {
  /** Rule ID (UUID) */
  readonly id: string;

  /** Pattern to match (e.g., "Bash:npm*", "Write:src/**") */
  readonly pattern: string;

  /** Tool name this rule applies to (e.g., "Bash", "Write") */
  readonly toolName: string;

  /** Action when pattern matches (allow or deny) */
  readonly action: 'allow' | 'deny';

  /** Created timestamp (Unix epoch milliseconds) */
  readonly createdAt: number;

  /** Optional description explaining the rule */
  readonly description?: string;
}

/**
 * Zod schema for PermissionRequest runtime validation
 *
 * Validates incoming permission requests from MCP server.
 */
export const PermissionRequestSchema = z.object({
  id: z.string().uuid(),
  toolName: z.string().min(1),
  toolInput: z.record(z.string(), z.unknown()),
  toolUseId: z.string().optional(),
  timestamp: z.number(),
  description: z.string(),
  timeoutAt: z.number(),
});

/**
 * Zod schema for PermissionResponse runtime validation
 *
 * Validates user responses before sending back to MCP server.
 */
export const PermissionResponseSchema = z.object({
  id: z.string(),
  decision: z.enum(['allow', 'deny', 'always_allow']),
  modifiedInput: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().optional(),
});

/**
 * Zod schema for PermissionRule runtime validation
 *
 * Validates permission rules before storing in workspace state.
 */
export const PermissionRuleSchema = z.object({
  id: z.string().uuid(),
  pattern: z.string().min(1),
  toolName: z.string().min(1),
  action: z.enum(['allow', 'deny']),
  createdAt: z.number(),
  description: z.string().optional(),
});
