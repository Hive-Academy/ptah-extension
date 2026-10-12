import {
  Injectable,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { SessionStatus } from '@ptah-extension/chat-types';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type {
  SessionBudgetAction,
  SessionBudgetActionResult,
  SessionBudgetStage,
  SessionBudgetState,
} from '@ptah-extension/shared';
import { ENDED_HANDOVER_PHASES } from '@ptah-extension/shared';
import { displayBudgetStage } from '../components/molecules/notifications/session-budget-format';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import { SessionHandoverClientService } from './session-handover-client.service';

/** The chat view's resolved tab and session, as the budget actions see them. */
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
}

/** The budget banner buttons that only change the budget state. */
export type SessionBudgetStateAction = 'dismiss' | 'extend' | 'restore-window';

/** One point on the banner sparkline. Frontend-only; the backend sends snapshots. */
export interface SessionBudgetUsageSample {
  readonly at: number;
  readonly used: number;
  readonly percent: number | null;
}

/** Sparkline length. Older points drop off the front. */
const USAGE_CAP = 60;

/**
 * The handover `failed` error published when the source session no longer
 * exists. Backend source: `SessionHandoverCoordinator.complete()`, the
 * `fail(operation, 'source session unavailable')` call in
 * `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts`.
 * Not part of the shared contract, so it is matched as published; if that
 * wording changes, Retry falls through to `session:beginHandover`, which
 * refuses with `source-unavailable` and still reaches the rotate fallback.
 */
const SOURCE_UNAVAILABLE_FAILURE = 'source session unavailable';

/** Shown in the new tab when the ended source left no handoff to seed it. */
const NO_HANDOFF_NOTICE =
  'The previous session has ended and no handoff could be built for it. This new session starts without its context.';

/** Shown when the host refuses `request-wrap-up` (`WRAP_UP_UNAVAILABLE`). */
const WRAP_UP_UNAVAILABLE_NOTICE =
  'The agent is not working on a turn right now.';

const NO_VIEW: SessionBudgetView = {
  activeTab: signal(null),
  tabId: signal(null),
  sessionId: signal(null),
};

/**
 * State and flows behind the session budget banner (TASK_2026_597 N7): the
 * `session:budgetAction` call, the handoff preview, "Continue in new session"
 * (also the Approve of an agent's request), "Continue now anyway", "Ask agent
 * to wrap up", "Rotate session", and the display stage (TASK_2026_627).
 * Every handover here starts from the user's click (D22).
 *
 * Provided by the chat view, one instance per view: the action state belongs
 * to the tab and session that view shows. The view calls {@link connect} once
 * with its resolved tab and session.
 */
@Injectable()
export class SessionBudgetActionsService {
  private readonly claudeRpc = inject(ClaudeRpcService);
  private readonly actionBanner = inject(ActionBannerService);
  private readonly tabManager = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly chatStore = inject(ChatStore);
  private readonly handoverClient = inject(SessionHandoverClientService);

  private readonly view = signal<SessionBudgetView>(NO_VIEW);

  /** Tab and session the budget action state and preview belong to (M6). */
  private readonly scope = computed(() => {
    const view = this.view();
    return `${view.tabId()}|${view.sessionId()}`;
  });

  /**
   * Latest `session:budgetAction` state, with the tab budget object it was
   * acted on (`base`); a newer snapshot replaces it. Reset to `null` on a tab
   * or session change.
   */
  private readonly actionState = linkedSignal<
    string,
    { state: SessionBudgetState; base: SessionBudgetState | null } | null
  >({ source: this.scope, computation: () => null });

  /**
   * The last handoff preview; `content: null` means the load failed. Reset
   * to `null` on a tab or session change.
   */
  private readonly preview = linkedSignal<
    string,
    { sessionId: string; content: string | null } | null
  >({ source: this.scope, computation: () => null });

  private readonly _busy = signal(false);
  /** True while a `session:budgetAction` call is in flight. */
  readonly busy = this._busy.asReadonly();

  /**
   * Per-session usage samples for the banner sparkline. Kept beside the
   * budget the banner renders, so a snapshot and an action result both
   * record. Reset when the session id changes or the budget clears.
   */
  private readonly _usage = signal<readonly SessionBudgetUsageSample[]>([]);
  readonly usage = this._usage.asReadonly();
  private usageSessionId: string | null = null;

