/**
 * ChildChatSessionHostAdapter — the chat-path host port (TASK_2026_584,
 * TASK_2026_655).
 *
 * `cli-agent-runtime` starts agent-started sessions through
 * `IChildChatSessionHost`; it cannot reach the chat internals itself because
 * `rpc-handlers` sits above it. This adapter is the implementation every host
 * that runs `registerChatServices` gets, bound under
 * `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST`. It starts two kinds:
 * a child session (`ptah_session_start`, announced with `agentSession:opened`)
 * and a top-level handoff session (`ptah_session_handoff`, announced with
 * `sessionHandoff:opened`).
 *
 * Order matters: the tab is announced BEFORE the session starts, so it exists
 * when the session's first chunk arrives. `uiAnnounced` is `true` only when at
 * least one open webview accepted the announcement. The announcement never
 * blocks the start — with no webview the broadcaster still drains the stream;
 * a child tab is adopted late through `chat:agent-sessions` and a handoff
 * session is listed in the sessions sidebar.
 *
 * A failed start after a successful announcement would leave the adopted tab
 * spinning: chat errors are emitted only from the stream loop, which a failed
 * launch never reaches. So the adapter sends that tab exactly one
 * `chat:error` itself. Each call starts at most one session and never
 * retries. Nothing here ever throws into the runtime.
 */

import { inject, injectable } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  safeErrorKind,
  type ChildChatSessionStartInput,
  type ChildChatSessionStartOutcome,
  type HandoffChatSessionStartInput,
  type IChildChatSessionHost,
} from '@ptah-extension/cli-agent-runtime';
import {
  SDK_TOKENS,
  type SessionLifecycleManager,
} from '@ptah-extension/agent-sdk';
import {
  MESSAGE_TYPES,
  type AgentSessionOpenedPayload,
  type SessionHandoffOpenedPayload,
} from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../tokens';
import type { ChatSessionService } from './chat-session.service';

/**
 * The `TOKENS.WEBVIEW_MANAGER` slice this adapter uses. `broadcastMessage`
 * gives no delivery answer (it resolves with no webview open and when a post
 * fails), so the announcement enumerates the open surfaces and sends to each.
 * Every bound manager implements this pair — VS Code's `WebviewManager`,
 * `ElectronWebviewManagerAdapter` and `CliWebviewManagerAdapter` — as
 * `createDashboardBroadcast` already relies on.
 */
