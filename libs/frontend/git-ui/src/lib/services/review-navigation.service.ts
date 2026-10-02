import { Injectable, inject, signal } from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import type {
  GitResolvedReviewRef,
  GitReviewChangesParams,
  GitReviewChangesResult,
  GitReviewFile,
  GitStashFileEntry,
} from '@ptah-extension/shared';
import { GitStatusService } from './git-status.service';
import type { FileViewOpenRequest } from '../types/diff-tab.types';

/** The four tabs of the review shell (design-spec §3). */
export type ReviewTab = 'changes' | 'commit' | 'task' | 'history';

/** The comparisons a user can pick in the comparison bar. */
export type ReviewComparisonKind = 'worktree' | 'staged' | 'branch';

/**
 * What the Changes tab compares.
 *
 * `branch` takes its base and head from `GitReviewService`. `historical` is a
 * read-only pair of resolved commits — a past commit against its parent, or a
 * stash entry against its parent — with the file list it was opened with.
 */
export type ReviewScope =
  | { kind: ReviewComparisonKind }
  | {
      kind: 'historical';
      base: GitResolvedReviewRef;
      head: GitResolvedReviewRef;
      /** Human label for the comparison bar, e.g. a short hash and subject. */
      label: string;
      files: readonly GitReviewFile[];
    };

/** One file of an agent turn's change set, as the card hands it over. */
export interface ReviewChangeSetFile {
  path: string;
  origPath?: string;
}

/**
 * What the Changes tab should bring into view.
 *
 * - `diff`       — scroll the canvas to one file's diff
 * - `change-set` — narrow the canvas to an agent turn's files; drafts written
 *                  there go to `ownerSessionId`
 * - `file`       — the spot editor mode (design-spec §3.3); `editable` is set
 *                  only by the canvas "Edit" action, chat links open read-only
 */
export type ReviewTarget =
  | { kind: 'none' }
  | { kind: 'diff'; path: string; originalPath?: string }
  | {
      kind: 'change-set';
      workspaceRoot: string;
      files: readonly ReviewChangeSetFile[];
      ownerSessionId?: string;
    }
  | { kind: 'file'; request: FileViewOpenRequest; editable?: true };

/**
 * One navigation. `seq` increases on every call so a surface can tell a
 * repeated request for the same target (a second click) from no change.
 */
export interface ReviewNavigation {
  readonly seq: number;
  readonly tab: ReviewTab;
  readonly scope: ReviewScope;
  readonly target: ReviewTarget;
}

/**
 * Result of a navigation that has to read git before it can land. `error` is
 * `null` when a newer navigation (or a workspace switch) superseded this one —
 * nothing failed, so there is nothing to show.
 */
export type ReviewNavigationOutcome =
  { opened: true } | { opened: false; error: string | null };

/** A stash file to open against the stash's parent, read-only. */
export interface ReviewStashFileRequest {
  /** The stash's first parent, resolved. */
  base: GitResolvedReviewRef;
  /** The stash commit, resolved. */
  head: GitResolvedReviewRef;
  /** Comparison-bar label, e.g. `"WIP on main · 1a2b3c4"`. */
  label: string;
  file: GitStashFileEntry;
}

/**
 * Asked before a navigation replaces the spot editor. `true` lets it land;
 * `false` (Keep editing) cancels it. A synchronous answer lands the
 * navigation synchronously.
 */
export type ReviewLeaveGuard = () => boolean | Promise<boolean>;

/** A full or abbreviated commit id; anything else never reaches git. */
const COMMIT_SHA = /^[0-9a-f]{4,64}$/i;

const NO_WORKSPACE_MESSAGE = 'Open a workspace folder to see its history.';
const INVALID_COMMIT_MESSAGE = 'That is not a commit id.';
const HISTORICAL_READ_MESSAGE = 'Could not read this commit.';

const INITIAL: ReviewNavigation = {
  seq: 0,
  tab: 'changes',
  scope: { kind: 'worktree' },
  target: { kind: 'none' },
};