  /** The tab the gone-source fallback opened, so a repeat click reuses it. */
  private goneSourceTab: { sourceSessionId: string; tabId: string } | null =
    null;

  /** True while the shown tab's agent is producing a turn. */
  readonly turnRunning = computed(
    () => this.view().activeTab()?.status === 'streaming',
  );

  /**
   * `${sessionId}|${stage}` of the last "Ask agent to wrap up" click. Reset on
   * a tab or session change and whenever the turn starts or ends, so the
   * button comes back for the next turn; a higher stage has a new key.
   */
  private readonly wrapUpRequestedKey = linkedSignal<string, string | null>({
    source: () => `${this.scope()}|${this.turnRunning()}`,
    computation: () => null,
  });

  /**
   * Handover operations whose accepted begin carried the composer's queued
   * message to the successor (R5 banner copy). Per view, like the rest of
   * the action state.
   */
  private readonly queuedInputOperations = signal<ReadonlySet<string>>(
    new Set(),
  );

  constructor() {
    effect(() => {
      const budget = this.budget();
      untracked(() => this.recordUsage(budget));
    });
  }

  /**
   * The tab's budget (installed with its stats snapshot), or the state a
   * budget action returned for the same session. With both revisions known
   * the newer one wins (ties go to the action). Without them the action
   * state wins only while the tab still holds the budget it acted on, so a
   * later snapshot without a revision always replaces it (M6).
   */
  readonly budget = computed(() => {
    const fromTab = this.tabBudget();
    const acted = this.actionState();
    if (!fromTab || acted?.state.sessionId !== fromTab.sessionId) {
      return fromTab;
    }
    const actedRevision = acted.state.revision;
    const tabRevision = fromTab.revision;
    if (actedRevision !== null && tabRevision !== null) {
      return actedRevision >= tabRevision ? acted.state : fromTab;
    }
    return acted.base === fromTab ? acted.state : fromTab;
  });

  /**
   * The live (estimated) stage, as far as it counts: only while the turn
   * runs and the tab has a budget (D25). Stop, an abnormal stream end and a
   * disabled budget all hide it at once, before the stored value is cleared.
   */
  readonly liveStage = computed<'handoff' | 'limit' | null>(() => {
    if (!this.turnRunning() || !this.tabBudget()) return null;
    return this.view().activeTab()?.liveBudgetStage ?? null;
  });

  /**
   * The stage the banner shows: the higher of the authoritative budget stage
   * and {@link liveStage}. `null` without a budget. Display only; the backend
   * decides what a send or an action may do.
   */
  readonly displayStage = computed<SessionBudgetStage | null>(() => {
    const budget = this.budget();
    if (!budget) return null;
    return displayBudgetStage(budget.stage, this.liveStage());
  });

  /** True once "Ask agent to wrap up" was clicked at this stage in this turn. */
  readonly wrapUpRequested = computed(() => {
    const key = this.wrapUpKey();
    return key !== null && this.wrapUpRequestedKey() === key;
  });

  /**
   * True from an accepted begin that carried the composer's queued message
   * until that handover ends: "Your queued message will be sent in the new
   * session." (R5).
   */
  readonly queuedMessageCarried = computed(() => {
    const handover = this.handoverClient.stateFor(this.view().sessionId());
    return (
      !!handover &&
      !ENDED_HANDOVER_PHASES.has(handover.phase) &&
      this.queuedInputOperations().has(handover.operationId)
    );
  });

  /**
   * The wrap-up key for the shown session, or `null` when the action does not
   * apply: no turn running, or a display stage below handoff.
   */
  private readonly wrapUpKey = computed(() => {
    const sessionId = this.view().sessionId();
    const stage = this.displayStage();
    if (!sessionId || !this.turnRunning()) return null;
    if (stage !== 'handoff' && stage !== 'limit') return null;
    return `${sessionId}|${stage}`;
  });

  private readonly currentPreview = computed(() => {
    const preview = this.preview();
    return preview && preview.sessionId === this.budget()?.sessionId
      ? preview
      : null;
  });

