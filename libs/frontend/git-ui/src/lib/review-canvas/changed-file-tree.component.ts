import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  LucideAngularModule,
  Minus,
  Plus,
  Undo2,
  X,
} from 'lucide-angular';
import { ElectronLayoutService } from '@ptah-extension/core';
import type { RpcCallResult } from '@ptah-extension/core';
import { GIT_LOCKED_MESSAGE } from '@ptah-extension/shared';
import type {
  EditorTarget,
  GitConflictKind,
  GitFileStatus,
  GitMutationFailureCode,
  GitReviewFile,
} from '@ptah-extension/shared';
import {
  FileStatusBadgeComponent,
  type FileStatusCode,
} from '@ptah-extension/ui';
import { buildChangedFileTree } from '../source-control/changed-file-tree';
import type { ChangedFileTreeNode } from '../source-control/changed-file-tree';
import { RailResizeHandleComponent } from '../git-dock/rail-resize-handle.component';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import { GitConfirmDialogComponent } from '../shared/git-confirm-dialog.component';
import { GitReviewService } from '../services/git-review.service';
import { GitStatusService } from '../services/git-status.service';
import { SourceControlService } from '../services/source-control.service';
import type { ReviewScope } from '../services/review-navigation.service';

/** The comparison the tree lists files for. */
export type ChangedFileTreeComparison = ReviewScope['kind'];

/** The file a row stands for, as the canvas needs it to scroll there. */
export interface ChangedFileSelection {
  path: string;
  originalPath?: string;
  /** Status comparisons only: whether the row is in the Staged section. */
  staged?: boolean;
}

/** Rail bounds, the same the dock's rail uses (`ElectronLayoutService`). */
const RAIL_MIN_WIDTH = 160;
const RAIL_MAX_WIDTH = 480;

type StatusSection = 'staged' | 'unstaged';

/** One file of either source, normalized for the rows. */
interface TreeFile {
  readonly path: string;
  readonly originalPath?: string;
  readonly status: FileStatusCode;
  readonly conflictKind?: GitConflictKind;
  readonly additions: number | null;
  readonly deletions: number | null;
  readonly binary: boolean;
  /** `null` for branch and historical comparisons. */
  readonly staged: boolean | null;
  readonly isDirectory?: boolean;
}

interface TreeRowBase {
  readonly id: string;
  readonly level: number;
  readonly setSize: number;
  readonly posInSet: number;
  readonly parentId: string | null;
  /** Every collapsible row above this one, outermost first. */
  readonly ancestorIds: readonly string[];
}

type TreeRow =
  | (TreeRowBase & {
      readonly kind: 'section';
      readonly section: StatusSection;
      readonly label: string;
      readonly count: number;
    })
  | (TreeRowBase & {
      readonly kind: 'folder';
      readonly name: string;
      readonly path: string;
    })
  | (TreeRowBase & {
      readonly kind: 'file';
      readonly name: string;
      readonly file: TreeFile;
    });

/** The fields every git mutation result (stage, unstage, discard) shares. */
interface GitMutationOutcome {
  readonly success: boolean;
  readonly error?: string;
  readonly code?: GitMutationFailureCode;
}

interface PendingDiscard {
  readonly workspaceRoot: string;
  readonly section: StatusSection;
  readonly path: string;
  readonly untracked: boolean;
}

function transportFailureText(detail: string | undefined): string {
  return `Could not reach git: ${detail || 'the request failed'}`;
}

/**
 * Why a mutation failed, or null when git reports success. A transport failure
 * is never read as git success (TASK_2026_576 RC1); a held lock always reads as
 * `GIT_LOCKED_MESSAGE`.
 */
function mutationFailureText(
  result: RpcCallResult<GitMutationOutcome>,
): string | null {
  if (!result.success) return transportFailureText(result.error);
  const data = result.data;
  if (!data) return 'Git returned no result.';
  if (data.success) return null;
  if (data.code === 'LOCKED') return GIT_LOCKED_MESSAGE;
  return data.error || 'The git operation failed.';
}