/**
 * ReviewNavigationService — where the review shell is pointed: which tab,
 * which comparison, and what to bring into view. Entry points (the change-set
 * card, chat file links, the history timeline, the stash popover) call it; the
 * shell and the Changes tab render from {@link current}.
 *
 * It holds view state only. It never reveals the dock (callers outside the
 * dock do that first) and never reads diffs (`ReviewDiffService` does, for the
 * file sections the canvas mounts).
 *
 * **Unsaved edits.** Every navigation that would replace the spot editor (a
 * change set, a commit, a stash file, a comparison or another tab) first asks
 * the registered {@link ReviewLeaveGuard}, so no caller has to know an editor
 * exists. Only {@link backToReview} skips it: the editor asked before it
 * emitted. A file-to-file navigation is not guarded here because the editor
 * stays mounted and asks about its own replacement. While an answer is
 * pending, the latest guarded navigation wins and any other navigation
 * supersedes it.
 */
@Injectable({ providedIn: 'root' })
export class ReviewNavigationService {
  private readonly vscode = inject(VSCodeService);
  private readonly gitStatus = inject(GitStatusService);

  private readonly _current = signal<ReviewNavigation>(INITIAL);
  private leaveGuard: ReviewLeaveGuard | null = null;
  /** Bumped per guarded navigation, so only the latest one can land. */
  private leaveTicket = 0;

  /** The latest navigation. */
  readonly current = this._current.asReadonly();

  /**
   * Register the question asked before the spot editor is replaced (the
   * review shell, while mounted). Returns the release.
   */
  registerLeaveGuard(guard: ReviewLeaveGuard): () => void {
    this.leaveGuard = guard;
    return () => {
      if (this.leaveGuard === guard) this.leaveGuard = null;
    };
  }

  /** Show the Changes tab, comparing the working tree, narrowed to one turn. */
  openChangeSet(request: {
    workspaceRoot: string;
    files: readonly ReviewChangeSetFile[];
    ownerSessionId?: string;
  }): void {
    void this.navigate(
      'changes',
      { kind: 'worktree' },
      {
        kind: 'change-set',
        workspaceRoot: request.workspaceRoot,
        files: [...request.files],
        ...(request.ownerSessionId
          ? { ownerSessionId: request.ownerSessionId }
          : {}),
      },
    );
  }

  /**
   * Open one file in the spot editor at an optional line. The comparison is
   * kept so "Back to review" returns to it. The editor opens read-only unless
   * `editable` is set (the canvas "Edit" action, design-spec §7).
   */
  openFile(
    path: string,
    line?: number,
    options?: { readonly editable?: boolean },
  ): void {
    void this.navigate('changes', this._current().scope, {
      kind: 'file',
      request: line === undefined ? { path } : { path, line },
      ...(options?.editable ? { editable: true as const } : {}),
    });
  }

  /**
   * Leave the spot editor for the canvas, keeping the comparison. Not
   * guarded: only the editor's own Back emits this, after it asked.
   */
  backToReview(): void {
    this.commit('changes', this._current().scope, { kind: 'none' });
  }

  /**
   * Show one commit against its first parent, read-only, through
   * `git:reviewChanges { base: '<sha>^', head: '<sha>' }`. A failed read
   * (a root commit has no parent) leaves the current view unchanged and
   * returns the reason. A navigation made while the read was in flight wins.
   */
  async openHistorical(sha: string): Promise<ReviewNavigationOutcome> {
    const commit = sha.trim();
    if (!COMMIT_SHA.test(commit)) {
      return { opened: false, error: INVALID_COMMIT_MESSAGE };
    }
    const workspaceRoot = this.gitStatus.activeWorkspacePath();
    if (!workspaceRoot) return { opened: false, error: NO_WORKSPACE_MESSAGE };

    const seq = this._current().seq;
    let result: GitReviewChangesResult | undefined;
    let transportError: string | undefined;
    try {
      const response = await rpcCall<GitReviewChangesResult>(
        this.vscode,
        'git:reviewChanges',
        {
          workspaceRoot,
          base: `${commit}^`,
          head: commit,
        } satisfies GitReviewChangesParams,
      );
      result = response.data;
      transportError = response.success ? undefined : response.error;
    } catch (error: unknown) {
      console.error('[ReviewNavigationService] git:reviewChanges threw', error);
    }

    if (
      this._current().seq !== seq ||
      this.gitStatus.activeWorkspacePath() !== workspaceRoot
    ) {
      return { opened: false, error: null };
    }
    const base = result?.base;
    const head = result?.head;
    if (!result?.success || !base || !head) {
      return {
        opened: false,
        error: result?.error ?? transportError ?? HISTORICAL_READ_MESSAGE,
      };
    }
    const landed = await this.navigate(
      'changes',
      {
        kind: 'historical',
        base,
        head,
        label: head.sha.slice(0, 7),
        files: result.files,
      },
      { kind: 'none' },
    );
    // Not landing is Keep editing (or a newer navigation): nothing failed.
    return landed ? { opened: true } : { opened: false, error: null };
  }