  /** Handoff preview text for the shown session, or `null`. */
  readonly previewText = computed(() => this.currentPreview()?.content ?? null);

  /** True when the last preview load for this session failed (F.6). */
  readonly previewFailed = computed(() => {
    const preview = this.currentPreview();
    return preview !== null && preview.content === null;
  });

  /** Binds this service to the view's resolved tab and session. */
  connect(view: SessionBudgetView): void {
    this.view.set(view);
  }

  /** Budget banner buttons that only change the budget state. */
  async runStateAction(action: SessionBudgetStateAction): Promise<void> {
    await this.runAction(action);
  }

  /**
   * "Compact": the same send path the composer uses for a typed `/compact`.
   * Compaction itself stays in the SDK slash-command handler.
   */
  async compact(): Promise<void> {
    const tabId = this.view().tabId();
    if (!tabId) return;
    const outcome = await this.chatStore.sendOrQueueMessage('/compact', {
      tabId,
    });
    if (!outcome?.success && outcome?.errorCode !== 'SESSION_BUDGET_REACHED') {
      this.showError(outcome?.error ?? 'Could not run /compact.');
    }
  }

  async loadPreview(): Promise<void> {
    const sessionId = this.budget()?.sessionId;
    if (!sessionId || this._busy()) return;
    // A retry after a failure shows "Loading…" again; loaded text stays until replaced.
    if (this.preview()?.content === null) this.preview.set(null);
    const result = await this.runAction('preview-handoff');
    this.preview.set({
      sessionId,
      content: result?.handoff?.content ?? null,
    });
  }

  /**
   * "Ask agent to wrap up": the user's explicit request that the running turn
   * wrap up (D22). Allowed once per stage per turn, only while a turn runs at
   * display stage handoff or limit. The host is authoritative: at the turn
   * edge it may refuse with `WRAP_UP_UNAVAILABLE`, which shows a notice. Any
   * other failure re-enables the button so the user can try again.
   */
  async requestWrapUp(): Promise<void> {
    const key = this.wrapUpKey();
    if (!key || this.wrapUpRequested() || this._busy()) return;
    this.wrapUpRequestedKey.set(key);
    const result = await this.runAction('request-wrap-up');
    if (!result && this.wrapUpRequestedKey() === key) {
      this.wrapUpRequestedKey.set(null);
    }
  }

  /**
   * Start the backend-owned, single-flight successor flow. When the source
   * session is gone (refused with `source-unavailable`, or a Retry after the
   * handover failed for that reason) the backend can never hand it over, so
   * fall back to {@link rotateSession}: a new tab with the seed in its composer.
   *
   * Also the Approve path for an agent's successor request (D23): the user's
   * click goes through the same begin, work gate included.
   */
  async continueInNewSession(): Promise<void> {
    await this.beginHandover(false);
  }

  /**
   * "Continue now anyway": the same begin, without waiting for the running
   * turn or its subagents and lanes to finish.
   */
  async continueNowAnyway(): Promise<void> {
    await this.beginHandover(true);
  }

