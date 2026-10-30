import { Injectable, inject, signal } from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  LoggingService,
  AppStateManager,
  SurfaceRouterService,
  VSCodeService,
  surfaceNavigationLanded,
} from '@ptah-extension/core';
import type {
  HarnessOpenWorkflowPayload,
  NewProjectIntake,
} from '@ptah-extension/shared';
import {
  canonicalHarnessRoot,
  HarnessBuilderRecordsService,
  type HarnessBuilderMode,
} from './harness-builder-records.service';
import { HarnessSessionController } from './harness-session.controller';
import { formatIntakeSummary } from './new-project-intake';

export type HarnessWorkflowRequestOutcome =
  'landed' | 'resumed' | 'cancelled' | 'failed';

export interface PendingHarnessIntent {
  readonly targetMode: HarnessBuilderMode;
  readonly pinnedWorkspaceRoot: string;
  readonly validatedIntake?: NewProjectIntake;
  readonly sourceMode: HarnessBuilderMode;
  readonly sourceTabId: string;
}

function workflowKind(
  mode: HarnessBuilderMode,
): 'harness-configure' | 'harness-new-project' {
  return mode === 'new-project' ? 'harness-new-project' : 'harness-configure';
}

/** Builder-only entry; the pending intent outlives the Setup Hub component. */
@Injectable({ providedIn: 'root' })
export class HarnessWorkflowRequestService {
  private readonly tabs = inject(TabManagerService);
  private readonly controller = inject(HarnessSessionController);
  private readonly records = inject(HarnessBuilderRecordsService);
  private readonly router = inject(SurfaceRouterService);
  private readonly vscode = inject(VSCodeService);
  private readonly logger = inject(LoggingService);
  private readonly appState = inject(AppStateManager);
  private readonly _pendingIntent = signal<PendingHarnessIntent | null>(null);
  private readonly _hubWarning = signal<string | null>(null);
  private readonly _hubError = signal<string | null>(null);
  private readonly _entryErrors = signal<Readonly<Record<string, string>>>({});
  private readonly _resumedIntake = signal<{
    tabId: string;
    text: string;
  } | null>(null);
  private transitioning = false;

  readonly pendingIntent = this._pendingIntent.asReadonly();
  readonly hubWarning = this._hubWarning.asReadonly();
  readonly hubError = this._hubError.asReadonly();
  readonly entryErrors = this._entryErrors.asReadonly();
  readonly resumedIntake = this._resumedIntake.asReadonly();

  get workspaceRoot(): string {
    return canonicalHarnessRoot(this.rawWorkspaceRoot);
  }

  get rawWorkspaceRoot(): string {
    return (
      this.tabs.activeWorkspacePath ?? this.vscode.config().workspaceRoot ?? ''
    );
  }

  hasRunningMode(mode: HarnessBuilderMode): boolean {
    return this.findRunningTab(mode, this.workspaceRoot) !== null;
  }

  hasResumableMode(mode: HarnessBuilderMode): boolean {
    const root = this.workspaceRoot;
    return !!root && this.findResumableTab(mode, root) !== null;
  }

  dismissHubWarning(): void {
    this._hubWarning.set(null);
  }
  dismissHubError(): void {
    this._hubError.set(null);
  }
  reportHubError(message: string): void {
    this._hubError.set(message);
  }

  /** A failed abort does not block the next entry. */
  reportAbortFailure(cause: unknown): void {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    this.logger.error(
      'HarnessWorkflowRequestService',
      'Chat abort failed',
      error,
    );
    this._hubWarning.set(
      'The previous session could not be stopped. Check it before starting more work.',
    );
  }

  clearEntryError(tabId: string): void {
    this._entryErrors.update((errors) => {
      const next = { ...errors };
      delete next[tabId];
      return next;
    });
  }

  /** Retry after the controller reconciles the bound tab with its first turn. */
  async retryFirstSend(tabId: string): Promise<boolean> {
    const mode = this.controller.session('new-project');
    if (mode.record()?.tabId !== tabId) {
      const outcome = await mode.restore(tabId);
      if (outcome !== 'ready') return false;
    }
    const sent = await mode.retrySend();
    if (sent || mode.phase() !== 'failed') this.clearEntryError(tabId);
    return sent;
  }