function fromStatus(file: GitFileStatus): TreeFile {
  return {
    path: file.path,
    ...(file.origPath ? { originalPath: file.origPath } : {}),
    status: file.status,
    ...(file.conflict ? { conflictKind: file.conflict.kind } : {}),
    additions: file.additions ?? null,
    deletions: file.deletions ?? null,
    binary: file.binary ?? false,
    staged: file.staged,
    ...(file.isDirectory ? { isDirectory: true } : {}),
  };
}

function fromReview(file: GitReviewFile): TreeFile {
  return {
    path: file.path,
    ...(file.originalPath ? { originalPath: file.originalPath } : {}),
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    staged: null,
  };
}

/** Append `nodes` (and their descendants) to `out` in display order. */
function flattenNodes(
  nodes: readonly ChangedFileTreeNode<TreeFile>[],
  scope: string,
  level: number,
  parentId: string | null,
  ancestorIds: readonly string[],
  out: TreeRow[],
): void {
  nodes.forEach((node, index) => {
    const id = `${scope}\u0000${node.kind}\u0000${node.path}`;
    const base = {
      id,
      level,
      setSize: nodes.length,
      posInSet: index + 1,
      parentId,
      ancestorIds,
    };
    if (node.kind === 'folder') {
      out.push({ ...base, kind: 'folder', name: node.name, path: node.path });
      flattenNodes(
        node.children,
        scope,
        level + 1,
        id,
        [...ancestorIds, id],
        out,
      );
    } else {
      out.push({ ...base, kind: 'file', name: node.name, file: node.file });
    }
  });
}

const SECTION_LABEL: Readonly<Record<StatusSection, string>> = {
  staged: 'Staged',
  unstaged: 'Changes',
};

/** Keyboard focus ring shared by every control here (repository pattern). */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

const ICON_BUTTON = `btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ${FOCUS_RING}`;

/**
 * ChangedFileTreeComponent — the review canvas's left rail (implementation-plan
 * Component 24, design-spec §6.1).
 *
 * - Working tree and Staged comparisons list the git status in two sections,
 *   Staged and Changes, with stage / unstage and a confirmed discard per row
 *   and stage-all / unstage-all per section. Every result is awaited and
 *   checked, a failure shows on its row or section, and the status is re-read
 *   after every mutation (RC1, ported from `SourceControlPanelComponent`).
 * - Branch and historical comparisons list the review's files read-only;
 *   branch rows carry the persisted "Viewed" mark (`GitReviewService`, key
 *   `gitReview.viewed.v1`).
 * - A WAI-ARIA tree: one tab stop (roving tabindex), Up/Down/Home/End move,
 *   Right expands or enters, Left collapses or climbs, Enter/Space selects a
 *   file or toggles a folder. The focused row's actions join the tab order
 *   after it, so they are reachable without leaving the tree's single stop.
 *   Rows are rendered flat with `aria-level`/`aria-setsize`/`aria-posinset`.
 * - Beside the diff the rail is resizable (`RailResizeHandleComponent`) and
 *   its width and collapsed state persist through `ElectronLayoutService`;
 *   `stacked` (the canvas below 520 px) puts it above the diff at full width.
 *
 * Open-in renders on the focused file row only: the button reads a setting
 * and listens on the document, which a row-per-file list must not multiply.
 */
