/**
 * SDK Permission Handler Service
 *
 * Bridges SDK's canUseTool callback to VS Code webview permission UI.
 * Implements the SDK permission interface with RPC-based user approval.
 *
 * Key Features:
 * - Auto-approve safe tools (Read, Grep, Glob) - no latency
 * - Emit RPC events for dangerous tools (Write, Edit, Bash, NotebookEdit)
 * - 30-second timeout with auto-deny (fail-safe)
 * - Input sanitization (redact API keys, tokens)
 * - Support parameter modification (user edits before approval)
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';

/**
 * SDK Types - Structural typing to avoid ESM/CommonJS import issues
 *
 * The SDK package is ESM-only ("type": "module"), but this library is CommonJS.
 * We use structural typing to match the SDK's permission types without imports.
 * These types are structurally compatible with @anthropic-ai/claude-agent-sdk/sdk.d.ts
 */

/**
 * Permission result type (internal type hint)
 */
type PermissionResult =
  | {
      behavior: 'allow';
      updatedInput: Record<string, unknown>;
      updatedPermissions?: any[];
      toolUseID?: string;
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
    };

/**
 * Callback type for permission checking
 * Structurally matches SDK's CanUseTool type
 * Return type uses 'any' to accept SDK's actual PermissionResult without type errors
 */
type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: any[];
  }
) => Promise<any>;

/**
 * Permission request payload for RPC event
 * Matches shared/permission.types.ts PermissionRequest interface
 */
interface PermissionRequest {
  /** Unique request ID - matches shared type's 'id' field */
  id: string;
  toolName: string;
  toolInput: any;
  /** Claude's tool_use_id for correlation with ExecutionNode.toolCallId */
  toolUseId?: string;
  timestamp: number;
  /** Human-readable description of the permission request */
  description: string;
  /** Timeout deadline (Unix epoch milliseconds) - auto-deny after this time */
  timeoutAt: number;
}

/**
 * Permission response from webview RPC
 */
interface PermissionResponse {
  approved: boolean;
  modifiedInput?: any;
  reason?: string;
}

/**
 * Pending request tracking
 */
interface PendingRequest {
  resolve: (response: PermissionResponse) => void;
  timer: NodeJS.Timeout;
}

/**
 * Permission timeout in milliseconds (30 seconds)
 */
const PERMISSION_TIMEOUT_MS = 30000;

/**
 * Safe tools that are auto-approved without user prompt
 * These are read-only operations that cannot modify system state
 */
const SAFE_TOOLS = ['Read', 'Grep', 'Glob'];

/**
 * Dangerous tools that require user approval
 * These can modify files, execute code, or perform destructive operations
 */
const DANGEROUS_TOOLS = ['Write', 'Edit', 'Bash', 'NotebookEdit'];

/**
 * SDK Permission Handler
 *
 * Implements SDK canUseTool callback interface with webview coordination.
 */
@injectable()
export class SdkPermissionHandler {
  /**
   * Pending permission requests awaiting user response
   * Maps requestId → PendingRequest
   */
  private pendingRequests = new Map<string, PendingRequest>();

  /**
   * Event emitter for permission requests
   * In a real implementation, this would use EventBus or RPC system
   * For now, storing reference to be called by external RPC handler
   */
  private eventEmitter: ((event: string, payload: any) => void) | null = null;

  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  /**
   * Set event emitter for permission requests
   * Called during initialization to wire up RPC event system
   */
  setEventEmitter(emitter: (event: string, payload: any) => void): void {
    this.eventEmitter = emitter;
  }

