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
  Folder,
  LucideAngularModule,
  Minus,
  Plus,
  X,
} from 'lucide-angular';
import { ElectronLayoutService } from '@ptah-extension/core';
import type {
  EditorTarget,
  GitFileStatus,
  GitReviewFile,
} from '@ptah-extension/shared';
import { FileStatusBadgeComponent } from '@ptah-extension/ui';
import { RailResizeHandleComponent } from '../git-dock/rail-resize-handle.component';
import type { OpenInRequest } from '../open-in/open-in-button.component';
import { GitConfirmDialogComponent } from '../shared/git-confirm-dialog.component';
import { GitReviewService } from '../services/git-review.service';
import { GitStatusService } from '../services/git-status.service';
import { SourceControlService } from '../services/source-control.service';
import type { ReviewScope } from '../services/review-navigation.service';
import { ChangedFileRowActionsComponent } from './changed-file-row-actions.component';
import {
  buildTreeRows,
  SECTION_BULK_ACTION,
  type StatusSection,
  type TreeFile,
  type TreeFileRow,
  type TreeRow,
} from './changed-file-tree-rows';
import { TreeMutationTracker } from './tree-mutation-tracker';

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

interface PendingDiscard {
  readonly workspaceRoot: string;
  readonly section: StatusSection;
  readonly path: string;
  readonly untracked: boolean;
}

/** Keyboard focus ring shared by every control here (repository pattern). */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

const ICON_BUTTON = `btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ${FOCUS_RING}`;

function selectionOf(file: TreeFile): ChangedFileSelection {
  return {
    path: file.path,
    ...(file.originalPath ? { originalPath: file.originalPath } : {}),
    ...(file.staged !== null ? { staged: file.staged } : {}),
  };
}

