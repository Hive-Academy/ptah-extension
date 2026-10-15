import { Injectable, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ChatStore } from '@ptah-extension/chat';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  LoggingService,
  SurfaceRouterService,
  VSCodeService,
  surfaceNavigationLanded,
} from '@ptah-extension/core';
import type {
  HarnessOpenWorkflowPayload,
  NewProjectIntake,
} from '@ptah-extension/shared';
import { firstValueFrom, filter, take, timeout } from 'rxjs';
import {
  canonicalHarnessRoot,
  HarnessBuilderRecordsService,
  type HarnessBuilderMode,
} from './harness-builder-records.service';
import { HarnessRpcService } from './harness-rpc.service';
import { formatIntakeSummary } from './new-project-intake';

export type HarnessWorkflowRequestOutcome = 'landed' | 'cancelled' | 'failed';

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
  private readonly chat = inject(ChatStore);
  private readonly rpc = inject(HarnessRpcService);
  private readonly records = inject(HarnessBuilderRecordsService);
  private readonly router = inject(SurfaceRouterService);
  private readonly vscode = inject(VSCodeService);
  private readonly logger = inject(LoggingService);
  private readonly visibleTabs$ = toObservable(this.tabs.visibleTabIds);
  private readonly _pendingIntent = signal<PendingHarnessIntent | null>(null);
  private readonly _hubWarning = signal<string | null>(null);
  private readonly _hubError = signal<string | null>(null);
  private readonly _entryErrors = signal<Readonly<Record<string, string>>>({});
  private transitioning = false;

  readonly pendingIntent = this._pendingIntent.asReadonly();
  readonly hubWarning = this._hubWarning.asReadonly();
  readonly hubError = this._hubError.asReadonly();
  readonly entryErrors = this._entryErrors.asReadonly();

  get workspaceRoot(): string {
    return canonicalHarnessRoot(
      this.tabs.activeWorkspacePath ?? this.vscode.config().workspaceRoot ?? '',
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

  /** The guard is set before the first await, so a second click is ignored. */
  async requestAndNavigate(
    data: HarnessOpenWorkflowPayload,
  ): Promise<HarnessWorkflowRequestOutcome> {
    if (this.transitioning || this._pendingIntent()) return 'cancelled';
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
      if (same) return await this.navigateToBuilder(data.mode, same);
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
    let tabId: string | null = null;
    let landed = false;
    try {
      const started =
        mode === 'new-project' && intake
          ? await this.rpc.startNewProject(intake)
          : null;
      if (mode === 'new-project' && (!started || !started.success)) {
        this.reportHubError('Could not start New Project. Try again.');
        return 'failed';
      }
      const preamble =
        mode === 'configure-harness'
          ? (
              await this.rpc.workflowPrompt({
                mode: 'configure-harness',
                contextOnly: true,
              })
            ).prompt
          : started?.success
            ? started.seedPrompt
            : '';
      if (this.workspaceRoot !== root) {
        this.reportHubError(
          'The workspace changed while opening the builder. Try again.',
        );
        return 'failed';
      }
      tabId = this.tabs.createTab(
        mode === 'new-project' ? 'New Project' : 'AI Team Builder',
      );
      this.tabs.setWorkflow(tabId, workflowKind(mode));
      this.tabs.setFirstMessagePreamble(tabId, preamble);
      if (started?.success) {
        try {
          if (!this.records.writeStackProfile(root, tabId, started)) {
            this.logger.error(
              'HarnessWorkflowRequestService',
              'Could not save stack profile',
              new Error('Stack profile write failed'),
            );
          }
        } catch (cause: unknown) {
          const error =
            cause instanceof Error ? cause : new Error(String(cause));
          this.logger.error(
            'HarnessWorkflowRequestService',
            'Could not save stack profile',
            error,
          );
        }
      }
      const outcome = await this.navigateToBuilder(mode, tabId);
      if (outcome !== 'landed') {
        this.records.clearTab(root, tabId);
        await this.tabs.closeTab(tabId);
        return outcome;
      }
      landed = true;
      if (mode === 'new-project' && intake) {
        const targetId = tabId;
        await firstValueFrom(
          this.visibleTabs$.pipe(
            filter((ids) => ids.has(targetId)),
            take(1),
            timeout({ first: 10_000 }),
          ),
        );
        const send = await this.chat.sendOrQueueMessage(
          formatIntakeSummary(intake),
          { tabId },
        );
        if (!send.success) {
          this._entryErrors.update((errors) => ({
            ...errors,
            [targetId]: 'The first message could not be sent. Please retry it.',
          }));
          return 'failed';
        }
      }
      return 'landed';
    } catch (cause: unknown) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.logger.error(
        'HarnessWorkflowRequestService',
        'Builder entry failed',
        error,
      );
      if (tabId) {
        const targetId = tabId;
        if (!landed) {
          this.records.clearTab(root, targetId);
          try {
            await this.tabs.closeTab(targetId);
          } catch (closeCause: unknown) {
            const closeError =
              closeCause instanceof Error
                ? closeCause
                : new Error(String(closeCause));
            this.logger.error(
              'HarnessWorkflowRequestService',
              'Could not roll back failed tab',
              closeError,
            );
          }
        } else {
          this._entryErrors.update((errors) => ({
            ...errors,
            [targetId]: 'The builder could not finish opening. Please retry.',
          }));
        }
      } else {
        this.reportHubError('The builder could not be opened. Try again.');
      }
      return 'failed';
    }
  }
}
