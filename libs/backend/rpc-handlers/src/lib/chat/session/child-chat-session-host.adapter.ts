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
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import type {
  ChildChatSessionStartInput,
  ChildChatSessionStartOutcome,
  IChildChatSessionHost,
} from '@ptah-extension/cli-agent-runtime';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

import { CHAT_TOKENS } from '../tokens';
import type { ChatSessionService } from './chat-session.service';
import type { WebviewManager } from '../streaming/chat-stream-broadcaster.service';

@injectable()
export class ChildChatSessionHostAdapter implements IChildChatSessionHost {
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
    } catch (thrown: unknown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
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
