/**
 * Agent Permission Types for CLI Agent Tool Approval
 *
 * These types handle Copilot agent tool permission requests routed to the
 * webview UI. Distinct from SDK permissions (Claude tool approval) and
 * MCP permissions (code execution approval).
 *
 * Permission Flow:
 *   CopilotSdkAdapter (onPreToolUse hook)
 *     -> CopilotPermissionBridge (emits event)
 *     -> RPC Layer (broadcasts to webview)
 *     -> AgentMonitorStore (renders dialog)
 *     -> User clicks Allow/Deny
 *     -> RPC Layer (routes back to extension)
 *     -> CopilotPermissionBridge (resolves Promise)
 *     -> SDK hook returns decision
 */

/**
 * Permission request from a CLI agent (Copilot SDK onPreToolUse hook).
 *
 * Emitted when a Copilot agent wants to use a tool that requires user approval.
 * Read-only tools (View, Read, Glob, Grep, LS) are auto-approved and never
 * generate a permission request.
 */
export interface AgentPermissionRequest {
  /** Unique request ID for correlation (UUID) */
  readonly requestId: string;

  /** Agent that is requesting permission (branded AgentId as string) */
  readonly agentId: string;

  /** Permission kind from SDK: "shell", "write", "mcp", "read", "url" */
  readonly kind: string;

  /** Tool name the agent wants to use (e.g., "bash", "edit", "create") */
  readonly toolName: string;

  /** Serialized tool arguments (JSON string -- SDK provides `unknown`, we serialize) */
  readonly toolArgs: string;

  /** Human-readable description of what the agent wants to do */
  readonly description: string;

  /** Request timestamp (Unix epoch milliseconds) */
  readonly timestamp: number;

  /** Timeout deadline (Unix epoch milliseconds). 0 means no timeout — block indefinitely until user responds. */
  readonly timeoutAt: number;
}

/**
 * User's decision on an agent permission request.
 *
 * Sent from the webview UI back to the extension when the user clicks
 * Allow or Deny on a permission dialog in the agent card.
 */
export interface AgentPermissionDecision {
  /** Must match requestId from the corresponding AgentPermissionRequest */
  readonly requestId: string;

  /** User decision: allow the tool use or deny it */
  readonly decision: 'allow' | 'deny';

  /** Optional reason for the decision (e.g., "User denied", "Timed out") */
  readonly reason?: string;
}

/**
 * User input request from a CLI agent (Copilot SDK onUserInputRequest hook).
 *
 * Emitted when Copilot asks the user a question, optionally with multiple
 * choice options. Maps to the SDK's UserInputRequest type.
 */
export interface AgentUserInputRequest {
  /** Unique request ID for correlation (UUID) */
  readonly requestId: string;

  /** Agent asking for input (branded AgentId as string) */
  readonly agentId: string;

  /** The question/prompt from the agent (maps to SDK UserInputRequest.question) */
  readonly question: string;

  /** Optional multiple choice options (maps to SDK UserInputRequest.choices) */
  readonly choices?: readonly string[];

  /** Request timestamp (Unix epoch milliseconds) */
  readonly timestamp: number;

  /** Auto-timeout deadline (Unix epoch milliseconds) */
  readonly timeoutAt: number;
}

/**
 * User's response to an agent input request.
 *
 * Sent from the webview UI back to the extension when the user submits
 * an answer. Maps to the SDK's UserInputResponse type.
 */
export interface AgentUserInputResponse {
  /** Must match requestId from the corresponding AgentUserInputRequest */
  readonly requestId: string;

  /** The user's text response (maps to SDK UserInputResponse.answer) */
  readonly answer: string;

  /** Whether the answer was freeform text rather than selected from choices */
  readonly wasFreeform: boolean;
}
