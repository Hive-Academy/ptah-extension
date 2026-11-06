import { Injectable, computed, inject, signal, type Signal } from '@angular/core';
import type { SessionStatus } from '@ptah-extension/chat-types';
import { QueuedFollowUpStore } from '@ptah-extension/chat-state';
import type {
  SessionBudgetStage,
  SessionBudgetState,
} from '@ptah-extension/shared';
import { displayBudgetStage } from '../components/molecules/notifications/session-budget-format';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import { FollowUpQueueService } from './chat-store/follow-up-queue.service';
import { SessionAutoHandoffService } from './session-auto-handoff.service';
import { SessionHandoffSkillService } from './session-handoff-skill.service';
import {
  buildHandoffCommand,
  buildWrapUpPrompt,
} from './session-handoff-prompts';

/** The chat view's resolved tab and session, as the budget banner sees them. */
export interface SessionBudgetView {
  readonly activeTab: Signal<{
    readonly sessionBudget?: SessionBudgetState | null;
    /** The tab's lifecycle status; the live stage counts only while `streaming`. */
    readonly status?: SessionStatus;
    /** Display-only stage from the live feed (TASK_2026_627 D25). */
    readonly liveBudgetStage?: 'handoff' | 'limit' | null;
  } | null>;
  readonly tabId: Signal<string | null>;
  readonly sessionId: Signal<string | null>;
  /** True while this view shows the budget banner, and so its Cancel. */
  readonly bannerVisible: Signal<boolean>;
}

const NO_VIEW: SessionBudgetView = {
  activeTab: signal(null),
  tabId: signal(null),
  sessionId: signal(null),
  bannerVisible: signal(false),
};

/**
 * State behind the session budget banner: the stage to display, the stage the
 * user dismissed per session, and the "Wrap up & hand off" button, which sends
 * one normal chat message through the composer's send path (so a running turn
 * queues it like any typed message). The agent does the rest.
 *
 * That message is the `/session-handoff` slash command when the workspace has
 * the `session-handoff` skill, which opens the continuation session itself;
 * otherwise it is the inline wrap-up prompt (see `session-handoff-prompts.ts`).
 *
 * The AUTOMATIC hand-off no longer lives here: this service is provided by the
 * chat view, so it sees only the SHOWN tab and only while its banner shows —
 * a background tab at its limit never fired (TASK_2026_863). The root
 * `SessionAutoHandoffCoordinatorService` triggers it for every mounted tab
 * now; this service keeps only the view's DISPLAY and CANCEL roles:
 * {@link autoHandoffQueued} projects the queued state onto the banner, and
 * {@link cancelAutoHandoff} withdraws it. A manual wrap-up marks the session in
 * {@link SessionAutoHandoffService} so the automatic trigger never adds a
 * second hand-off to it.
 *
 * Provided by the chat view, one instance per view. The view calls
 * {@link connect} once with its resolved tab and session.
 */
@Injectable()
export class SessionBudgetActionsService {
  private readonly actionBanner = inject(ActionBannerService);
  private readonly chatStore = inject(ChatStore);
  private readonly autoHandoff = inject(SessionAutoHandoffService);
  private readonly handoffSkill = inject(SessionHandoffSkillService);
  private readonly followUpStore = inject(QueuedFollowUpStore);
  private readonly followUps = inject(FollowUpQueueService);

  private readonly view = signal<SessionBudgetView>(NO_VIEW);

  /** Session id → the banner stage the user dismissed in it. */
  private readonly dismissedStages = signal<
    ReadonlyMap<string, SessionBudgetStage>
  >(new Map());

  /** Sessions whose wrap-up prompt was sent from this view. */
  private readonly wrapUpSessions = signal<ReadonlySet<string>>(new Set());

  /** The tab's budget (installed with its stats snapshot), or `null`. */
  readonly budget = computed<SessionBudgetState | null>(
    () => this.view().activeTab()?.sessionBudget ?? null,
  );

  /** True while the shown tab's agent is producing a turn. */
  private readonly turnRunning = computed(
    () => this.view().activeTab()?.status === 'streaming',
  );

  /**
   * The live (estimated) stage, as far as it counts: only while the turn
   * runs and the tab has a budget (D25).
   */
  private readonly liveStage = computed<'handoff' | 'limit' | null>(() => {
    if (!this.turnRunning() || !this.budget()) return null;
    return this.view().activeTab()?.liveBudgetStage ?? null;
  });

  /**
   * The stage the banner shows: the higher of the authoritative budget stage
   * and {@link liveStage}. `null` without a budget.
   */
  readonly displayStage = computed<SessionBudgetStage | null>(() => {
    const budget = this.budget();
    if (!budget) return null;
    return displayBudgetStage(budget.stage, this.liveStage());
  });

  /** The stage the user dismissed in the shown session, or `null`. */
  readonly dismissedStage = computed<SessionBudgetStage | null>(() => {
    const sessionId = this.budget()?.sessionId;
    return sessionId ? (this.dismissedStages().get(sessionId) ?? null) : null;
  });

  /**
   * True while the shown session's automatic hand-off is queued and not yet
   * sent (held by the renderer or by the backend queue), matched by identity.
   */
  readonly autoHandoffQueued = computed(() => {
    const sessionId = this.budget()?.sessionId;
    const entry = sessionId ? this.autoHandoff.entry(sessionId) : null;
    if (entry?.state !== 'fired' || !entry.queued) return false;
    return this.followUpStore.isPending(entry.queued.clientMessageId);
  });

