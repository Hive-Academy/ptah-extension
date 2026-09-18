import { Injectable, computed, inject, signal } from '@angular/core';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import type {
  GitReviewChangesResult,
  GitReviewFileResult,
  GitStashFileEntry,
  GitStashListResult,
  GitStashMutationResult,
  GitStashShowResult,
  StashEntry,
} from '@ptah-extension/shared';
import type { EditorTab } from '../types/diff-tab.types';
import { DiffTabsService } from './diff-tabs.service';
import { GitBranchesService } from './git-branches.service';
import { GitStatusService } from './git-status.service';
import {
  describeGitReadError,
  firstReadError,
  readSideText,
} from './git-read-error-messages';

export type GitStashMutation = 'apply' | 'pop' | 'drop';

type ListReloadResult = 'applied' | 'failed' | 'superseded';

/** Resolved commits a stash entry is diffed between: its parent and itself. */
interface StashRefs {
  baseSha: string;
  headSha: string;
}

/** Everything the stash viewer shows, for ONE workspace folder. */
interface StashWorkspaceState {
  entries: readonly StashEntry[];
  listLoading: boolean;
  selectedIndex: number | null;
  selectedHash: string | null;
  files: readonly GitStashFileEntry[];
  filesLoading: boolean;
  /** Immutable stash parent / head shas, resolved lazily on first file open. */
  refs: StashRefs | null;
  busy: boolean;
  error: string | null;
}

const EMPTY_STATE: StashWorkspaceState = {
  entries: [],
  listLoading: false,
  selectedIndex: null,
  selectedHash: null,
  files: [],
  filesLoading: false,
  refs: null,
  busy: false,
  error: null,
};

const MUTATION_METHODS: Record<GitStashMutation, string> = {
  apply: 'git:stashApply',
  pop: 'git:stashPop',
  drop: 'git:stashDrop',
};

const STASH_LIST_CHANGED_ERROR =
  'The stash list changed. Refresh and try again.';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * GitStashService — state for the dock's stash viewer: the entry list, the
 * selected entry's changed files, and apply / pop / drop.
 *
 * Workspace-partitioned (git-ui guideline 3): state lives in a map keyed by
 * the workspace path and every public signal derives from the ACTIVE slice,
 * which follows `GitStatusService.activeWorkspacePath()`. Every async write
 * targets the workspace captured when the request started, so a late answer
 * lands in its own slice instead of leaking into the folder now on screen.
 *
 * Not a `MessageHandler`: the stash count badge is already refreshed from
 * `git:status-update` by {@link GitBranchesService}; this list is read on
 * demand when the viewer opens.
 */
@Injectable({ providedIn: 'root' })
export class GitStashService {
  private readonly vscode = inject(VSCodeService);
  private readonly gitStatus = inject(GitStatusService);
  private readonly gitBranches = inject(GitBranchesService);
  private readonly diffTabs = inject(DiffTabsService);

  private readonly _states = signal<ReadonlyMap<string, StashWorkspaceState>>(
    new Map(),
  );
  private readonly listGenerations = new Map<string, number>();
  private readonly interactionGenerations = new Map<string, number>();
  private fileDiffToken = 0;

  private readonly active = computed<StashWorkspaceState>(() => {
    const workspace = this.gitStatus.activeWorkspacePath();
    return (workspace && this._states().get(workspace)) || EMPTY_STATE;
  });

  readonly entries = computed(() => this.active().entries);
  readonly listLoading = computed(() => this.active().listLoading);
  readonly selectedIndex = computed(() => this.active().selectedIndex);
  readonly files = computed(() => this.active().files);
  readonly filesLoading = computed(() => this.active().filesLoading);
  readonly busy = computed(() => this.active().busy);
  readonly error = computed(() => this.active().error);

  /** Read `git:stashList` for the active workspace. */
  async loadList(): Promise<void> {
    const workspace = this.gitStatus.activeWorkspacePath();
    if (!workspace) return;
    await this.loadListFor(workspace);
  }

