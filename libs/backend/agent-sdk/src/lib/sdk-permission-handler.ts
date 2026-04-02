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
 * - Blocks indefinitely until user responds or session is aborted via AbortSignal
 * - Input sanitization (redact API keys, tokens)
 * - Support parameter modification (user edits before approval)
 * - Unknown tools prompt user rather than silently denying
 *
 * TASK_2025_215: Removed 5-minute setTimeout-based timeout. Permission and question
 * requests now block indefinitely until the user responds (matching Claude Code CLI
 * behavior). Cancellation is handled via the SDK's AbortSignal, which fires on
 * session abort or extension deactivation.
 */

import { injectable, inject, container } from 'tsyringe';
import {
  Logger,
  TOKENS,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import {
  isBashToolInput,
  isEditToolInput,
  isGlobToolInput,
  isGrepToolInput,
  isNotebookEditToolInput,
  isReadToolInput,
  isWriteToolInput,
  isAskUserQuestionToolInput,
  isExitPlanModeToolInput,
  MESSAGE_TYPES,
  UNKNOWN_AGENT_TOOL_CALL_ID,
  type AgentPermissionRequest,
  type QuestionItem,
  type PermissionRequest,
  type PermissionResponse,
  type PermissionRule,
  type ISdkPermissionHandler,
  type PermissionLevel,
} from '@ptah-extension/shared';
import {
  CanUseTool,
  PermissionResult,
  PermissionUpdate,
} from './types/sdk-types/claude-sdk.types';

// PermissionRequest and PermissionResponse are imported from @ptah-extension/shared
// See: libs/shared/src/lib/types/permission.types.ts

/**
 * Pending request tracking
 */
interface PendingRequest {
  resolve: (response: PermissionResponse) => void;
  /** Session ID this request belongs to (for session-scoped cleanup) */
  sessionId?: string;
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
  /** Session ID this question belongs to (for UI routing to correct tab) */
  sessionId?: string;
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
  /** Session ID this request belongs to (for session-scoped cleanup) */
  sessionId?: string;
}

/**
 * Safe tools that are auto-approved without user prompt
 * These are read-only operations that cannot modify system state
 */
const SAFE_TOOLS = [
  'Read',
  'Grep',
  'Glob',
  'TodoWrite',
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
 * File editing tools that are auto-approved in 'auto-edit' mode
 * and for background sub-agents (matching SDK acceptEdits semantics)
 */
const AUTO_EDIT_TOOLS = ['Write', 'Edit', 'NotebookEdit'];

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
    payload: T,
  ): Promise<boolean>;
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
   * Current permission level controlling auto-approval behavior.
   * - 'ask': Prompt for all dangerous/network/MCP tools (default)
   * - 'auto-edit': Auto-approve Write/Edit/NotebookEdit, prompt for Bash/network/MCP
   * - 'yolo': Auto-approve ALL tools unconditionally
   */
  private _permissionLevel: PermissionLevel = 'ask';

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

  /**
   * WebviewManager is optional: present in VS Code for permission prompt UI,
   * absent in Electron where WebviewManager is registered AFTER SDK services resolve.
   * Resolved lazily via container.isRegistered() to avoid DI crash in Electron.
   *
   * When absent, permission-related webview messages (permission requests,
   * plan mode changes, session cleanup notifications) are silently skipped.
   * The permission logic itself still works — tools get auto-approved or denied
   * based on permission level — but there is no interactive UI prompt.
   *
   * Resolved lazily via getter because in Electron the TOKENS.WEBVIEW_MANAGER
   * is registered AFTER SDK services are constructed (it depends on IPC bridge
   * initialization which happens in main.ts Phase 4.4).
   */
  private _webviewManager: WebviewManager | undefined;
  private _webviewManagerResolved = false;

  private get webviewManager(): WebviewManager | undefined {
    if (!this._webviewManagerResolved) {
      this._webviewManagerResolved = true;
      this._webviewManager = container.isRegistered(TOKENS.WEBVIEW_MANAGER)
        ? container.resolve<WebviewManager>(TOKENS.WEBVIEW_MANAGER)
        : undefined;
    }
    return this._webviewManager;
  }

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
  ) {
    // Initialize permission emitter on construction
    this.initializePermissionEmitter();
  }

  /**
   * Set the permission level for auto-approval behavior.
   * Called when the user toggles autopilot settings.
   *
   * @param level - The permission level to set
   */
  setPermissionLevel(level: PermissionLevel): void {
    const previous = this._permissionLevel;
    this._permissionLevel = level;
    this.logger.info(
      `[SdkPermissionHandler] Permission level changed: ${previous} → ${level}`,
    );
  }

  /**
   * Get the current permission level
   */
  getPermissionLevel(): PermissionLevel {
    return this._permissionLevel;
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
      '[SdkPermissionHandler] Initializing permission event emitter...',
    );

    this.emitterInitialized = true;

    this.logger.info(
      '[SdkPermissionHandler] Permission event emitter initialized successfully',
    );
  }

  /**
   * Send permission request to webview
   * TASK_2025_092: Replaced external emitter pattern with direct webview messaging
   * TASK_2025_255: When cliAgentResolver returns an agentId, routes to agent monitor panel
   */
  private sendPermissionRequest(
    payload: PermissionRequest,
    cliAgentResolver?: () => string | undefined,
  ): void {
    // TASK_2025_255: Check if this is a CLI agent permission request.
    // When the resolver returns an agentId, route to the agent monitor panel
    // (same path as Copilot SDK permissions) instead of the chat UI badge.
    const cliAgentId = cliAgentResolver?.();
    if (cliAgentId) {
      this.sendCliAgentPermissionRequest(payload, cliAgentId);
      return;
    }

    this.logger.info(`[SdkPermissionHandler] Permission event emitter called`, {
      payloadId: payload.id,
      payloadToolName: payload.toolName,
      payloadToolUseId: payload.toolUseId,
      payloadAgentToolCallId: payload.agentToolCallId,
    });

    // Send to webview - fire and forget (async but we don't await)
    // In Electron, webviewManager may be undefined — auto-approve to avoid permanent hang
    if (!this.webviewManager) {
      this.logger.warn(
        `[SdkPermissionHandler] No WebviewManager available (Electron) — auto-resolving permission request`,
        { requestId: payload.id, toolName: payload.toolName },
      );
      const pending = this.pendingRequests.get(payload.id);
      if (pending) {
        this.pendingRequests.delete(payload.id);
        this.pendingRequestContext.delete(payload.id);
        pending.resolve({
          id: payload.id,
          decision: 'allow',
          reason: 'Auto-approved: no webview UI available (Electron)',
        });
      }
      return;
    }

    this.webviewManager
      .sendMessage('ptah.main', MESSAGE_TYPES.PERMISSION_REQUEST, payload)
      .then((delivered) => {
        if (delivered) {
          this.logger.info(
            `[SdkPermissionHandler] Permission event sent to webview`,
            { requestId: payload.id, sessionId: payload.sessionId },
          );
        } else {
          // CRITICAL: sendMessage returns false when the webview isn't found.
          // Without this check, the pending request hangs forever — the agent
          // blocks indefinitely waiting for a response that will never come.
          this.logger.warn(
            `[SdkPermissionHandler] Permission event NOT delivered — webview "ptah.main" not found. ` +
              `Denying to prevent permanent hang.`,
            {
              requestId: payload.id,
              toolName: payload.toolName,
              sessionId: payload.sessionId,
            },
          );
          const pending = this.pendingRequests.get(payload.id);
          if (pending) {
            this.pendingRequests.delete(payload.id);
            this.pendingRequestContext.delete(payload.id);
            pending.resolve({
              id: payload.id,
              decision: 'deny',
              reason:
                'Permission request could not be delivered to UI (webview not available)',
            });
          }
        }
      })
      .catch((error) => {
        this.logger.error(
          `[SdkPermissionHandler] Failed to send permission event`,
          { error },
        );
        // If send fails, resolve pending request to avoid permanent hang
        // (TASK_2025_215: no timeout fallback anymore)
        const pending = this.pendingRequests.get(payload.id);
        if (pending) {
          this.pendingRequests.delete(payload.id);
          this.pendingRequestContext.delete(payload.id);
          pending.resolve({
            id: payload.id,
            decision: 'deny',
            reason: 'Failed to send permission request to UI',
          });
        }
      });
  }

  /**
   * Send CLI agent permission request to agent monitor panel.
   *
   * Converts PermissionRequest to AgentPermissionRequest and broadcasts via
   * AGENT_MONITOR_PERMISSION_REQUEST (same message type as Copilot permissions).
   * This routes CLI agent permissions through the agent monitor panel instead
   * of the broken chat UI badge.
   *
   * TASK_2025_255: Unified CLI agent permission channel
   */
  private sendCliAgentPermissionRequest(
    payload: PermissionRequest,
    agentId: string,
  ): void {
    if (!this.webviewManager) {
      // Electron fallback: auto-approve (same as main agent path)
      this.logger.warn(
        `[SdkPermissionHandler] No WebviewManager available (Electron) — auto-resolving CLI agent permission`,
        { requestId: payload.id, toolName: payload.toolName, agentId },
      );
      const pending = this.pendingRequests.get(payload.id);
      if (pending) {
        this.pendingRequests.delete(payload.id);
        this.pendingRequestContext.delete(payload.id);
        pending.resolve({
          id: payload.id,
          decision: 'allow',
          reason: 'Auto-approved: no webview UI available (Electron)',
        });
      }
      return;
    }

    // Convert PermissionRequest -> AgentPermissionRequest
    const agentPermissionRequest: AgentPermissionRequest = {
      requestId: payload.id,
      agentId,
      kind: 'tool',
      toolName: payload.toolName,
      toolArgs: JSON.stringify(payload.toolInput),
      description: payload.description,
      timestamp: payload.timestamp,
      timeoutAt: payload.timeoutAt,
    };

    this.webviewManager
      .sendMessage(
        'ptah.main',
        MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_REQUEST,
        agentPermissionRequest,
      )
      .then((delivered) => {
        if (delivered) {
          this.logger.info(
            `[SdkPermissionHandler] CLI agent permission sent to agent monitor panel`,
            { requestId: payload.id, agentId, toolName: payload.toolName },
          );
        } else {
          // Deny on delivery failure (same safety as main agent path)
          this.logger.warn(
            `[SdkPermissionHandler] CLI agent permission NOT delivered — denying to prevent permanent hang`,
            { requestId: payload.id, agentId, toolName: payload.toolName },
          );
          const pending = this.pendingRequests.get(payload.id);
          if (pending) {
            this.pendingRequests.delete(payload.id);
            this.pendingRequestContext.delete(payload.id);
            pending.resolve({
              id: payload.id,
              decision: 'deny',
              reason:
                'Permission request could not be delivered to UI (webview not available)',
            });
          }
        }
      })
      .catch((error) => {
        this.logger.error(
          '[SdkPermissionHandler] Failed to send CLI agent permission',
          { error, requestId: payload.id, agentId },
        );
        const pending = this.pendingRequests.get(payload.id);
        if (pending) {
          this.pendingRequests.delete(payload.id);
          this.pendingRequestContext.delete(payload.id);
          pending.resolve({
            id: payload.id,
            decision: 'deny',
            reason: 'Failed to send permission request to UI',
          });
        }
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
  createCallback(
    sessionId?: string,
    cliAgentResolver?: () => string | undefined,
  ): CanUseTool {
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
      },
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
        },
      );

      // Auto-approve safe tools (no user prompt needed)
      if (SAFE_TOOLS.includes(toolName)) {
        // Detect agent entering plan mode
        if (toolName === 'EnterPlanMode') {
          this.logger.info(`[SdkPermissionHandler] Agent entered plan mode`);
          this.webviewManager
            ?.sendMessage('ptah.main', MESSAGE_TYPES.PLAN_MODE_CHANGED, {
              active: true,
            })
            .catch((error) => {
              this.logger.error(
                `[SdkPermissionHandler] Failed to send plan mode changed event`,
                { error },
              );
            });
        }

        this.logger.debug(
          `[SdkPermissionHandler] Auto-approved safe tool: ${toolName}`,
        );
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        };
      }

      // Handle AskUserQuestion tool FIRST — it must NEVER be auto-approved.
      // AskUserQuestion is a user interaction tool that always requires a real response,
      // regardless of permission level (including YOLO mode). Auto-approving it would
      // cause the agent to proceed without actual user input.
      if (toolName === 'AskUserQuestion') {
        this.logger.info(
          `[SdkPermissionHandler] Handling AskUserQuestion tool request (bypasses all auto-approval)`,
        );
        return await this.handleAskUserQuestion(
          input,
          options.toolUseID,
          sessionId,
          options.signal,
        );
      }

      // Handle ExitPlanMode — NEVER auto-approved (like AskUserQuestion).
      // ExitPlanMode clears the conversation context and starts a fresh session
      // with the plan. The user MUST review and approve the plan before the SDK
      // performs the context clear. This prevents data loss from in-flight tool
      // executions (e.g. Write tool interrupted before completion).
      if (toolName === 'ExitPlanMode') {
        this.logger.info(
          `[SdkPermissionHandler] Handling ExitPlanMode tool request (bypasses all auto-approval)`,
        );
        return await this.handleExitPlanMode(
          input,
          options.toolUseID,
          sessionId,
          options.signal,
        );
      }

      // Permission-level-aware auto-approval
      // 'yolo' mode: auto-approve ALL tools unconditionally
      if (this._permissionLevel === 'yolo') {
        this.logger.info(
          `[SdkPermissionHandler] YOLO mode: auto-approved tool: ${toolName}`,
        );
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        };
      }

      // 'auto-edit' mode: auto-approve file editing tools (Write, Edit, NotebookEdit)
      // Bash is NOT auto-approved — it's code execution, not file editing
      if (this._permissionLevel === 'auto-edit') {
        if (AUTO_EDIT_TOOLS.includes(toolName)) {
          this.logger.info(
            `[SdkPermissionHandler] Auto-edit mode: auto-approved file tool: ${toolName}`,
          );
          return {
            behavior: 'allow' as const,
            updatedInput: input,
          };
        }
      }

      // Background agent auto-approval: auto-approve Write/Edit/NotebookEdit for
      // background sub-agents. Background agents can't show interactive permission
      // prompts (the main turn has completed), so file operations are auto-approved
      // matching the SDK's acceptEdits semantics. Bash still requires user approval
      // and will surface a permission request to the chat UI.
      if (options.agentID) {
        const bgToolCallId = this.subagentRegistry.getToolCallIdByAgentId(
          options.agentID,
        );
        if (bgToolCallId) {
          const bgRecord = this.subagentRegistry.get(bgToolCallId);
          if (bgRecord?.isBackground) {
            if (AUTO_EDIT_TOOLS.includes(toolName)) {
              this.logger.info(
                `[SdkPermissionHandler] Background agent auto-approved: ${toolName}`,
                {
                  agentID: options.agentID,
                  toolCallId: bgToolCallId,
                  agentType: bgRecord.agentType,
                },
              );
              return {
                behavior: 'allow' as const,
                updatedInput: input,
              };
            }
          }
        }
      }

      // Check if tool has a stored "Always Allow" rule
      const storedRule = this.permissionRules.get(toolName);
      if (storedRule && storedRule.action === 'allow') {
        this.logger.info(
          `[SdkPermissionHandler] Auto-approved via "Always Allow" rule: ${toolName}`,
          { ruleId: storedRule.id },
        );
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        };
      }

      // Dangerous tools require user approval
      if (DANGEROUS_TOOLS.includes(toolName)) {
        this.logger.info(
          `[SdkPermissionHandler] Requesting user permission for dangerous tool: ${toolName}`,
        );
        return await this.requestUserPermission(
          toolName,
          input,
          options.toolUseID,
          sessionId,
          options.agentID,
          options.signal,
          cliAgentResolver,
        );
      }

      // Network tools require user approval (external requests)
      if (NETWORK_TOOLS.includes(toolName)) {
        this.logger.info(
          `[SdkPermissionHandler] Requesting user permission for network tool: ${toolName}`,
        );
        return await this.requestUserPermission(
          toolName,
          input,
          options.toolUseID,
          sessionId,
          options.agentID,
          options.signal,
          cliAgentResolver,
        );
      }

      // Subagent tools are auto-approved (user initiated the session)
      if (SUBAGENT_TOOLS.includes(toolName)) {
        this.logger.debug(
          `[SdkPermissionHandler] Auto-approved subagent tool: ${toolName}`,
        );
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        };
      }

      // MCP tools require user approval (can execute arbitrary code)
      if (isMcpTool(toolName)) {
        this.logger.info(
          `[SdkPermissionHandler] Requesting user permission for MCP tool: ${toolName}`,
        );
        return await this.requestUserPermission(
          toolName,
          input,
          options.toolUseID,
          sessionId,
          options.agentID,
          options.signal,
          cliAgentResolver,
        );
      }

      // Unknown tools: prompt user for approval rather than silently denying
      // This handles any new tools added in future SDK versions
      this.logger.warn(
        `[SdkPermissionHandler] Unknown tool encountered, requesting user permission: ${toolName}`,
      );
      return await this.requestUserPermission(
        toolName,
        input,
        options.toolUseID,
        sessionId,
        options.agentID,
        options.signal,
        cliAgentResolver,
      );
    };
  }

  /**
   * Request user permission via RPC event
   *
   * Emits permission request event to webview and awaits response.
   * Blocks indefinitely until user responds or the AbortSignal fires.
   *
   * @param toolName - Name of the tool requiring permission
   * @param input - Tool input parameters
   * @param toolUseId - SDK's tool_use ID for correlation with ExecutionNode
   * @param sessionId - Session ID for routing to correct tab
   * @param agentID - Sub-agent's short hex ID from SDK (if tool runs inside a subagent)
   * @param signal - AbortSignal from SDK for cancellation on session abort
   * @param cliAgentResolver - Optional resolver for CLI agent ID; routes to agent monitor panel when defined
   */
  private async requestUserPermission(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId?: string,
    sessionId?: string,
    agentID?: string,
    signal?: AbortSignal,
    cliAgentResolver?: () => string | undefined,
  ): Promise<PermissionResult> {
    // TASK_2025_097: Timing diagnostics - capture start time for latency measurement
    const startTime = Date.now();

    // Generate unique request ID
    const requestId = this.generateRequestId();

    // Sanitize tool input before sending to UI
    const sanitizedInput = this.sanitizeToolInput(input);

    // TASK_2025_215: No timeout — set timeoutAt to 0 to signal "no timeout" to frontend
    const timeoutAt = 0;

    // Generate human-readable description based on tool type
    const description = this.generateDescription(toolName, sanitizedInput);

    // TASK_2025_213 (Bug 2): Resolve the parent agent's toolCallId from
    // the sub-agent's agentID. The SDK's canUseTool provides agentID (short hex
    // like "a329b32") when the tool runs inside a subagent. The frontend needs
    // the Task tool's toolCallId to identify the agent ExecutionNode.
    let agentToolCallId: string | undefined;
    if (agentID) {
      const resolvedToolCallId =
        this.subagentRegistry.getToolCallIdByAgentId(agentID);
      agentToolCallId = resolvedToolCallId ?? UNKNOWN_AGENT_TOOL_CALL_ID;
      this.logger.info(
        `[SdkPermissionHandler] Resolved agentID to agentToolCallId`,
        {
          agentID,
          agentToolCallId,
          resolved: resolvedToolCallId !== null,
        },
      );
    }

    // Emit permission request event
    // Note: All fields match shared/permission.types.ts PermissionRequest interface
    // toolUseId is critical for correlating permission with ExecutionNode.toolCallId
    const request: PermissionRequest = {
      id: requestId,
      toolName,
      toolInput: sanitizedInput,
      toolUseId, // The denied tool's own tool_use_id
      agentToolCallId, // TASK_2025_213: The parent agent's toolCallId for frontend matching
      timestamp: startTime,
      description,
      timeoutAt,
      sessionId, // TASK_2025_187: Route permission UI to correct session tab
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
        agentToolCallId,
        messageType: MESSAGE_TYPES.PERMISSION_REQUEST,
      },
    );

    this.sendPermissionRequest(request, cliAgentResolver);

    // TASK_2025_097: Log emit latency for timing diagnostics
    this.logger.info(`[SdkPermissionHandler] Permission request emitted`, {
      requestId,
      toolName,
      toolUseId,
      emitLatency: Date.now() - startTime,
    });

    // Await user response indefinitely (pass signal for cancellation, sessionId for cleanup)
    const response = await this.awaitResponse(requestId, signal, sessionId);

    // TASK_2025_097: Log total latency for timing diagnostics (includes user decision time)
    this.logger.info(`[SdkPermissionHandler] Permission response received`, {
      requestId,
      totalLatency: Date.now() - startTime,
      decision: response?.decision ?? 'aborted',
    });

    if (!response) {
      // Aborted (signal fired or session cleanup) - deny with interrupt
      this.logger.warn(
        `[SdkPermissionHandler] Permission request ${requestId} aborted`,
        { decision: 'aborted', interrupt: true },
      );
      return {
        behavior: 'deny' as const,
        message: 'Permission request was aborted',
        interrupt: true,
      };
    }

    // User approved (allow or always_allow)
    const isApproved =
      response.decision === 'allow' || response.decision === 'always_allow';
    if (isApproved) {
      this.logger.info(
        `[SdkPermissionHandler] Permission request ${requestId} approved for tool ${toolName}`,
        { decision: response.decision, interrupt: false },
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
      const userReason = response.reason || 'No explanation given';
      this.logger.info(
        `[SdkPermissionHandler] Permission request ${requestId} denied with message for tool ${toolName}`,
        {
          decision: 'deny_with_message',
          reason: userReason,
          interrupt: false,
        },
      );
      // Prefix with clear context so the model understands this is a deliberate
      // user decision, not a transient tool error. Without this prefix the model
      // may retry the same tool or ignore the feedback entirely.
      return {
        behavior: 'deny' as const,
        message: `Permission denied by user for tool "${toolName}". The user reviewed this tool call and explicitly chose to deny it. User's message: "${userReason}". You MUST respect this decision — do NOT retry the same tool call. Adjust your approach based on the user's feedback.`,
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
      },
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
        `[SdkPermissionHandler] Received response for unknown request: ${requestId}`,
      );
      return;
    }

    // Get request context for rule creation
    const requestContext = this.pendingRequestContext.get(requestId);

    // Handle "Always Allow" - store permission rule for future auto-approval
    // ExitPlanMode and AskUserQuestion must NEVER be auto-approved — skip rule
    // creation and sibling auto-resolution for these tools.
    const neverAutoApproveTools = ['ExitPlanMode', 'AskUserQuestion'];
    if (
      response.decision === 'always_allow' &&
      requestContext &&
      !neverAutoApproveTools.includes(requestContext.toolName)
    ) {
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
        { ruleId: rule.id },
      );

      // Auto-resolve other pending requests for the same tool
      const toolName = requestContext.toolName;
      const autoResolvedIds: string[] = [];

      for (const [
        pendingId,
        pendingCtx,
      ] of this.pendingRequestContext.entries()) {
        if (pendingId === requestId) continue; // Skip the current request
        if (pendingCtx.toolName !== toolName) continue;

        const pendingReq = this.pendingRequests.get(pendingId);
        if (!pendingReq) continue;

        // Auto-resolve: remove from maps, resolve promise
        this.pendingRequests.delete(pendingId);
        this.pendingRequestContext.delete(pendingId);
        pendingReq.resolve({ id: pendingId, decision: 'allow' });
        autoResolvedIds.push(pendingId);

        // Notify frontend to dismiss the UI card
        this.webviewManager
          ?.sendMessage('ptah.main', MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED, {
            id: pendingId,
            toolName,
          })
          .catch((error) => {
            this.logger.error(
              `[SdkPermissionHandler] Failed to send auto-resolved event`,
              { error, pendingId },
            );
          });
      }

      if (autoResolvedIds.length > 0) {
        this.logger.info(
          `[SdkPermissionHandler] Auto-resolved ${autoResolvedIds.length} sibling requests for tool: ${toolName}`,
          { autoResolvedIds },
        );
      }
    }

    // Clean up request context
    this.pendingRequestContext.delete(requestId);

    // Resolve pending promise
    this.pendingRequests.delete(requestId);
    pending.resolve(response);

    const isApproved =
      response.decision === 'allow' || response.decision === 'always_allow';
    this.logger.debug(
      `[SdkPermissionHandler] Handled response for request ${requestId}: ${
        isApproved ? 'approved' : 'denied'
      } (decision: ${response.decision})`,
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
    toolUseId: string,
    sessionId?: string,
    signal?: AbortSignal,
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

    // Build request payload
    // TASK_2025_215: timeoutAt=0 signals "no timeout" to frontend
    const request: AskUserQuestionRequest = {
      id: requestId,
      toolName: 'AskUserQuestion',
      questions: input.questions,
      toolUseId,
      timestamp: now,
      timeoutAt: 0,
      sessionId, // TASK_2025_187: Route question UI to correct session tab
    };

    this.logger.info('[SdkPermissionHandler] Sending AskUserQuestion request', {
      requestId,
      questionCount: input.questions.length,
      toolUseId,
    });

    // Send to webview — in Electron, webviewManager may be undefined
    if (!this.webviewManager) {
      this.logger.warn(
        `[SdkPermissionHandler] No WebviewManager available (Electron) — cannot prompt AskUserQuestion`,
        { requestId },
      );
      // Cannot prompt user without webview — deny the question
      return {
        behavior: 'deny' as const,
        message: 'AskUserQuestion unavailable: no webview UI (Electron)',
      };
    }

    this.webviewManager
      .sendMessage(
        'ptah.main',
        MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST,
        request,
      )
      .then(() => {
        this.logger.info(
          `[SdkPermissionHandler] AskUserQuestion request sent to webview`,
          { requestId },
        );
      })
      .catch((error) => {
        this.logger.error(
          `[SdkPermissionHandler] Failed to send AskUserQuestion request`,
          { error },
        );
        // If send fails, resolve pending question to avoid permanent hang
        const pending = this.pendingQuestionRequests.get(request.id);
        if (pending) {
          this.pendingQuestionRequests.delete(request.id);
          pending.resolve(null);
        }
      });

    // Await user response indefinitely (pass signal for cancellation, sessionId for cleanup)
    const response = await this.awaitQuestionResponse(
      requestId,
      signal,
      sessionId,
    );

    if (!response) {
      this.logger.warn('[SdkPermissionHandler] AskUserQuestion aborted', {
        requestId,
      });
      return {
        behavior: 'deny' as const,
        message: 'Question request was aborted',
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
   * Handle ExitPlanMode tool — present plan to user for review
   *
   * ExitPlanMode clears the conversation context and starts a fresh session
   * with the approved plan. Like AskUserQuestion, it must NEVER be auto-approved
   * regardless of permission level — the user must always review the plan.
   *
   * On approval: returns allow → SDK performs context clear internally,
   * fires SessionStart with source "clear", and begins execution phase.
   *
   * On denial: returns deny → agent stays in plan mode and can revise.
   *
   * @param input - ExitPlanModeToolInput containing the plan string
   * @param toolUseId - SDK's tool_use ID for correlation
   * @returns PermissionResult
   */
  private async handleExitPlanMode(
    input: Record<string, unknown>,
    toolUseId: string,
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<PermissionResult> {
    // Validate input — ExitPlanMode must contain a plan string
    if (!isExitPlanModeToolInput(input)) {
      this.logger.warn(
        '[SdkPermissionHandler] Invalid ExitPlanMode input — missing plan field',
        { input },
      );
      return {
        behavior: 'deny' as const,
        message: 'Invalid ExitPlanMode input format — plan field is required',
      };
    }

    // Use requestUserPermission which shows the plan via the existing
    // permission request UI. The plan text will appear in the tool input.
    this.logger.info(
      '[SdkPermissionHandler] Requesting user approval for ExitPlanMode (plan review)',
      {
        toolUseId,
        planLength: input.plan.length,
      },
    );

    const result = await this.requestUserPermission(
      'ExitPlanMode',
      input,
      toolUseId,
      sessionId,
      undefined, // agentID - ExitPlanMode is never called from subagents
      signal,
    );

    // On approval: notify frontend that plan mode is ending
    if (result.behavior === 'allow') {
      this.logger.info(
        '[SdkPermissionHandler] ExitPlanMode approved — SDK will clear context and begin execution',
      );
      this.webviewManager
        ?.sendMessage('ptah.main', MESSAGE_TYPES.PLAN_MODE_CHANGED, {
          active: false,
        })
        .catch((error) => {
          this.logger.error(
            `[SdkPermissionHandler] Failed to send plan mode exited event`,
            { error },
          );
        });
    } else {
      this.logger.info(
        '[SdkPermissionHandler] ExitPlanMode denied — agent stays in plan mode',
      );
    }

    return result;
  }

  /**
   * Await question response from webview
   *
   * Blocks indefinitely until user responds or the AbortSignal fires.
   * Returns null on abort, AskUserQuestionResponse on user action.
   *
   * TASK_2025_215: Replaced setTimeout with AbortSignal-based cancellation.
   */
  private async awaitQuestionResponse(
    requestId: string,
    signal?: AbortSignal,
    sessionId?: string,
  ): Promise<AskUserQuestionResponse | null> {
    return new Promise<AskUserQuestionResponse | null>((resolve) => {
      // If already aborted, resolve immediately
      if (signal?.aborted) {
        this.pendingQuestionRequests.delete(requestId);
        resolve(null);
        return;
      }

      // Listen for abort signal (session abort, extension deactivation)
      const onAbort = () => {
        this.pendingQuestionRequests.delete(requestId);
        resolve(null);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      // Store pending request (no timer — blocks indefinitely)
      this.pendingQuestionRequests.set(requestId, {
        resolve: (response) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(response);
        },
        sessionId,
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
        `[SdkPermissionHandler] Received question response for unknown request: ${response.id}`,
      );
      return;
    }

    // Resolve pending promise
    this.pendingQuestionRequests.delete(response.id);
    pending.resolve(response);

    this.logger.debug(
      `[SdkPermissionHandler] Handled question response for request ${response.id}`,
    );
  }

  /**
   * Await RPC response from webview
   *
   * Blocks indefinitely until user responds or the AbortSignal fires.
   * Returns null on abort, PermissionResponse on user action.
   *
   * TASK_2025_215: Replaced setTimeout with AbortSignal-based cancellation.
   */
  private async awaitResponse(
    requestId: string,
    signal?: AbortSignal,
    sessionId?: string,
  ): Promise<PermissionResponse | null> {
    return new Promise<PermissionResponse | null>((resolve) => {
      // If already aborted, resolve immediately
      if (signal?.aborted) {
        this.pendingRequests.delete(requestId);
        this.pendingRequestContext.delete(requestId);
        resolve(null);
        return;
      }

      // Listen for abort signal (session abort, extension deactivation)
      const onAbort = () => {
        this.pendingRequests.delete(requestId);
        this.pendingRequestContext.delete(requestId);
        resolve(null);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      // Store pending request (no timer — blocks indefinitely)
      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(response);
        },
        sessionId,
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
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!input || typeof input !== 'object') {
      return input;
    }

    const sanitized = { ...input };

    // Sanitize environment variables
    const env = sanitized['env'];
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      const envRecord = env as Record<string, unknown>;
      sanitized['env'] = Object.keys(envRecord).reduce(
        (acc, key) => {
          // Redact keys that likely contain secrets
          const isSecret =
            key.toUpperCase().includes('KEY') ||
            key.toUpperCase().includes('TOKEN') ||
            key.toUpperCase().includes('SECRET') ||
            key.toUpperCase().includes('PASSWORD') ||
            key.toUpperCase().includes('API');

          acc[key] = isSecret ? '***REDACTED***' : envRecord[key];
          return acc;
        },
        {} as Record<string, unknown>,
      );
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
    input: Record<string, unknown>,
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

      case 'ExitPlanMode': {
        if (isExitPlanModeToolInput(input)) {
          const planPreview =
            input.plan.length > 200
              ? `${input.plan.substring(0, 200)}...`
              : input.plan;
          return `Exit plan mode and execute plan: ${planPreview}`;
        }
        return 'Exit plan mode and clear context to begin execution';
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
      `[SdkPermissionHandler] Disposing ${this.pendingRequests.size} pending permission requests, ${this.pendingQuestionRequests.size} pending question requests, and ${this.permissionRules.size} permission rules`,
    );

    // Resolve all pending permission requests as denied
    for (const [requestId, pending] of this.pendingRequests.entries()) {
      pending.resolve({
        id: requestId,
        decision: 'deny',
        reason: 'Extension deactivated',
      });
    }
    this.pendingRequests.clear();

    // Clear request context map
    this.pendingRequestContext.clear();

    // Resolve all pending question requests as null (aborted)
    for (const [
      _requestId,
      pending,
    ] of this.pendingQuestionRequests.entries()) {
      pending.resolve(null);
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

    if (sessionId) {
      // Session-scoped cleanup: only remove requests belonging to this session
      for (const [requestId, pending] of this.pendingRequests.entries()) {
        if (pending.sessionId === sessionId) {
          pending.resolve({
            id: requestId,
            decision: 'deny',
            reason: 'Session aborted',
          });
          this.pendingRequests.delete(requestId);
          this.pendingRequestContext.delete(requestId);
        }
      }

      for (const [
        requestId,
        pending,
      ] of this.pendingQuestionRequests.entries()) {
        if (pending.sessionId === sessionId) {
          pending.resolve(null);
          this.pendingQuestionRequests.delete(requestId);
        }
      }

      // Notify frontend to remove stale permission/question cards for this session
      this.webviewManager
        ?.sendMessage('ptah.main', MESSAGE_TYPES.PERMISSION_SESSION_CLEANUP, {
          sessionId,
        })
        .catch((error) => {
          this.logger.error(
            '[SdkPermissionHandler] Failed to send session cleanup notification',
            { error },
          );
        });
    } else {
      // Global cleanup: clear ALL (backward compat, extension deactivation)
      for (const [requestId, pending] of this.pendingRequests.entries()) {
        pending.resolve({
          id: requestId,
          decision: 'deny',
          reason: 'Session aborted',
        });
      }
      this.pendingRequests.clear();
      this.pendingRequestContext.clear();

      for (const [, pending] of this.pendingQuestionRequests.entries()) {
        pending.resolve(null);
      }
      this.pendingQuestionRequests.clear();
    }

    // Reset agent plan mode indicator on session end
    this.webviewManager
      ?.sendMessage('ptah.main', MESSAGE_TYPES.PLAN_MODE_CHANGED, {
        active: false,
      })
      .catch((error) => {
        this.logger.error(
          `[SdkPermissionHandler] Failed to send plan mode reset`,
          { error },
        );
      });

    this.logger.info(
      `[SdkPermissionHandler] Pending permissions cleanup complete`,
      { sessionId: sessionId ?? 'all' },
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
        `[SdkPermissionHandler] Cleared permission rule for tool: ${toolName}`,
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
      `[SdkPermissionHandler] Cleared all ${count} permission rules`,
    );
  }
}