export interface TabAnnouncementHost {
  getActiveWebviews(): readonly string[];
  sendMessage(
    viewType: string,
    type: string,
    payload: unknown,
  ): Promise<boolean>;
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

@injectable()
export class ChildChatSessionHostAdapter implements IChildChatSessionHost {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: TabAnnouncementHost,
    @inject(CHAT_TOKENS.SESSION)
    private readonly session: ChatSessionService,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, { isOptional: true })
    private readonly lifecycle: SessionLifecycleManager | null = null,
  ) {}

  async startChildSession(
    input: ChildChatSessionStartInput,
  ): Promise<ChildChatSessionStartOutcome> {
    const uiAnnounced = await this.announce(
      MESSAGE_TYPES.AGENT_SESSION_OPENED,
      input.descriptor,
    );
    // The child inherits the parent's live permission level, so a parent in
    // YOLO does not spawn a child that prompts for every out-of-policy call.
    const permissionLevel =
      input.permissionLevel ??
      this.lifecycle?.find(input.descriptor.parentTabId)?.permissionLevel;

    let error: string;
    try {
      const result = await this.session.startAgentChildSession({
        tabId: input.tabId,
        workspaceRoot: input.workspaceRoot,
        worktreePath: input.worktreePath,
        prompt: input.prompt,
        sessionName: input.sessionName,
        model: input.model,
        ...(permissionLevel ? { permissionLevel } : {}),
      });
      if (result.success) {
        return { started: true, uiAnnounced };
      }
      error = result.error || 'unknown error';
    } catch (error_: unknown) {
      error = error_ instanceof Error ? error_.message : String(error_);
    }

    this.logger.warn('[ChildChatSessionHost] child session did not start', {
      tabId: input.tabId,
      uiAnnounced,
      error,
    });
    if (uiAnnounced) {
      await this.reportStartFailure(
        input.tabId,
        `Child session could not start: ${error}`,
      );
    }
    return { started: false, error };
  }

  /**
   * Start the top-level session that continues a handing-off session. The
   * `ChatSessionService` result is prompt-free by construction (fixed refusal
   * texts, or the launch error's allowlisted kind), so it is safe to log and
   * to show; a throw, which breaks that method's never-throw contract, is
   * reduced to its allowlisted kind for the same reason.
   */
  async startHandoffSession(
    input: HandoffChatSessionStartInput,
  ): Promise<ChildChatSessionStartOutcome> {
    const uiAnnounced = await this.announce(
      MESSAGE_TYPES.SESSION_HANDOFF_OPENED,
      input.descriptor,
    );
    // The new session keeps the caller's live level (its lifecycle record,
    // which the autopilot toggle writes), so a user in full autopilot is not
    // asked again for what they already granted. The runtime reads it at
    // handoff time; the record is the fallback. Neither → the global default.
    const permissionLevel =
      input.permissionLevel ??
      this.lifecycle?.find(input.descriptor.fromTabId)?.permissionLevel;

    let error: string;
    try {
      const result = await this.session.startHandoffSession({
        tabId: input.tabId,
        workspaceRoot: input.workspaceRoot,
        cwd: input.cwd,
        prompt: input.prompt,
        sessionName: input.sessionName,
        ...(input.model ? { model: input.model } : {}),
        ...(permissionLevel ? { permissionLevel } : {}),
      });
      if (result.success) {
        return { started: true, uiAnnounced };
      }
      error = result.error || 'unknown error';
    } catch (error_: unknown) {
      error = `the session launch threw (${safeErrorKind(error_)}).`;
    }

    this.logger.warn('[ChildChatSessionHost] handoff session did not start', {
      tabId: input.tabId,
      uiAnnounced,
      error,
    });
    if (uiAnnounced) {
      await this.reportStartFailure(
        input.tabId,
        `Handoff session could not start: ${error}`,
      );
    }
    return { started: false, error };
  }

  /**
   * Send the tab descriptor to every open webview; `true` only when at least
   * one accepted it. No open webview, a `false` send and a throwing send are
   * all "not announced". The descriptor carries the prompt, so a failure is
   * logged by its allowlisted kind only.
   */
  private async announce(
    type:
      | typeof MESSAGE_TYPES.AGENT_SESSION_OPENED
      | typeof MESSAGE_TYPES.SESSION_HANDOFF_OPENED,
    descriptor: AgentSessionOpenedPayload | SessionHandoffOpenedPayload,
  ): Promise<boolean> {
    const failureKinds: string[] = [];
    let surfaces: readonly string[] = [];
    let delivered = 0;
    try {
      surfaces = this.webviewManager.getActiveWebviews();
      // Deferred, so a synchronous throw counts as a failed send too.
      const results = await Promise.all(
        surfaces.map((viewType) =>
          Promise.resolve()
            .then(() =>
              this.webviewManager.sendMessage(viewType, type, descriptor),
            )
            .then(
              (ok) => ok === true,
              (error: unknown) => {
                failureKinds.push(safeErrorKind(error));
                return false;
              },
            ),
        ),
      );
      delivered = results.filter(Boolean).length;
    } catch (error: unknown) {
      // Enumeration racing a disposal is a headless start, logged below
      // like a failed send.
      failureKinds.push(safeErrorKind(error));
    }
    if (delivered > 0) return true;
    // An undelivered announcement degrades to a headless start
    // (`uiAnnounced: false`); the session still
    // starts. A child tab is adopted late through `chat:agent-sessions`; a
    // handoff session is listed in the sessions sidebar.
    this.logger.warn(
      `[ChildChatSessionHost] ${type} reached no webview; starting without a tab`,
      { tabId: descriptor.tabId, surfaces: surfaces.length, failureKinds },
    );
    return false;
  }

  /**
   * Reset the announced tab with `message`. A failing broadcast is logged and
   * does not change the outcome the runtime receives.
   */
  private async reportStartFailure(
    tabId: string,
    message: string,
  ): Promise<void> {
    try {
      await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_ERROR, {
        tabId,
        sessionId: tabId,
        error: message,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[ChildChatSessionHost] chat:error broadcast for a failed start failed',
        { tabId, errorKind: safeErrorKind(error) },
      );
    }
  }
}