  private async loadListFor(workspace: string): Promise<ListReloadResult> {
    const generation = this.bumpGeneration(this.listGenerations, workspace);
    this.patch(workspace, { listLoading: true });
    try {
      const response = await rpcCall<GitStashListResult>(
        this.vscode,
        'git:stashList',
        { workspaceRoot: workspace },
      );
      if (
        !this.isCurrentGeneration(this.listGenerations, workspace, generation)
      )
        return 'superseded';
      if (
        response.success &&
        response.data &&
        Array.isArray(response.data.entries)
      ) {
        const entries = response.data.entries;
        const selectedHash = this.stateFor(workspace).selectedHash;
        const selectedEntry = entries.find(
          (entry) => entry.hash === selectedHash,
        );
        this.patch(workspace, {
          entries,
          listLoading: false,
          error: null,
          ...(selectedEntry
            ? { selectedIndex: selectedEntry.index }
            : {
                selectedIndex: null,
                selectedHash: null,
                files: [],
                refs: null,
              }),
        });
        return 'applied';
      } else {
        this.patch(workspace, {
          listLoading: false,
          error: response.error ?? 'Could not list stashes.',
        });
        return 'failed';
      }
    } catch (error: unknown) {
      // degradation-audit: reported - the message is published through the
      // slice's `error`, which the stash popover renders.
      if (
        !this.isCurrentGeneration(this.listGenerations, workspace, generation)
      )
        return 'superseded';
      this.patch(workspace, {
        listLoading: false,
        error: messageOf(error, 'Could not list stashes.'),
      });
      return 'failed';
    } finally {
      if (
        this.isCurrentGeneration(this.listGenerations, workspace, generation)
      ) {
        this.patch(workspace, { listLoading: false });
      }
    }
  }

  /**
   * Select an entry and load its changed files. Selecting the selected entry
   * again collapses it.
   */
  async select(entry: StashEntry): Promise<void> {
    const workspace = this.gitStatus.activeWorkspacePath();
    if (!workspace) return;
    const generation = this.bumpGeneration(
      this.interactionGenerations,
      workspace,
    );
    if (this.stateFor(workspace).selectedHash === entry.hash) {
      this.patch(workspace, {
        selectedIndex: null,
        selectedHash: null,
        files: [],
        refs: null,
        filesLoading: false,
      });
      return;
    }
    this.patch(workspace, {
      selectedIndex: entry.index,
      selectedHash: entry.hash,
      files: [],
      refs: null,
      filesLoading: true,
      error: null,
    });
    try {
      const response = await rpcCall<GitStashShowResult>(
        this.vscode,
        'git:stashShow',
        {
          workspaceRoot: workspace,
          index: entry.index,
          expectedHash: entry.hash,
        },
      );
      if (!this.isSelectionCurrent(workspace, entry, generation)) return;
      const result = response.data;
      if (response.success && result?.success) {
        this.patch(workspace, { files: result.files, filesLoading: false });
      } else {
        this.patch(workspace, {
          filesLoading: false,
          error: result?.error ?? response.error ?? 'Could not read the stash.',
        });
      }
    } catch (error: unknown) {
      // degradation-audit: reported - the message is published through the
      // slice's `error`, which the stash popover renders.
      if (!this.isSelectionCurrent(workspace, entry, generation)) return;
      this.patch(workspace, {
        filesLoading: false,
        error: messageOf(error, 'Could not read the stash.'),
      });
    } finally {
      if (
        this.isCurrentGeneration(
          this.interactionGenerations,
          workspace,
          generation,
        )
      ) {
        this.patch(workspace, { filesLoading: false });
      }
    }
  }