  /** The guard is set before the first await, so a second click is ignored. */
  async requestAndNavigate(
    data: HarnessOpenWorkflowPayload,
  ): Promise<HarnessWorkflowRequestOutcome> {
    if (this.transitioning) return 'cancelled';
    const pending = this._pendingIntent();
    if (pending) {
      if (
        this.router.currentSurface() === 'harness-builder' &&
        this.tabs.findTabByIdAcrossWorkspaces(pending.sourceTabId)
      ) {
        return 'cancelled';
      }
      this._pendingIntent.set(null);
    }
    const root = this.workspaceRoot;
    if (!root) {
      this.reportHubError(
        'Open a workspace before starting a builder session.',
      );
      return 'failed';
    }
    this.transitioning = true;
    try {
      const same = this.findResumableTab(data.mode, root);
      if (same) {
        const outcome = await this.navigateToBuilder(data.mode, same);
        if (
          outcome === 'landed' &&
          data.mode === 'new-project' &&
          data.intake
        ) {
          const text = formatIntakeSummary(data.intake);
          // ChatInput ignores a prefill when its composer contains user text.
          // Keep the intake visible on the builder in that case.
          this._resumedIntake.set({ tabId: same, text });
          this.appState.requestComposerPrefill(text, same);
          return 'resumed';
        }
        if (outcome === 'landed') this._resumedIntake.set(null);
        return outcome;
      }
      if (data.mode === 'new-project' && !data.intake) {
        this.reportHubError('The New Project request is missing its intake.');
        return 'failed';
      }
      const otherMode: HarnessBuilderMode =
        data.mode === 'new-project' ? 'configure-harness' : 'new-project';
      const other = this.findRunningTab(otherMode, root);
      if (other) {
        this._pendingIntent.set({
          targetMode: data.mode,
          pinnedWorkspaceRoot: root,
          ...(data.intake ? { validatedIntake: { ...data.intake } } : {}),
          sourceMode: otherMode,
          sourceTabId: other,
        });
        const outcome = await this.navigateToBuilder(otherMode, other);
        if (outcome !== 'landed') this._pendingIntent.set(null);
        return outcome;
      }
      return await this.enter(data.mode, root, data.intake);
    } catch (cause: unknown) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.logger.error(
        'HarnessWorkflowRequestService',
        'Builder handoff failed',
        error,
      );
      this._pendingIntent.set(null);
      this.reportHubError('The builder could not be opened. Try again.');
      return 'failed';
    } finally {
      this.transitioning = false;
    }
  }

  cancelPendingIntent(): void {
    this._pendingIntent.set(null);
  }

  /** Invoke after Save/Discard and the old abort attempt settle. */
  async completePendingIntent(): Promise<HarnessWorkflowRequestOutcome> {
    if (this.transitioning) return 'cancelled';
    const intent = this._pendingIntent();
    if (!intent) return 'cancelled';
    this.transitioning = true;
    // Copy entry arguments before clearing: navigation may remount the Hub.
    const mode = intent.targetMode;
    const root = intent.pinnedWorkspaceRoot;
    const intake = intent.validatedIntake
      ? { ...intent.validatedIntake }
      : undefined;
    this._pendingIntent.set(null);
    try {
      return await this.enter(mode, root, intake);
    } finally {
      this.transitioning = false;
    }
  }

  private findRunningTab(
    mode: HarnessBuilderMode,
    root: string,
  ): string | null {
    if (!root) return null;
    const draftId = this.records.readDraft(root, mode)?.tabId;
    const matches = this.tabs
      .tabs()
      .filter(
        (tab) => tab.workflow === workflowKind(mode) && tab.id !== draftId,
      );
    const active = matches.find((tab) => tab.id === this.tabs.activeTabId());
    return active?.id ?? matches.at(-1)?.id ?? null;
  }

  private findResumableTab(
    mode: HarnessBuilderMode,
    root: string,
  ): string | null {
    const running = this.findRunningTab(mode, root);
    if (running) return running;
    const draft = this.records.readDraft(root, mode);
    if (!draft) return null;
    const tab = this.tabs.findTabByIdAcrossWorkspaces(draft.tabId)?.tab;
    return tab?.workflow === workflowKind(mode) ? tab.id : null;
  }

  private async navigateToBuilder(
    mode: HarnessBuilderMode,
    tabId: string,
  ): Promise<HarnessWorkflowRequestOutcome> {
    const result = await this.router.navigateToSurface('harness-builder', [
      mode,
      tabId,
    ]);
    return surfaceNavigationLanded(result)
      ? 'landed'
      : result === 'cancelled'
        ? 'cancelled'
        : 'failed';
  }

  private async enter(
    mode: HarnessBuilderMode,
    root: string,
    intake?: NewProjectIntake,
  ): Promise<HarnessWorkflowRequestOutcome> {
    if (mode === 'new-project' && !intake) {
      this.reportHubError('The New Project request is missing its intake.');
      return 'failed';
    }
    const session = this.controller.session(mode);
    const result = await session.start(
      mode === 'new-project'
        ? { mode, workspaceRoot: root, intake: intake as NewProjectIntake }
        : { mode, workspaceRoot: root, intent: '' },
    );
    if (result.kind === 'conflict') {
      this.reportHubError('Another builder session is open in this workspace.');
      return 'failed';
    }
    if (result.kind === 'failed') {
      const tabId = session.record()?.tabId;
      if (tabId) {
        this._entryErrors.update((errors) => ({ ...errors, [tabId]: result.error }));
        await this.navigateToBuilder(mode, tabId);
      } else this.reportHubError(result.error);
      return 'failed';
    }
    const outcome = await this.navigateToBuilder(mode, result.tabId);
    if (outcome !== 'landed' && result.kind === 'started') {
      const left = await this.controller.leave(mode, 'discard');
      if (left === 'uncertain') this.reportHubError('The builder started, but navigation failed. Keep this session open and retry navigation.');
    }
    return outcome === 'landed' && result.kind === 'reused' ? 'resumed' : outcome;
  }
}
