import { Injectable, effect, inject, signal } from '@angular/core';
import { LoggingService } from '@ptah-extension/core';
import {
  QueuedFollowUpStore,
  TabManagerService,
  TabWorkspacePartitionService,
  type TabLookupResult,
} from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import type {
  SessionHandoffOpenedPayload,
} from '@ptah-extension/shared';
import { MessageDispatchService } from './chat-store/message-dispatch.service';
import { SessionAutoHandoffService } from './session-auto-handoff.service';

const LOG_CONTEXT = '[SessionAutoHandoff]';

/**
 * Tab statuses that mean "the source's own hand-off turn has not settled
 * yet". The `/session-handoff` command runs as the SOURCE tab's turn
 * (the skill calls the host during it), so at `sessionHandoff:opened` time
 * the source is almost certainly still streaming: closing is evaluated once,
 * at the first moment the tab is none of these.
 */
const WAIT_STATUSES: ReadonlySet<TabState['status']> = new Set([
  'streaming',
  'resuming',
  'switching',
]);

/** One source tab armed to close once its hand-off turn settles. */
interface PendingClose {
  readonly tabId: string;
  readonly sessionId: string;
}

/**
 * AutoHandoffSourceCloserService — closes the SOURCE tab of an AUTOMATIC
 * session hand-off once its continuation tab is adopted (TASK_2026_863,
 * `sessionBudget.closeSourceAfterAutoHandoff`, default off).
 *
 * Correlation, in {@link onHandoffAdopted} (called by
 * `AgentSessionAdoptionService` when a `sessionHandoff:opened` tab is
 * adopted):
 * - the source session must carry an AUTOMATIC hand-off claim in
 *   {@link SessionAutoHandoffService} (`state: 'fired'`); a MANUAL hand-off
 *   (the "Wrap up & hand off" button) never claims, so it never closes its
 *   source, and a user-CANCELLED one stays open too;
 * - the source tab must be mounted in this panel (by the descriptor's
 *   `fromTabId`, then by session id), and its budget must still name the
 *   source session with the setting on.
 *
 * The close itself waits: it is evaluated ONCE, at the first moment the source
 * tab stops streaming or resuming, and only when the tab is clean — not
 * dirty, no queued message, no background work, no open permission prompt,
 * not a Command Center tab. Otherwise the tab stays open and the reason is
 * logged. One evaluation only: a blocker found once disarms the close, so a
 * session the user resumes is never closed later.
 *
 * The close goes through `TabManagerService.closeTabAcrossWorkspaces`, which
 * works for a source parked in a non-active workspace partition and carries
 * the same `close` event the session ender reacts to, so the source's SDK
 * process ends. History is never deleted by this path.
 */
@Injectable({ providedIn: 'root' })
export class AutoHandoffSourceCloserService {
  private readonly tabManager = inject(TabManagerService);
  private readonly partition = inject(TabWorkspacePartitionService);
  private readonly messageDispatch = inject(MessageDispatchService);
  private readonly autoHandoff = inject(SessionAutoHandoffService);
  private readonly followUpStore = inject(QueuedFollowUpStore);
  private readonly logger = inject(LoggingService);

  /** Armed source tabs: tab id → the session it must still hold. */
  private readonly _pending = signal<ReadonlyMap<string, string>>(new Map());

  constructor() {
    effect(() => {
      const ready = this.readySources();
      if (ready.length === 0) return;
      // Close and disarm write signals; run them outside the effect's
      // reactive context, like the UI's deferred-focus moves do.
      queueMicrotask(() => this.settle(ready));
    });
  }

  /**
   * A `sessionHandoff:opened` tab was adopted: arm its source tab for close
   * when that hand-off was the AUTOMATIC one and the setting says so. Silent
   * for everything else (manual hand-off, cancelled hand-off, setting off).
   */
  onHandoffAdopted(descriptor: SessionHandoffOpenedPayload): void {
    const sessionId = descriptor.fromSessionId;
    if (typeof sessionId !== 'string') return;
    if (this.autoHandoff.entry(sessionId)?.state !== 'fired') return;
    if (this.autoHandoff.isManuallyWrappedUp(sessionId)) return;
    const located = this.locateSource(descriptor.fromTabId, sessionId);
    if (!located) {
      // The automatic hand-off fired from this panel, so its tab should be
      // here; the user may have closed or moved it meanwhile.
      this.logger.info(
        LOG_CONTEXT,
        'the handed-off source session is not mounted in this panel; nothing to close',
        { sessionId },
      );
      return;
    }
    const budget = located.tab.sessionBudget;
    // Without a budget for the source session the setting cannot be read;
    // the tab stays open.
    if (!budget || budget.sessionId !== sessionId) return;
    if (budget.closeSourceAfterAutoHandoff !== true) return;
    this._pending.update(
      (pending) => new Map(pending).set(located.tab.id, sessionId),
    );
  }

