import { inject, Injectable } from '@angular/core';
import type {
  AgentFeedbackSendResult,
  AgentFeedbackTarget,
  IAgentFeedbackSender,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ChatStore } from '../chat.store';

/**
 * Chat implementation of the `AGENT_FEEDBACK_SENDER` port: delivers review
 * feedback to a chat session through `ChatStore.sendOrQueueMessage`, so it
 * gets the same send-vs-queue routing as a typed message (a busy session
 * queues it for the end of the running turn).
 *
 * A session target is resolved to its tab across workspaces. When that tab
 * lives in the active workspace it is brought to the front first, so the user
 * sees the feedback land; a tab parked in a background workspace receives it
 * in place (`tabId` routing is workspace-aware).
 *
 * Never rejects: every failure resolves `sent: false` with a user-facing
 * `error`, so the caller keeps its drafts.
 */
@Injectable({ providedIn: 'root' })
export class ChatAgentFeedbackSender implements IAgentFeedbackSender {
  private readonly chatStore = inject(ChatStore);
  private readonly tabManager = inject(TabManagerService);

  async send(
    target: AgentFeedbackTarget,
    text: string,
  ): Promise<AgentFeedbackSendResult> {
    if (!text.trim()) {
      return { sent: false, error: 'There is no feedback to send.' };
    }
    const tabId =
      target === 'active'
        ? this.tabManager.activeTabId()
        : this.activateSessionTab(target.sessionId);
    if (!tabId) {
      return {
        sent: false,
        error:
          target === 'active'
            ? 'No chat session is open.'
            : 'That session is not open in a chat tab.',
      };
    }
    try {
      const outcome = await this.chatStore.sendOrQueueMessage(text, { tabId });
      return outcome.success
        ? { sent: true }
        : {
            sent: false,
            error: outcome.error ?? 'The message could not be sent.',
          };
    } catch (error: unknown) {
      return {
        sent: false,
        error:
          error instanceof Error && error.message
            ? error.message
            : 'The message could not be sent.',
      };
    }
  }

  /** Resolves the session's tab id, switching to it when it is in the active workspace. */
  private activateSessionTab(sessionId: string): string | null {
    const found =
      this.tabManager.findTabBySessionIdAcrossWorkspaces(sessionId)?.tab;
    if (!found) return null;
    const inActiveWorkspace = this.tabManager
      .tabs()
      .some((tab) => tab.id === found.id);
    if (inActiveWorkspace && this.tabManager.activeTabId() !== found.id) {
      this.tabManager.switchTab(found.id);
    }
    return found.id;
  }
}
