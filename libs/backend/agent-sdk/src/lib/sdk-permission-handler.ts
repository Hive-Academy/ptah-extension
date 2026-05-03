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
 *
 * TASK_2025_291 Wave C7a: Tool classification tables, description generation,
 * input sanitization, and the "always allow" rule store are extracted into
 * sibling modules under `./permission/`. This class remains the DI-resolved
 * coordinator with an unchanged public surface.
 */

import { injectable, inject, container } from 'tsyringe';
import {
  Logger,
  TOKENS,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import {
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
import {
  SAFE_TOOLS,
  DANGEROUS_TOOLS,
  NETWORK_TOOLS,
  SUBAGENT_TOOLS,
  AUTO_EDIT_TOOLS,
  isMcpTool,
} from './permission/permission-tool-classifier';
import {
  generateDescription,
  sanitizeToolInput,
  generateRequestId,
} from './permission/permission-description';
import { PermissionRuleStore } from './permission/permission-rule-store';

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
  /** Frontend tab ID for direct tab routing (authoritative over sessionId) */
  tabId?: string;
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
  /** Idle-timeout timer that auto-picks the recommended option after
   *  ASK_USER_QUESTION_IDLE_TIMEOUT_MS. Cleared when a real response or
   *  abort arrives first. Null when timeout is disabled. */
  idleTimer?: ReturnType<typeof setTimeout> | null;
}

/**
 * Idle timeout for AskUserQuestion. After this long with no user response,
 * the handler auto-picks the recommended (first) option for every question
 * so the agent can continue instead of hanging forever. Set to 0 to disable.
 */
const ASK_USER_QUESTION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

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
 */
@injectable()
export class SdkPermissionHandler implements ISdkPermissionHandler {
  /**
   * Current permission level controlling auto-approval behavior.
   */
  private _permissionLevel: PermissionLevel = 'ask';

  private pendingRequests = new Map<string, PendingRequest>();
  private pendingQuestionRequests = new Map<string, PendingQuestionRequest>();
  private readonly ruleStore: PermissionRuleStore;

  private pendingRequestContext = new Map<
    string,
    { toolName: string; toolInput: Record<string, unknown> }
  >();

  private emitterInitialized = false;

  /**
   * WebviewManager is optional: resolved lazily via container.isRegistered() to
   * avoid DI crash in Electron.
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
    this.ruleStore = new PermissionRuleStore(this.logger);
    this.initializePermissionEmitter();
  }

  setPermissionLevel(level: PermissionLevel): void {
    const previous = this._permissionLevel;
    this._permissionLevel = level;
    this.logger.info(
      `[SdkPermissionHandler] Permission level changed: ${previous} → ${level}`,
    );
  }

  getPermissionLevel(): PermissionLevel {
    return this._permissionLevel;
  }

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

  private sendPermissionRequest(
    payload: PermissionRequest,
    cliAgentResolver?: () => string | undefined,
  ): void {
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

  private sendCliAgentPermissionRequest(
    payload: PermissionRequest,
    agentId: string,
  ): void {
    if (!this.webviewManager) {
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

    let toolArgs: string;
    try {
      toolArgs = JSON.stringify(payload.toolInput);
    } catch {
      toolArgs = '[unable to serialize tool input]';
    }

    const agentPermissionRequest: AgentPermissionRequest = {
      requestId: payload.id,
      agentId,
      kind: 'tool',
      toolName: payload.toolName,
      toolArgs,
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

      // Auto-approve safe tools
      if (SAFE_TOOLS.includes(toolName)) {
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

      // AskUserQuestion bypasses all auto-approval.
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

      // ExitPlanMode bypasses all auto-approval.
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

      // 'yolo' mode: auto-approve everything.
      if (this._permissionLevel === 'yolo') {
        this.logger.info(
          `[SdkPermissionHandler] YOLO mode: auto-approved tool: ${toolName}`,
        );
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        };
      }

      // 'auto-edit' mode: auto-approve file editing tools.
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

      // Background agent auto-approval for file edits.
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

      // "Always Allow" rule lookup.
      const storedRule = this.ruleStore.getRule(toolName);
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

      if (SUBAGENT_TOOLS.includes(toolName)) {
        this.logger.debug(
          `[SdkPermissionHandler] Auto-approved subagent tool: ${toolName}`,
        );
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        };
      }

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

  private async requestUserPermission(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId?: string,
    sessionId?: string,
    agentID?: string,
    signal?: AbortSignal,
    cliAgentResolver?: () => string | undefined,
  ): Promise<PermissionResult> {
    const startTime = Date.now();

    const requestId = generateRequestId();

    const sanitizedInput = sanitizeToolInput(input);

    const timeoutAt = 0;

    const description = generateDescription(toolName, sanitizedInput);

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

    const request: PermissionRequest = {
      id: requestId,
      toolName,
      toolInput: sanitizedInput,
      toolUseId,
      agentToolCallId,
      timestamp: startTime,
      description,
      timeoutAt,
      sessionId,
    };

    this.pendingRequestContext.set(requestId, { toolName, toolInput: input });

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

    this.logger.info(`[SdkPermissionHandler] Permission request emitted`, {
      requestId,
      toolName,
      toolUseId,
      emitLatency: Date.now() - startTime,
    });

    const response = await this.awaitResponse(requestId, signal, sessionId);

    this.logger.info(`[SdkPermissionHandler] Permission response received`, {
      requestId,
      totalLatency: Date.now() - startTime,
      decision: response?.decision ?? 'aborted',
    });

    if (!response) {
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

    if (response.decision === 'deny_with_message') {
      const userReason = response.reason || 'No explanation given';
      this.logger.info(
        `[SdkPermissionHandler] Permission request ${requestId} denied with message for tool ${toolName}`,
        {
          decision: 'deny_with_message',
          reason: userReason,
          interrupt: false,
        },
      );
      return {
        behavior: 'deny' as const,
        message: `Permission denied by user for tool "${toolName}". The user reviewed this tool call and explicitly chose to deny it. User's message: "${userReason}". You MUST respect this decision — do NOT retry the same tool call. Adjust your approach based on the user's feedback.`,
        interrupt: false,
      };
    }

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
      interrupt: true,
    };
  }

  handleResponse(requestId: string, response: PermissionResponse): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) {
      this.logger.warn(
        `[SdkPermissionHandler] Received response for unknown request: ${requestId}`,
      );
      return;
    }

    const requestContext = this.pendingRequestContext.get(requestId);

    const neverAutoApproveTools = ['ExitPlanMode', 'AskUserQuestion'];
    if (
      response.decision === 'always_allow' &&
      requestContext &&
      !neverAutoApproveTools.includes(requestContext.toolName)
    ) {
      const rule: PermissionRule = {
        id: `rule_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        pattern: requestContext.toolName,
        toolName: requestContext.toolName,
        action: 'allow',
        createdAt: Date.now(),
        description: `Auto-created from "Always Allow" for ${requestContext.toolName}`,
      };

      this.ruleStore.setRule(requestContext.toolName, rule);

      this.logger.info(
        `[SdkPermissionHandler] Created "Always Allow" rule for tool: ${requestContext.toolName}`,
        { ruleId: rule.id },
      );

      const toolName = requestContext.toolName;
      const autoResolvedIds: string[] = [];

      for (const [
        pendingId,
        pendingCtx,
      ] of this.pendingRequestContext.entries()) {
        if (pendingId === requestId) continue;
        if (pendingCtx.toolName !== toolName) continue;

        const pendingReq = this.pendingRequests.get(pendingId);
        if (!pendingReq) continue;

        this.pendingRequests.delete(pendingId);
        this.pendingRequestContext.delete(pendingId);
        pendingReq.resolve({ id: pendingId, decision: 'allow' });
        autoResolvedIds.push(pendingId);

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

    this.pendingRequestContext.delete(requestId);

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

  private async handleAskUserQuestion(
    input: Record<string, unknown>,
    toolUseId: string,
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<PermissionResult> {
    if (!isAskUserQuestionToolInput(input)) {
      this.logger.warn('[SdkPermissionHandler] Invalid AskUserQuestion input', {
        input,
      });
      return {
        behavior: 'deny' as const,
        message: 'Invalid AskUserQuestion input format',
      };
    }

    const requestId = generateRequestId();
    const now = Date.now();

    const request: AskUserQuestionRequest = {
      id: requestId,
      toolName: 'AskUserQuestion',
      questions: input.questions,
      toolUseId,
      timestamp: now,
      timeoutAt: 0,
      sessionId,
      tabId: sessionId,
    };

    this.logger.info('[SdkPermissionHandler] Sending AskUserQuestion request', {
      requestId,
      questionCount: input.questions.length,
      toolUseId,
    });

    if (!this.webviewManager) {
      this.logger.warn(
        `[SdkPermissionHandler] No WebviewManager available (Electron) — cannot prompt AskUserQuestion`,
        { requestId },
      );
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
        const pending = this.pendingQuestionRequests.get(request.id);
        if (pending) {
          this.pendingQuestionRequests.delete(request.id);
          pending.resolve(null);
        }
      });

    const response = await this.awaitQuestionResponse(
      requestId,
      signal,
      sessionId,
      input.questions,
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

    return {
      behavior: 'allow' as const,
      updatedInput: {
        ...input,
        answers: response.answers,
      },
    };
  }

  private async handleExitPlanMode(
    input: Record<string, unknown>,
    toolUseId: string,
    sessionId?: string,
    signal?: AbortSignal,
  ): Promise<PermissionResult> {
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
      undefined,
      signal,
    );

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

  private async awaitQuestionResponse(
    requestId: string,
    signal?: AbortSignal,
    sessionId?: string,
    questions?: QuestionItem[],
  ): Promise<AskUserQuestionResponse | null> {
    return new Promise<AskUserQuestionResponse | null>((resolve) => {
      if (signal?.aborted) {
        this.pendingQuestionRequests.delete(requestId);
        resolve(null);
        return;
      }

      // Idle-timeout fallback — after ASK_USER_QUESTION_IDLE_TIMEOUT_MS with
      // no response, auto-pick the recommended (first) option for every
      // question so the agent continues instead of hanging forever.
      // The agent's next turn naturally surfaces the choice via the tool
      // result it receives.
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      if (
        ASK_USER_QUESTION_IDLE_TIMEOUT_MS > 0 &&
        questions &&
        questions.length > 0
      ) {
        idleTimer = setTimeout(() => {
          const pending = this.pendingQuestionRequests.get(requestId);
          if (!pending) return;
          const answers: Record<string, string> = {};
          for (const q of questions) {
            const recommended = q.options?.[0]?.label;
            if (recommended) answers[q.header] = recommended;
          }
          this.logger.warn(
            '[SdkPermissionHandler] AskUserQuestion idle-timeout reached — auto-picking recommended options',
            {
              requestId,
              timeoutMs: ASK_USER_QUESTION_IDLE_TIMEOUT_MS,
              answers,
            },
          );
          this.pendingQuestionRequests.delete(requestId);
          signal?.removeEventListener('abort', onAbort);
          // Notify the webview to remove the now-stale question card so the
          // user sees what was auto-answered. handleQuestionResponse on the
          // frontend already filters the request out of `_questionRequests`.
          this.webviewManager
            ?.sendMessage(
              'ptah.main',
              MESSAGE_TYPES.ASK_USER_QUESTION_AUTO_RESOLVED,
              { id: requestId, answers, sessionId },
            )
            .catch((error) => {
              this.logger.error(
                '[SdkPermissionHandler] Failed to broadcast AskUserQuestion auto-resolution',
                { error },
              );
            });
          resolve({ id: requestId, answers });
        }, ASK_USER_QUESTION_IDLE_TIMEOUT_MS);
      }

      const onAbort = () => {
        if (idleTimer) clearTimeout(idleTimer);
        this.pendingQuestionRequests.delete(requestId);
        resolve(null);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pendingQuestionRequests.set(requestId, {
        resolve: (response) => {
          if (idleTimer) clearTimeout(idleTimer);
          signal?.removeEventListener('abort', onAbort);
          resolve(response);
        },
        sessionId,
        idleTimer,
      });
    });
  }

  handleQuestionResponse(response: AskUserQuestionResponse): void {
    const pending = this.pendingQuestionRequests.get(response.id);
    if (!pending) {
      this.logger.warn(
        `[SdkPermissionHandler] Received question response for unknown request: ${response.id}`,
      );
      return;
    }

    this.pendingQuestionRequests.delete(response.id);
    pending.resolve(response);

    this.logger.debug(
      `[SdkPermissionHandler] Handled question response for request ${response.id}`,
    );
  }

  private async awaitResponse(
    requestId: string,
    signal?: AbortSignal,
    sessionId?: string,
  ): Promise<PermissionResponse | null> {
    return new Promise<PermissionResponse | null>((resolve) => {
      if (signal?.aborted) {
        this.pendingRequests.delete(requestId);
        this.pendingRequestContext.delete(requestId);
        resolve(null);
        return;
      }

      const onAbort = () => {
        this.pendingRequests.delete(requestId);
        this.pendingRequestContext.delete(requestId);
        resolve(null);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(response);
        },
        sessionId,
      });
    });
  }

  dispose(): void {
    this.logger.info(
      `[SdkPermissionHandler] Disposing ${this.pendingRequests.size} pending permission requests, ${this.pendingQuestionRequests.size} pending question requests, and ${this.ruleStore.size} permission rules`,
    );

    for (const [requestId, pending] of this.pendingRequests.entries()) {
      pending.resolve({
        id: requestId,
        decision: 'deny',
        reason: 'Extension deactivated',
      });
    }
    this.pendingRequests.clear();

    this.pendingRequestContext.clear();

    for (const [
      _requestId,
      pending,
    ] of this.pendingQuestionRequests.entries()) {
      pending.resolve(null);
    }
    this.pendingQuestionRequests.clear();

    this.ruleStore.clearAll();
  }

  cleanupPendingPermissions(sessionId?: string): void {
    this.logger.info(`[SdkPermissionHandler] Cleaning up pending permissions`, {
      sessionId: sessionId ?? 'all',
      pendingPermissionCount: this.pendingRequests.size,
      pendingQuestionCount: this.pendingQuestionRequests.size,
    });

    if (sessionId) {
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

  getPermissionRules(): PermissionRule[] {
    return this.ruleStore.listRules();
  }

  clearPermissionRule(toolName: string): boolean {
    return this.ruleStore.clearRule(toolName);
  }

  clearAllPermissionRules(): void {
    this.ruleStore.clearAll();
  }
}