  private async beginHandover(continueNow: boolean): Promise<void> {
    const sessionId = this.view().sessionId();
    const tabId = this.view().tabId();
    if (!sessionId || !tabId || this._busy()) return;
    const handover = this.handoverClient.stateFor(sessionId);
    if (
      handover?.phase === 'failed' &&
      handover.error === SOURCE_UNAVAILABLE_FAILURE
    ) {
      await this.continueFromGoneSource(sessionId);
      // Deliberately skips the queued-input transfer below: no handover runs,
      // so the queued text stays in this tab's composer (deferred 627-L9).
      return;
    }
    const queuedInput = this.tabManager
      .findTabByIdAcrossWorkspaces(tabId)
      ?.tab.queuedContent?.trim();
    let sourceGone = false;
    this._busy.set(true);
    try {
      const result = await this.claudeRpc.call('session:beginHandover', {
        sourceSessionId: sessionId,
        sourceTabId: tabId,
        ...(queuedInput ? { queuedInput } : {}),
        ...(continueNow ? { continueNow: true } : {}),
      });
      const data = result.isSuccess() ? result.data : null;
      if (data?.accepted) {
        // Only an operation that took the text as its draft may clear the
        // composer; any other accepted begin (e.g. at `closing`) leaves it.
        if (queuedInput && data.draftCaptured === true) {
          const currentQueuedInput = this.tabManager
            .findTabByIdAcrossWorkspaces(tabId)
            ?.tab.queuedContent?.trim();
          if (currentQueuedInput === queuedInput) {
            this.tabManager.clearQueuedContentAndOptions(tabId);
          }
          const operationId = data.state.operationId;
          this.queuedInputOperations.update((ids) =>
            new Set(ids).add(operationId),
          );
        }
        this.handoverClient.record(sessionId, data.state);
        return;
      }
      if (data?.error === 'source-unavailable') {
        sourceGone = true;
      } else {
        this.showError(
          data?.error === 'unavailable'
            ? 'Session handover is not available in this window.'
            : 'Could not start the session handover. Please try again.',
        );
      }
    } catch (error: unknown) {
      this.showError(
        `Could not start the session handover: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this._busy.set(false);
    }
    // After `finally`: the fallback runs its own busy-guarded preview call.
    if (sourceGone) await this.continueFromGoneSource(sessionId);
  }

  /** Release the backend-held transfer and keep the source session active. */
  async cancelHandover(): Promise<void> {
    const sessionId = this.view().sessionId();
    const tabId = this.view().tabId();
    const handover = sessionId ? this.handoverClient.stateFor(sessionId) : null;
    if (!sessionId || !tabId || !handover || this._busy()) return;

    this._busy.set(true);
    try {
      const result = await this.claudeRpc.call('session:cancelHandover', {
        operationId: handover.operationId,
        sourceSessionId: sessionId,
      });
      const data = result.isSuccess() ? result.data : null;
      if (data?.state) this.handoverClient.record(sessionId, data.state);
      if (!data?.cancelled) {
        this.showError('Could not cancel the session handover. Please try again.');
      }
    } catch (error: unknown) {
      this.showError(
        `Could not cancel the session handover: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this._busy.set(false);
    }
  }

  /**
   * "Rotate session": same handoff as "Continue in new session", but the seed
   * is only placed in the new tab's composer; the user sends it.
   */
  async rotateSession(): Promise<void> {
    const seed = await this.handoffSeed('preview-handoff');
    if (!seed) return;
    const { tabId, grid } = this.openTabForHandoff();
    // Only canvas tiles have SESSION_CONTEXT; null targets the main panel.
    this.appState.requestComposerPrefill(seed, grid ? tabId : null);
  }

  /**
   * The source can never be handed over, so the user always gets a new tab:
   * seeded with the best handoff the host still has (the live budget's, or
   * the file written at the handoff or limit stage), else empty with a
   * visible notice. One tab per source: while the tab opened for it is still
   * open, a repeated Continue or Retry switches to it instead (627 6F M1).
   * Asks the host by session id, so it works after the budget card cleared.
   */
  private async continueFromGoneSource(sessionId: string): Promise<void> {
    const opened = this.goneSourceTab;
    if (
      opened?.sourceSessionId === sessionId &&
      this.tabManager.findTabByIdAcrossWorkspaces(opened.tabId)
    ) {
      this.tabManager.switchTab(opened.tabId);
      return;
    }
    if (this._busy()) return;
    const seed = await this.goneSourceSeed(sessionId);
    const { tabId, grid } = this.openTabForHandoff();
    this.goneSourceTab = { sourceSessionId: sessionId, tabId };
    if (seed) {
      // Only canvas tiles have SESSION_CONTEXT; null targets the main panel.
      this.appState.requestComposerPrefill(seed, grid ? tabId : null);
      return;
    }
    this.actionBanner.showWarning(NO_HANDOFF_NOTICE, tabId);
  }

  /**
   * `preview-handoff` for a source that is gone; `null` when the host has no
   * handoff for it. A host without the session's budget means the session
   * ended, so its stale card is cleared as {@link runAction} does.
   */
  private async goneSourceSeed(sessionId: string): Promise<string | null> {
    this._busy.set(true);
    try {
      const result = await this.claudeRpc.call('session:budgetAction', {
        sessionId,
        action: 'preview-handoff',
      });
      const data = result.isSuccess() ? result.data : null;
      const seed = data?.success ? data.handoff?.seed : undefined;
      if (seed) return seed;
      if (data?.errorCode === 'NO_SESSION_BUDGET_STATE') {
        this.actionState.set(null);
        const tabId = this.view().tabId();
        if (tabId) this.tabManager.clearSessionBudget(tabId, sessionId);
      }
      console.warn('[SessionBudget] No handoff for the ended session', {
        error: data?.error ?? result.error ?? 'no seed',
      });
      return null;
    } catch (error: unknown) {
      console.warn('[SessionBudget] Could not load the ended session handoff', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      this._busy.set(false);
    }
  }

  private tabBudget(): SessionBudgetState | null {
    return this.view().activeTab()?.sessionBudget ?? null;
  }

  /** Append one sample when `used` moves. Identical `used` is not a point. */
  private recordUsage(budget: SessionBudgetState | null): void {
    if (!budget) {
      this.usageSessionId = null;
      this._usage.set([]);
      return;
    }
    if (this.usageSessionId !== budget.sessionId) {
      this.usageSessionId = budget.sessionId;
      this._usage.set(
        budget.used === null
          ? []
          : [{ at: Date.now(), used: budget.used, percent: budget.percent }],
      );
      return;
    }
    if (budget.used === null) return;
    const current = this._usage();
    const last = current[current.length - 1];
    if (last && last.used === budget.used) return;
    const next = [
      ...current,
      { at: Date.now(), used: budget.used, percent: budget.percent },
    ];
    this._usage.set(next.length > USAGE_CAP ? next.slice(-USAGE_CAP) : next);
  }

  /** Runs a handoff action and returns its seed, reporting a missing one. */
  private async handoffSeed(
    action: 'write-handoff' | 'preview-handoff',
  ): Promise<string | null> {
    const result = await this.runAction(action);
    if (!result) return null;
    const seed = result.handoff?.seed;
    if (!seed) {
      this.showError('The handoff is not ready yet. Please try again.');
      return null;
    }
    return seed;
  }

  /** Opens a new tab and, in grid layout, asks the canvas to adopt it. */
  private openTabForHandoff(): { tabId: string; grid: boolean } {
    const tabId = this.tabManager.createTab();
    const grid = this.appState.layoutMode() === 'grid';
    if (grid) {
      this.appState.requestCanvasTab(
        tabId,
        this.tabManager.activeWorkspacePath,
      );
    }
    return { tabId, grid };
  }

  /** One `session:budgetAction` call; returns the result only on success. */
  private async runAction(
    action: SessionBudgetAction,
  ): Promise<SessionBudgetActionResult | null> {
    const budget = this.budget();
    if (!budget || this._busy()) return null;
    const base = this.tabBudget();
    this._busy.set(true);
    try {
      const result = await this.claudeRpc.call('session:budgetAction', {
        sessionId: budget.sessionId,
        action,
      });
      const data = result.isSuccess() ? result.data : null;
      if (data?.state) this.actionState.set({ state: data.state, base });
      if (data?.success) return data;
      if (data?.errorCode === 'NO_SESSION_BUDGET_STATE') {
        // The host restarted and no longer tracks this restored session. The
        // stale card is no longer actionable, so dismiss it quietly.
        this.actionState.set(null);
        const tabId = this.view().tabId();
        if (tabId) this.tabManager.clearSessionBudget(tabId, budget.sessionId);
        return null;
      }
      if (data?.errorCode === 'WRAP_UP_UNAVAILABLE') {
        this.actionBanner.showInfo(
          WRAP_UP_UNAVAILABLE_NOTICE,
          this.view().tabId(),
        );
        return null;
      }
      const error = data?.error ?? result.error ?? 'Unknown error';
      this.showError(
        error === 'unavailable'
          ? 'Session budget actions are not available in this window.'
          : `Budget action failed: ${error}`,
      );
      return null;
    } catch (error: unknown) {
      this.showError(
        `Budget action failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      this._busy.set(false);
    }
  }

  /** Error banner scoped to the view's tab. */
  private showError(message: string): void {
    this.actionBanner.showError(message, this.view().tabId());
  }
}
