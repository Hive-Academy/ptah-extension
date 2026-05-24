/**
 * MCP (Model Context Protocol) wire types — JSON-RPC 2.0 over any transport.
 *
 * These were originally co-located in `code-execution/types.ts` alongside the
 * PtahAPI namespace definitions. As part of TASK_2026_128 Phase 0 the MCP
 * protocol surface was split out so that transport adapters (`mcp-http/`,
 * `mcp-stdio/`) can depend on the protocol contracts without dragging in
 * the PtahAPI namespace types they don't need.
 *
 * `code-execution/types.ts` continues to re-export every symbol declared
 * here so the 27+ existing consumers keep compiling unchanged.
 */

/**
 * MCP request following JSON-RPC 2.0 specification.
 */
export interface MCPRequest {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';

  /** Request ID for correlation */
  id: string | number;

  /** MCP method name (e.g., "tools/list", "tools/call") */
  method: string;

  /** Method-specific parameters */
  params?: Record<string, unknown>;

  /** Caller's SDK session ID extracted from MCP URL path (e.g., /session/{tabId}) */
  _callerSessionId?: string;
}

/**
 * MCP response following JSON-RPC 2.0 specification.
 */
export interface MCPResponse {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';

  /** Request ID for correlation */
  id: string | number;

  /** Success result (mutually exclusive with error) */
  result?: unknown;

  /** Error response (mutually exclusive with result) */
  error?: MCPError;
}

/**
 * MCP error structure.
 */
export interface MCPError {
  /** Error code (JSON-RPC standard codes) */
  code: number;

  /** Human-readable error message */
  message: string;

  /** Additional error data (e.g., stack trace) */
  data?: unknown;
}

/**
 * MCP notification — a server → client message with no `id` and no response.
 * Examples: `notifications/progress`, `notifications/message`, `notifications/cancelled`.
 */
export interface MCPNotification {
  /** JSON-RPC version (always "2.0") */
  jsonrpc: '2.0';

  /** Notification method name (e.g., "notifications/progress") */
  method: string;

  /** Method-specific parameters */
  params?: Record<string, unknown>;
}

/**
 * MCP tool definition structure.
 */
export interface MCPToolDefinition {
  /** Tool name (must be unique) */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for tool parameters */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };

  /** MCP protocol annotations — hints for LLM clients about tool behavior */
  annotations?: {
    /** Tool only reads data, does not modify state */
    readOnlyHint?: boolean;
    /** Tool may perform destructive/irreversible operations */
    destructiveHint?: boolean;
    /** Calling with same args produces same result (safe to retry) */
    idempotentHint?: boolean;
    /** Tool interacts with external systems beyond the local environment */
    openWorldHint?: boolean;
  };
}

/**
 * Parameters for the `execute_code` MCP tool.
 */
export interface ExecuteCodeParams {
  /** TypeScript code to execute */
  code: string;

  /** Execution timeout in milliseconds (default: 15000, max: 30000) */
  timeout?: number;
}

/**
 * Result of code execution.
 */
export interface ExecuteCodeResult {
  /** Execution success flag */
  success: boolean;

  /** Return value from code (if success) */
  result?: unknown;

  /** Error message (if failure) */
  error?: string;

  /** Stack trace (if failure) */
  stack?: string;
}

/**
 * Parameters for the `approval_prompt` MCP tool.
 * Called by Claude CLI when permission is needed for tool execution.
 */
export interface ApprovalPromptParams {
  /** Name of the tool requesting permission (e.g., "Bash", "Write", "Read") */
  readonly tool_name: string;

  /** Input parameters for the tool (arbitrary JSON-serializable object) */
  readonly input: Readonly<Record<string, unknown>>;

  /** Claude's unique tool use ID for correlation */
  readonly tool_use_id?: string;
}
