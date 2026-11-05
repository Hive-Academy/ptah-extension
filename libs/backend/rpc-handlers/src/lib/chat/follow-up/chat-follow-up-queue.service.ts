/**
 * Chat follow-up queue coordinator (TASK_2026_884).
 *
 * The provider adapter holds a follow-up sent with `queueIntent: 'next-turn'`
 * for its session and admits it as the next turn. This service is the chat
 * side of that queue:
 *
 *  - it remembers which tab queued each held item (`sessionId` +
 *    `clientMessageId` → `tabId`), captured when `chat:continue` hands the item
 *    to the adapter, so a state change is pushed to that tab and only that tab
 *    can list, withdraw or steer it;
 *  - it subscribes to `IAgentAdapter.onQueuedFollowUpState` (feature-checked:
 *    an adapter without it keeps today's behaviour) and pushes every change as
 *    `MESSAGE_TYPES.CHAT_QUEUED_MESSAGE_STATE` straight to the webview. The push
 *    bypasses the stream-viewport suppression, so a hidden tab receives it;
 *  - it withdraws every held item of a session, FIFO, before Stop interrupts.
 *
 * The tab is never resolved from the active tab. It comes from the item's
 * binding, else from the session's live Claude registration.
 *
 * Bindings exist only while an item is held: a terminal state, a confirmed
 * withdraw or steer, an admission that was not held, or a failed send removes
 * it. No timer or observer per item.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, RpcUserError, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS, type SessionLifecycleManager } from '@ptah-extension/agent-sdk';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  ChatQueuedMessageStateEvent,
  IAgentAdapter,
  QueuedFollowUpSnapshot,
  QueuedFollowUpStateChange,
  SessionId,
  SteerQueuedFollowUpResult,
} from '@ptah-extension/shared';

import type { WebviewManager } from '../streaming/chat-stream-broadcaster.service';

/** How `chat:continue` reports an accepted queued send. */
export type FollowUpAcceptance = 'queued' | 'admitted';

/** The live Claude registration lookup this service reads (tab ↔ session). */
type SessionRegistrations = Pick<SessionLifecycleManager, 'find'>;

/** Refusal text shared by every ownership check; it names no id. */
const NOT_THIS_TAB_MESSAGE = 'This conversation is not open in this tab.';

