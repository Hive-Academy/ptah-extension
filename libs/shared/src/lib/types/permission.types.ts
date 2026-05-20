/**
 * Permission handling types for MCP approval_prompt tool
 *
 * These types support the MCP server's approval_prompt tool, allowing Claude CLI
 * to request user permission for tool execution via VS Code webview UI.
 */

import { z } from 'zod';
import type { PermissionLevel } from './model-autopilot.types';
import type { QuestionItem } from '../type-guards/guards';
import { UUID_REGEX } from './branded.types';

/**
 * Sentinel value for when the parent agent's toolCallId cannot be resolved.
 *
 * Used in PermissionRequest.agentToolCallId when the permission handler
 * knows the tool is running inside a subagent (agentID is present) but
 * cannot map it to a registry record (e.g., registry entry expired or
 * agent hasn't been registered yet).
 *
 * The frontend uses this sentinel to fall back to markLastAgentAsInterrupted()
 * instead of targeted marking.
 */
export const UNKNOWN_AGENT_TOOL_CALL_ID = '__unknown__' as const;

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

  /**
   * The toolCallId of the Task tool that spawned the subagent whose tool
   * is being denied. This is the ID the frontend uses to identify the
   * agent ExecutionNode in the streaming state tree.
   *
   * - Set when a tool inside a subagent requires permission and the backend
   *   can resolve the sub-agent's ID to the parent Task tool's toolCallId
   *   via the SubagentRegistryService.
   * - Set to UNKNOWN_AGENT_TOOL_CALL_ID when the agent context is known
   *   but the registry lookup fails.
   * - Undefined when the tool is not running inside a subagent.
   *
   * Fixes the semantic mismatch where toolUseId is the
   * denied tool's ID but the frontend needs the agent's toolCallId.
   */
  readonly agentToolCallId?: string;

  /** Request timestamp (Unix epoch milliseconds) */
  readonly timestamp: number;

  /** Human-readable description of the permission request */
  readonly description: string;

  /** Timeout deadline (Unix epoch milliseconds). 0 means no timeout — block indefinitely until user responds. */
  readonly timeoutAt: number;

  /** Session ID this permission belongs to (for UI routing to correct tab) */
  readonly sessionId?: string;

  /** Frontend tab ID for direct tab routing (authoritative over `sessionId`). */
  readonly tabId?: string;
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

  /** User's decision: allow (once), deny, always_allow (create rule), or deny_with_message (deny but continue) */
  readonly decision: 'allow' | 'deny' | 'always_allow' | 'deny_with_message';

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

  /**
   * Get the current permission level
   * Used by SessionLifecycleManager to set initial SDK permissionMode at query creation
   */
  getPermissionLevel(): PermissionLevel;

  /**
   * Cleanup pending permission requests for a session
   * Called when session is aborted to prevent unhandled promise rejections
   * @param sessionId - The session ID to cleanup (optional, cleanup all if not provided)
   */
  cleanupPendingPermissions(sessionId?: string): void;
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
 * AskUserQuestion request sent from backend to webview
 *
 * Represents a pending question request from the SDK's AskUserQuestion tool.
 * The backend creates this when Claude invokes AskUserQuestion.
 */
export interface AskUserQuestionRequest {
  /** Unique request ID (for correlation with response) */
  readonly id: string;
  /** Tool name (always 'AskUserQuestion') */
  readonly toolName: 'AskUserQuestion';
  /** Array of questions to present to the user */
  readonly questions: QuestionItem[];
  /** Claude's tool_use_id for correlation */
  readonly toolUseId?: string;
  /** Request timestamp (Unix epoch milliseconds) */
  readonly timestamp: number;
  /** Timeout deadline (Unix epoch milliseconds). 0 means no timeout — block indefinitely until user responds. */
  readonly timeoutAt: number;
  /** Session ID this question belongs to (for UI routing to correct tab) */
  readonly sessionId?: string;
  /** Frontend tab ID for direct tab routing (authoritative over sessionId) */
  readonly tabId?: string;
}

/**
 * AskUserQuestion response sent from webview to backend
 */
export interface AskUserQuestionResponse {
  /** Must match request ID from AskUserQuestionRequest */
  readonly id: string;
  /** User's answers keyed by question ID */
  readonly answers: Record<string, string>;
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
  agentToolCallId: z.string().optional(),
  timestamp: z.number(),
  description: z.string(),
  timeoutAt: z.number(),
  sessionId: z
    .string()
    .refine((v) => UUID_REGEX.test(v), {
      message: 'sessionId must be a UUID v4',
    })
    .optional(),
  tabId: z
    .string()
    .refine((v) => UUID_REGEX.test(v), { message: 'tabId must be a UUID v4' })
    .optional(),
});

/**
 * Zod schema for PermissionResponse runtime validation
 *
 * Validates user responses before sending back to MCP server.
 */
export const PermissionResponseSchema = z.object({
  id: z.string(),
  decision: z.enum(['allow', 'deny', 'always_allow', 'deny_with_message']),
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

/**
 * Zod schema for AskUserQuestionRequest runtime validation
 *
 * Validates incoming question requests at the frontend receive point.
 */
export const AskUserQuestionRequestSchema = z.object({
  id: z.string().uuid(),
  toolName: z.literal('AskUserQuestion'),
  questions: z.array(z.unknown()),
  toolUseId: z.string().optional(),
  timestamp: z.number(),
  timeoutAt: z.number(),
  sessionId: z
    .string()
    .refine((v) => UUID_REGEX.test(v), {
      message: 'sessionId must be a UUID v4',
    })
    .optional(),
  tabId: z
    .string()
    .refine((v) => UUID_REGEX.test(v), { message: 'tabId must be a UUID v4' })
    .optional(),
});
