/**
 * ChildChatSessionHostAdapter — the chat-path host port (TASK_2026_584).
 *
 * `cli-agent-runtime`'s session spawner starts a child chat session through
 * `IChildChatSessionHost`; it cannot reach the chat internals itself because
 * `rpc-handlers` sits above it. This adapter is the implementation every host
 * that runs `registerChatServices` gets, bound under
 * `CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST`.
 *
 * Order matters: the tab is announced BEFORE the session starts, so it exists
 * when the child's first chunk arrives. The announcement never blocks the
 * start — with no webview the broadcaster still drains the stream and the tab
 * is adopted late through `chat:agent-sessions`.
 *
 * A failed start after a successful announcement would leave the adopted tab
 * spinning: chat errors are emitted only from the stream loop, which a failed
 * launch never reaches. So the adapter sends that tab exactly one
 * `chat:error` itself. Nothing here ever throws into the spawner.
 */

import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'node:crypto';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ChildChatSessionStartInput,
  ChildChatSessionStartOutcome,
  IChildChatSessionHost,
  SuccessorSessionQueuedInput,
  StartSuccessorSessionInput,
} from '@ptah-extension/cli-agent-runtime';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../tokens';
import type { ChatSessionService } from './chat-session.service';
import type { WebviewManager } from '../streaming/chat-stream-broadcaster.service';

/** The UI must bind and focus before the source can be closed. */
export const SUCCESSOR_BIND_TIMEOUT_MS = 15_000;

interface PendingSuccessorBind {
  readonly sourceTabId: string;
  readonly successorTabId: string;
  readonly resolve: () => void;
}

@injectable()
export class ChildChatSessionHostAdapter implements IChildChatSessionHost {
  private readonly pendingSuccessorBinds = new Map<string, PendingSuccessorBind>();
  private readonly boundSuccessors = new Map<string, string>();
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(CHAT_TOKENS.SESSION)
    private readonly session: ChatSessionService,
  ) {}

  async startChildSession(
    input: ChildChatSessionStartInput,
  ): Promise<ChildChatSessionStartOutcome> {
    const uiAnnounced = await this.announce(input);

    let error: string;
    try {
      const result = await this.session.startAgentChildSession({
        tabId: input.tabId,
        workspaceRoot: input.workspaceRoot,
        worktreePath: input.worktreePath,
        prompt: input.prompt,
        sessionName: input.sessionName,
        model: input.model,
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
      await this.reportStartFailure(input.tabId, error);
    }
    return { started: false, error };
  }

  async startSuccessorSession(
    input: StartSuccessorSessionInput,
  ): Promise<ChildChatSessionStartOutcome> {
    const successorTabId = randomUUID();
    const config = input.source.successorConfig;
    try {
      const started = await this.session.startHandoverSuccessor({
        tabId: successorTabId,
        workspaceRoot: config.workspacePath,
        worktreePath: input.resourceLease.worktreePath,
        seed: input.seed,
        model: config.model,
        effort: config.effort,
        permissionLevel: config.permissionLevel,
      });
      if (!started.success) {
        return { started: false, error: started.error ?? 'successor start failed' };
      }

      if (!this.hasInteractiveWebview()) {
        this.boundSuccessors.set(input.operationId, successorTabId);
        return { started: true, uiAnnounced: false, successorTabId };
      }

      const bound = await this.requestSuccessorBind(input, successorTabId);
      if (bound) {
        this.boundSuccessors.set(input.operationId, successorTabId);
        return { started: true, uiAnnounced: true, successorTabId };
      }

      await this.stopSuccessor(successorTabId);
      return { started: false, error: 'successor tab was not bound before timeout' };
    } catch (error: unknown) {
      await this.stopSuccessor(successorTabId);
      return {
        started: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async deliverTransferInputs(
    operationId: string,
    inputs: readonly SuccessorSessionQueuedInput[],
  ): Promise<{ readonly delivered: boolean; readonly error?: string }> {
    const successorTabId = this.boundSuccessors.get(operationId);
    if (!successorTabId) {
      return { delivered: false, error: 'successor was not bound' };
    }
    const delivered = await this.session.deliverHandoverInputs(successorTabId, inputs);
    this.boundSuccessors.delete(operationId);
    if (!delivered.delivered) await this.stopSuccessor(successorTabId);
    return delivered;
  }

  async stopSuccessorSession(operationId: string): Promise<void> {
    const successorTabId = this.boundSuccessors.get(operationId);
    if (!successorTabId) return;
    this.boundSuccessors.delete(operationId);
    await this.stopSuccessor(successorTabId);
  }

  acknowledgeSuccessorBound(
    operationId: string,
    sourceTabId: string,
    successorTabId: string,
  ): boolean {
    const pending = this.pendingSuccessorBinds.get(operationId);
    if (
      !pending ||
      pending.sourceTabId !== sourceTabId ||
      pending.successorTabId !== successorTabId
    ) {
      return false;
    }
    this.pendingSuccessorBinds.delete(operationId);
    pending.resolve();
    return true;
  }

  private hasInteractiveWebview(): boolean {
    const manager = this.webviewManager as WebviewManager & {
      getActiveWebviews?: () => readonly string[];
    };
    return (manager.getActiveWebviews?.().length ?? 0) > 0;
  }

  private async requestSuccessorBind(
    input: StartSuccessorSessionInput,
    successorTabId: string,
  ): Promise<boolean> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const acknowledged = new Promise<void>((resolve) => {
      this.pendingSuccessorBinds.set(input.operationId, {
        sourceTabId: input.source.tabId,
        successorTabId,
        resolve,
      });
    });
    try {
      await this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.SESSION_SUCCESSOR_REPLACEMENT,
        {
          operationId: input.operationId,
          sourceSessionId: input.source.sessionId,
          sourceTabId: input.source.tabId,
          successorSessionId: successorTabId,
          successorTabId,
          config: input.source.successorConfig,
        },
      );
      await Promise.race([
        acknowledged,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, SUCCESSOR_BIND_TIMEOUT_MS);
        }),
      ]);
      return !this.pendingSuccessorBinds.has(input.operationId);
    } finally {
      if (timeout) clearTimeout(timeout);
      this.pendingSuccessorBinds.delete(input.operationId);
    }
  }

  private async stopSuccessor(tabId: string): Promise<void> {
    try {
      await this.session.stopHandoverSuccessor(tabId);
    } catch (error: unknown) {
      this.logger.warn('[ChildChatSessionHost] successor cleanup failed', {
        tabId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Push the tab descriptor; `true` only when the broadcast resolved. */
  private async announce(input: ChildChatSessionStartInput): Promise<boolean> {
    try {
      await this.webviewManager.broadcastMessage(
        MESSAGE_TYPES.AGENT_SESSION_OPENED,
        input.descriptor,
      );
      return true;
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a failed broadcast degrades
      // to a headless start (`uiAnnounced: false`); the session still starts
      // and the webview adopts the tab late through `chat:agent-sessions`.
      this.logger.warn(
        '[ChildChatSessionHost] agentSession:opened broadcast failed; the tab is adopted on the next webview load',
        {
          tabId: input.tabId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return false;
    }
  }

  /**
   * Reset the announced tab. A failing broadcast is logged and does not change
   * the outcome the spawner receives.
   */
  private async reportStartFailure(
    tabId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_ERROR, {
        tabId,
        sessionId: tabId,
        error: `Child session could not start: ${reason}`,
      });
    } catch (error: unknown) {
      this.logger.warn(
        '[ChildChatSessionHost] chat:error broadcast for a failed child start failed',
        {
          tabId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
