/**
 * SDK Permission Handler Service
 *
 * Bridges SDK's canUseTool callback to VS Code webview permission UI.
 * Implements the SDK permission interface with RPC-based user approval.
 *
 * Key Features:
 * - Auto-approve safe tools (Read, Grep, Glob, TodoWrite, Task, etc.) - no latency
 * - Emit RPC events for dangerous tools (Write, Edit, Bash, NotebookEdit)
 * - Prompt for network tools (WebFetch, WebSearch)
 * - Handle AskUserQuestion with specialized question UI
 * - 5-minute timeout with auto-deny (fail-safe)
 * - Input sanitization (redact API keys, tokens)
 * - Support parameter modification (user edits before approval)
 * - Unknown tools prompt user rather than silently denying
 */

import { injectable, inject } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  isBashToolInput,
  isEditToolInput,
  isGlobToolInput,
  isGrepToolInput,
  isNotebookEditToolInput,
  isReadToolInput,
  isWriteToolInput,
  isAskUserQuestionToolInput,
  MESSAGE_TYPES,
  type QuestionItem,
  type PermissionResponse,
  type PermissionRequest as SharedPermissionRequest,
  type PermissionRule,
  type ISdkPermissionHandler,
} from '@ptah-extension/shared';
import {
  ContentBlock,
  ToolUseBlock,
  isToolUseBlock,
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from './types/sdk-types/claude-sdk.types';

/**
 * Permission request payload for RPC event
 * Matches shared/permission.types.ts PermissionRequest interface
 */
interface PermissionRequest {
  /** Unique request ID - matches shared type's 'id' field */
  id: string;
  toolName: string;
  toolInput: Record<string, unknown>;
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
 * Using shared type from @ptah-extension/shared
 * See: libs/shared/src/lib/types/permission.types.ts
 */
// PermissionResponse is now imported from @ptah-extension/shared

/**
 * Pending request tracking
 */
interface PendingRequest {
  resolve: (response: PermissionResponse) => void;
  timer: NodeJS.Timeout;
}

/**
 * AskUserQuestion request payload
 * Sent to webview to prompt user with clarifying questions
 */
interface AskUserQuestionRequest {
  id: string;
  toolName: 'AskUserQuestion';
  questions: QuestionItem[];
  toolUseId?: string;
  timestamp: number;
  timeoutAt: number;
}

/**
 * AskUserQuestion response from webview
 * Contains user-selected answers
 */
interface AskUserQuestionResponse {
  id: string;
  answers: Record<string, string>;
}

/**
 * Pending question request tracking
 */
interface PendingQuestionRequest {
  resolve: (response: AskUserQuestionResponse | null) => void;
  timer: NodeJS.Timeout;
}

/**
 * Permission timeout in milliseconds (5 minutes)
 *
 * NOTE: Claude Code CLI blocks INDEFINITELY until user responds.
 * We use a 5-minute timeout as a fail-safe to prevent orphaned requests,
 * but this should be long enough for users to respond in normal usage.
 *
 * If you need truly indefinite blocking, consider removing the timeout
 * and relying on the abort signal from the SDK instead.
 */
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Safe tools that are auto-approved without user prompt
 * These are read-only operations that cannot modify system state
 */
const SAFE_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'TodoWrite',
  'ExitPlanMode',
  'EnterPlanMode',
  'KillShell',
  'TaskStop',
  'ListMcpResources',
  'ReadMcpResource',
  'TaskOutput',
  'TaskCreate',
  'TaskUpdate',
  'TaskList',
  'TaskGet',
  'Skill',
  'ToolSearch',
];

/**
 * Dangerous tools that require user approval
 * These can modify files, execute code, or perform destructive operations
 */
const DANGEROUS_TOOLS = ['Write', 'Edit', 'Bash', 'NotebookEdit'];

/**
 * Network tools that require user approval
 * These make external network requests
 */
const NETWORK_TOOLS = ['WebFetch', 'WebSearch'];

/**
 * Subagent tools that are auto-approved
 * The Task tool spawns subagents - auto-approve since the user initiated the session
 */
const SUBAGENT_TOOLS = ['Task'];

/**
 * Check if a tool name is an MCP tool (prefixed with "mcp__")
 * MCP tools should always require user approval as they can execute arbitrary code
 */
function isMcpTool(toolName: string): boolean {
  return toolName.startsWith('mcp__');
}

/**
 * WebviewManager interface (avoid circular import)
 */
interface WebviewManager {
  sendMessage<T = unknown>(
    viewType: string,
    type: string,
    payload: T
  ): Promise<void>;
}

/**
 * SDK Permission Handler
 *
 * Implements SDK canUseTool callback interface with webview coordination.
 *
 * TASK_2025_092: Refactored to inject WebviewManager directly and create
 * permission emitter internally. Previously this was done via SdkRpcHandlers
 * which was dead code (RPC methods never registered).
 */
@injectable()
export class SdkPermissionHandler implements ISdkPermissionHandler {
  /**
   * Pending permission requests awaiting user response
   * Maps requestId → PendingRequest
   */
  private pendingRequests = new Map<string, PendingRequest>();

  /**
   * Pending question requests awaiting user answers
   * Maps requestId → PendingQuestionRequest
   */
  private pendingQuestionRequests = new Map<string, PendingQuestionRequest>();

  /**
   * Stored "Always Allow" permission rules
   * Maps toolName → PermissionRule (auto-approve matching tools)
   * TASK_2025_FIX: Implements persistent "Always" button functionality
   */
  private permissionRules = new Map<string, PermissionRule>();

  /**
   * Pending request to tool mapping (for storing rules on response)
   * Maps requestId → { toolName, toolInput }
   */
  private pendingRequestContext = new Map<
    string,
    { toolName: string; toolInput: Record<string, unknown> }
  >();

  /**
   * Flag to track if emitter has been initialized
   */
  private emitterInitialized = false;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager
  ) {
    // Initialize permission emitter on construction
    this.initializePermissionEmitter();
  }

  /**
   * Initialize permission event emitter
   *
   * TASK_2025_092: Moved from dead-code SdkRpcHandlers to here.
   * Creates the emitter that sends permission requests to webview.
   */
  private initializePermissionEmitter(): void {
    if (this.emitterInitialized) {
      return;
    }

    this.logger.info(
      '[SdkPermissionHandler] Initializing permission event emitter...'
    );

    this.emitterInitialized = true;

    this.logger.info(
      '[SdkPermissionHandler] Permission event emitter initialized successfully'
    );
  }

  /**
   * Send permission request to webview
   * TASK_2025_092: Replaced external emitter pattern with direct webview messaging
   */
  private sendPermissionRequest(payload: PermissionRequest): void {
    this.logger.info(`[SdkPermissionHandler] Permission event emitter called`, {
      payloadId: payload.id,
      payloadToolName: payload.toolName,
      payloadToolUseId: payload.toolUseId,
    });

    // Send to webview - fire and forget (async but we don't await)
    this.webviewManager
      .sendMessage('ptah.main', MESSAGE_TYPES.PERMISSION_REQUEST, payload)
      .then(() => {
        this.logger.info(
          `[SdkPermissionHandler] Permission event sent to webview`,
          { requestId: payload.id }
        );
      })
      .catch((error) => {
        this.logger.error(
          `[SdkPermissionHandler] Failed to send permission event`,
          { error }
        );
      });
  }

  /**
   * Create canUseTool callback for SDK query
   *
   * Returns a function matching SDK's CanUseTool signature that:
   * 1. Auto-approves safe tools instantly
   * 2. Requests user approval for dangerous tools via RPC
   * 3. Requests user approval for MCP tools (can execute arbitrary code)
   * 4. Denies unknown tools (fail-safe)
   */
  createCallback(): CanUseTool {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      options: {
        signal: AbortSignal;
        suggestions?: PermissionUpdate[];
        blockedPath?: string;
        decisionReason?: string;
        toolUseID: string;
        agentID?: string;
      }
    ): Promise<PermissionResult> => {
      // CRITICAL: Log every canUseTool invocation for debugging
      this.logger.info(
        `[SdkPermissionHandler] canUseTool invoked: ${toolName}`,
        {
          toolName,
          toolUseID: options.toolUseID,
          inputKeys: input ? Object.keys(input) : [],
          isSafe: SAFE_TOOLS.includes(toolName),
          isDangerous: DANGEROUS_TOOLS.includes(toolName),
          isNetwork: NETWORK_TOOLS.includes(toolName),
          isSubagent: SUBAGENT_TOOLS.includes(toolName),
          isMcp: isMcpTool(toolName),
        }
      );

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

      // Handle AskUserQuestion tool - prompt user with clarifying questions
      // This must be checked BEFORE dangerous tools to use its specialized handler
      if (toolName === 'AskUserQuestion') {
        this.logger.info(
          `[SdkPermissionHandler] Handling AskUserQuestion tool request`
        );
        return await this.handleAskUserQuestion(input, options.toolUseID);
      }

      // Check if tool has a stored "Always Allow" rule
      const storedRule = this.permissionRules.get(toolName);
      if (storedRule && storedRule.action === 'allow') {
        this.logger.info(
          `[SdkPermissionHandler] Auto-approved via "Always Allow" rule: ${toolName}`,
          { ruleId: storedRule.id }
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
        return await this.requestUserPermission(
          toolName,
          input,
          options.toolUseID
        );
      }

      // Network tools require user approval (external requests)
      if (NETWORK_TOOLS.includes(toolName)) {
        this.logger.info(
          `[SdkPermissionHandler] Requesting user permission for network tool: ${toolName}`
        );
        return await this.requestUserPermission(
          toolName,
          input,
          options.toolUseID
        );
      }

      // Subagent tools are auto-approved (user initiated the session)
      if (SUBAGENT_TOOLS.includes(toolName)) {
        this.logger.debug(
          `[SdkPermissionHandler] Auto-approved subagent tool: ${toolName}`
        );
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        };
      }

      // MCP tools require user approval (can execute arbitrary code)
      if (isMcpTool(toolName)) {
        this.logger.info(
          `[SdkPermissionHandler] Requesting user permission for MCP tool: ${toolName}`
        );
        return await this.requestUserPermission(
          toolName,
          input,
          options.toolUseID
        );
      }

      // Unknown tools: prompt user for approval rather than silently denying
      // This handles any new tools added in future SDK versions
      this.logger.warn(
        `[SdkPermissionHandler] Unknown tool encountered, requesting user permission: ${toolName}`
      );
      return await this.requestUserPermission(
        toolName,
        input,
        options.toolUseID
      );
    };
  }

  /**
   * Request user permission via RPC event
   *
   * Emits permission request event to webview and awaits response.
   * Implements 30-second timeout with auto-deny.
   *
   * @param toolName - Name of the tool requiring permission
   * @param input - Tool input parameters
   * @param toolUseId - SDK's tool_use ID for correlation with ExecutionNode
   */
  private async requestUserPermission(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId?: string
  ): Promise<PermissionResult> {
    // TASK_2025_097: Timing diagnostics - capture start time for latency measurement
    const startTime = Date.now();

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
    // toolUseId is critical for correlating permission with ExecutionNode.toolCallId
    const request: PermissionRequest = {
      id: requestId,
      toolName,
      toolInput: sanitizedInput,
      toolUseId, // CRITICAL: Enables frontend to show permission inline with tool node
      timestamp: now,
      description,
      timeoutAt,
    };

    // Store request context for later rule creation (on always_allow response)
    this.pendingRequestContext.set(requestId, { toolName, toolInput: input });

    // Send SDK permission request event (webview will show permission prompt)
    // Uses MESSAGE_TYPES.PERMISSION_REQUEST which is shared by both SDK and MCP systems
    // TASK_2025_092: Now uses direct webview messaging instead of external emitter
    this.logger.info(
      `[SdkPermissionHandler] Sending permission request to webview`,
      {
        requestId,
        toolName,
        toolUseId,
        messageType: MESSAGE_TYPES.PERMISSION_REQUEST,
      }
    );

    this.sendPermissionRequest(request);

    // TASK_2025_097: Log emit latency for timing diagnostics
    this.logger.info(`[SdkPermissionHandler] Permission request emitted`, {
      requestId,
      toolName,
      toolUseId,
      emitLatency: Date.now() - startTime,
    });

    // Await user response with timeout
    const response = await this.awaitResponse(requestId, PERMISSION_TIMEOUT_MS);

    // TASK_2025_097: Log total latency for timing diagnostics (includes user decision time)
    this.logger.info(`[SdkPermissionHandler] Permission response received`, {
      requestId,
      totalLatency: Date.now() - startTime,
      decision: response?.decision ?? 'timeout',
    });

    if (!response) {
      // Timeout - auto-deny with interrupt (stops execution)
      this.logger.warn(
        `[SdkPermissionHandler] Permission request ${requestId} timed out after ${PERMISSION_TIMEOUT_MS}ms`,
        { decision: 'timeout', interrupt: true }
      );
      return {
        behavior: 'deny' as const,
        message: 'Permission request timed out',
        interrupt: true, // Stop execution on timeout
      };
    }

    // User approved (allow or always_allow)
    const isApproved =
      response.decision === 'allow' || response.decision === 'always_allow';
    if (isApproved) {
      this.logger.info(
        `[SdkPermissionHandler] Permission request ${requestId} approved for tool ${toolName}`,
        { decision: response.decision, interrupt: false }
      );
      return {
        behavior: 'allow' as const,
        updatedInput: response.modifiedInput ?? input,
      };
    }

    // User denied - distinguish between hard deny and deny-with-message
    // TASK_2025_102: deny_with_message allows Claude to continue execution with feedback
    if (response.decision === 'deny_with_message') {
      // Deny with message - provide feedback but don't interrupt execution
      this.logger.info(
        `[SdkPermissionHandler] Permission request ${requestId} denied with message for tool ${toolName}`,
        {
          decision: 'deny_with_message',
          reason: response.reason || 'User denied without explanation',
          interrupt: false,
        }
      );
      return {
        behavior: 'deny' as const,
        message: response.reason || 'User denied without explanation',
        interrupt: false, // Continue execution, just skip this tool
      };
    }

    // Hard deny - stop execution
    this.logger.info(
      `[SdkPermissionHandler] Permission request ${requestId} hard denied for tool ${toolName}`,
      {
        decision: 'deny',
        reason: response.reason || 'No reason provided',
        interrupt: true,
      }
    );
    return {
      behavior: 'deny' as const,
      message: response.reason || 'User denied permission',
      interrupt: true, // Stop execution
    };
  }

  /**
   * Handle permission response from webview
   *
   * Called by RPC handler when user approves/denies permission.
   * Supports three decisions: allow, deny, always_allow
   *
   * TASK_2025_FIX: Added always_allow handling to persist permission rules
   */
  handleResponse(requestId: string, response: PermissionResponse): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      this.logger.warn(
        `[SdkPermissionHandler] Received response for unknown request: ${requestId}`
      );
      return;
    }

    // Get request context for rule creation
    const requestContext = this.pendingRequestContext.get(requestId);

    // Handle "Always Allow" - store permission rule for future auto-approval
    if (response.decision === 'always_allow' && requestContext) {
      const rule: PermissionRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        pattern: requestContext.toolName, // Match by tool name
        toolName: requestContext.toolName,
        action: 'allow',
        createdAt: Date.now(),
        description: `Auto-created from "Always Allow" for ${requestContext.toolName}`,
      };

      this.permissionRules.set(requestContext.toolName, rule);

      this.logger.info(
        `[SdkPermissionHandler] Created "Always Allow" rule for tool: ${requestContext.toolName}`,
        { ruleId: rule.id }
      );
    }

    // Clean up request context
    this.pendingRequestContext.delete(requestId);

    // Clear timeout and resolve pending promise
    clearTimeout(pending.timer);
    this.pendingRequests.delete(requestId);
    pending.resolve(response);

    const isApproved =
      response.decision === 'allow' || response.decision === 'always_allow';
    this.logger.debug(
      `[SdkPermissionHandler] Handled response for request ${requestId}: ${
        isApproved ? 'approved' : 'denied'
      } (decision: ${response.decision})`
    );
  }

  /**
   * Handle AskUserQuestion tool - prompt user with clarifying questions
   *
   * Unlike permission requests (approve/deny), AskUserQuestion expects
   * the user to SELECT answers from provided options.
   *
   * @param input - AskUserQuestionToolInput containing questions array
   * @param toolUseId - SDK's tool_use ID for correlation
   * @returns PermissionResult with updatedInput.answers populated
   */
  private async handleAskUserQuestion(
    input: Record<string, unknown>,
    toolUseId: string
  ): Promise<PermissionResult> {
    // Validate input using type guard
    if (!isAskUserQuestionToolInput(input)) {
      this.logger.warn('[SdkPermissionHandler] Invalid AskUserQuestion input', {
        input,
      });
      return {
        behavior: 'deny' as const,
        message: 'Invalid AskUserQuestion input format',
      };
    }

    const requestId = this.generateRequestId();
    const now = Date.now();
    const timeoutAt = now + PERMISSION_TIMEOUT_MS;

    // Build request payload
    const request: AskUserQuestionRequest = {
      id: requestId,
      toolName: 'AskUserQuestion',
      questions: input.questions,
      toolUseId,
      timestamp: now,
      timeoutAt,
    };

    this.logger.info('[SdkPermissionHandler] Sending AskUserQuestion request', {
      requestId,
      questionCount: input.questions.length,
      toolUseId,
    });

    // Send to webview
    this.webviewManager
      .sendMessage(
        'ptah.main',
        MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
        request
      )
      .then(() => {
        this.logger.info(
          `[SdkPermissionHandler] AskUserQuestion request sent to webview`,
          { requestId }
        );
      })
      .catch((error) => {
        this.logger.error(
          `[SdkPermissionHandler] Failed to send AskUserQuestion request`,
          { error }
        );
      });

    // Await user response with timeout
    const response = await this.awaitQuestionResponse(
      requestId,
      PERMISSION_TIMEOUT_MS
    );

    if (!response) {
      this.logger.warn('[SdkPermissionHandler] AskUserQuestion timed out', {
        requestId,
      });
      return {
        behavior: 'deny' as const,
        message: 'Question request timed out',
      };
    }

    this.logger.info('[SdkPermissionHandler] AskUserQuestion answered', {
      requestId,
      answerCount: Object.keys(response.answers).length,
    });

    // Return with answers populated in updatedInput
    return {
      behavior: 'allow' as const,
      updatedInput: {
        ...input,
        answers: response.answers,
      },
    };
  }

  /**
   * Await question response from webview
   *
   * Returns null on timeout, AskUserQuestionResponse on user action.
   */
  private async awaitQuestionResponse(
    requestId: string,
    timeoutMs: number
  ): Promise<AskUserQuestionResponse | null> {
    return new Promise<AskUserQuestionResponse | null>((resolve) => {
      // Set timeout
      const timer = setTimeout(() => {
        this.pendingQuestionRequests.delete(requestId);
        resolve(null); // Timeout - return null
      }, timeoutMs);

      // Store pending request
      this.pendingQuestionRequests.set(requestId, {
        resolve,
        timer,
      });
    });
  }

  /**
   * Handle question response from webview
   *
   * Called when user submits answers to AskUserQuestion prompts.
   */
  handleQuestionResponse(response: AskUserQuestionResponse): void {
    const pending = this.pendingQuestionRequests.get(response.id);
    if (!pending) {
      this.logger.warn(
        `[SdkPermissionHandler] Received question response for unknown request: ${response.id}`
      );
      return;
    }

    // Clear timeout and resolve pending promise
    clearTimeout(pending.timer);
    this.pendingQuestionRequests.delete(response.id);
    pending.resolve(response);

    this.logger.debug(
      `[SdkPermissionHandler] Handled question response for request ${response.id}`
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
  private sanitizeToolInput(
    input: Record<string, unknown>
  ): Record<string, unknown> {
    if (!input || typeof input !== 'object') {
      return input;
    }

    const sanitized = { ...input };

    // Sanitize environment variables
    const env = sanitized['env'];
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      const envRecord = env as Record<string, unknown>;
      sanitized['env'] = Object.keys(envRecord).reduce((acc, key) => {
        // Redact keys that likely contain secrets
        const isSecret =
          key.toUpperCase().includes('KEY') ||
          key.toUpperCase().includes('TOKEN') ||
          key.toUpperCase().includes('SECRET') ||
          key.toUpperCase().includes('PASSWORD') ||
          key.toUpperCase().includes('API');

        acc[key] = isSecret ? '***REDACTED***' : envRecord[key];
        return acc;
      }, {} as Record<string, unknown>);
    }

    // Sanitize command strings that might contain secrets
    const command = sanitized['command'];
    if (command && typeof command === 'string') {
      // Simple heuristic: if command contains key-like patterns, warn user
      if (
        command.includes('KEY=') ||
        command.includes('TOKEN=') ||
        command.includes('PASSWORD=')
      ) {
        sanitized['_securityWarning'] =
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
  private generateDescription(
    toolName: string,
    input: Record<string, unknown>
  ): string {
    // Handle MCP tools (format: mcp__server-name__tool-name)
    if (isMcpTool(toolName)) {
      const parts = toolName.split('__');
      if (parts.length >= 3) {
        const serverName = parts[1];
        const toolNameOnly = parts.slice(2).join('__');
        return `Execute MCP tool "${toolNameOnly}" from server "${serverName}"`;
      }
      return `Execute MCP tool: ${toolName}`;
    }

    switch (toolName) {
      case 'Bash': {
        if (isBashToolInput(input)) {
          const truncated =
            input.command.length > 100
              ? `${input.command.substring(0, 100)}...`
              : input.command;
          return `Execute bash command: ${truncated}`;
        }
        return 'Execute a bash command';
      }

      case 'Write': {
        if (isWriteToolInput(input)) {
          return `Write to file: ${input.file_path}`;
        }
        return 'Write to a file';
      }

      case 'Edit': {
        if (isEditToolInput(input)) {
          return `Edit file: ${input.file_path}`;
        }
        return 'Edit a file';
      }

      case 'NotebookEdit': {
        if (isNotebookEditToolInput(input)) {
          return `Edit notebook: ${input.notebook_path}`;
        }
        return 'Edit a Jupyter notebook';
      }

      case 'Read': {
        if (isReadToolInput(input)) {
          return `Read file: ${input.file_path}`;
        }
        return 'Read a file';
      }

      case 'Grep': {
        if (isGrepToolInput(input)) {
          return `Search for pattern: ${input.pattern}`;
        }
        return 'Search file contents';
      }

      case 'Glob': {
        if (isGlobToolInput(input)) {
          return `Find files matching: ${input.pattern}`;
        }
        return 'Find files';
      }

      case 'WebFetch': {
        const url = input['url'];
        if (typeof url === 'string') {
          const truncated =
            url.length > 80 ? `${url.substring(0, 80)}...` : url;
          return `Fetch web content from: ${truncated}`;
        }
        return 'Fetch content from a URL';
      }

      case 'WebSearch': {
        const query = input['query'];
        if (typeof query === 'string') {
          const truncated =
            query.length > 80 ? `${query.substring(0, 80)}...` : query;
          return `Web search: ${truncated}`;
        }
        return 'Perform a web search';
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
      `[SdkPermissionHandler] Disposing ${this.pendingRequests.size} pending permission requests, ${this.pendingQuestionRequests.size} pending question requests, and ${this.permissionRules.size} permission rules`
    );

    // Clear all permission request timeouts
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.resolve({
        id: requestId,
        decision: 'deny',
        reason: 'Extension deactivated',
      });
    }
    this.pendingRequests.clear();

    // Clear request context map
    this.pendingRequestContext.clear();

    // Clear all question request timeouts
    for (const [requestId, pending] of this.pendingQuestionRequests.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(null); // Resolve with null on dispose
    }
    this.pendingQuestionRequests.clear();

    // Clear permission rules (session-scoped - reset on extension deactivation)
    this.permissionRules.clear();
  }

  /**
   * Cleanup pending permission requests for a specific session
   * Called when a session is aborted to prevent unhandled promise rejections
   *
   * TASK_2025_102: Implements session abort cleanup requirement
   * - Resolves all pending promises to prevent "Operation aborted" unhandled rejections
   * - Similar to dispose() but for session abort scenario
   *
   * @param sessionId - The session ID to cleanup (optional, cleanup all if not provided)
   */
  cleanupPendingPermissions(sessionId?: string): void {
    this.logger.info(`[SdkPermissionHandler] Cleaning up pending permissions`, {
      sessionId: sessionId ?? 'all',
      pendingPermissionCount: this.pendingRequests.size,
      pendingQuestionCount: this.pendingQuestionRequests.size,
    });

    // Resolve all pending permission requests with deny response
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      // Resolve with deny to unblock the waiting promise
      pending.resolve({
        id: requestId,
        decision: 'deny',
        reason: 'Session aborted',
      });
    }
    this.pendingRequests.clear();

    // Also clear pending question requests
    for (const [, pending] of this.pendingQuestionRequests.entries()) {
      clearTimeout(pending.timer);
      pending.resolve(null); // Questions resolve to null on abort
    }
    this.pendingQuestionRequests.clear();

    // Clear request context map
    this.pendingRequestContext.clear();

    this.logger.info(
      `[SdkPermissionHandler] Pending permissions cleanup complete`,
      { sessionId: sessionId ?? 'all' }
    );
  }

  /**
   * Get all current permission rules
   * Useful for debugging and UI display
   */
  getPermissionRules(): PermissionRule[] {
    return Array.from(this.permissionRules.values());
  }

  /**
   * Clear a specific permission rule
   */
  clearPermissionRule(toolName: string): boolean {
    const deleted = this.permissionRules.delete(toolName);
    if (deleted) {
      this.logger.info(
        `[SdkPermissionHandler] Cleared permission rule for tool: ${toolName}`
      );
    }
    return deleted;
  }

  /**
   * Clear all permission rules
   */
  clearAllPermissionRules(): void {
    const count = this.permissionRules.size;
    this.permissionRules.clear();
    this.logger.info(
      `[SdkPermissionHandler] Cleared all ${count} permission rules`
    );
  }
}
