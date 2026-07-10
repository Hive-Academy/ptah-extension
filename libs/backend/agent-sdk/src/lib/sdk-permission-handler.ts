import { v4 as uuidv4, validate as isUuid } from 'uuid';
import { injectable, inject } from 'tsyringe';
import {
  Logger,
  TOKENS,
  type SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  UNKNOWN_AGENT_TOOL_CALL_ID,
  SessionId,
  TabId,
  type AgentPermissionRequest,
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
import { PendingResponseRegistry } from './permission/pending-response-registry';
import {
  AskUserQuestionService,
  type AskUserQuestionResponse,
  type WebviewManagerLike,
} from './permission/ask-user-question.service';
import { ExitPlanModeService } from './permission/exit-plan-mode.service';

interface PendingRequest {
  resolve: (response: PermissionResponse) => void;
  sessionId?: SessionId;
  tabId?: TabId;
}

/**
 * Deny window for UNROUTABLE permission requests only — those with no valid
 * UUID session/tab surface to render the prompt (the broadcast-fallback case,
 * e.g. gateway `gw-<id>` tabs). Routable webview requests keep an infinite wait
 * so a user can legitimately take minutes to answer. See F2 in TASK_2026_155.
 */
const UNROUTABLE_PERMISSION_TIMEOUT_MS = 60_000;

@injectable()
export class SdkPermissionHandler implements ISdkPermissionHandler {
  private _permissionLevel: PermissionLevel = 'ask';

  private pendingRequests = new Map<string, PendingRequest>();
  private readonly ruleStore: PermissionRuleStore;

  private pendingRequestContext = new Map<
    string,
    { toolName: string; toolInput: Record<string, unknown> }
  >();

  private emitterInitialized = false;

  private readonly askUserQuestion: AskUserQuestionService;
  private readonly exitPlanMode: ExitPlanModeService;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManagerLike,
  ) {
    this.ruleStore = new PermissionRuleStore(this.logger);

    const questionRegistry =
      new PendingResponseRegistry<AskUserQuestionResponse>(this.logger);
    this.askUserQuestion = new AskUserQuestionService(
      this.webviewManager,
      this.logger,
      questionRegistry,
    );
    this.exitPlanMode = new ExitPlanModeService(
      this.webviewManager,
      this.logger,
      this.requestUserPermission.bind(this),
    );

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
    sessionId?: SessionId,
    cliAgentResolver?: () => string | undefined,
    tabId?: TabId,
    /**
     * Resolves the CURRENT permission level for THIS session, read live on
     * every tool call. Interactive sessions pass a resolver bound to their
     * SessionRecord so a tool call never sees another workspace's level; the
     * CLI-agent path omits it and falls back to the global default.
     */
    levelResolver?: () => PermissionLevel,
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

      if (SAFE_TOOLS.includes(toolName)) {
        if (toolName === 'EnterPlanMode') {
          this.logger.info(`[SdkPermissionHandler] Agent entered plan mode`);
          this.webviewManager
            .sendMessage('ptah.main', MESSAGE_TYPES.PLAN_MODE_CHANGED, {
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

      if (toolName === 'AskUserQuestion') {
        this.logger.info(
          `[SdkPermissionHandler] Handling AskUserQuestion tool request (bypasses all auto-approval)`,
        );
        return await this.askUserQuestion.handleAskUserQuestion(
          input,
          options.toolUseID,
          sessionId,
          options.signal,
          tabId,
        );
      }

      if (toolName === 'ExitPlanMode') {
        this.logger.info(
          `[SdkPermissionHandler] Handling ExitPlanMode tool request (bypasses all auto-approval)`,
        );
        return await this.exitPlanMode.handleExitPlanMode(
          input,
          options.toolUseID,
          sessionId,
          options.signal,
          tabId,
        );
      }

      // Per-session level (interactive) or global default (CLI agents). Read
      // live so a mid-session toggle takes effect, but scoped to THIS session
      // so it never reflects another workspace's level.
      const effectiveLevel = levelResolver
        ? levelResolver()
        : this._permissionLevel;

      if (effectiveLevel === 'yolo') {
        this.logger.info(
          `[SdkPermissionHandler] YOLO mode: auto-approved tool: ${toolName}`,
        );
        return {
          behavior: 'allow' as const,
          updatedInput: input,
        };
      }

      if (effectiveLevel === 'auto-edit') {
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
          tabId,
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
          tabId,
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
          tabId,
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
        tabId,
      );
    };
  }

  /**
   * A request is routable when it carries a valid UUID session or tab surface
   * the prompt can be delivered to. `sessionId`/`tabId` are branded types the
   * options builder only populates from `SessionId.safeParse`/`TabId.safeParse`
   * (non-UUID routing ids become `undefined`), so in practice "unroutable" is
   * "both are absent" — the broadcast-fallback case. The explicit UUID check is
   * defense-in-depth and keeps the classification correct regardless of caller.
   */
  private isRoutablePermissionRequest(
    sessionId?: SessionId,
    tabId?: TabId,
  ): boolean {
    return (
      (sessionId !== undefined && isUuid(sessionId as string)) ||
      (tabId !== undefined && isUuid(tabId as string))
    );
  }

  private async requestUserPermission(
    toolName: string,
    input: Record<string, unknown>,
    toolUseId?: string,
    sessionId?: SessionId,
    agentID?: string,
    signal?: AbortSignal,
    cliAgentResolver?: () => string | undefined,
    tabId?: TabId,
  ): Promise<PermissionResult> {
    const startTime = Date.now();

    const requestId = generateRequestId();

    const sanitizedInput = sanitizeToolInput(input);

    // Unroutable requests (no UUID session/tab surface) get a deny timeout so
    // the SDK stream can complete instead of hanging forever; routable webview
    // requests keep `timeoutAt = 0` (infinite wait) exactly as before.
    const isRoutable = this.isRoutablePermissionRequest(sessionId, tabId);
    const timeoutAt = isRoutable
      ? 0
      : startTime + UNROUTABLE_PERMISSION_TIMEOUT_MS;

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
      tabId,
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

    const response = await this.awaitResponse(
      requestId,
      signal,
      sessionId,
      tabId,
      isRoutable ? undefined : UNROUTABLE_PERMISSION_TIMEOUT_MS,
    );

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
        id: uuidv4(),
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
          .sendMessage('ptah.main', MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED, {
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

  handleQuestionResponse(response: AskUserQuestionResponse): void {
    this.askUserQuestion.handleQuestionResponse(response);
  }

  private async awaitResponse(
    requestId: string,
    signal?: AbortSignal,
    sessionId?: SessionId,
    tabId?: TabId,
    timeoutMs?: number,
  ): Promise<PermissionResponse | null> {
    return new Promise<PermissionResponse | null>((resolve) => {
      if (signal?.aborted) {
        this.pendingRequests.delete(requestId);
        this.pendingRequestContext.delete(requestId);
        resolve(null);
        return;
      }

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const clearTimer = () => {
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
      };

      const onAbort = () => {
        clearTimer();
        this.pendingRequests.delete(requestId);
        this.pendingRequestContext.delete(requestId);
        resolve(null);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          clearTimer();
          signal?.removeEventListener('abort', onAbort);
          resolve(response);
        },
        sessionId,
        tabId,
      });

      // Only unroutable requests supply a positive timeout — deny after the
      // window so an undeliverable prompt cannot wedge the SDK stream forever.
      // The timer is cleared by the resolve wrapper and onAbort above, so a real
      // response or an abort arriving first cancels it (no late deny, no leak).
      if (timeoutMs !== undefined && timeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          const pending = this.pendingRequests.get(requestId);
          if (!pending) {
            return;
          }
          const context = this.pendingRequestContext.get(requestId);
          this.pendingRequests.delete(requestId);
          this.pendingRequestContext.delete(requestId);
          this.logger.warn(
            `[SdkPermissionHandler] Unroutable permission request timed out — denying`,
            { requestId, toolName: context?.toolName, timeoutMs },
          );
          pending.resolve({
            id: requestId,
            decision: 'deny',
            reason: `Permission request timed out after ${timeoutMs}ms with no UI surface to route it to (unroutable request) — denying to prevent a permanent hang.`,
          });
        }, timeoutMs);
      }
    });
  }

  dispose(): void {
    this.logger.info(
      `[SdkPermissionHandler] Disposing ${this.pendingRequests.size} pending permission requests, ${this.askUserQuestion.pendingCount} pending question requests, and ${this.ruleStore.size} permission rules`,
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

    this.askUserQuestion.disposeAll();

    this.ruleStore.clearAll();
  }

  cleanupPendingPermissions(sessionId?: string): void {
    this.logger.info(`[SdkPermissionHandler] Cleaning up pending permissions`, {
      sessionId: sessionId ?? 'all',
      pendingPermissionCount: this.pendingRequests.size,
      pendingQuestionCount: this.askUserQuestion.pendingCount,
    });

    if (sessionId) {
      for (const [requestId, pending] of this.pendingRequests.entries()) {
        if (pending.tabId === sessionId || pending.sessionId === sessionId) {
          pending.resolve({
            id: requestId,
            decision: 'deny',
            reason: 'Session aborted',
          });
          this.pendingRequests.delete(requestId);
          this.pendingRequestContext.delete(requestId);
        }
      }

      this.askUserQuestion.cleanupBySession(sessionId);

      this.webviewManager
        .sendMessage('ptah.main', MESSAGE_TYPES.PERMISSION_SESSION_CLEANUP, {
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

      this.askUserQuestion.disposeAll();
    }

    this.webviewManager
      .sendMessage('ptah.main', MESSAGE_TYPES.PLAN_MODE_CHANGED, {
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