  /**
   * The armed sources whose tab stopped streaming or resuming: their hand-off
   * turn settled, so their close can be evaluated now. Called inside the
   * effect: every read here that can change re-runs the effect.
   */
  private readySources(): readonly PendingClose[] {
    const pending = this._pending();
    if (pending.size === 0) return [];
    this.tabManager.tabs(); // tracked: active-set updates re-run the effect
    this.tabManager.backgroundTabsRevision(); // tracked: background updates too
    const ready: PendingClose[] = [];
    for (const [tabId, sessionId] of pending) {
      const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
      if (!tab || !WAIT_STATUSES.has(tab.status)) {
        ready.push({ tabId, sessionId });
      }
    }
    return ready;
  }

  /**
   * Evaluate each ready source ONCE and disarm it either way: close it when
   * it is clean, keep it open (with the reason logged) when it is not.
   */
  private settle(ready: readonly PendingClose[]): void {
    for (const { tabId, sessionId } of ready) {
      this.disarm(tabId);
      const lookup = this.tabManager.findTabByIdAcrossWorkspaces(tabId);
      if (!lookup) continue; // already closed or parked away: nothing to do
      if (lookup.tab.claudeSessionId !== sessionId) {
        this.logger.info(
          LOG_CONTEXT,
          'the handed-off source tab was rebound to another session; it stays open',
          { tabId, sessionId },
        );
        continue;
      }
      const blocker = this.closeBlocker(lookup.tab, sessionId);
      if (blocker !== null) {
        this.logger.info(
          LOG_CONTEXT,
          `the handed-off source tab stays open: ${blocker}`,
          { tabId, sessionId },
        );
        continue;
      }
      const closed = this.tabManager.closeTabAcrossWorkspaces(tabId, sessionId);
      if (!closed) {
        this.logger.warn(
          LOG_CONTEXT,
          'closing the handed-off source tab was refused',
          { tabId, sessionId },
        );
      }
    }
  }

  /**
   * Why the source tab must NOT close now, or `null` when it may. Ordered
   * from "the hand-off changed" to "the tab is busy".
   */
  private closeBlocker(tab: TabState, sessionId: string): string | null {
    const entry = this.autoHandoff.entry(sessionId);
    if (entry === null) return 'its automatic hand-off claim was released';
    if (entry.state !== 'fired') {
      return 'the user cancelled the automatic hand-off';
    }
    if (this.autoHandoff.isManuallyWrappedUp(sessionId)) {
      return 'the session was wrapped up by hand';
    }
    if (tab.status !== 'loaded') {
      return `its state is '${tab.status}' (background work or sleep)`;
    }
    if (tab.isDirty) return 'it has unsent input';
    if (this.followUpStore.forTab(tab.id).length > 0) {
      return 'it still has a queued message';
    }
    if (tab.pendingBackgroundTasks && tab.pendingBackgroundTasks.length > 0) {
      return 'it has background work in flight';
    }
    if (this.messageDispatch.hasPendingPermissionForTab(tab.id)) {
      return 'a permission prompt is open on it';
    }
    if (tab.commandCenterOrigin) return 'it is a Command Center tab';
    const budget = tab.sessionBudget;
    if (!budget || budget.sessionId !== sessionId) {
      return 'its session budget no longer names the handed-off session';
    }
    if (budget.closeSourceAfterAutoHandoff !== true) {
      return 'the close-source setting was turned off';
    }
    return null;
  }

  /**
   * The source tab of the hand-off: the descriptor's `fromTabId` when it still
   * holds the session, else any mounted tab bound to the session (a workspace
   * switch may have parked it).
   */
  private locateSource(
    tabId: string,
    sessionId: string,
  ): TabLookupResult | null {
    const byId = this.tabManager.findTabByIdAcrossWorkspaces(tabId);
    if (byId?.tab.claudeSessionId === sessionId) return byId;
    return this.partition.findTabBySessionIdAcrossWorkspaces(
      sessionId,
      this.tabManager.tabs(),
    );
  }

  private disarm(tabId: string): void {
    this._pending.update((pending) => {
      if (!pending.has(tabId)) return pending;
      const next = new Map(pending);
      next.delete(tabId);
      return next;
    });
  }
}