@Component({
  selector: 'ptah-changed-file-tree',
  standalone: true,
  imports: [
    LucideAngularModule,
    FileStatusBadgeComponent,
    RailResizeHandleComponent,
    OpenInButtonComponent,
    GitConfirmDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClass()',
    'data-testid': 'changed-file-tree-host',
  },
  template: `
    @if (!layout.gitRailCollapsed()) {
      <div
        class="flex min-h-0 min-w-0 flex-col bg-base-100 text-xs"
        [class]="panelClass()"
        [style.width.px]="stacked() ? null : layout.gitRailWidth()"
        data-testid="changed-file-tree"
      >
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          @if (rows().length > 0) {
            <div role="tree" [id]="treeId" aria-label="Changed files">
              @for (row of rows(); track row.id; let i = $index) {
                <div
                  #treeRow
                  role="treeitem"
                  class="group flex flex-col cursor-pointer select-none hover:bg-base-300/50 {{
                    focusRing
                  }}"
                  [class.bg-base-300]="isActiveRow(row)"
                  [attr.data-row-id]="row.id"
                  [attr.data-testid]="'tree-row-' + row.kind"
                  [attr.aria-level]="row.level"
                  [attr.aria-setsize]="row.setSize"
                  [attr.aria-posinset]="row.posInSet"
                  [attr.aria-expanded]="
                    row.kind === 'file' ? null : !isCollapsed(row.id)
                  "
                  [attr.aria-selected]="
                    row.kind === 'file' ? isActiveRow(row) : null
                  "
                  [attr.aria-labelledby]="labelledBy(row, i)"
                  [attr.aria-busy]="isRowBusy(row) || null"
                  [attr.tabindex]="row.id === rovingId() ? 0 : -1"
                  (focus)="focusedId.set(row.id)"
                  (click)="onRowClick(row, $event)"
                  (keydown)="onRowKeydown(row, $event)"
                >
                  <div
                    class="flex min-w-0 items-center gap-1 py-0.5 pr-2"
                    [style.padding-left.px]="indent(row)"
                  >
                    @switch (row.kind) {
                      @case ('section') {
                        <lucide-angular
                          [img]="
                            isCollapsed(row.id)
                              ? ChevronRightIcon
                              : ChevronDownIcon
                          "
                          class="h-3 w-3 shrink-0"
                          aria-hidden="true"
                        />
                        <span
                          [id]="domId(i, 'name')"
                          class="min-w-0 flex-1 truncate font-semibold uppercase tracking-wider text-[10px]"
                          >{{ row.label }} ({{ row.count }})</span
                        >
                        @if (row.count > 0) {
                          <span class="flex shrink-0" data-row-action>
                            @if (row.section === 'staged') {
                              <button
                                type="button"
                                [class]="iconButton"
                                title="Unstage all"
                                aria-label="Unstage all files"
                                data-testid="tree-unstage-all"
                                [tabIndex]="actionTabIndex(row)"
                                [disabled]="!canRunBulk()"
                                [attr.aria-busy]="
                                  isPending(sectionKey('staged')) || null
                                "
                                (click)="onUnstageAll()"
                              >
                                <lucide-angular
                                  [img]="MinusIcon"
                                  class="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                            } @else {
                              <button
                                type="button"
                                [class]="iconButton"
                                title="Stage all"
                                aria-label="Stage all files"
                                data-testid="tree-stage-all"
                                [tabIndex]="actionTabIndex(row)"
                                [disabled]="!canRunBulk()"
                                [attr.aria-busy]="
                                  isPending(sectionKey('unstaged')) || null
                                "
                                (click)="onStageAll()"
                              >
                                <lucide-angular
                                  [img]="PlusIcon"
                                  class="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                            }
                          </span>
                        }
                      }
                      @case ('folder') {
                        <lucide-angular
                          [img]="
                            isCollapsed(row.id)
                              ? ChevronRightIcon
                              : ChevronDownIcon
                          "
                          class="h-3 w-3 shrink-0"
                          aria-hidden="true"
                        />
                        <span
                          [id]="domId(i, 'name')"
                          class="min-w-0 flex-1 truncate font-medium"
                          [title]="row.path"
                          >{{ row.name }}</span
                        >
                      }
                      @case ('file') {
                        <ptah-file-status-badge
                          [attr.id]="domId(i, 'badge')"
                          [status]="row.file.status"
                          [conflictKind]="row.file.conflictKind"
                        />
                        <span
                          [id]="domId(i, 'name')"
                          class="min-w-0 flex-1 truncate"
                          [title]="fileTitle(row.file)"
                          >{{ row.name }}</span
                        >
                        <span
                          [id]="domId(i, 'counts')"
                          class="shrink-0 font-mono text-[10px]"
                        >
                          @if (row.file.binary) {
                            <span class="text-base-content-muted">binary</span>
                          } @else {
                            <span class="diff-add-text"
                              >+{{ row.file.additions ?? '?' }}</span
                            >
                            <span class="diff-del-text"
                              >−{{ row.file.deletions ?? '?' }}</span
                            >
                          }
                        </span>
                        <span
                          class="flex shrink-0 items-center gap-0.5 group-hover:opacity-100 group-focus-within:opacity-100"
                          [class.opacity-0]="!isFocusedRow(row)"
                          data-row-action
                        >
                          @if (row.file.staged !== null) {
                            @if (row.file.staged) {
                              <button
                                type="button"
                                [class]="iconButton"
                                title="Unstage"
                                [attr.aria-label]="'Unstage ' + row.name"
                                data-testid="tree-unstage"
                                [tabIndex]="actionTabIndex(row)"
                                [disabled]="!canRunRow(row)"
                                (click)="onUnstage(row)"
                              >
                                <lucide-angular
                                  [img]="MinusIcon"
                                  class="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                            } @else {
                              <button
                                type="button"
                                [class]="iconButton"
                                title="Stage"
                                [attr.aria-label]="'Stage ' + row.name"
                                data-testid="tree-stage"
                                [tabIndex]="actionTabIndex(row)"
                                [disabled]="!canRunRow(row)"
                                (click)="onStage(row)"
                              >
                                <lucide-angular
                                  [img]="PlusIcon"
                                  class="h-3.5 w-3.5"
                                  aria-hidden="true"
                                />
                              </button>
                            }
                            <button
                              type="button"
                              [class]="iconButton"
                              title="Discard changes"
                              [attr.aria-label]="
                                'Discard changes to ' + row.name
                              "
                              data-testid="tree-discard"
                              [tabIndex]="actionTabIndex(row)"
                              [disabled]="!canRunRow(row)"
                              (click)="onDiscard(row, $event)"
                            >
                              <lucide-angular
                                [img]="Undo2Icon"
                                class="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            </button>
                          }
                          @if (comparison() === 'branch') {
                            <input
                              type="checkbox"
                              class="checkbox checkbox-xs {{ focusRing }}"
                              title="Viewed"
                              [attr.aria-label]="'Viewed ' + row.name"
                              data-testid="tree-viewed"
                              [tabIndex]="actionTabIndex(row)"
                              [checked]="review.isViewed(row.file.path)"
                              (change)="review.toggleViewed(row.file.path)"
                            />
                          }
                          @if (isFocusedRow(row) && canOpenIn(row.file)) {
                            <ptah-open-in-button
                              mode="icon-only"
                              [targets]="editorTargets()"
                              [path]="row.file.path"
                              [root]="workspaceRoot()"
                              (open)="openFile.emit($event)"
                            />
                          }
                        </span>
                      }
                    }
                  </div>
                  @if (rowError(row); as message) {
                    <div
                      class="mx-2 my-0.5 flex items-start gap-1 rounded border border-error/60 bg-error/10 px-1.5 py-1 text-[10px] text-base-content"
                      data-row-action
                      data-testid="tree-row-error"
                    >
                      <lucide-angular
                        [img]="ErrorIcon"
                        class="mt-px h-3 w-3 shrink-0 text-error"
                        aria-hidden="true"
                      />
                      <span role="alert" class="min-w-0 flex-1 break-words">{{
                        message
                      }}</span>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs btn-square h-6 min-h-6 w-6 shrink-0 p-0 {{
                          focusRing
                        }}"
                        aria-label="Dismiss error"
                        [tabIndex]="actionTabIndex(row)"
                        (click)="dismissRowError(row)"
                      >
                        <lucide-angular
                          [img]="DismissIcon"
                          class="h-3 w-3"
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
          }
          @if (emptyMessage(); as message) {
            <p
              class="px-3 py-2 text-center text-[10px] text-base-content-muted"
              data-testid="changed-file-tree-empty"
            >
              {{ message }}
            </p>
          }
        </div>
      </div>
      @if (!stacked()) {
        <ptah-git-rail-resize-handle
          [width]="layout.gitRailWidth()"
          [min]="railMin"
          [max]="railMax"
          (widthChange)="layout.setGitRailWidth($event)"
          (widthCommit)="layout.commitGitRailWidth()"
        />
      }
    }

    <ptah-git-confirm-dialog
      [title]="discardTitle()"
      [description]="discardDescription()"
      [confirmLabel]="discardConfirmLabel()"
      tone="danger"
      (confirmed)="confirmDiscard()"
      (cancelled)="pendingDiscard.set(null)"
    />
  `,
})
export class ChangedFileTreeComponent {
  protected readonly layout = inject(ElectronLayoutService);
  protected readonly review = inject(GitReviewService);
  private readonly sourceControl = inject(SourceControlService);
  private readonly gitStatus = inject(GitStatusService);
  private readonly injector = inject(Injector);

