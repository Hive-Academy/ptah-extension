import { Injectable, Injector, inject } from '@angular/core';
import {
  ElectronLayoutService,
  VSCodeService,
  rpcCall,
} from '@ptah-extension/core';
import type {
  CommandExecuteResponse,
  TurnChangeSet,
  TurnChangeSetFile,
} from '@ptah-extension/shared';
import { ChangeSetStore } from './change-set.store';

/**
 * The part of git-ui's `ReviewNavigationService` these actions call. Declared
 * structurally so this file never names git-ui outside the dynamic import.
 */
interface ReviewNavigation {
  openChangeSet(request: {
    workspaceRoot: string;
    files: readonly { path: string; origPath?: string }[];
    ownerSessionId?: string;
  }): void;
  openFile(
    path: string,
    line?: number,
    options?: { readonly workspaceRoot?: string },
  ): void;
  selectComparison(kind: 'worktree'): void;
}

const LOG_PREFIX = '[ChangeSetActions]';
const COMMAND_TIMEOUT_MS = 30_000;

/** The VS Code commands registered by `apps/ptah-extension-vscode/src/commands/review-commands.ts`. */
export const REVIEW_COMMANDS = {
  openChanges: 'ptah.review.openChanges',
  openDiff: 'ptah.review.openDiff',
  openMerge: 'ptah.review.openMerge',
  openScm: 'ptah.review.openScm',
} as const;

/**
 * Opens what a change-set card asks for, in the host's own review surface
 * (TASK_2026_576, Component 20).
 *
 * - VS Code: `command:execute` with the `ptah.review.*` commands, which open
 *   the native changes, diff, merge and Source Control views. The command
 *   re-validates every argument against the open workspace folders.
 * - Electron: the dock is revealed and pointed through git-ui's
 *   `ReviewNavigationService`: Review opens the Changes tab narrowed to the
 *   turn's files (drafts go to the turn's session), a file opens in the spot
 *   editor rooted at the change set's own working directory, and Source
 *   Control shows the working-tree comparison.
 *
 * Every method rejects with a user-facing `Error` on failure, so the card's
 * container can show it inline. `@ptah-extension/git-ui` is imported
 * dynamically for the same reason the file-link router does it: the dock
 * must stay out of the eager chat chunk.
 */
@Injectable({ providedIn: 'root' })
export class ChangeSetActionsService {
  private readonly vscode = inject(VSCodeService);
  private readonly layout = inject(ElectronLayoutService);
  private readonly store = inject(ChangeSetStore);
  private readonly injector = inject(Injector);

  /** Review every file of the change set. */
  async review(changeSet: TurnChangeSet): Promise<void> {
    if (this.vscode.isElectron) {
      await this.openInDock('Could not open the review.', (navigation) =>
        navigation.openChangeSet({
          workspaceRoot: changeSet.workspaceRoot,
          files: changeSet.files.map((file) =>
            file.origPath
              ? { path: file.path, origPath: file.origPath }
              : { path: file.path },
          ),
          ownerSessionId: changeSet.sessionId,
        }),
      );
      return;
    }
    await this.executeCommand(REVIEW_COMMANDS.openChanges, {
      workspaceRoot: changeSet.workspaceRoot,
      files: changeSet.files.map(toCommandFile),
    });
  }

  /**
   * Open one file of the change set: its merge editor when the store's marks
   * say it is conflicted, its diff against HEAD otherwise. The marks follow
   * the current status and fall back to the recorded `U` only when no
   * trustworthy status exists, so a conflict resolved since the turn opens
   * its diff.
   */
  async openFile(changeSet: TurnChangeSet, path: string): Promise<void> {
    const file = changeSet.files.find((entry) => entry.path === path);
    if (!file) throw new Error(`${path} is not part of this change set.`);

    if (this.vscode.isElectron) {
      await this.openInDock(`Could not open ${file.path}.`, (navigation) =>
        navigation.openFile(file.path, undefined, {
          workspaceRoot: changeSet.workspaceRoot,
        }),
      );
      return;
    }
    const conflicted = this.store.marksFor(changeSet).conflicted.has(file.path);
    await this.executeCommand(
      conflicted ? REVIEW_COMMANDS.openMerge : REVIEW_COMMANDS.openDiff,
      { workspaceRoot: changeSet.workspaceRoot, ...toCommandFile(file) },
    );
  }

  /** Open the host's source-control view. */
  async openScm(): Promise<void> {
    if (this.vscode.isElectron) {
      await this.openInDock('Could not open the review.', (navigation) =>
        navigation.selectComparison('worktree'),
      );
      return;
    }
    await this.executeCommand(REVIEW_COMMANDS.openScm);
  }

  /**
   * Reveal the dock first and synchronously (it starts the shell's lazy dock
   * load, so the dock chunk and git-ui fetch in parallel), then point the
   * review shell with `navigate`. On failure the reveal is undone when the
   * dock was hidden before, as in `FileLinkRouterService`, and the rejection
   * carries `failureText`.
   */
  private async openInDock(
    failureText: string,
    navigate: (navigation: ReviewNavigation) => void,
  ): Promise<void> {
    const dockWasVisible = this.layout.editorPanelVisible();
    this.layout.setEditorPanelVisible(true);
    try {
      const git = await import('@ptah-extension/git-ui');
      navigate(this.injector.get(git.ReviewNavigationService));
    } catch (error: unknown) {
      if (!dockWasVisible) this.layout.setEditorPanelVisible(false);
      console.error(`${LOG_PREFIX} Failed to open the review dock`, error);
      throw new Error(failureText, { cause: error });
    }
  }

  private async executeCommand(
    command: string,
    argument?: Record<string, unknown>,
  ): Promise<void> {
    const result = await rpcCall<CommandExecuteResponse>(
      this.vscode,
      'command:execute',
      { command, args: argument ? [argument] : [] },
      COMMAND_TIMEOUT_MS,
    );
    // Success is asserted, never assumed (see `FileLinkRouterService`, L-8).
    if (result.success && result.data?.success === true) return;
    const reason =
      result.data?.error ?? result.error ?? 'The review could not be opened.';
    console.error(`${LOG_PREFIX} ${command} failed: ${reason}`);
    throw new Error(reason);
  }
}

/** Only the fields the command validates; `origPath` only for a rename. */
function toCommandFile(
  file: TurnChangeSetFile,
): Pick<TurnChangeSetFile, 'path' | 'origPath' | 'status'> {
  return file.origPath
    ? { path: file.path, origPath: file.origPath, status: file.status }
    : { path: file.path, status: file.status };
}
