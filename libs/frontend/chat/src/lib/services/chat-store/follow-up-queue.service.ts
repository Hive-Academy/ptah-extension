import {
  DestroyRef,
  Injectable,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import {
  AuthStateService,
  ClaudeRpcService,
  LoggingService,
} from '@ptah-extension/core';
import {
  createExecutionChatMessage,
  SessionId,
  type QueuedFollowUpSnapshot,
} from '@ptah-extension/shared';
import {
  CommandCenterSendLockService,
  QueuedFollowUpStore,
  TabManagerService,
  type ClosedTabEvent,
  type QueuedFollowUpEntry,
  type QueuedFollowUpRef,
} from '@ptah-extension/chat-state';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import type { SendMessageOptions, TabState } from '@ptah-extension/chat-types';
import { ActionBannerService } from '../action-banner.service';
import { ComposerRestoreService } from '../composer-restore.service';
import { MessageSenderService } from '../message-sender.service';
import { MessageValidationService } from '../message-validation.service';
import { StreamViewportController } from '../stream-viewport-controller.service';
import {
  parseQueuedMessageStateEvent,
  validSnapshots,
} from './queued-follow-up-event';
import { isTabBusyGenerating } from './tab-busy';

/** The backend's slash-command test: a message is a command only when it starts with one. */
const SLASH_COMMAND = /^\/[a-zA-Z]/;
const CODEX_PROVIDER_ID = 'openai-codex';
const LOG = 'FollowUpQueueService';

const NOTE = {
  turnChanged: 'The turn changed. It stays queued for the next turn.',
  unsupported: 'Send now is not available for this session.',
  sessionEnded: 'The session ended.',
  steerFailed: 'Could not send it now. It stays queued.',
} as const;

/**
 * Backend-owned follow-up queue, renderer side (TASK_2026_884).
 *
 * A message typed while the tab's turn runs is handed to the backend AT ONCE
 * (`chat:continue` + `queueIntent: 'next-turn'`) for the tab and session
 * captured when it was typed; the backend admits it as the next turn of that
 * session, whether or not the tab is shown. Nothing here waits for a terminal
 * `turn_state` to release a text follow-up, and nothing is ever sent to a
 * session other than the captured one.
 *
 * The renderer holds an item itself (`held`) only while it cannot hand it
 * over yet, and sends it, in FIFO order, once that clears:
 * - a slash command (the backend never queues one): sent as a normal
 *   `chat:continue` when nothing older is pending and the tab is idle — by
 *   status alone for a hidden tab, whose stream is not delivered;
 * - anything typed after a held command, so order is kept;
 * - a tab whose new session is not bound yet (sent once it is);
 * - a tab held by the Command Center send lock (sent after release).
 *
 * Failed items become an editable composer draft. Stop returns the confirmed
 * withdrawn items and the held ones to the composer, in FIFO order.
 */
@Injectable({ providedIn: 'root' })
export class FollowUpQueueService {
  private readonly stopWithdrawals = new Map<string, (QueuedFollowUpSnapshot & { tabId: string })[]>();
  private readonly store = inject(QueuedFollowUpStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly sender = inject(MessageSenderService);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly viewport = inject(StreamViewportController);
  private readonly sendLock = inject(CommandCenterSendLockService);
  private readonly composerRestore = inject(ComposerRestoreService);
  private readonly actionBanner = inject(ActionBannerService);
  private readonly authState = inject(AuthStateService);
  private readonly validator = inject(MessageValidationService);
  private readonly logger = inject(LoggingService);

  /** Tabs with one send in flight: one at a time per tab keeps FIFO order. */
  private readonly sending = new Set<string>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(
      this.tabManager.onTabClosed((event) => this.onTabClosed(event)),
    );
    // Wakes only while something is held: with no held item the effect reads
    // nothing else, so it costs nothing per tab update.
    effect(() => {
      const tabIds = this.store.tabsWithHeldEntries();
      if (tabIds.length === 0) return;
      this.tabManager.tabs();
      this.tabManager.backgroundTabsRevision();
      this.tabManager.streamingTabIds();
      this.sendLock.state();
      untracked(() => {
        for (const tabId of tabIds) this.pump(tabId);
      });
    });
    // A removed workspace takes its tabs with no close event.
    effect(() => {
      if (!this.tabManager.removedWorkspace$()) return;
      untracked(() => this.forgetRemovedTabs());
    });
  }

  /** Whether the tab's current view has a follow-up waiting. Reactive. */
  hasPending(tabId: string): boolean {
    const tab = this.findTab(tabId);
    return this.store.hasPendingForView(tabId, tab?.claudeSessionId ?? null);
  }

  /**
   * Queue `content` for the tab (the caller decided the tab cannot take a
   * normal send now). Returns at once, before any RPC, so the composer can
   * clear; the outcome arrives through the store. `null` for invalid text.
   */
  enqueue(
    tabId: string,
    content: string,
    options?: SendMessageOptions & { ownerToken?: string },
  ): QueuedFollowUpRef | null {
    const validation = this.validator.validate(content);
    if (!validation.valid) {
      this.logger.warn(LOG, 'invalid follow-up content', validation.reason);
      return null;
    }
    const sanitized = this.validator.sanitize(content);
    const sendOptions: SendMessageOptions = {
      ...(options?.files?.length ? { files: options.files } : {}),
      ...(options?.images?.length ? { images: options.images } : {}),
      ...(options?.effort !== undefined ? { effort: options.effort } : {}),
    };
    const ownerToken = options?.ownerToken;
    const tab = this.findTab(tabId);
    const entry: QueuedFollowUpEntry = {
      clientMessageId: uuidv4(),
      tabId,
      sessionId: tab?.claudeSessionId ?? null,
      content: sanitized,
      ...(Object.keys(sendOptions).length > 0 ? { options: sendOptions } : {}),
      ...(ownerToken ? { ownerToken } : {}),
      isCommand: SLASH_COMMAND.test(sanitized.trim()),
      phase: 'held',
    };
    this.store.add(entry);
    this.pump(tabId);
    return {
      clientMessageId: entry.clientMessageId,
      tabId,
      sessionId: entry.sessionId,
    };
  }

  /** Apply one `chat:queued-message-state` push. It never releases anything. */
  handleStateEvent(payload: unknown): void {
    const event = parseQueuedMessageStateEvent(payload);
    if (!event) return;
    const entry = this.store.get(event.clientMessageId);
    if (!entry || entry.tabId !== event.tabId) return;
    if (entry.sessionId !== null && entry.sessionId !== event.sessionId) return;
    switch (event.state) {
      case 'queued':
        if (entry.phase === 'submitting') {
          this.store.update(entry.clientMessageId, { phase: 'queued' });
        }
        return;
      case 'delivered':
      case 'steered':
        this.deliver(entry.clientMessageId, event.state);
        return;
      case 'withdrawn':
        if (this.stopWithdrawals.has(event.sessionId)) {
          this.stopWithdrawals.get(event.sessionId)?.push({
            clientMessageId: entry.clientMessageId,
            content: entry.content,
            tabId: entry.tabId,
          });
        }
        // The caller that withdrew it (Withdraw or Stop) restores the text
        // from its own reply.
        this.store.settle(entry.clientMessageId, 'withdrawn');
        return;
      case 'failed':
        this.fail(entry.clientMessageId, event.reason);
        return;
    }
  }

  /** Add the backend's held items of a session view this renderer missed. */
  async reconcile(tabId: string, sessionId: string): Promise<void> {
    const session = SessionId.safeParse(sessionId);
    if (!session) return;
    try {
      const result = await this.rpc.call('chat:queued-list', {
        sessionId: session,
        tabId,
      });
      if (!result.success || !result.data) return;
      // The view may have moved on during the await; the items stay keyed to
      // the captured tab and session either way.
      if (!this.findTab(tabId)) return;
      this.store.reconcile(tabId, sessionId, validSnapshots(result.data.items));
    } catch (error: unknown) {
      this.logger.warn(LOG, 'chat:queued-list failed', error);
    }
  }

  /**
   * Withdraw one item. With `restore`, its text goes back to the composer
   * (the composer's Withdraw); the automatic hand-off's Cancel discards it.
   * False when it was already claimed by a turn or is mid-submission.
   */
  async withdraw(
    ref: QueuedFollowUpRef,
    options: { restore: boolean },
  ): Promise<boolean> {
    const entry = this.store.get(ref.clientMessageId);
    if (!entry || entry.phase === 'submitting') return false;
    if (entry.phase === 'held') {
      this.store.settle(entry.clientMessageId, 'withdrawn');
      if (options.restore) this.toComposer(entry.tabId, [entry.content]);
      this.pump(entry.tabId);
      return true;
    }
    const session = entry.sessionId && SessionId.safeParse(entry.sessionId);
    if (!session) return false;
    try {
      const result = await this.rpc.call('chat:queued-withdraw', {
        sessionId: session,
        tabId: entry.tabId,
        clientMessageId: entry.clientMessageId,
      });
      if (!result.success || result.data?.withdrawn !== true) return false;
      this.store.settle(entry.clientMessageId, 'withdrawn');
      if (options.restore) this.toComposer(entry.tabId, [entry.content]);
      this.pump(entry.tabId);
      return true;
    } catch (error: unknown) {
      this.logger.warn(LOG, 'chat:queued-withdraw failed', error);
      return false;
    }
  }

  /** "Send now" is offered only for a Codex session (`turn/steer`). Reactive. */
  canSendNow(tabId: string): boolean {
    const tab = this.findTab(tabId);
    if (!tab?.claudeSessionId) return false;
    const providerId = tab.providerId ?? this.authState.activeProviderId();
    return providerId === CODEX_PROVIDER_ID;
  }

  /**
   * Codex only: move a queued item into the running turn. On `TURN_CHANGED`
   * it stays queued with a short note.
   */
  async sendNow(ref: QueuedFollowUpRef): Promise<void> {
    const entry = this.store.get(ref.clientMessageId);
    const session = entry?.sessionId && SessionId.safeParse(entry.sessionId);
    if (!entry || entry.phase !== 'queued' || !session) return;
    this.store.update(entry.clientMessageId, { note: undefined });
    try {
      const result = await this.rpc.call('chat:queued-steer', {
        sessionId: session,
        tabId: entry.tabId,
        clientMessageId: entry.clientMessageId,
      });
      const data = result.success ? result.data : undefined;
      if (!data) return this.noteFor(entry, NOTE.steerFailed);
      if (data.ok) return this.deliver(entry.clientMessageId, 'steered');
      switch (data.code) {
        case 'TURN_CHANGED':
          return this.noteFor(entry, NOTE.turnChanged);
        case 'UNSUPPORTED':
          return this.noteFor(entry, NOTE.unsupported);
        case 'SESSION_ENDED':
          return this.noteFor(entry, NOTE.sessionEnded);
        case 'NOT_QUEUED':
          return; // already claimed or withdrawn; its push settles it
      }
    } catch (error: unknown) {
      this.logger.warn(LOG, 'chat:queued-steer failed', error);
      this.noteFor(entry, NOTE.steerFailed);
    }
  }

  /**
   * Stop, before `chat:abort`: take the tab's held items of the stopped
   * session so none of them starts a turn after the interrupt.
   */
  takeHeldForStop(tabId: string, sessionId: string): readonly string[] {
    const held = this.store
      .forView(tabId, sessionId)
      .filter((entry) => entry.phase === 'held');
    for (const entry of held) this.store.settle(entry.clientMessageId, 'withdrawn');
    return held.map((entry) => entry.content);
  }

  beginStop(sessionId: string): void {
    this.stopWithdrawals.set(sessionId, []);
  }

  endStop(sessionId: string): readonly (QueuedFollowUpSnapshot & { tabId: string })[] {
    const withdrawn = this.stopWithdrawals.get(sessionId) ?? [];
    this.stopWithdrawals.delete(sessionId);
    return withdrawn;
  }

  /**
   * Stop, after `chat:abort`: the items the backend confirmed withdrawn come
   * back first (they are older), then the held ones, all in FIFO order.
   */
  restoreAfterStop(
    tabId: string,
    withdrawn: unknown,
    heldTexts: readonly string[],
  ): void {
    const snapshots = validSnapshots(withdrawn).filter(
      (snapshot): snapshot is QueuedFollowUpSnapshot & { tabId: string } =>
        typeof (snapshot as { tabId?: unknown }).tabId === 'string',
    );
    for (const snapshot of snapshots) {
      this.store.settle(snapshot.clientMessageId, 'withdrawn');
    }
    for (const owner of new Set(snapshots.map((snapshot) => snapshot.tabId))) {
      this.toComposer(owner, snapshots.filter((snapshot) => snapshot.tabId === owner).map((snapshot) => snapshot.content));
    }
    this.toComposer(tabId, heldTexts);
  }

  /**
   * A failed turn (`chat:error`): nothing the renderer holds may start a turn
   * on its own afterwards. Held items become a composer draft.
   */
  draftHeld(tabId: string): void {
    const held = this.store.forTab(tabId).filter((e) => e.phase === 'held');
    for (const entry of held) this.store.settle(entry.clientMessageId, 'failed');
    this.toComposer(tabId, held.map((entry) => entry.content));
  }

  /** Send the oldest held item of the tab when nothing blocks it. */
  private pump(tabId: string): void {
    if (this.sending.has(tabId)) return;
    const tab = this.findTab(tabId);
    if (!tab) return;
    const bound = tab.claudeSessionId;
    if (!bound) return; // a new session is still starting
    this.draftHeldOfOtherSessions(tab, bound);
    const entries = this.store.forTab(tabId);
    const index = entries.findIndex((e) => e.phase === 'held');
    if (index < 0) return;
    const entry = entries[index];
    if (this.sendLock.isHeld(tabId, entry.ownerToken)) return;
    if (entry.isCommand) {
      // Every older item must be settled and the turn over: the backend
      // runs a slash command only as a normal turn.
      if (index > 0 || !this.isIdle(tab)) return;
      void this.sendCommand(entry, bound);
      return;
    }
    if (entries.slice(0, index).some((e) => e.phase === 'submitting')) return;
    void this.submit(entry, bound);
  }

  /** Held items captured for an earlier session of the tab are never sent there. */
  private draftHeldOfOtherSessions(tab: TabState, bound: string): void {
    const stale = this.store
      .forTab(tab.id)
      .filter(
        (e) => e.phase === 'held' && e.sessionId !== null && e.sessionId !== bound,
      );
    for (const entry of stale) this.store.settle(entry.clientMessageId, 'failed');
    this.toComposer(tab.id, stale.map((entry) => entry.content));
  }

  private async submit(entry: QueuedFollowUpEntry, sessionId: SessionId): Promise<void> {
    const { tabId, clientMessageId } = entry;
    this.sending.add(tabId);
    this.store.update(clientMessageId, { phase: 'submitting', sessionId });
    let outcome: 'queued' | 'admitted' | 'failed' = 'failed';
    let startedTurn = false;
    try {
      const result = await this.sender.submitQueuedFollowUp({
        content: entry.content,
        sessionId,
        tabId,
        clientMessageId,
        options: entry.options,
      });
      const data = result.data;
      if (result.success && data?.success !== false && data?.cancelled !== true) {
        outcome = data?.queueState === 'queued' ? 'queued' : 'admitted';
        startedTurn = data?.enqueued === true && data.settled !== true;
      }
    } catch (error: unknown) {
      this.logger.warn(LOG, 'queued chat:continue failed', error);
    } finally {
      this.sending.delete(tabId);
    }
    // A push may have settled it while the RPC was in flight.
    const current = this.store.get(clientMessageId);
    if (current) {
      if (outcome === 'queued') {
        if (current.phase === 'submitting') {
          this.store.update(clientMessageId, { phase: 'queued' });
        }
      } else if (outcome === 'admitted') {
        // The session was idle, so the message started a turn at once. Status
        // only: the turn's own turn_state (or its hidden status copy) ends it.
        if (startedTurn && this.findTab(tabId)?.claudeSessionId === sessionId) {
          this.tabManager.markStreaming(tabId);
        }
        this.deliver(clientMessageId, 'delivered');
      } else {
        this.fail(clientMessageId);
      }
    }
    this.pump(tabId);
  }

  private async sendCommand(entry: QueuedFollowUpEntry, sessionId: SessionId): Promise<void> {
    const { tabId, clientMessageId } = entry;
    this.sending.add(tabId);
    this.store.update(clientMessageId, { phase: 'submitting', sessionId });
    let delivered = false;
    try {
      const outcome = await this.sender.send(entry.content, {
        ...entry.options,
        tabId,
        ...(entry.ownerToken ? { ownerToken: entry.ownerToken } : {}),
      });
      delivered = outcome?.success === true;
    } catch (error: unknown) {
      this.logger.warn(LOG, 'held slash command send failed', error);
    } finally {
      this.sending.delete(tabId);
    }
    if (delivered) {
      // The normal send path wrote its own bubble.
      this.store.settle(clientMessageId, 'delivered');
    } else if (this.store.settle(clientMessageId, 'failed')) {
      // The sender kept the prompt as the failed bubble; do not duplicate it.
      this.actionBanner.showError(
        'A queued command was not sent.',
        tabId,
      );
    }
    this.pump(tabId);
  }

  private deliver(clientMessageId: string, outcome: 'delivered' | 'steered'): void {
    const entry = this.store.settle(clientMessageId, outcome);
    if (entry) this.appendDeliveredBubble(entry);
  }

  private fail(clientMessageId: string, reason?: string): void {
    const entry = this.store.settle(clientMessageId, 'failed');
    if (!entry) return;
    this.toComposer(entry.tabId, [entry.content]);
    this.actionBanner.showError(
      reason
        ? `A queued message was not sent (${reason}). It is back in the composer.`
        : 'A queued message was not sent. It is back in the composer.',
      entry.tabId,
    );
  }

  /** The user bubble, once a turn took the item, on the tab still showing its session. */
  private appendDeliveredBubble(entry: QueuedFollowUpEntry): void {
    const tab = this.findTab(entry.tabId);
    if (!tab?.claudeSessionId || tab.claudeSessionId !== entry.sessionId) return;
    if (tab.messages.some((message) => message.id === entry.clientMessageId)) return;
    const images = entry.options?.images;
    const message = createExecutionChatMessage({
      id: entry.clientMessageId,
      role: 'user',
      rawContent: entry.content,
      files: entry.options?.files,
      ...(images && images.length > 0 ? { imageCount: images.length } : {}),
      sessionId: tab.claudeSessionId,
    });
    this.tabManager.setMessages(tab.id, [...tab.messages, message]);
    this.streamingHandler.recordUserPromptBoundary(tab.id, message);
  }

  private onTabClosed(event: ClosedTabEvent): void {
    if (event.kind === 'reset') {
      // The tab survives as a fresh conversation: what it still held goes
      // back to its composer; items already in the backend stay with the old
      // session and drop out of this view.
      this.draftHeld(event.tabId);
      return;
    }
    this.store.removeTab(event.tabId);
    this.composerRestore.discard(event.tabId);
  }

  private forgetRemovedTabs(): void {
    const tabIds = new Set(this.store.entries().map((entry) => entry.tabId));
    for (const tabId of tabIds) {
      if (this.findTab(tabId)) continue;
      this.store.removeTab(tabId);
      this.composerRestore.discard(tabId);
    }
  }

  private noteFor(entry: QueuedFollowUpEntry, note: string): void {
    if (this.store.get(entry.clientMessageId)) {
      this.store.update(entry.clientMessageId, { note });
    }
  }

  private toComposer(tabId: string, texts: readonly string[]): void {
    if (texts.length === 0 || !this.findTab(tabId)) return;
    this.composerRestore.restore(tabId, texts);
  }

  /**
   * Idle enough for a held slash command. A hidden tab gets only the status
   * of its terminal `turn_state` (no tree finalization), so its status alone
   * decides; a shown tab uses the dispatcher's full predicate.
   */
  private isIdle(tab: TabState): boolean {
    const hidden =
      this.viewport.tierFor(tab.id) === 'hidden' ||
      !this.tabManager.tabs().some((t) => t.id === tab.id);
    if (hidden) return tab.status !== 'streaming' && tab.status !== 'resuming';
    return !isTabBusyGenerating({
      status: tab.status,
      streamingState: tab.streamingState,
      isStreamingTab: this.tabManager.isTabStreaming(tab.id),
    });
  }

  private findTab(tabId: string): TabState | null {
    return this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab ?? null;
  }
}