  /**
   * Create canUseTool callback for SDK query
   *
   * Returns a function matching SDK's CanUseTool signature that:
   * 1. Auto-approves safe tools instantly
   * 2. Requests user approval for dangerous tools via RPC
   * 3. Denies unknown tools (fail-safe)
   */
  createCallback(): CanUseTool {
    return async (
      toolName: string,
      input: any,
      _options?: { signal?: AbortSignal; suggestions?: any[] }
    ): Promise<PermissionResult> => {
      // Auto-approve safe tools (no user prompt needed)
      if (SAFE_TOOLS.includes(toolName)) {
        this.logger.debug(
          `[SdkPermissionHandler] Auto-approved safe tool: ${toolName}`
        );
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        };
      }

      // Dangerous tools require user approval
      if (DANGEROUS_TOOLS.includes(toolName)) {
        this.logger.info(
          `[SdkPermissionHandler] Requesting user permission for dangerous tool: ${toolName}`
        );
        return await this.requestUserPermission(toolName, input);
      }

      // Unknown tools default to deny (fail-safe)
      this.logger.warn(
        `[SdkPermissionHandler] Unknown tool denied: ${toolName}`
      );
      return {
        behavior: 'deny' as const,
        message: `Unknown tool: ${toolName}`,
      };
    };
  }

  /**
   * Request user permission via RPC event
   *
   * Emits permission request event to webview and awaits response.
   * Implements 30-second timeout with auto-deny.
   */
  private async requestUserPermission(
    toolName: string,
    input: any
  ): Promise<PermissionResult> {
    // Generate unique request ID
    const requestId = this.generateRequestId();

    // Sanitize tool input before sending to UI
    const sanitizedInput = this.sanitizeToolInput(input);

    // Calculate timeout deadline (30 seconds from now)
    const now = Date.now();
    const timeoutAt = now + PERMISSION_TIMEOUT_MS;

    // Generate human-readable description based on tool type
    const description = this.generateDescription(toolName, sanitizedInput);

    // Emit permission request event
    // Note: All fields match shared/permission.types.ts PermissionRequest interface
    const request: PermissionRequest = {
      id: requestId,
      toolName,
      toolInput: sanitizedInput,
      timestamp: now,
      description,
      timeoutAt,
    };

    if (!this.eventEmitter) {
      this.logger.error(
        '[SdkPermissionHandler] Event emitter not set - cannot request permission'
      );
      return {
        behavior: 'deny' as const,
        message: 'Permission system not initialized',
      };
    }

    // Emit event (webview will listen and show permission prompt)
    // Uses 'permission:request' to match shared/message.types.ts and VSCodeService handler
    this.eventEmitter('permission:request', request);

    this.logger.debug(
      `[SdkPermissionHandler] Emitted permission request ${requestId} for tool ${toolName}`
    );

    // Await user response with timeout
    const response = await this.awaitResponse(requestId, PERMISSION_TIMEOUT_MS);

    if (!response) {
      // Timeout - auto-deny
      this.logger.warn(
        `[SdkPermissionHandler] Permission request ${requestId} timed out after ${PERMISSION_TIMEOUT_MS}ms`
      );
      return {
        behavior: 'deny' as const,
        message: 'Permission request timed out',
      };
    }

    // User approved
    if (response.approved) {
      this.logger.info(
        `[SdkPermissionHandler] Permission request ${requestId} approved for tool ${toolName}`
      );
      return {
        behavior: 'allow' as const,
        updatedInput: response.modifiedInput ?? input,
      };
    }

    // User denied
    this.logger.info(
      `[SdkPermissionHandler] Permission request ${requestId} denied for tool ${toolName}: ${
        response.reason || 'No reason provided'
      }`
    );
    return {
      behavior: 'deny' as const,
      message: response.reason || 'User denied permission',
    };
  }

  /**
   * Handle permission response from webview
   *
   * Called by RPC handler when user approves/denies permission.
   */
  handleResponse(requestId: string, response: PermissionResponse): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      this.logger.warn(
        `[SdkPermissionHandler] Received response for unknown request: ${requestId}`
      );
      return;
    }

    // Clear timeout and resolve pending promise
    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);
    pending.resolve(response);

    this.logger.debug(
      `[SdkPermissionHandler] Handled response for request ${requestId}: ${
        response.approved ? 'approved' : 'denied'
      }`
    );
  }

  /**
   * Await RPC response from webview
   *
   * Returns null on timeout, PermissionResponse on user action.
   */
  private async awaitResponse(
    requestId: string,
    timeoutMs: number
  ): Promise<PermissionResponse | null> {
    return new Promise<PermissionResponse | null>((resolve) => {
      // Set timeout
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve(null); // Timeout - return null
      }, timeoutMs);

      // Store pending request
      this.pendingRequests.set(requestId, {
        resolve,
        timer,
      });
    });
  }

  /**
   * Sanitize tool input before showing to user
   *
   * Removes sensitive data like API keys, tokens, credentials.
   * Prevents accidental exposure of secrets in permission prompts.
   */
  private sanitizeToolInput(input: any): any {
    if (!input || typeof input !== 'object') {
      return input;
    }

    const sanitized = { ...input };

    // Sanitize environment variables
    if (sanitized.env && typeof sanitized.env === 'object') {
      sanitized.env = Object.keys(sanitized.env).reduce((acc, key) => {
        // Redact keys that likely contain secrets
        const isSecret =
          key.toUpperCase().includes('KEY') ||
          key.toUpperCase().includes('TOKEN') ||
          key.toUpperCase().includes('SECRET') ||
          key.toUpperCase().includes('PASSWORD') ||
          key.toUpperCase().includes('API');

        acc[key] = isSecret ? '***REDACTED***' : sanitized.env[key];
        return acc;
      }, {} as Record<string, string>);
    }

    // Sanitize command strings that might contain secrets
    if (sanitized.command && typeof sanitized.command === 'string') {
      // Simple heuristic: if command contains key-like patterns, warn user
      if (
        sanitized.command.includes('KEY=') ||
        sanitized.command.includes('TOKEN=') ||
        sanitized.command.includes('PASSWORD=')
      ) {
        sanitized._securityWarning =
          'Command may contain sensitive credentials';
      }
    }

    return sanitized;
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `perm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate human-readable description for permission request
   *
   * Creates a meaningful description based on tool type and input parameters.
   * Used in the webview permission UI to help users understand what's being requested.
   */
  private generateDescription(toolName: string, input: any): string {
    switch (toolName) {
      case 'Bash': {
        const command = input?.command;
        if (command) {
          // Truncate long commands
          const truncated =
            command.length > 100 ? `${command.substring(0, 100)}...` : command;
          return `Execute bash command: ${truncated}`;
        }
        return 'Execute a bash command';
      }

      case 'Write': {
        const filePath = input?.file_path;
        if (filePath) {
          return `Write to file: ${filePath}`;
        }
        return 'Write to a file';
      }

      case 'Edit': {
        const filePath = input?.file_path;
        if (filePath) {
          return `Edit file: ${filePath}`;
        }
        return 'Edit a file';
      }

      case 'NotebookEdit': {
        const notebookPath = input?.notebook_path;
        if (notebookPath) {
          return `Edit notebook: ${notebookPath}`;
        }
        return 'Edit a Jupyter notebook';
      }

      case 'Read': {
        const filePath = input?.file_path;
        if (filePath) {
          return `Read file: ${filePath}`;
        }
        return 'Read a file';
      }

      case 'Grep': {
        const pattern = input?.pattern;
        if (pattern) {
          return `Search for pattern: ${pattern}`;
        }
        return 'Search file contents';
      }

      case 'Glob': {
        const pattern = input?.pattern;
        if (pattern) {
          return `Find files matching: ${pattern}`;
        }
        return 'Find files';
      }

      default:
        return `Execute tool: ${toolName}`;
    }
  }

  /**
   * Dispose all pending requests
   * Called on extension deactivation
   */
  dispose(): void {
    this.logger.info(
      `[SdkPermissionHandler] Disposing ${this.pendingRequests.size} pending permission requests`
    );

    // Clear all timeouts
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.resolve({
        approved: false,
        reason: 'Extension deactivated',
      });
    }

    this.pendingRequests.clear();
  }
}
