import * as path from 'path';
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
  type AskUserQuestionRequest,
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
import { evaluateUnattendedBash } from './permission/unattended-bash-policy';
import type {
  UnattendedSessionPolicy,
  UnattendedSessionPolicyRegistry,
} from './permission/unattended-session-policy.registry';
import { SDK_TOKENS } from './di/tokens';

/** Tools of Ptah's own MCP server, allowed for unattended sessions (R1). */
const PTAH_MCP_TOOL_PREFIX = 'mcp__ptah__';

/**
 * Internal superset of the wire type {@link PermissionResponse}.
 *
 * `systemAbort` marks a response Ptah itself manufactured while tearing a
 * session down (auth/config change, extension deactivation) — NOT a decision a
 * human made. It is deliberately NOT part of `PermissionResponse`: that type is
 * what the WEBVIEW sends, and a system abort never originates there.
 *
 * Without this distinction an abort-deny is indistinguishable from a user deny
 * at the tool-result layer, so the model reads a teardown as a deliberate
 * refusal and correctly stops working. See TASK_2026_247.
 */
type InternalPermissionResponse = PermissionResponse & {
  readonly systemAbort?: true;
  /** Set only by the unroutable deny-window timer. */
  readonly timedOut?: true;
};

interface PendingRequest {
  resolve: (response: InternalPermissionResponse) => void;
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

/**
 * Ceiling for a permission request routed to the agent monitor panel by CLI
 * agent id.
 *
 * A webview request lands on a surface that provably exists — the tab is open,
 * the user is looking at it — so it waits indefinitely. A CLI-agent request
 * lands on an agent CARD, and the card may not exist yet:
 * `AgentMonitorStore.onPermissionRequest` buffers the prompt in
 * `_pendingPermissionBuffer` when the agent has not spawned, and that buffer is
 * drained ONLY by the matching `onAgentSpawned` (no TTL). If the spawn event
 * never arrives — a crash between `setAgentId()` and the frontend event, an
 * extension-host restart, a webview reload mid-spawn — the prompt is never
 * rendered and never answered.
 *
 * The `delivered === false` net does not catch that: `postMessage` succeeded, so
 * delivery is reported as true. It is a TRANSPORT check, and this is an
 * APPLICATION-level drop.
 *
 * So the wait is bounded. Ten minutes is double the house's "a human is looking
 * at this prompt" window (`ASK_USER_QUESTION_IDLE_TIMEOUT_MS`, 5 min), which
 * keeps a legitimate slow answer safe while guaranteeing the SDK stream cannot
 * stall on a tool call forever (TASK_2026_295 Wave 2).
 */
const CLI_AGENT_PERMISSION_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Lifecycle of one user-facing permission prompt, observed out-of-band by
 * hosts that own a surface the webview cannot reach — the messaging gateway
 * tells the Discord user "Ptah is waiting for approval in the desktop app"
 * instead of going silent for the deny window (TASK_2026_271 #1).
 * `routingHint` is the caller's raw tab id (e.g. `gw-<conversationId>`) even
 * when it is not a UUID and therefore not a routable webview surface.
 */
export type PermissionPromptLifecycleEvent =
  | {
      readonly phase: 'requested';
      readonly requestId: string;
      readonly routingHint?: string;
      readonly toolName: string;
      readonly description: string;
      readonly routable: boolean;
      /** Deny window in ms; `undefined` when the prompt waits indefinitely. */
      readonly timeoutMs?: number;
    }
  | {
      readonly phase: 'resolved';
      readonly requestId: string;
      readonly routingHint?: string;
      readonly toolName: string;
      readonly outcome: 'allowed' | 'denied' | 'timed-out' | 'aborted';
    };

export type PermissionPromptLifecycleListener = (
  event: PermissionPromptLifecycleEvent,
) => void;

@injectable()
export class SdkPermissionHandler implements ISdkPermissionHandler {
  private _permissionLevel: PermissionLevel = 'ask';

  private pendingRequests = new Map<string, PendingRequest>();
  private readonly ruleStore: PermissionRuleStore;
  private readonly lifecycleListeners =
    new Set<PermissionPromptLifecycleListener>();

  private pendingRequestContext = new Map<
    string,
    { toolName: string; toolInput: Record<string, unknown> }
  >();

  private emitterInitialized = false;

  /**
   * Request ids of prompts raised for unattended (policy) sessions. "Always
   * Allow" rules are never consulted for those sessions, so a rule created by
   * answering another prompt must not auto-resolve them either.
   */
  private readonly unattendedRequestIds = new Set<string>();

  private readonly askUserQuestion: AskUserQuestionService;
  private readonly exitPlanMode: ExitPlanModeService;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.SUBAGENT_REGISTRY_SERVICE)
    private readonly subagentRegistry: SubagentRegistryService,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManagerLike,
    @inject(SDK_TOKENS.SDK_UNATTENDED_SESSION_POLICY_REGISTRY, {
      isOptional: true,
    })
    private readonly unattendedPolicies?: UnattendedSessionPolicyRegistry,
  ) {
    this.ruleStore = new PermissionRuleStore(this.logger);

    const questionRegistry = new PendingResponseRegistry<
      AskUserQuestionResponse,
      AskUserQuestionRequest
    >(this.logger);
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

  /**
   * Observe permission prompts as they are raised and settled. Returns the
   * unsubscribe function. Listeners must not throw; a throwing listener is
   * logged and never blocks the prompt.
   */
  onPromptLifecycle(listener: PermissionPromptLifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => {
      this.lifecycleListeners.delete(listener);
    };
  }

  private emitLifecycle(event: PermissionPromptLifecycleEvent): void {
    for (const listener of this.lifecycleListeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        this.logger.warn(
          '[SdkPermissionHandler] prompt lifecycle listener threw',
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }
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
    cliAgentId?: string,
  ): void {
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
    /**
     * Raw routing id of the caller (its tab id, UUID or not). Carried onto the
     * prompt lifecycle events so out-of-band observers can match prompts to
     * their own conversations even when the id is not a routable surface.
     */
    routingHint?: string,
    /**
     * Resolves the session's REAL SDK id, read live on every prompt.
     *
     * `sessionId` above is a build-time value: for a new session the SDK UUID
     * does not exist yet, so the options builder falls back to the caller's
     * routing id (`sessionConfig.tabId ?? sessionId`). For a chat tab that is
     * harmless — the frontend recognises the tab id anyway. For a workflow
     * SURFACE it is fatal: the prompt then carries the harness's correlation
     * id in BOTH fields and no consumer can map it to a conversation, which
     * is how New Project questions ended up on an unrelated canvas tile and
     * why `chat:pending-questions` could never replay them after a reload
     * (TASK_2026_317). This resolver closes over the SessionRecord, so by the
     * time a tool call happens the real id is known and travels with the
     * prompt. Omitted by callers with no record; those behave as before.
     */
    sessionIdResolver?: () => string | undefined,
  ): CanUseTool {
    const resolveSessionId = (): SessionId | undefined => {
      const live = sessionIdResolver?.();
      return (live ? SessionId.safeParse(live) : null) ?? sessionId;
    };
    const requestUserPermission = (
      toolName: string,
      input: Record<string, unknown>,
      options: { toolUseID: string; agentID?: string; signal: AbortSignal },
    ): Promise<PermissionResult> =>
      this.requestUserPermission(
        toolName,
        input,
        options.toolUseID,
        resolveSessionId(),
        options.agentID,
        options.signal,
        cliAgentResolver,
        tabId,
        routingHint,
      );
    const requestBoundedPermission = (
      toolName: string,
      input: Record<string, unknown>,
      options: { toolUseID: string; agentID?: string; signal: AbortSignal },
      denyWindowMs: number,
    ): Promise<PermissionResult> =>
      this.requestUserPermission(
        toolName,
        input,
        options.toolUseID,
        resolveSessionId(),
        options.agentID,
        options.signal,
        cliAgentResolver,
        tabId,
        routingHint,
        denyWindowMs,
      );
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

      // Unattended (child) sessions: read live so a release takes effect on
      // the next call. The policy table decides and returns; the permission
      // level, background-agent and "Always Allow" paths below never apply.
      const unattendedPolicy = this.unattendedPolicies?.get(
        routingHint ?? (tabId as string | undefined),
      );
      if (unattendedPolicy) {
        return await this.decideUnattendedToolCall(
          unattendedPolicy,
          toolName,
          input,
          options.signal,
          (denyWindowMs) =>
            requestBoundedPermission(toolName, input, options, denyWindowMs),
        );
      }

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
          resolveSessionId(),
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
          resolveSessionId(),
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
        return await requestUserPermission(toolName, input, options);
      }

      if (NETWORK_TOOLS.includes(toolName)) {
        this.logger.info(
          `[SdkPermissionHandler] Requesting user permission for network tool: ${toolName}`,
        );
        return await requestUserPermission(toolName, input, options);
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
        return await requestUserPermission(toolName, input, options);
      }

      this.logger.warn(
        `[SdkPermissionHandler] Unknown tool encountered, requesting user permission: ${toolName}`,
      );
      return await requestUserPermission(toolName, input, options);
    };
  }

