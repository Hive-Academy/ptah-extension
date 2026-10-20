import {
  type EnvironmentProviders,
  Injectable,
  effect,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  untracked,
} from '@angular/core';
import {
  attentionConditionKey,
  ElectronLayoutService,
  NOTICE_ACTION_HANDLER,
  NotificationService,
  type AttentionActionOutcome,
  type NoticeActionHandler,
} from '@ptah-extension/core';
import { GitStatusService } from './git-status.service';
import { statusUnavailableNoticeTitle } from './git-status-unavailable-label';

const CONDITION = 'git-status-unavailable';
const RETRY = 'retry';

/** Keeps the workspace's git warning live independently of the review shell. */
@Injectable({ providedIn: 'root' })
export class GitStatusAttentionService implements NoticeActionHandler {
  private readonly gitStatus = inject(GitStatusService);
  private readonly layout = inject(ElectronLayoutService);
  private readonly notifications = inject(NotificationService);
  private previousKey: string | null = null;

  constructor() {
    // The review shell owns the git push gate (it closes with the dock);
    // this service only observes the status it reads.

    effect(() => {
      const path = this.gitStatus.activeWorkspacePath();
      const reason = this.gitStatus.statusUnavailable();
      const visible = this.layout.editorPanelVisible();
      const key = path ? attentionConditionKey(path, CONDITION) : null;

      untracked(() => {
        if (this.previousKey && this.previousKey !== key) {
          this.notifications.resolve(this.previousKey, undefined, 'git');
        }
        this.previousKey = key;
        if (!key || !path) return;
        if (!reason) {
          this.notifications.resolve(key, undefined, 'git');
          return;
        }

        // Apply suppression before publication so a visible dock never has
        // an active snackbar, even during a synchronous notification update.
        this.notifications.setSnackbarSuppressed(key, visible, 'inline');
        this.notifications.upsert({
          key,
          generation: 1,
          source: 'git',
          kind: 'warning',
          severity: 'warning',
          workspacePath: path,
          workspaceName: path.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) ?? path,
          title: statusUnavailableNoticeTitle(reason),
          actions: [{ id: RETRY, label: 'Retry' }],
          actionable: true,
          soundEligible: false,
        });
      });
    });
  }

  canHandle(key: string, actionId: string): boolean {
    const path = this.gitStatus.activeWorkspacePath();
    return actionId === RETRY && !!path && key === attentionConditionKey(path, CONDITION);
  }

  async run(key: string, generation: number, actionId: string): Promise<AttentionActionOutcome> {
    if (!this.canHandle(key, actionId) || generation !== 1 || !this.gitStatus.statusUnavailable()) {
      return { kind: 'unavailable', reason: 'Git status retry is no longer available.' };
    }
    try {
      await this.gitStatus.refresh();
    } catch {
      return { kind: 'unavailable', reason: 'Git status could not be refreshed.' };
    }
    return this.gitStatus.statusUnavailable()
      ? { kind: 'unavailable', reason: 'Git status remains unavailable.' }
      : { kind: 'completed' };
  }
}

/** Starts git attention at app initialization and registers its Retry action. */
export function provideGitStatusAttention(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => inject(GitStatusAttentionService)),
    { provide: NOTICE_ACTION_HANDLER, useExisting: GitStatusAttentionService, multi: true },
  ]);
}