  /** The canvas's comparison; decides sections, actions and marks. */
  readonly comparison = input.required<ChangedFileTreeComparison>();
  /** `git status` entries, listed for the working-tree and staged comparisons. */
  readonly statusFiles = input<readonly GitFileStatus[]>([]);
  /** Review entries, listed for the branch and historical comparisons. */
  readonly reviewFiles = input<readonly GitReviewFile[]>([]);
  /** Path filter from the comparison bar (case-insensitive substring). */
  readonly filter = input('');
  /** The file the continuous diff has in view, marked selected. */
  readonly activePath = input<string | null>(null);
  /** The canvas is narrower than 520 px: full width above the diff. */
  readonly stacked = input(false);
  readonly editorTargets = input<readonly EditorTarget[]>([]);
  readonly workspaceRoot = input('');

  /** A file row was activated: scroll the continuous diff to it. */
  readonly fileSelected = output<ChangedFileSelection>();
  readonly openFile = output<OpenInRequest>();

  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly PlusIcon = Plus;
  protected readonly MinusIcon = Minus;
  protected readonly Undo2Icon = Undo2;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly DismissIcon = X;
  protected readonly focusRing = FOCUS_RING;
  protected readonly iconButton = ICON_BUTTON;
  protected readonly railMin = RAIL_MIN_WIDTH;
  protected readonly railMax = RAIL_MAX_WIDTH;