  /**
   * The decision table for an unattended session (TASK_2026_584). Nobody is
   * watching, so no call may wait without bound: a call outside the policy
   * gets a prompt in the child's own tab that is denied after
   * `policy.denyWindowMs`, or at once when that window is `0`. Anything the
   * policy cannot prove safe is prompted, never allowed.
   */
  private async decideUnattendedToolCall(
    policy: UnattendedSessionPolicy,
    toolName: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    requestBounded: (denyWindowMs: number) => Promise<PermissionResult>,
  ): Promise<PermissionResult> {
    const allow: PermissionResult = {
      behavior: 'allow' as const,
      updatedInput: input,
    };

    if (toolName === 'EnterPlanMode') {
      return {
        behavior: 'deny' as const,
        message: `Plan mode is unavailable to unattended agent sessions: nobody is watching this session to approve a plan. Write your plan to a file inside ${policy.writableRoot} instead, then carry on with the task.`,
        interrupt: false,
      };
    }
    if (toolName === 'AskUserQuestion') {
      return {
        behavior: 'deny' as const,
        message: `Nobody is watching this unattended agent session (started by ${policy.ownerLabel}), so questions cannot be answered. Make the decision yourself, then tell the parent session what you decided and why with ptah_agent_report.`,
        interrupt: false,
      };
    }
    if (
      toolName === 'ExitPlanMode' ||
      SAFE_TOOLS.includes(toolName) ||
      SUBAGENT_TOOLS.includes(toolName) ||
      toolName.startsWith(PTAH_MCP_TOOL_PREFIX)
    ) {
      this.logger.debug(
        `[SdkPermissionHandler] Unattended policy allowed: ${toolName}`,
      );
      return allow;
    }

    let outOfPolicyReason: string;
    if (AUTO_EDIT_TOOLS.includes(toolName)) {
      const target = this.checkUnattendedWriteTarget(
        policy.writableRoot,
        toolName,
        input,
      );
      if (target.inside) {
        return allow;
      }
      outOfPolicyReason = target.reason;
    } else if (toolName === 'Bash') {
      const decision = evaluateUnattendedBash(
        input?.['command'],
        policy.bashAllowlist,
      );
      if (decision.allowed) {
        return allow;
      }
      outOfPolicyReason =
        decision.reason ??
        'the command does not start with an allowlisted command';
    } else {
      outOfPolicyReason = `the tool "${toolName}" is not covered by the unattended policy`;
    }

    const policyDenyMessage = this.buildUnattendedDenyMessage(
      policy,
      toolName,
      outOfPolicyReason,
    );

    if (policy.denyWindowMs === 0) {
      this.logger.info(
        `[SdkPermissionHandler] Unattended policy denied without a prompt (deny window 0): ${toolName}`,
      );
      return {
        behavior: 'deny' as const,
        message: policyDenyMessage,
        interrupt: false,
      };
    }

    this.logger.info(
      `[SdkPermissionHandler] Unattended policy: bounded prompt for ${toolName}`,
      { denyWindowMs: policy.denyWindowMs },
    );
    const result = await requestBounded(policy.denyWindowMs);
    // An allow from a human stands; an abort is a session teardown and keeps
    // its own result. Every other deny (refused, timed out, undelivered) is
    // rewritten so the model knows to report the blocker instead of stopping.
    if (result.behavior === 'allow' || signal.aborted) {
      return result;
    }
    return {
      behavior: 'deny' as const,
      message: `${policyDenyMessage}\n\nPrompt outcome: ${result.message}`,
      interrupt: false,
    };
  }