  /**
   * Show one stash file against the stash's parent, read-only.
   *
   * A stash listing carries no line counts and no binary flag, so the file's
   * row is read through `git:reviewChanges` over the same two commits. When
   * that read fails (or does not list the file) the row is built from the
   * listing, with unknown counts. A navigation made while the read was in
   * flight wins.
   */
  async openStashFile(request: ReviewStashFileRequest): Promise<void> {
    const { file } = request;
    const workspaceRoot = this.gitStatus.activeWorkspacePath();
    const seq = this._current().seq;
    const listed = workspaceRoot
      ? await this.readStashFileRow(workspaceRoot, request)
      : null;
    if (
      this._current().seq !== seq ||
      this.gitStatus.activeWorkspacePath() !== workspaceRoot
    ) {
      return;
    }
    await this.navigate(
      'changes',
      {
        kind: 'historical',
        base: request.base,
        head: request.head,
        label: request.label,
        files: [
          listed ?? {
            path: file.path,
            ...(file.oldPath ? { originalPath: file.oldPath } : {}),
            status: file.status,
            additions: null,
            deletions: null,
            binary: false,
          },
        ],
      },
      {
        kind: 'diff',
        path: file.path,
        ...(file.oldPath ? { originalPath: file.oldPath } : {}),
      },
    );
  }

  /** A shell tab was picked. */
  selectTab(tab: ReviewTab): void {
    const current = this._current();
    if (current.tab === tab) return;
    void this.navigate(tab, current.scope, current.target);
  }

  /** A comparison was picked in the comparison bar. Clears the target. */
  selectComparison(kind: ReviewComparisonKind): void {
    void this.navigate('changes', { kind }, { kind: 'none' });
  }

  /** The stash file's `git:reviewChanges` row, or `null` when it cannot be read. */
  private async readStashFileRow(
    workspaceRoot: string,
    request: ReviewStashFileRequest,
  ): Promise<GitReviewFile | null> {
    try {
      const response = await rpcCall<GitReviewChangesResult>(
        this.vscode,
        'git:reviewChanges',
        {
          workspaceRoot,
          base: request.base.sha,
          head: request.head.sha,
        } satisfies GitReviewChangesParams,
      );
      const result = response.success ? response.data : undefined;
      if (!result?.success) return null;
      return result.files.find((row) => row.path === request.file.path) ?? null;
    } catch (error: unknown) {
      console.error('[ReviewNavigationService] git:reviewChanges threw', error);
      return null;
    }
  }

  /**
   * Land a navigation, asking the leave guard first when it would replace the
   * spot editor. Resolves `true` when it landed. With no question to ask (or a
   * synchronous answer) it lands before returning.
   */
  private navigate(
    tab: ReviewTab,
    scope: ReviewScope,
    target: ReviewTarget,
  ): Promise<boolean> {
    const current = this._current();
    const guard = this.leaveGuard;
    const replacesEditor =
      current.target.kind === 'file' &&
      (target.kind !== 'file' || tab !== current.tab);
    if (!guard || !replacesEditor) {
      this.commit(tab, scope, target);
      return Promise.resolve(true);
    }

    const ticket = ++this.leaveTicket;
    const land = (leave: boolean): boolean => {
      if (
        !leave ||
        ticket !== this.leaveTicket ||
        this._current().seq !== current.seq
      ) {
        return false;
      }
      this.commit(tab, scope, target);
      return true;
    };
    // A guard that fails keeps the editor: losing edits is the worse outcome.
    const refuse = (error: unknown): boolean => {
      console.error('[ReviewNavigationService] leave guard failed', error);
      return false;
    };
    let answer: boolean | Promise<boolean>;
    try {
      answer = guard();
    } catch (error: unknown) {
      return Promise.resolve(refuse(error));
    }
    return typeof answer === 'boolean'
      ? Promise.resolve(land(answer))
      : answer.then(land, refuse);
  }

  private commit(
    tab: ReviewTab,
    scope: ReviewScope,
    target: ReviewTarget,
  ): void {
    const seq = this._current().seq + 1;
    this._current.set({ seq, tab, scope, target });
  }
}