  private static instanceCount = 0;
  protected readonly treeId = `changed-file-tree-${ChangedFileTreeComponent.instanceCount++}`;

  /** The row holding the tree's tab stop, once the user moved it. */
  protected readonly focusedId = signal<string | null>(null);
  private readonly collapsed = signal<ReadonlySet<string>>(new Set());
  /** Failed mutations by row / section key (keys carry the workspace root). */
  private readonly errors = signal<ReadonlyMap<string, string>>(new Map());
  /** Row / section keys with a mutation in flight. */
  private readonly pending = signal<ReadonlySet<string>>(new Set());
  protected readonly pendingDiscard = signal<PendingDiscard | null>(null);

  private readonly dialog = viewChild.required(GitConfirmDialogComponent);
  private readonly rowElements =
    viewChildren<ElementRef<HTMLElement>>('treeRow');

  private readonly statusMode = computed(() => {
    const kind = this.comparison();
    return kind === 'worktree' || kind === 'staged';
  });

  protected readonly hostClass = computed(() => {
    if (this.layout.gitRailCollapsed()) return 'hidden';
    return this.stacked()
      ? 'flex w-full min-h-0 flex-col'
      : 'flex h-full min-h-0 shrink-0';
  });

  protected readonly panelClass = computed(() =>
    this.stacked()
      ? 'w-full max-h-48 border-b border-base-content/10'
      : 'h-full border-r border-base-content/10',
  );

  /** Every row, ignoring collapse, in display order. */
  private readonly allRows = computed<readonly TreeRow[]>(() => {
    const query = this.filter();
    const out: TreeRow[] = [];
    if (!this.statusMode()) {
      const files = this.reviewFiles().map(fromReview);
      flattenNodes(
        buildChangedFileTree(files, query),
        'files',
        1,
        null,
        [],
        out,
      );
      return out;
    }
    const all = this.statusFiles().map(fromStatus);
    const sections: readonly StatusSection[] = ['staged', 'unstaged'];
    sections.forEach((section, index) => {
      const files = all.filter(
        (file) => file.staged === (section === 'staged'),
      );
      const id = `section\u0000${section}`;
      out.push({
        id,
        kind: 'section',
        section,
        label: SECTION_LABEL[section],
        count: files.length,
        level: 1,
        setSize: sections.length,
        posInSet: index + 1,
        parentId: null,
        ancestorIds: [],
      });
      flattenNodes(
        buildChangedFileTree(files, query),
        section,
        2,
        id,
        [id],
        out,
      );
    });
    return out;
  });

  /** The rows on screen: those under no collapsed section or folder. */
  protected readonly rows = computed<readonly TreeRow[]>(() => {
    const collapsed = this.collapsed();
    return this.allRows().filter(
      (row) => !row.ancestorIds.some((id) => collapsed.has(id)),
    );
  });