@injectable()
export class ChatFollowUpQueueService {
  /** sessionId → (clientMessageId → tabId) for items still held. */
  private readonly bindings = new Map<string, Map<string, string>>();
  private readonly states = new Map<string, Map<string, QueuedFollowUpStateChange['state']>>();
  private readonly stopGenerations = new Map<string, number>();
  private readonly submissions = new Map<string, Set<Promise<void>>>();
  private readonly unsubscribe: (() => void) | null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager,
    @inject(TOKENS.AGENT_ADAPTER)
    private readonly sdkAdapter: IAgentAdapter,
    /**
     * Optional: a host without the Claude lifecycle manager has no
     * registration to consult, so only the item bindings decide ownership.
     */
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER, { isOptional: true })
    private readonly registrations: SessionRegistrations | null = null,
  ) {
    this.unsubscribe =
      this.sdkAdapter.onQueuedFollowUpState?.((change) =>
        this.onStateChange(change),
      ) ?? null;
  }

  /** Release the adapter subscription. */
  dispose(): void {
    this.unsubscribe?.();
    this.bindings.clear();
    this.states.clear();
    this.stopGenerations.clear();
    this.submissions.clear();
  }

  trackSubmission(sessionId: string, submission: Promise<void>): void {
    const submissions = this.submissions.get(sessionId) ?? new Set<Promise<void>>();
    submissions.add(submission);
    this.submissions.set(sessionId, submissions);
    const remove = () => {
      submissions.delete(submission);
      if (submissions.size === 0) this.submissions.delete(sessionId);
    };
    void submission.then(remove, remove);
  }

  stopGeneration(sessionId: string): number {
    return this.stopGenerations.get(sessionId) ?? 0;
  }

  advanceStopGeneration(sessionId: string): void {
    this.stopGenerations.set(sessionId, this.stopGeneration(sessionId) + 1);
  }

  /**
   * Throw when `sessionId` is open in a different tab: a live Claude
   * registration under another tab, or items held for another tab. A session
   * with neither is unowned and accepted.
   */
  assertTabOwnsSession(sessionId: string, tabId: string): void {
    const owner = this.ownerTab(sessionId);
    if (owner !== undefined && owner !== tabId) {
      throw new RpcUserError(NOT_THIS_TAB_MESSAGE, 'SESSION_NOT_FOUND');
    }
  }

  /** Record the queuing tab BEFORE the adapter sees the item. */
  bind(sessionId: string, tabId: string, clientMessageId: string): void {
    let items = this.bindings.get(sessionId);
    if (!items) {
      items = new Map();
      this.bindings.set(sessionId, items);
    }
    items.set(clientMessageId, tabId);
  }

  /** Drop a binding whose send failed or whose item left the queue. */
  unbind(sessionId: string, clientMessageId: string): void {
    const items = this.bindings.get(sessionId);
    if (!items) return;
    items.delete(clientMessageId);
    if (items.size === 0) this.bindings.delete(sessionId);
  }

  /**
   * After `sendMessageToSession` resolved: `queued` when the adapter still
   * holds the item, otherwise `admitted` (it started a turn, or the adapter has
   * no queue). An admitted item keeps no binding.
   */
  settleAccepted(sessionId: string, clientMessageId: string): FollowUpAcceptance {
    const held = this.heldItems(sessionId).some(
      (item) => item.clientMessageId === clientMessageId,
    );
    if (held) return 'queued';
    const state = this.states.get(sessionId)?.get(clientMessageId);
    if (state !== 'delivered' && state !== 'steered')
      throw new RpcUserError('Follow-up has no queued entry or delivered turn.', 'FOLLOW_UP_ID_CONFLICT');
    this.unbind(sessionId, clientMessageId);
    return 'admitted';
  }

  /** `chat:queued-list`: this tab's held items, FIFO. */
  list(sessionId: string, tabId: string): QueuedFollowUpSnapshot[] {
    this.assertTabOwnsSession(sessionId, tabId);
    return this.heldItems(sessionId).filter(
      (item) => this.boundTab(sessionId, item.clientMessageId) === tabId,
    );
  }

  /** `chat:queued-withdraw`: true only when removed before a turn claimed it. */
  async withdraw(
    sessionId: string,
    tabId: string,
    clientMessageId: string,
  ): Promise<boolean> {
    this.assertTabOwnsSession(sessionId, tabId);
    if (this.boundTab(sessionId, clientMessageId) !== tabId) return false;
    if (!this.sdkAdapter.withdrawQueuedFollowUp) return false;
    const removed = await this.sdkAdapter.withdrawQueuedFollowUp(
      sessionId as SessionId,
      clientMessageId,
    );
    if (removed) this.unbind(sessionId, clientMessageId);
    return removed;
  }

  /** `chat:queued-steer`: Codex `turn/steer`; `UNSUPPORTED` elsewhere. */
  async steer(
    sessionId: string,
    tabId: string,
    clientMessageId: string,
  ): Promise<SteerQueuedFollowUpResult> {
    this.assertTabOwnsSession(sessionId, tabId);
    if (this.boundTab(sessionId, clientMessageId) !== tabId) {
      return { ok: false, code: 'NOT_QUEUED' };
    }
    if (!this.sdkAdapter.steerQueuedFollowUp) {
      return { ok: false, code: 'UNSUPPORTED' };
    }
    const result = await this.sdkAdapter.steerQueuedFollowUp(
      sessionId as SessionId,
      clientMessageId,
    );
    if (result.ok) this.unbind(sessionId, clientMessageId);
    return result;
  }

  /**
   * Stop: withdraw every held item of the session in FIFO order, before the
   * caller interrupts. Returns only the confirmed withdrawals; an item a turn
   * claimed meanwhile (withdraw answered false) is not in it.
   */
  async withdrawAllForStop(sessionId: string): Promise<(QueuedFollowUpSnapshot & { readonly tabId: string })[]> {
    await Promise.allSettled([...(this.submissions.get(sessionId) ?? [])]);
    const adapter = this.sdkAdapter;
    if (!adapter.withdrawQueuedFollowUp) return [];
    const withdrawn: (QueuedFollowUpSnapshot & { readonly tabId: string })[] = [];
    for (const item of this.heldItems(sessionId)) {
      const tabId = this.boundTab(sessionId, item.clientMessageId);
      if (tabId === undefined) continue;
      try {
        const removed = await adapter.withdrawQueuedFollowUp(
          sessionId as SessionId,
          item.clientMessageId,
        );
        if (!removed) continue;
        this.unbind(sessionId, item.clientMessageId);
        withdrawn.push({ ...item, tabId });
      } catch (error: unknown) {
        // degradation-audit: reported - Stop must still interrupt; an item that could not be withdrawn stays held and the session end fails it.
        this.logger.warn(
          '[RPC] chat:abort could not withdraw a queued follow-up',
          error instanceof Error ? error : new Error(String(error)),
          { sessionId },
        );
      }
    }
    return withdrawn;
  }

  private onStateChange(change: QueuedFollowUpStateChange): void {
    const sessionId = change.sessionId as string;
    const states = this.states.get(sessionId) ?? new Map<string, QueuedFollowUpStateChange['state']>();
    states.set(change.clientMessageId, change.state);
    this.states.set(sessionId, states);
    const tabId =
      this.boundTab(sessionId, change.clientMessageId) ??
      this.registeredTab(sessionId);
    if (change.state !== 'queued') this.unbind(sessionId, change.clientMessageId);
    if (tabId === undefined) {
      this.logger.debug('[RPC] queued follow-up state has no tab', {
        sessionId,
        state: change.state,
      });
      return;
    }
    const payload: ChatQueuedMessageStateEvent = {
      sessionId: change.sessionId,
      tabId,
      clientMessageId: change.clientMessageId,
      state: change.state,
      ...(change.reason !== undefined ? { reason: change.reason } : {}),
    };
    this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.CHAT_QUEUED_MESSAGE_STATE, payload)
      .catch((error: unknown) => {
        // degradation-audit: reported - a lost push is recovered by chat:queued-list on reconnect.
        this.logger.warn(
          '[RPC] failed to deliver a queued follow-up state',
          error instanceof Error ? error : new Error(String(error)),
          { sessionId, state: change.state },
        );
      });
  }

  private heldItems(sessionId: string): QueuedFollowUpSnapshot[] {
    return [...(this.sdkAdapter.listQueuedFollowUps?.(sessionId as SessionId) ?? [])];
  }

  private boundTab(sessionId: string, clientMessageId: string): string | undefined {
    return this.bindings.get(sessionId)?.get(clientMessageId);
  }

  /** Tab of the live Claude record registered under this real session id. */
  private registeredTab(sessionId: string): string | undefined {
    const record = this.registrations?.find(sessionId);
    return record?.realSessionId === sessionId ? record.tabId : undefined;
  }

  private ownerTab(sessionId: string): string | undefined {
    const registered = this.registeredTab(sessionId);
    if (registered !== undefined) return registered;
    const items = this.bindings.get(sessionId);
    return items ? items.values().next().value : undefined;
  }
}
