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
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import type {
  SessionBudgetAction,
  SessionBudgetActionResult,
  SessionBudgetState,
} from '@ptah-extension/shared';
import { ActionBannerService } from './action-banner.service';
import { ChatStore } from './chat.store';
import { SessionHandoverClientService } from './session-handover-client.service';

/** The chat view's resolved tab and session, as the budget actions see them. */
export interface SessionBudgetView {
  readonly activeTab: Signal<{
    readonly sessionBudget?: SessionBudgetState | null;
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

const NO_VIEW: SessionBudgetView = {
  activeTab: signal(null),
  tabId: signal(null),
  sessionId: signal(null),
};

/**
 * State and flows behind the session budget banner (TASK_2026_597 N7): the
 * `session:budgetAction` call, the handoff preview, "Continue in new session"
 * and "Rotate session".
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

  /** Start the backend-owned, single-flight successor flow. */
  async continueInNewSession(): Promise<void> {
    const sessionId = this.view().sessionId();
    const tabId = this.view().tabId();
    if (!sessionId || !tabId || this._busy()) return;
    const queuedInput = this.tabManager
      .findTabByIdAcrossWorkspaces(tabId)
      ?.tab.queuedContent?.trim();
    this._busy.set(true);
    try {
      const result = await this.claudeRpc.call('session:beginHandover', {
        sourceSessionId: sessionId,
        sourceTabId: tabId,
        ...(queuedInput ? { queuedInput } : {}),
      });
      const data = result.isSuccess() ? result.data : null;
      if (data?.accepted) {
        const currentQueuedInput = this.tabManager
          .findTabByIdAcrossWorkspaces(tabId)
          ?.tab.queuedContent?.trim();
        if (queuedInput && currentQueuedInput === queuedInput) {
          this.tabManager.clearQueuedContentAndOptions(tabId);
        }
        this.handoverClient.record(sessionId, data.state);
        return;
      }
      this.showError(
        data?.error === 'unavailable'
          ? 'Session handover is not available in this window.'
          : 'Could not start the session handover. Please try again.',
      );
    } catch (error: unknown) {
      this.showError(
        `Could not start the session handover: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this._busy.set(false);
    }
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