  private readonly fileRows = computed(() =>
    this.allRows().filter(
      (row): row is Extract<TreeRow, { kind: 'file' }> => row.kind === 'file',
    ),
  );

  /** The row with `tabindex="0"`. */
  protected readonly rovingId = computed<string | null>(() => {
    const rows = this.rows();
    const focused = this.focusedId();
    if (focused && rows.some((row) => row.id === focused)) return focused;
    const active = rows.find((row) => this.isActiveRow(row));
    return (active ?? rows[0])?.id ?? null;
  });

  protected readonly emptyMessage = computed<string | null>(() => {
    const total = this.statusMode()
      ? this.statusFiles().length
      : this.reviewFiles().length;
    if (total === 0) {
      return this.statusMode()
        ? 'No changes in the working tree.'
        : 'No files changed in this comparison.';
    }
    if (this.fileRows().length === 0 && this.filter().trim()) {
      return 'No files match the filter.';
    }
    return null;
  });

  /** A stage-all / unstage-all may start: nothing else runs in this workspace. */
  protected readonly canRunBulk = computed(() => {
    const prefix = this.workspacePrefix();
    for (const key of this.pending()) {
      if (key.startsWith(prefix)) return false;
    }
    return true;
  });

  protected readonly discardTitle = computed(() =>
    this.pendingDiscard()?.untracked
      ? 'Delete this untracked file?'
      : 'Discard these changes?',
  );

  protected readonly discardDescription = computed(() => {
    const pending = this.pendingDiscard();
    if (!pending) return '';
    return pending.untracked
      ? `${pending.path} is not tracked by git. Deleting it cannot be undone.`
      : `Your changes to ${pending.path} will be lost. This cannot be undone.`;
  });

  protected readonly discardConfirmLabel = computed(() =>
    this.pendingDiscard()?.untracked ? 'Delete file' : 'Discard changes',
  );

  // ---------------------------------------------------------------------------
  // Selection and keyboard
  // ---------------------------------------------------------------------------

  /**
   * Select the next or previous file in tree order (no wrap), expanding the
   * folders it sits in. Starts from the first or last file when nothing is
   * selected. Focus is not moved: the canvas calls this from its own keys.
   */
  selectAdjacentFile(delta: 1 | -1): void {
    const files = this.fileRows();
    if (files.length === 0) return;
    const current = files.findIndex((row) => this.isActiveRow(row));
    const next =
      current < 0 ? (delta > 0 ? 0 : files.length - 1) : current + delta;
    const target = files[next];
    if (!target) return;
    this.expandAll(target.ancestorIds);
    this.focusedId.set(target.id);
    this.emitSelection(target.file);
    afterNextRender(
      () => {
        const element = this.rowElement(target.id);
        if (typeof element?.scrollIntoView === 'function') {
          element.scrollIntoView({ block: 'nearest' });
        }
      },
      { injector: this.injector },
    );
  }

  protected onRowClick(row: TreeRow, event: MouseEvent): void {
    // The row's own controls (actions, viewed mark, error dismiss) act alone.
    if (
      event.target instanceof Element &&
      event.target.closest('[data-row-action]')
    ) {
      return;
    }
    this.focusedId.set(row.id);
    this.activate(row);
  }

  protected onRowKeydown(row: TreeRow, event: KeyboardEvent): void {
    // Keys typed on a control inside the row belong to that control.
    if (event.target !== event.currentTarget) return;
    const rows = this.rows();
    const index = rows.findIndex((candidate) => candidate.id === row.id);
    let target: TreeRow | undefined;
    switch (event.key) {
      case 'ArrowDown':
        target = rows[index + 1];
        break;
      case 'ArrowUp':
        target = rows[index - 1];
        break;
      case 'Home':
        target = rows[0];
        break;
      case 'End':
        target = rows[rows.length - 1];
        break;
      case 'ArrowRight':
        if (row.kind === 'file') break;
        if (this.isCollapsed(row.id)) {
          this.setCollapsed(row.id, false);
        } else if (rows[index + 1]?.parentId === row.id) {
          target = rows[index + 1];
        }
        break;
      case 'ArrowLeft':
        if (row.kind !== 'file' && !this.isCollapsed(row.id)) {
          this.setCollapsed(row.id, true);
        } else {
          target = rows.find((candidate) => candidate.id === row.parentId);
        }
        break;
      case 'Enter':
      case ' ':
        this.activate(row);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target) this.focusRow(target.id);
  }

