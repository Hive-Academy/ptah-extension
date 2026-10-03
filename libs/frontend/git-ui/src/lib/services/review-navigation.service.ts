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
import type { FileViewOpenRequest } from '../types/file-view.types';

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

/** How {@link ReviewNavigationService.openFile} opens a file. */
export interface ReviewOpenFileOptions {
  /** Open editable (the canvas "Edit" action); otherwise read-only. */
  readonly editable?: boolean;
  readonly column?: number;
  /** The workspace a relative path resolves against. */
  readonly workspaceRoot?: string;
  /** The previewed markdown document a relative link was written in. */
  readonly documentPath?: string;
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
 * change set, a commit, a stash file or a comparison) first asks the
 * registered {@link ReviewLeaveGuard}, so no caller has to know an editor
 * exists. Only {@link backToReview} skips it: the editor asked before it
 * emitted. A file-to-file navigation is not guarded here because the editor
 * stays mounted and asks about its own replacement; a tab-only switch is not
 * guarded because the editor stays mounted behind the other tab. While an answer is
 * pending, the latest navigation wins: a newer guarded navigation, a newer
 * git-reading open, a committed navigation or a workspace switch supersedes it.
 */
@Injectable({ providedIn: 'root' })
export class ReviewNavigationService {
  private readonly vscode = inject(VSCodeService);
  private readonly gitStatus = inject(GitStatusService);

  private readonly _current = signal<ReviewNavigation>(INITIAL);
  private leaveGuard: ReviewLeaveGuard | null = null;
  /**
   * One navigation generation, bumped when a git-reading open
   * ({@link openHistorical}, {@link openStashFile}) starts, when a guarded
   * navigation starts asking, and on every workspace switch or removal. A
   * pending continuation (an RPC read or a leave-guard answer, including the
   * workspace-reset one) lands only while it still holds the latest
   * generation, so an older click never replaces a newer one.
   */
  private generation = 0;
  /**
   * The workspace the current scope and target were opened in, or `null`
   * while they hold nothing workspace-specific. Set when they are opened and
   * kept while only the tab (or a retained editor's comparison) changes.
   */
  private stateWorkspace: string | null = null;

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
   *
   * `workspaceRoot` and `documentPath` are where a relative path resolves (a
   * chat link's session workspace, or the previewed document it was written
   * in); the backend re-authorizes the path either way.
   */
  openFile(path: string, line?: number, options?: ReviewOpenFileOptions): void {
    const request: FileViewOpenRequest = {
      path,
      ...(line === undefined ? {} : { line }),
      ...(options?.column === undefined ? {} : { column: options.column }),
      ...(options?.workspaceRoot
        ? { workspaceRoot: options.workspaceRoot }
        : {}),
      ...(options?.documentPath ? { documentPath: options.documentPath } : {}),
    };
    void this.navigate('changes', this._current().scope, {
      kind: 'file',
      request,
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

    const ticket = ++this.generation;
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

    if (this.superseded(ticket, seq, workspaceRoot)) {
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
    const ticket = ++this.generation;
    const seq = this._current().seq;
    const listed = workspaceRoot
      ? await this.readStashFileRow(workspaceRoot, request)
      : null;
    if (this.superseded(ticket, seq, workspaceRoot)) return;
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

  /**
   * The active workspace changed (`WorkspaceCoordinatorService`). A commit or
   * stash comparison, a change set, a diff target or a spot-editor file
   * opened in another workspace would be read against the new repository, so
   * they are dropped; the tab and a generic comparison (worktree, staged,
   * branch) stay. Opens still reading git, and navigations still waiting on
   * the leave guard, are superseded.
   */
  switchWorkspace(workspacePath: string): void {
    this.generation++;
    if (this.stateWorkspace === null || this.stateWorkspace === workspacePath) {
      return;
    }
    this.resetWorkspaceState();
  }

  /** A workspace was closed; drop what was opened in it. */
  removeWorkspaceState(workspacePath: string): void {
    if (this.stateWorkspace !== workspacePath) return;
    this.generation++;
    this.resetWorkspaceState();
  }

  /**
   * Point the shell back at a workspace-neutral view. A spot editor still
   * asks the leave guard before it goes: its comparison is dropped at once
   * (the editor stays mounted), and the editor itself only when the user
   * agrees, so unsaved edits are never discarded silently. A retained editor
   * keeps the workspace it was opened in as its owner (see {@link commit}).
   */
  private resetWorkspaceState(): void {
    const { tab, scope, target } = this._current();
    const neutralScope: ReviewScope =
      scope.kind === 'historical' ? { kind: 'worktree' } : scope;
    if (target.kind === 'file') {
      if (scope.kind === 'historical') this.commit(tab, neutralScope, target);
      void this.navigate(tab, neutralScope, { kind: 'none' });
      return;
    }
    this.commit(tab, neutralScope, { kind: 'none' });
  }

  /** A newer open, a committed navigation or a workspace switch won. */
  private superseded(
    ticket: number,
    seq: number,
    workspaceRoot: string | null,
  ): boolean {
    return (
      ticket !== this.generation ||
      this._current().seq !== seq ||
      this.gitStatus.activeWorkspacePath() !== workspaceRoot
    );
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
    // The workspace the request was made in owns what it opens.
    const opened = this.gitStatus.activeWorkspacePath();
    // A tab-only switch keeps the file target: the Changes body (and the
    // editor in it) stays mounted behind the other tabs, so nothing is lost.
    const replacesEditor =
      current.target.kind === 'file' && target.kind !== 'file';
    if (!guard || !replacesEditor) {
      this.commit(tab, scope, target, opened);
      return Promise.resolve(true);
    }

    const ticket = ++this.generation;
    const land = (leave: boolean): boolean => {
      if (
        !leave ||
        ticket !== this.generation ||
        this._current().seq !== current.seq
      ) {
        return false;
      }
      this.commit(tab, scope, target, opened);
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

  /**
   * Land a navigation. `opened` is the workspace the request was made in; it
   * becomes the owner only of what is newly opened. A retained target (a
   * tab-only switch, or a kept editor whose comparison was dropped) keeps the
   * owner it was opened under, whatever workspace is active now.
   */
  private commit(
    tab: ReviewTab,
    scope: ReviewScope,
    target: ReviewTarget,
    opened: string | null = this.gitStatus.activeWorkspacePath(),
  ): void {
    const current = this._current();
    const retained =
      target === current.target &&
      (scope === current.scope || target.kind !== 'none');
    let owner: string | null = null;
    if (scope.kind === 'historical' || target.kind !== 'none') {
      owner = retained ? this.stateWorkspace : opened;
    }
    this._current.set({ seq: current.seq + 1, tab, scope, target });
    this.stateWorkspace = owner;
  }
}