/**
 * ChangedFileTreeComponent — the review canvas's left rail (implementation-plan
 * Component 24, design-spec §6.1).
 *
 * - Working tree and Staged comparisons list the git status in two sections,
 *   Staged and Changes, with stage / unstage and a confirmed discard per row
 *   and stage-all / unstage-all per section. Every result is awaited and
 *   checked, a failure shows on its row or section, and the status is re-read
 *   after every mutation (RC1, {@link TreeMutationTracker}).
 * - Branch and historical comparisons list the review's files read-only;
 *   branch rows carry the persisted "Viewed" mark (`GitReviewService`, key
 *   `gitReview.viewed.v1`).
 * - A WAI-ARIA tree: one tab stop (roving tabindex), Up/Down/Home/End move,
 *   Right expands or enters, Left collapses or climbs, Enter/Space selects a
 *   file or toggles a folder. The focused row's actions join the tab order
 *   after it, so they are reachable without leaving the tree's single stop.
 *   Rows are rendered flat with `aria-level`/`aria-setsize`/`aria-posinset`.
 * - File to file (the old diff tabs' Left/Right, parity row 40): Alt+Down /
 *   Alt+Up on a row (and {@link selectAdjacentFile} for the canvas) step to
 *   the next / previous file, wrapping from the last to the first. Delete on
 *   a file row collapses that file in the canvas (the old tab close).
 * - Untracked directories carry a folder icon beside their status badge.
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
    GitConfirmDialogComponent,
    ChangedFileRowActionsComponent,
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
            <div
              role="tree"
              [id]="treeId"
              aria-label="Changed files"
              aria-keyshortcuts="Delete Alt+ArrowDown Alt+ArrowUp"
            >
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
                            <button
                              type="button"
                              [class]="iconButton"
                              [title]="bulk[row.section].title"
                              [attr.aria-label]="bulk[row.section].label"
                              [attr.data-testid]="bulk[row.section].testId"
                              [tabIndex]="actionTabIndex(row)"
                              [disabled]="!canRunBulk()"
                              [attr.aria-busy]="
                                mutations.isPending(sectionKey(row.section)) ||
                                null
                              "
                              (click)="onBulk(row.section)"
                            >
                              <lucide-angular
                                [img]="
                                  row.section === 'staged'
                                    ? MinusIcon
                                    : PlusIcon
                                "
                                class="h-3.5 w-3.5"
                                aria-hidden="true"
                              />
                            </button>
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
                        @if (row.file.isDirectory) {
                          <lucide-angular
                            [img]="FolderIcon"
                            class="h-3 w-3 shrink-0 text-warning"
                            aria-hidden="true"
                            data-testid="tree-folder-icon"
                          />
                        }
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
                          } @else if (!row.file.isDirectory) {
                            <span class="diff-add-text"
                              >+{{ row.file.additions ?? '?' }}</span
                            >
                            <span class="diff-del-text"
                              >−{{ row.file.deletions ?? '?' }}</span
                            >
                          }
                        </span>
                        <ptah-changed-file-row-actions
                          [class.opacity-0]="!isFocusedRow(row)"
                          [file]="row.file"
                          [name]="row.name"
                          [controlTabIndex]="actionTabIndex(row)"
                          [canRun]="canRunRow(row)"
                          [showViewed]="comparison() === 'branch'"
                          [viewed]="review.isViewed(row.file.path)"
                          [showOpenIn]="
                            isFocusedRow(row) && canOpenIn(row.file)
                          "
                          [editorTargets]="editorTargets()"
                          [workspaceRoot]="workspaceRoot()"
                          (stage)="onStage(row)"
                          (unstage)="onUnstage(row)"
                          (discard)="onDiscard(row, $event)"
                          (viewedToggle)="review.toggleViewed(row.file.path)"
                          (openFile)="openFile.emit($event)"
                        />
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
  /** Delete on a file row: collapse that file in the continuous diff. */
  readonly collapseFile = output<ChangedFileSelection>();
  readonly openFile = output<OpenInRequest>();

  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly PlusIcon = Plus;
  protected readonly MinusIcon = Minus;
  protected readonly FolderIcon = Folder;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly DismissIcon = X;
  protected readonly focusRing = FOCUS_RING;
  protected readonly iconButton = ICON_BUTTON;
  protected readonly bulk = SECTION_BULK_ACTION;
  protected readonly railMin = RAIL_MIN_WIDTH;
  protected readonly railMax = RAIL_MAX_WIDTH;

  private static instanceCount = 0;
  protected readonly treeId = `changed-file-tree-${ChangedFileTreeComponent.instanceCount++}`;

  /** The row holding the tree's tab stop, once the user moved it. */
  protected readonly focusedId = signal<string | null>(null);
  private readonly collapsed = signal<ReadonlySet<string>>(new Set());
  /** Failed and in-flight mutations by row / section key. */
  protected readonly mutations = new TreeMutationTracker(() => {
    this.gitStatus.refresh().catch(() => {
      // degradation-audit: reported - GitStatusService publishes a failed
      // re-read as its stale / unavailable status, which the shell shows.
    });
  });
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
  private readonly allRows = computed(() =>
    buildTreeRows(
      this.statusMode(),
      this.statusFiles(),
      this.reviewFiles(),
      this.filter(),
    ),
  );

  /** The rows on screen: those under no collapsed section or folder. */
  protected readonly rows = computed<readonly TreeRow[]>(() => {
    const collapsed = this.collapsed();
    return this.allRows().filter(
      (row) => !row.ancestorIds.some((id) => collapsed.has(id)),
    );
  });

  private readonly fileRows = computed(() =>
    this.allRows().filter((row): row is TreeFileRow => row.kind === 'file'),
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
  protected readonly canRunBulk = computed(
    () => !this.mutations.anyPending(this.workspacePrefix()),
  );

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
   * Select the next or previous file in tree order, wrapping from the last
   * file to the first and back (the old diff tabs' Left/Right), expanding
   * the folders it sits in. Starts from the first or last file when nothing
   * is selected. Focus is not moved: the canvas calls this from its own keys.
   */
  selectAdjacentFile(delta: 1 | -1): void {
    const target = this.adjacentFile(delta);
    if (!target) return;
    this.expandAll(target.ancestorIds);
    this.focusedId.set(target.id);
    this.fileSelected.emit(selectionOf(target.file));
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
    if (event.altKey) {
      this.onAltKey(event);
      return;
    }
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
      case 'Delete':
        if (row.kind !== 'file' || row.file.isDirectory) return;
        this.collapseFile.emit(selectionOf(row.file));
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target) this.focusRow(target.id);
  }

  /** Alt+Down / Alt+Up: the next / previous file, focused, wrapping. */
  private onAltKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    this.selectAdjacentFile(event.key === 'ArrowDown' ? 1 : -1);
    const id = this.focusedId();
    afterNextRender(() => (id ? this.rowElement(id)?.focus() : undefined), {
      injector: this.injector,
    });
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

  /**
   * The file `delta` away from the active one, wrapping; first/last if none.
   * Untracked directories have no diff to step to.
   */
  private adjacentFile(delta: 1 | -1): TreeFileRow | undefined {
    const files = this.fileRows().filter((row) => !row.file.isDirectory);
    const count = files.length;
    if (count === 0) return undefined;
    const current = files.findIndex((row) => this.isActiveRow(row));
    if (current >= 0) return files[(current + delta + count) % count];
    return delta > 0 ? files[0] : files[count - 1];
  }

  private activate(row: TreeRow): void {
    if (row.kind === 'file') {
      if (!row.file.isDirectory) this.fileSelected.emit(selectionOf(row.file));
      return;
    }
    this.setCollapsed(row.id, !this.isCollapsed(row.id));
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

  protected isRowBusy(row: TreeRow): boolean {
    const key = this.keyFor(row);
    return key !== null && this.mutations.isPending(key);
  }

  /** No call in flight for the key, and no bulk action over its workspace. */
  private canRunKey(key: string): boolean {
    return (
      !this.mutations.isPending(key) &&
      !this.mutations.isPending(this.sectionKey('staged')) &&
      !this.mutations.isPending(this.sectionKey('unstaged'))
    );
  }

  protected canRunRow(row: TreeRow): boolean {
    const key = this.keyFor(row);
    return key !== null && this.canRunKey(key);
  }

  protected rowError(row: TreeRow): string | null {
    const key = this.keyFor(row);
    return key === null ? null : this.mutations.error(key);
  }

  protected dismissRowError(row: TreeRow): void {
    const key = this.keyFor(row);
    if (key !== null) this.mutations.dismiss(key);
  }

  protected onStage(row: TreeRow): Promise<void> {
    const key = this.keyFor(row);
    if (row.kind !== 'file' || key === null || !this.canRunRow(row)) {
      return Promise.resolve();
    }
    const path = row.file.path;
    return this.mutations.run(key, () => this.sourceControl.stageFile(path));
  }

  protected onUnstage(row: TreeRow): Promise<void> {
    const key = this.keyFor(row);
    if (row.kind !== 'file' || key === null || !this.canRunRow(row)) {
      return Promise.resolve();
    }
    const path = row.file.path;
    return this.mutations.run(key, () => this.sourceControl.unstageFile(path));
  }

  /** Discard asks first; nothing is written until the dialog confirms. */
  protected onDiscard(row: TreeRow, invoker: HTMLElement): void {
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
    this.dialog().open(invoker);
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
    if (!this.canRunKey(key)) return Promise.resolve();
    return this.mutations.run(key, () =>
      this.sourceControl.discardChanges(pending.path),
    );
  }

  /** Stage all (Changes) or unstage all (Staged); the failure shows on the section. */
  protected onBulk(section: StatusSection): Promise<void> {
    if (!this.canRunBulk()) return Promise.resolve();
    return this.mutations.run(this.sectionKey(section), () =>
      section === 'staged'
        ? this.sourceControl.unstageAll()
        : this.sourceControl.stageAll(),
    );
  }
}