  protected isCollapsed(id: string): boolean {
    return this.collapsed().has(id);
  }

  protected isActiveRow(row: TreeRow): boolean {
    if (row.kind !== 'file') return false;
    const file = row.file;
    if (file.path !== this.activePath()) return false;
    return (
      file.staged === null || file.staged === (this.comparison() === 'staged')
    );
  }

  protected isFocusedRow(row: TreeRow): boolean {
    return row.id === this.rovingId();
  }

  /** The focused row's controls follow it in the tab order; others are skipped. */
  protected actionTabIndex(row: TreeRow): number {
    return this.isFocusedRow(row) ? 0 : -1;
  }

  protected indent(row: TreeRow): number {
    return 8 + (row.level - 1) * 12;
  }

  protected domId(index: number, part: string): string {
    return `${this.treeId}-${index}-${part}`;
  }

  /** The accessible name: name, then (files) status word and line counts. */
  protected labelledBy(row: TreeRow, index: number): string {
    return row.kind === 'file'
      ? [
          this.domId(index, 'name'),
          this.domId(index, 'badge'),
          this.domId(index, 'counts'),
        ].join(' ')
      : this.domId(index, 'name');
  }

  protected fileTitle(file: TreeFile): string {
    return file.originalPath && file.originalPath !== file.path
      ? `${file.originalPath} → ${file.path}`
      : file.path;
  }

  /** Open-in needs a file on disk: not a deletion, not a past commit. */
  protected canOpenIn(file: TreeFile): boolean {
    return (
      this.comparison() !== 'historical' &&
      file.status !== 'D' &&
      !file.isDirectory
    );
  }

  private activate(row: TreeRow): void {
    if (row.kind === 'file') {
      if (!row.file.isDirectory) this.emitSelection(row.file);
      return;
    }
    this.setCollapsed(row.id, !this.isCollapsed(row.id));
  }

  private emitSelection(file: TreeFile): void {
    this.fileSelected.emit({
      path: file.path,
      ...(file.originalPath ? { originalPath: file.originalPath } : {}),
      ...(file.staged !== null ? { staged: file.staged } : {}),
    });
  }

  private focusRow(id: string): void {
    this.focusedId.set(id);
    this.rowElement(id)?.focus();
  }

  private rowElement(id: string): HTMLElement | undefined {
    return this.rowElements().find(
      (ref) => ref.nativeElement.dataset['rowId'] === id,
    )?.nativeElement;
  }

  private setCollapsed(id: string, collapsed: boolean): void {
    const next = new Set(this.collapsed());
    if (collapsed) next.add(id);
    else next.delete(id);
    this.collapsed.set(next);
  }

  private expandAll(ids: readonly string[]): void {
    if (!ids.some((id) => this.collapsed().has(id))) return;
    const next = new Set(this.collapsed());
    for (const id of ids) next.delete(id);
    this.collapsed.set(next);
  }

  // ---------------------------------------------------------------------------
  // Mutations (RC1: awaited, checked, followed by a status re-read)
  // ---------------------------------------------------------------------------

  protected sectionKey(section: StatusSection): string {
    return `${this.workspacePrefix()}section\u0000${section}`;
  }

  private rowKey(section: StatusSection, path: string): string {
    return `${this.workspacePrefix()}row\u0000${section}\u0000${path}`;
  }

  private workspacePrefix(): string {
    return `${this.workspaceRoot()}\u0000`;
  }

  /** The mutation key a row's actions and error use, or null when it has none. */
  private keyFor(row: TreeRow): string | null {
    if (row.kind === 'section') return this.sectionKey(row.section);
    if (row.kind === 'file' && row.file.staged !== null) {
      return this.rowKey(
        row.file.staged ? 'staged' : 'unstaged',
        row.file.path,
      );
    }
    return null;
  }

  protected isPending(key: string): boolean {
    return this.pending().has(key);
  }

  protected isRowBusy(row: TreeRow): boolean {
    const key = this.keyFor(row);
    return key !== null && this.isPending(key);
  }