  /**
   * Is the Write/Edit/NotebookEdit target inside `writableRoot`? Lexical
   * containment only (no realpath). Any failure counts as "not inside".
   */
  private checkUnattendedWriteTarget(
    writableRoot: string,
    toolName: string,
    input: Record<string, unknown>,
  ): { readonly inside: true } | { readonly inside: false; reason: string } {
    const key = toolName === 'NotebookEdit' ? 'notebook_path' : 'file_path';
    try {
      const target = input?.[key];
      if (typeof target !== 'string' || target.trim().length === 0) {
        return { inside: false, reason: `the ${key} argument is missing` };
      }
      if (typeof writableRoot !== 'string' || writableRoot.trim() === '') {
        return { inside: false, reason: 'no writable root is configured' };
      }
      const root = path.resolve(writableRoot);
      const relative = path.relative(root, path.resolve(root, target));
      const inside =
        relative.length > 0 &&
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative);
      return inside
        ? { inside: true }
        : {
            inside: false,
            reason: `the target ${target} is outside the writable root`,
          };
    } catch (error: unknown) {
      return {
        inside: false,
        reason: `the target could not be checked (${
          error instanceof Error ? error.message : String(error)
        })`,
      };
    }
  }

  private buildUnattendedDenyMessage(
    policy: UnattendedSessionPolicy,
    toolName: string,
    reason: string,
  ): string {
    const allowlist =
      policy.bashAllowlist.length > 0
        ? policy.bashAllowlist.map((entry) => `"${entry}"`).join(', ')
        : '(none)';
    return (
      `Tool "${toolName}" was not run. This is an unattended agent session started by ${policy.ownerLabel}; ` +
      `nobody approved this call, which is outside the session policy: ${reason}. ` +
      `Bash runs without approval only for a single command (no ; & | \` $( < > or newline) that starts with one of: ${allowlist}. ` +
      `Files can be written without approval only inside ${policy.writableRoot}. ` +
      `Do NOT retry the same call. If this blocks your task, report the blocker to the parent session with ptah_agent_report, then continue with what you can do.`
    );
  }

  /**
   * Classify the surface a prompt can be delivered to AND answered from, and
   * with it the deny window. Route and window are decided together on purpose:
   * they were two rules before, and they drifted — a request classified
   * routable inherited an unbounded wait it had not earned.
   *
   * - `'webview'` — a valid UUID session or tab. `sessionId`/`tabId` are branded
   *   types the options builder only populates from
   *   `SessionId.safeParse`/`TabId.safeParse` (non-UUID routing ids become
   *   `undefined`), so in practice this is "either is present". The explicit
   *   UUID check is defense-in-depth and keeps the classification correct
   *   regardless of caller. The surface provably exists, so the wait is
   *   unbounded and a user can take as long as they like.
   * - `'cli-agent'` — a resolved CLI agent id. `sendPermissionRequest` routes
   *   those to the agent monitor panel by `agentId`, and the answer comes back
   *   via `agent:permissionResponse` → `handleResponse(requestId)`, which is
   *   keyed on requestId alone — no session or tab is involved in that round
   *   trip. Classifying it unroutable gave the user a real, visible prompt that
   *   auto-denied itself after 60s (TASK_2026_295 Wave 1). But the card it
   *   targets may never materialize, so the wait is bounded rather than
   *   infinite — see {@link CLI_AGENT_PERMISSION_TIMEOUT_MS}. CLI agent ids are
   *   not UUIDs, so no UUID check.
   * - `'none'` — no surface at all (the broadcast-fallback case). Short deny
   *   window so the SDK stream can complete.
   */
  private classifyPermissionRoute(
    sessionId?: SessionId,
    tabId?: TabId,
    cliAgentId?: string,
  ): { readonly routable: boolean; readonly denyWindowMs?: number } {
    if (
      (sessionId !== undefined && isUuid(sessionId as string)) ||
      (tabId !== undefined && isUuid(tabId as string))
    ) {
      return { routable: true, denyWindowMs: undefined };
    }
    if (cliAgentId !== undefined && cliAgentId.length > 0) {
      return { routable: true, denyWindowMs: CLI_AGENT_PERMISSION_TIMEOUT_MS };
    }
    return { routable: false, denyWindowMs: UNROUTABLE_PERMISSION_TIMEOUT_MS };
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
    routingHint?: string,
    /**
     * Set only for an unattended (policy) session: the deny window replaces
     * the route's window — including the webview's unbounded wait — so the
     * prompt can never have `timeoutAt = 0`. Clamped to at least 1 ms.
     */
    unattendedDenyWindowMs?: number,
  ): Promise<PermissionResult> {
    const startTime = Date.now();

    const requestId = generateRequestId();

    const sanitizedInput = sanitizeToolInput(input);

    // Route and deny window come from one classification — see
    // `classifyPermissionRoute`. Only a webview surface earns an unbounded wait
    // (`timeoutAt = 0`); every other route is bounded so the SDK stream can
    // complete instead of stalling on a tool call forever.
    //
    // Resolved ONCE here, not again inside sendPermissionRequest: the resolver
    // is read live, and a routability verdict that disagrees with the delivery
    // route is the whole defect this replaces.
    const cliAgentId = cliAgentResolver?.();
    const route = this.classifyPermissionRoute(sessionId, tabId, cliAgentId);
    const isRoutable = route.routable;
    const isUnattended = unattendedDenyWindowMs !== undefined;
    const denyWindowMs = isUnattended
      ? Math.max(1, unattendedDenyWindowMs)
      : route.denyWindowMs;
    const timeoutAt = denyWindowMs === undefined ? 0 : startTime + denyWindowMs;

    const description = generateDescription(toolName, sanitizedInput);

    this.emitLifecycle({
      phase: 'requested',
      requestId,
      routingHint,
      toolName,
      description,
      routable: isRoutable,
      timeoutMs: denyWindowMs,
    });

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

    if (isUnattended) {
      this.unattendedRequestIds.add(requestId);
    }
    let response: InternalPermissionResponse | null;
    try {
      this.sendPermissionRequest(request, cliAgentId);

      this.logger.info(`[SdkPermissionHandler] Permission request emitted`, {
        requestId,
        toolName,
        toolUseId,
        emitLatency: Date.now() - startTime,
      });

      response = await this.awaitResponse(
        requestId,
        signal,
        sessionId,
        tabId,
        denyWindowMs,
      );
    } finally {
      this.unattendedRequestIds.delete(requestId);
    }

    this.logger.info(`[SdkPermissionHandler] Permission response received`, {
      requestId,
      totalLatency: Date.now() - startTime,
      decision: response?.decision ?? 'aborted',
    });

    this.emitLifecycle({
      phase: 'resolved',
      requestId,
      routingHint,
      toolName,
      outcome: !response
        ? 'aborted'
        : response.decision === 'allow' || response.decision === 'always_allow'
          ? 'allowed'
          : response.timedOut
            ? 'timed-out'
            : response.systemAbort
              ? 'aborted'
              : 'denied',
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

    // A system abort is NOT a user decision. `interrupt: true` is what makes the
    // CLI substitute its canned "The user doesn't want to take this action right
    // now. STOP what you are doing..." string, which launders a teardown into a
    // deliberate refusal. `deny_with_message` above proves `interrupt: false`
    // plus a rich message is the path whose text actually reaches the model.
    // The turn is torn down by the session's abortController regardless, so
    // dropping `interrupt` here leaves nothing running. See TASK_2026_247.
    if (response.systemAbort) {
      this.logger.warn(
        `[SdkPermissionHandler] Permission request ${requestId} aborted by the system (not a user decision) for tool ${toolName}`,
        {
          decision: 'deny',
          systemAbort: true,
          reason: response.reason || 'Session aborted',
          interrupt: false,
        },
      );
      return {
        behavior: 'deny' as const,
        message: `SYSTEM ABORT — this was NOT a user decision. Ptah cancelled the pending permission request for tool "${toolName}" because the session was being torn down (for example an authentication or configuration change) or the prompt could not be routed to any UI surface before its deny window expired. No human ever saw this prompt, and nobody reviewed or refused the tool call. Do NOT treat this as a user denial and do NOT abandon the work you were asked to do. The operation may be retried once the session is available again. Internal reason: "${
          response.reason || 'Session aborted'
        }".`,
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
        // Unattended sessions never consult "Always Allow" rules.
        if (this.unattendedRequestIds.has(pendingId)) continue;

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

  /**
   * AskUserQuestion requests this session is still blocked on.
   *
   * Serves the `chat:pending-questions` RPC: a webview reload discards the
   * rendered prompt while the SDK call stays parked, so the reloaded UI
   * re-fetches the outstanding requests and renders them again.
   */
  listPendingQuestions(sessionId: string): AskUserQuestionRequest[] {
    return this.askUserQuestion.listPendingBySession(sessionId);
  }

  private async awaitResponse(
    requestId: string,
    signal?: AbortSignal,
    sessionId?: SessionId,
    tabId?: TabId,
    timeoutMs?: number,
  ): Promise<InternalPermissionResponse | null> {
    return new Promise<InternalPermissionResponse | null>((resolve) => {
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

      // Every route except a live webview surface supplies a positive window —
      // deny after it so a prompt that was never rendered, or never answered,
      // cannot wedge the SDK stream forever. The timer is cleared by the resolve
      // wrapper and onAbort above, so a real response or an abort arriving first
      // cancels it (no late deny, no leak).
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
            `[SdkPermissionHandler] Permission request timed out — denying`,
            { requestId, toolName: context?.toolName, timeoutMs },
          );
          pending.resolve({
            id: requestId,
            decision: 'deny',
            systemAbort: true,
            timedOut: true,
            reason: `Permission request timed out after ${timeoutMs}ms with no answer from the UI — denying to prevent a permanent hang.`,
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
    // `undefined` means "all sessions" and is a deliberate call. `''` is not a
    // third mode — it is a caller that lost an id. Without this guard it fell
    // through to the global branch and resolved EVERY pending permission in the
    // process as deny/systemAbort, which reaches the model as a user refusal in
    // sessions the caller never meant to touch (TASK_2026_295).
    if (sessionId !== undefined && sessionId.trim().length === 0) {
      this.logger.warn(
        `[SdkPermissionHandler] cleanupPendingPermissions called with an empty sessionId — refusing (an empty id must never mean "all sessions")`,
        {
          pendingPermissionCount: this.pendingRequests.size,
          pendingQuestionCount: this.askUserQuestion.pendingCount,
        },
      );
      return;
    }

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
            systemAbort: true,
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
          systemAbort: true,
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
