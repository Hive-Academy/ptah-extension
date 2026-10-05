import {
  Injectable,
  computed,
  inject,
  linkedSignal,
  signal,
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
  readonly previewText = computed(
    () => this.currentPreview()?.content ?? null,
  );

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
   * "Continue in new session": write a fresh handoff, then open a new tab
   * whose first prompt is exactly the seed the backend returned (AS-N7b).
   */
  async continueInNewSession(): Promise<void> {
    const seed = await this.handoffSeed('write-handoff');
    if (!seed) return;
    const tabId = this.openTabForHandoff().tabId;
    const outcome = await this.chatStore.sendOrQueueMessage(seed, { tabId });
    if (!outcome.success) {
      this.actionBanner.showError(
        `Could not start the new session: ${outcome.error ?? 'Unknown error'}`,
        tabId,
      );
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