  /** No call in flight for the row, and no bulk action over its workspace. */
  protected canRunRow(row: TreeRow): boolean {
    const key = this.keyFor(row);
    return (
      key !== null &&
      !this.isPending(key) &&
      !this.isPending(this.sectionKey('staged')) &&
      !this.isPending(this.sectionKey('unstaged'))
    );
  }

  protected rowError(row: TreeRow): string | null {
    const key = this.keyFor(row);
    return key === null ? null : (this.errors().get(key) ?? null);
  }

  protected dismissRowError(row: TreeRow): void {
    const key = this.keyFor(row);
    if (key !== null) this.setError(key, null);
  }

  protected onStage(row: TreeRow): Promise<void> {
    const key = this.keyFor(row);
    if (row.kind !== 'file' || key === null || !this.canRunRow(row)) {
      return Promise.resolve();
    }
    const path = row.file.path;
    return this.runMutation(key, () => this.sourceControl.stageFile(path));
  }

  protected onUnstage(row: TreeRow): Promise<void> {
    const key = this.keyFor(row);
    if (row.kind !== 'file' || key === null || !this.canRunRow(row)) {
      return Promise.resolve();
    }
    const path = row.file.path;
    return this.runMutation(key, () => this.sourceControl.unstageFile(path));
  }

  /** Discard asks first; nothing is written until the dialog confirms. */
  protected onDiscard(row: TreeRow, event: MouseEvent): void {
    if (
      row.kind !== 'file' ||
      row.file.staged === null ||
      !this.canRunRow(row)
    ) {
      return;
    }
    this.pendingDiscard.set({
      workspaceRoot: this.workspaceRoot(),
      section: row.file.staged ? 'staged' : 'unstaged',
      path: row.file.path,
      untracked: row.file.status === '??',
    });
    const invoker = event.currentTarget;
    this.dialog().open(
      invoker instanceof HTMLElement ? invoker : document.body,
    );
  }

  /**
   * Discard what the dialog was opened for — unless the workspace changed
   * underneath it, in which case the path names a different repository.
   */
  protected confirmDiscard(): Promise<void> {
    const pending = this.pendingDiscard();
    this.pendingDiscard.set(null);
    if (!pending || pending.workspaceRoot !== this.workspaceRoot()) {
      return Promise.resolve();
    }
    const key = this.rowKey(pending.section, pending.path);
    if (
      this.isPending(key) ||
      this.isPending(this.sectionKey('staged')) ||
      this.isPending(this.sectionKey('unstaged'))
    ) {
      return Promise.resolve();
    }
    return this.runMutation(key, () =>
      this.sourceControl.discardChanges(pending.path),
    );
  }

  protected onStageAll(): Promise<void> {
    if (!this.canRunBulk()) return Promise.resolve();
    return this.runMutation(this.sectionKey('unstaged'), () =>
      this.sourceControl.stageAll(),
    );
  }

  protected onUnstageAll(): Promise<void> {
    if (!this.canRunBulk()) return Promise.resolve();
    return this.runMutation(this.sectionKey('staged'), () =>
      this.sourceControl.unstageAll(),
    );
  }

  /**
   * Run one mutation, record its failure (or clear an earlier one), then
   * re-read the status: a failed call can still have changed the index, and
   * only Electron pushes status updates.
   */
  private async runMutation(
    key: string,
    call: () => Promise<RpcCallResult<GitMutationOutcome>>,
  ): Promise<void> {
    if (this.isPending(key)) return;
    this.setPending(key, true);
    let failure: string | null;
    try {
      failure = mutationFailureText(await call());
    } catch (error: unknown) {
      failure = transportFailureText(
        error instanceof Error ? error.message : String(error),
      );
    }
    this.setError(key, failure);
    this.setPending(key, false);
    this.gitStatus.refresh().catch(() => {
      // degradation-audit: reported - GitStatusService publishes a failed
      // re-read as its stale / unavailable status, which the shell shows.
    });
  }

  private setPending(key: string, pending: boolean): void {
    const next = new Set(this.pending());
    if (pending) next.add(key);
    else next.delete(key);
    this.pending.set(next);
  }

  private setError(key: string, message: string | null): void {
    const current = this.errors();
    if (message === null && !current.has(key)) return;
    const next = new Map(current);
    if (message === null) next.delete(key);
    else next.set(key, message);
    this.errors.set(next);
  }
}