  /** True once the wrap-up prompt was sent (or auto-queued) for the shown session. */
  readonly wrapUpSent = computed(() => {
    const sessionId = this.budget()?.sessionId;
    return (
      (!!sessionId && this.wrapUpSessions().has(sessionId)) ||
      this.autoHandoffQueued() ||
      (!!sessionId && this.autoHandoff.entry(sessionId)?.state === 'fired')
    );
  });

  /** Binds this service to the view's resolved tab and session. */
  connect(view: SessionBudgetView): void {
    this.view.set(view);
  }

  /**
   * Cancel the shown session's queued automatic hand-off: withdraw exactly
   * that command (the rest of the queue stays) and never fire it again for
   * the session. The button becomes available again. Nothing changes when a
   * turn already took it.
   */
  async cancelAutoHandoff(): Promise<void> {
    const sessionId = this.budget()?.sessionId;
    if (!sessionId || !this.autoHandoffQueued()) return;
    const queued = this.autoHandoff.entry(sessionId)?.queued;
    if (!queued) return;
    // Marked first: the withdrawn outcome must not schedule a retry.
    this.autoHandoff.cancel(sessionId);
    if (!(await this.followUps.withdraw(queued, { restore: false }))) {
      // Already claimed by a turn (or mid-submission): it fired after all.
      this.autoHandoff.revertCancel(sessionId);
      return;
    }
    this.setWrapUpSent(sessionId, false);
  }

  /** Hide the banner for the shown session until its stage rises. */
  dismiss(): void {
    const sessionId = this.budget()?.sessionId;
    const stage = this.displayStage();
    if (!sessionId || !stage) return;
    this.dismissedStages.update((current) => {
      const next = new Map(current);
      next.set(sessionId, stage);
      return next;
    });
  }

  /**
   * "Wrap up & hand off": send the `/session-handoff` command when the
   * `session-handoff` skill is available, else the inline wrap-up prompt, as
   * a normal message through `ChatStore.sendOrQueueMessage`, the composer's
   * send path. The button is disabled before the skill probe, so a second
   * click during it sends nothing. A failed send re-enables the button; a
   * thrown error is also shown.
   *
   * The session is marked in {@link SessionAutoHandoffService} while the
   * wrap-up is out, so the automatic trigger (the root coordinator) never
   * adds a second hand-off to it. A send that fails or never reaches the
   * captured tab clears the mark again.
   *
   * During a turn the slash command waits as its own queued item, sent when
   * the turn and everything queued before it are done. The button stays
   * disabled meanwhile; if the command is withdrawn or fails, it is enabled
   * again with a notice.
   */
  sendWrapUp(): Promise<void> {
    return this.requestWrapUp();
  }

  /**
   * The button's send. Any probe outcome but `available` (skill missing, or
   * the discovery RPC failed) sends the inline wrap-up prompt, which does the
   * same job without the skill.
   */
  private async requestWrapUp(): Promise<void> {
    const tabId = this.view().tabId();
    const budget = this.budget();
    const sessionId = budget?.sessionId;
    if (!tabId || !sessionId || this.wrapUpSent()) return;
    this.setWrapUpSent(sessionId, true);
    try {
      const probe = await this.handoffSkill.probe();
      // The probe is asynchronous: the view may show another tab or session
      // now. Never send into those.
      if (!this.stillTargets(tabId, sessionId)) {
        this.setWrapUpSent(sessionId, false);
        return;
      }
      const prompt =
        probe === 'available'
          ? buildHandoffCommand(budget)
          : buildWrapUpPrompt(budget);
      const outcome = await this.chatStore.sendOrQueueMessage(prompt, {
        tabId,
      });
      // The send path already shows its own failure notice in the transcript.
      if (!outcome?.success) {
        this.setWrapUpSent(sessionId, false);
        return;
      }
      const queued = outcome.queued;
      if (!queued) return;
      this.followUpStore.onSettled(queued.clientMessageId, (result) => {
        if (result === 'delivered' || result === 'steered') return;
        this.setWrapUpSent(sessionId, false);
        this.actionBanner.showError(
          'The wrap-up request was not sent: it was stopped or failed before it ran.',
          tabId,
        );
      });
    } catch (error: unknown) {
      this.setWrapUpSent(sessionId, false);
      this.actionBanner.showError(
        `Could not send the wrap-up request: ${error instanceof Error ? error.message : String(error)}`,
        tabId,
      );
    }
  }

  /**
   * After an await: the view still shows the captured tab and session. False
   * means the user switched away (or the session changed) while the probe
   * ran, so the send must not land in the new view's tab.
   */
  private stillTargets(tabId: string, sessionId: string): boolean {
    const budget = this.budget();
    return this.view().tabId() === tabId && budget?.sessionId === sessionId;
  }

  private setWrapUpSent(sessionId: string, sent: boolean): void {
    // The mark the root coordinator checks: a manual wrap-up must suppress
    // the automatic one for the session, and a failed one must un-suppress it.
    if (sent) this.autoHandoff.markManualWrapUp(sessionId);
    else this.autoHandoff.clearManualWrapUp(sessionId);
    this.wrapUpSessions.update((current) => {
      const next = new Set(current);
      if (sent) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }
}