  /**
   * Run apply / pop / drop on `stash@{index}`, then reload the stash list, the
   * stash count badge and the working-tree status — pop and apply change files,
   * and stash indices shift after pop and drop.
   */
  async mutate(
    kind: GitStashMutation,
    entry: StashEntry,
  ): Promise<GitStashMutationResult> {
    const workspace = this.gitStatus.activeWorkspacePath();
    if (!workspace) return { success: false, error: 'No workspace is open.' };
    if (this.stateFor(workspace).busy) {
      return { success: false, error: 'Another stash action is running.' };
    }
    const hadInFlightListRead = this.stateFor(workspace).listLoading;
    this.bumpGeneration(this.listGenerations, workspace);
    this.bumpGeneration(this.interactionGenerations, workspace);
    this.patch(workspace, {
      busy: true,
      listLoading: false,
      filesLoading: false,
      error: null,
    });
    let outcome: GitStashMutationResult;
    try {
      const response = await rpcCall<GitStashMutationResult>(
        this.vscode,
        MUTATION_METHODS[kind],
        {
          workspaceRoot: workspace,
          index: entry.index,
          expectedHash: entry.hash,
        },
      );
      outcome =
        response.success && response.data
          ? response.data
          : {
              success: false,
              error: response.error ?? `Stash ${kind} failed.`,
            };
    } catch (error: unknown) {
      outcome = {
        success: false,
        error: messageOf(error, `Stash ${kind} failed.`),
      };
    }
    this.patch(workspace, {
      busy: false,
      error: outcome.success
        ? null
        : (outcome.error ?? `Stash ${kind} failed.`),
      // Indices are positional; any selection is meaningless after a change.
      ...(outcome.success && kind !== 'apply'
        ? {
            selectedIndex: null,
            selectedHash: null,
            files: [],
            refs: null,
          }
        : {}),
    });
    if (outcome.error === STASH_LIST_CHANGED_ERROR) {
      const reloaded = await this.loadListFor(workspace);
      if (reloaded === 'applied') {
        this.patch(workspace, { error: STASH_LIST_CHANGED_ERROR });
      }
    }
    if (
      !outcome.success &&
      outcome.error !== STASH_LIST_CHANGED_ERROR &&
      hadInFlightListRead &&
      this.gitStatus.activeWorkspacePath() === workspace
    ) {
      const mutationError = this.stateFor(workspace).error;
      const reloaded = await this.loadListFor(workspace);
      if (
        reloaded === 'applied' &&
        mutationError &&
        this.gitStatus.activeWorkspacePath() === workspace
      ) {
        this.patch(workspace, { error: mutationError });
      }
    }
    if (outcome.success && this.gitStatus.activeWorkspacePath() === workspace) {
      const refreshes = await Promise.allSettled([
        this.loadListFor(workspace),
        this.gitBranches.refreshForCauses(['refs-stash']),
        this.gitStatus.refresh(),
      ]);
      const listRefresh = refreshes[0];
      if (
        refreshes.some(({ status }) => status === 'rejected') ||
        (listRefresh.status === 'fulfilled' && listRefresh.value === 'failed')
      ) {
        this.patch(workspace, {
          error: `Stash ${kind} completed, but the view could not refresh.`,
        });
      }
    }
    return outcome;
  }

  /** Open one file of the selected stash as a diff tab: parent vs stash. */
  async openFileDiff(file: GitStashFileEntry): Promise<void> {
    const workspace = this.gitStatus.activeWorkspacePath();
    if (!workspace) return;
    const state = this.stateFor(workspace);
    const entry = state.entries.find(
      ({ index, hash }) =>
        index === state.selectedIndex && hash === state.selectedHash,
    );
    if (!entry || state.busy) return;
    const generation = this.currentGeneration(
      this.interactionGenerations,
      workspace,
    );
    const token = ++this.fileDiffToken;
    try {
      const refs = await this.resolveRefs(workspace, entry, generation);
      if (token !== this.fileDiffToken) return;
      if (!this.isSelectionCurrent(workspace, entry, generation)) return;
      if (!refs) return;
      const response = await rpcCall<GitReviewFileResult>(
        this.vscode,
        'git:reviewFile',
        {
          workspaceRoot: workspace,
          baseSha: refs.baseSha,
          headSha: refs.headSha,
          path: file.path,
          ...(file.oldPath ? { originalPath: file.oldPath } : {}),
        },
      );
      if (token !== this.fileDiffToken) return;
      if (!this.isSelectionCurrent(workspace, entry, generation)) return;
      const result = response.data;
      if (!response.success || !result?.success) {
        this.patch(workspace, {
          error:
            result?.error ?? response.error ?? 'Could not read the stash diff.',
        });
        return;
      }
      this.diffTabs.openHistoricalDiff(this.toTab(entry, result));
    } catch (error: unknown) {
      // degradation-audit: reported - the message is published through the
      // slice's `error`, which the stash popover renders.
      if (token !== this.fileDiffToken) return;
      if (!this.isSelectionCurrent(workspace, entry, generation)) return;
      this.patch(workspace, {
        error: messageOf(error, 'Could not read the stash diff.'),
      });
    }
  }

  /**
   * Resolve the selected stash hash and its first parent through the read-only
   * review pair. Cached only for the current immutable selection.
   */
  private async resolveRefs(
    workspace: string,
    entry: StashEntry,
    generation: number,
  ): Promise<StashRefs | null> {
    const cached = this.stateFor(workspace).refs;
    if (cached) return cached;
    const response = await rpcCall<GitReviewChangesResult>(
      this.vscode,
      'git:reviewChanges',
      {
        workspaceRoot: workspace,
        base: `${entry.hash}^1`,
        head: entry.hash,
      },
    );
    if (!this.isSelectionCurrent(workspace, entry, generation)) return null;
    const result = response.data;
    const baseSha = result?.mergeBaseSha ?? result?.base?.sha;
    const headSha = result?.head?.sha;
    if (!response.success || !result?.success || !baseSha || !headSha) {
      this.patch(workspace, {
        error:
          result?.error ?? response.error ?? 'Could not resolve the stash.',
      });
      return null;
    }
    const refs = { baseSha, headSha };
    if (this.isSelectionCurrent(workspace, entry, generation)) {
      this.patch(workspace, { refs });
    }
    return refs;
  }

  private toTab(entry: StashEntry, data: GitReviewFileResult): EditorTab {
    const shortHash = entry.hash.slice(0, 7);
    const label = `${entry.message} · ${shortHash}`;
    const fileName =
      data.path.replace(/\\/g, '/').split('/').pop() || data.path;
    const failure = firstReadError(data.original, data.modified);
    const modified = readSideText(data.modified);
    return {
      filePath: `diff:${entry.hash}:${data.headSha}:${data.path}`,
      fileName: `${fileName} (${label})`,
      content: modified,
      isDirty: false,
      diff: {
        provenance: {
          kind: 'historical',
          base: { name: `${entry.hash}^1`, sha: data.baseSha },
          head: { name: entry.hash, sha: data.headSha },
        },
        comparison: 'staged',
        path: data.path,
        originalPath: data.originalPath,
        original: readSideText(data.original),
        modified,
        originalRef:
          data.original.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'commit', sha: data.baseSha },
        modifiedRef:
          data.modified.outcome === 'absent'
            ? { kind: 'absent' }
            : { kind: 'commit', sha: data.headSha },
        snapshotToken: '',
        hunks: [],
        isBinary:
          data.original.outcome === 'binary' ||
          data.modified.outcome === 'binary',
        status: failure ? 'error' : 'fresh',
        ...(failure
          ? {
              errorMessage: describeGitReadError(failure.code),
              errorDetail: failure.message || undefined,
            }
          : {}),
        requestId: 0,
      },
    };
  }

  private stateFor(workspace: string): StashWorkspaceState {
    return this._states().get(workspace) ?? EMPTY_STATE;
  }

  private bumpGeneration(map: Map<string, number>, workspace: string): number {
    const generation = this.currentGeneration(map, workspace) + 1;
    map.set(workspace, generation);
    return generation;
  }

  private currentGeneration(
    map: Map<string, number>,
    workspace: string,
  ): number {
    return map.get(workspace) ?? 0;
  }

  private isCurrentGeneration(
    map: Map<string, number>,
    workspace: string,
    generation: number,
  ): boolean {
    return this.currentGeneration(map, workspace) === generation;
  }

  private isSelectionCurrent(
    workspace: string,
    entry: StashEntry,
    generation: number,
  ): boolean {
    const state = this.stateFor(workspace);
    return (
      this.gitStatus.activeWorkspacePath() === workspace &&
      !state.busy &&
      state.selectedIndex === entry.index &&
      state.selectedHash === entry.hash &&
      this.isCurrentGeneration(
        this.interactionGenerations,
        workspace,
        generation,
      )
    );
  }

  private patch(workspace: string, change: Partial<StashWorkspaceState>): void {
    this._states.update((states) => {
      const next = new Map(states);
      next.set(workspace, {
        ...(states.get(workspace) ?? EMPTY_STATE),
        ...change,
      });
      return next;
    });
  }
}
