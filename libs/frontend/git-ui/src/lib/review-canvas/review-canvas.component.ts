import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import type { GitFileStatus, GitReviewFile } from '@ptah-extension/shared';
import type { PierreDiffStyle } from '../renderer/pierre-config';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitReviewService } from '../services/git-review.service';
import { GitStatusService } from '../services/git-status.service';
import {
  ReviewCommentDraftStore,
  type ReviewDraftOwner,
} from '../services/review-comment-draft.store';
import type { ReviewDiffComparison } from '../services/review-diff.service';
import {
  ReviewNavigationService,
  type ReviewScope,
  type ReviewTarget,
} from '../services/review-navigation.service';
import type { OpenInRequest } from '../open-in/open-in-button.component';
import { normalizeDiffPath } from '../types/diff-tab.types';
import {
  ChangedFileTreeComponent,
  type ChangedFileSelection,
} from './changed-file-tree.component';
import {
  ComparisonBarComponent,
  type ComparisonTotals,
} from './comparison-bar.component';
import { DraftCommentsBarComponent } from './draft-comments-bar.component';
import {
  FileDiffSectionComponent,
  type ReviewCanvasFile,
  type ReviewFileEditRequest,
  type ReviewFileLabel,
} from './file-diff-section.component';

/** Estimated row height and fixed chrome, for placeholders before a measure. */
const ESTIMATED_ROW_PX = 20;
const ESTIMATED_CHROME_PX = 72;
const UNKNOWN_SIZE_PX = 240;

/** Scroll anchors kept for comparisons the canvas is not showing. */
const MAX_SCROLL_ANCHORS = 16;

interface ScrollAnchor {
  readonly fileId: string;
  /** Pixels from the top of that file's section to the viewport top. */
  readonly offset: number;
}

/**
 * Where each comparison was scrolled to, so leaving the canvas (spot editor,
 * another tab) and coming back lands on the same file (parity §7 "view
 * state"). Module scope because the canvas itself is destroyed in between;
 * bounded and in memory only.
 */
const scrollAnchors = new Map<string, ScrollAnchor>();

function rememberAnchor(comparisonId: string, anchor: ScrollAnchor): void {
  scrollAnchors.delete(comparisonId);
  scrollAnchors.set(comparisonId, anchor);
  if (scrollAnchors.size > MAX_SCROLL_ANCHORS) {
    const oldest = scrollAnchors.keys().next().value;
    if (oldest !== undefined) scrollAnchors.delete(oldest);
  }
}

function scopeId(scope: ReviewScope, branchRange: string | null): string {
  if (scope.kind === 'historical') {
    return `historical:${scope.base.sha}..${scope.head.sha}`;
  }
  return scope.kind === 'branch' ? `branch:${branchRange ?? ''}` : scope.kind;
}

function statusLabel(file: GitFileStatus): ReviewFileLabel | null {
  if (file.status === 'U') return 'conflicted';
  if (file.submodule) return 'submodule';
  return file.binary ? 'binary' : null;
}

function fileId(kind: string, path: string, originalPath?: string): string {
  return `${kind}\u0000${originalPath ?? path}\u0000${path}`;
}

/**
 * ReviewCanvasComponent — the Changes tab body (implementation-plan
 * Component 24, design-spec §6.1; Requirement 6): the comparison bar, the
 * changed-file tree, every changed file in one scrolling list, and the
 * draft-comments footer. Built unmounted; the review shell hosts it.
 *
 * - Files come from the navigation scope: the working tree lists every
 *   `git status` entry (staged entries as staged diffs, the rest as working
 *   tree diffs) and "Staged" only the staged ones; branch review and a
 *   historical comparison list their review files read-only. A change-set
 *   target narrows the list to that turn's files and owns the drafts.
 * - Virtualization (A9): ONE `IntersectionObserver` over every section, with a
 *   root margin of one viewport, marks sections near the viewport; only those
 *   read their diff and create a renderer. Off-screen sections hold an
 *   estimated height, replaced by the height measured when they last left the
 *   window. The observer and the scroll listener are released on destroy.
 * - Selecting a file in the tree scrolls its section into view; Alt+Down /
 *   Alt+Up move to the next / previous file.
 * - When the draft bar disappears with focus inside it, focus moves to the
 *   diff list rather than being dropped on the page.
 */
@Component({
  selector: 'ptah-review-canvas',
  standalone: true,
  imports: [
    ChangedFileTreeComponent,
    ComparisonBarComponent,
    DraftCommentsBarComponent,
    FileDiffSectionComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full min-h-0 flex-col' },
  template: `
    <ptah-comparison-bar
      [filter]="filter()"
      [totals]="totals()"
      [(sideBySide)]="sideBySide"
      (filterChange)="filter.set($event)"
    />

    <div
      class="flex min-h-0 flex-1"
      [class.flex-col]="stacked()"
      data-testid="review-canvas-split"
    >
      <ptah-changed-file-tree
        [comparison]="treeComparison()"
        [statusFiles]="treeStatusFiles()"
        [reviewFiles]="treeReviewFiles()"
        [filter]="filter()"
        [activePath]="activePath()"
        [stacked]="stacked()"
        [editorTargets]="launchers.targets()"
        [workspaceRoot]="workspaceRoot()"
        (fileSelected)="onFileSelected($event)"
        (openFile)="openInEditor($event)"
      />

      <div
        #scroller
        class="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-base-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]"
        role="region"
        aria-label="Changed files"
        aria-keyshortcuts="Alt+ArrowDown Alt+ArrowUp"
        tabindex="0"
        data-testid="review-canvas-list"
        (keydown)="onListKeydown($event)"
      >
        @if (listMessage(); as message) {
          <p
            class="px-3 py-6 text-center text-xs text-base-content-muted"
            [attr.role]="listMessageIsError() ? 'alert' : 'status'"
            data-testid="review-canvas-message"
          >
            {{ message }}
          </p>
        }
        @for (file of visibleFiles(); track file.id) {
          <ptah-file-diff-section
            [file]="file"
            [near]="isNear(file.id)"
            [diffStyle]="diffStyle()"
            [reservedHeight]="reservedHeight(file)"
            [draftOwner]="draftOwner()"
            [editorTargets]="launchers.targets()"
            [workspaceRoot]="workspaceRoot()"
            (openFile)="openInEditor($event)"
            (edit)="onEdit($event)"
          />
        }
      </div>
    </div>

    <div #draftFooter>
      @if (draftOwner(); as owner) {
        <ptah-draft-comments-bar [owner]="owner" />
      }
    </div>
  `,
})
export class ReviewCanvasComponent {
  private readonly navigation = inject(ReviewNavigationService);
  private readonly gitStatus = inject(GitStatusService);
  private readonly review = inject(GitReviewService);
  private readonly draftStore = inject(ReviewCommentDraftStore);
  private readonly injector = inject(Injector);
  protected readonly launchers = inject(EditorLauncherService);

  /** The shell is narrower than 520 px: stack the tree above the list. */
  readonly stacked = input(false);

  protected readonly filter = signal('');
  protected readonly sideBySide = signal(true);
  /** The file in view: its path and whether it is the staged entry. */
  private readonly active = signal<{ path: string; staged: boolean } | null>(
    null,
  );
  protected readonly activePath = computed(() => this.active()?.path ?? null);
  private readonly nearIds = signal<ReadonlySet<string>>(new Set());

  private readonly scroller =
    viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly draftFooter =
    viewChild.required<ElementRef<HTMLElement>>('draftFooter');
  private readonly tree = viewChild.required(ChangedFileTreeComponent);
  private readonly sectionElements = viewChildren<
    FileDiffSectionComponent,
    ElementRef<HTMLElement>
  >(FileDiffSectionComponent, { read: ElementRef });

  /** Measured section heights, by file id and layout. */
  private readonly measuredHeights = new Map<string, number>();
  private observer: IntersectionObserver | null = null;
  private root: HTMLElement | null = null;
  private readonly observed = new Set<HTMLElement>();
  /** Without `IntersectionObserver` every section is treated as near. */
  private readonly windowed = typeof IntersectionObserver !== 'undefined';
  private scrollFrame: number | null = null;
  private restoredFor: string | null = null;
  private handledSeq = -1;

  protected readonly scope = computed(() => this.navigation.current().scope);

  /**
   * In the two status comparisons the tree lists both sections and uses its
   * comparison only to decide which section holds the active row, so it gets
   * the active file's own side: a staged section in view marks its Staged row.
   */
  protected readonly treeComparison = computed(() => {
    const kind = this.scope().kind;
    if (kind !== 'worktree' && kind !== 'staged') return kind;
    return this.active()?.staged ? 'staged' : 'worktree';
  });
  private readonly target = computed<ReviewTarget>(
    () => this.navigation.current().target,
  );

  protected readonly workspaceRoot = computed(
    () => this.gitStatus.activeWorkspacePath() ?? '',
  );

  protected readonly diffStyle = computed<PierreDiffStyle>(() =>
    this.sideBySide() ? 'split' : 'unified',
  );

  /** A change-set target owns the drafts; otherwise the workspace does. */
  protected readonly draftOwner = computed<ReviewDraftOwner | null>(() => {
    const target = this.target();
    if (target.kind === 'change-set') {
      return {
        workspaceRoot: target.workspaceRoot,
        ...(target.ownerSessionId
          ? { ownerSessionId: target.ownerSessionId }
          : {}),
      };
    }
    const root = this.workspaceRoot();
    return root ? { workspaceRoot: root } : null;
  });

  private readonly draftCount = computed(() => {
    const owner = this.draftOwner();
    return owner ? this.draftStore.draftsFor(owner).length : 0;
  });

  /** Paths of a change-set target, or `null` when the list is not narrowed. */
  private readonly changeSetPaths = computed<ReadonlySet<string> | null>(() => {
    const target = this.target();
    if (target.kind !== 'change-set') return null;
    const paths = new Set<string>();
    for (const file of target.files) {
      paths.add(normalizeDiffPath(file.path));
      if (file.origPath) paths.add(normalizeDiffPath(file.origPath));
    }
    return paths;
  });

  /** `git status` entries in scope: change-set narrowed, folders dropped. */
  protected readonly treeStatusFiles = computed<readonly GitFileStatus[]>(
    () => {
      const kind = this.scope().kind;
      if (kind !== 'worktree' && kind !== 'staged') return [];
      const narrow = this.changeSetPaths();
      return this.gitStatus
        .files()
        .filter(
          (file) =>
            !narrow ||
            narrow.has(normalizeDiffPath(file.path)) ||
            (!!file.origPath && narrow.has(normalizeDiffPath(file.origPath))),
        );
    },
  );

  protected readonly treeReviewFiles = computed<readonly GitReviewFile[]>(
    () => {
      const scope = this.scope();
      if (scope.kind === 'historical') return scope.files;
      return scope.kind === 'branch' ? this.review.files() : [];
    },
  );

  /** The branch range the review result was read for, or `null`. */
  private readonly branchComparison = computed<ReviewDiffComparison | null>(
    () => {
      const result = this.review.result();
      const mergeBase = result?.mergeBaseSha;
      const head = result?.head;
      if (!result?.success || !mergeBase || !head) return null;
      return {
        kind: 'historical',
        base: { name: result.base?.name ?? this.review.base(), sha: mergeBase },
        head,
      };
    },
  );

  /** Every file of the comparison, in tree order. */
  private readonly files = computed<readonly ReviewCanvasFile[]>(() => {
    const scope = this.scope();
    if (scope.kind === 'worktree' || scope.kind === 'staged') {
      return this.treeStatusFiles()
        .filter(
          (file) =>
            !file.isDirectory && (scope.kind === 'worktree' || file.staged),
        )
        .map((file) => {
          const kind = file.staged ? 'staged' : 'worktree';
          return {
            id: fileId(kind, file.path, file.origPath),
            path: file.path,
            ...(file.origPath ? { originalPath: file.origPath } : {}),
            status: file.status,
            ...(file.conflict ? { conflictKind: file.conflict.kind } : {}),
            additions: file.additions ?? null,
            deletions: file.deletions ?? null,
            comparison: kind,
            request: {
              comparison: { kind },
              path: file.path,
              ...(file.origPath ? { origPath: file.origPath } : {}),
            },
            label: statusLabel(file),
          } satisfies ReviewCanvasFile;
        });
    }
    const comparison: ReviewDiffComparison | null =
      scope.kind === 'historical'
        ? { kind: 'historical', base: scope.base, head: scope.head }
        : this.branchComparison();
    if (!comparison) return [];
    return this.treeReviewFiles().map(
      (file) =>
        ({
          id: fileId(scope.kind, file.path, file.originalPath),
          path: file.path,
          ...(file.originalPath ? { originalPath: file.originalPath } : {}),
          status: file.status,
          additions: file.additions,
          deletions: file.deletions,
          comparison: scope.kind,
          request: {
            comparison,
            path: file.path,
            ...(file.originalPath ? { origPath: file.originalPath } : {}),
          },
          label: file.binary ? 'binary' : null,
        }) satisfies ReviewCanvasFile,
    );
  });

  /** The files the filter keeps (case-insensitive path substring, as the tree). */
  protected readonly visibleFiles = computed(() => {
    const needle = this.filter().trim().toLowerCase();
    const files = this.files();
    return needle
      ? files.filter((file) => file.path.toLowerCase().includes(needle))
      : files;
  });

  protected readonly totals = computed<ComparisonTotals | null>(() => {
    const files = this.visibleFiles();
    if (files.length === 0 && this.listMessageIsError()) return null;
    let additions = 0;
    let deletions = 0;
    let binaryFiles = 0;
    for (const file of files) {
      additions += file.additions ?? 0;
      deletions += file.deletions ?? 0;
      if (file.label === 'binary') binaryFiles++;
    }
    return { files: files.length, additions, deletions, binaryFiles };
  });

  private readonly comparisonId = computed(() => {
    const branch = this.branchComparison();
    return scopeId(
      this.scope(),
      branch?.kind === 'historical'
        ? `${branch.base.sha}..${branch.head.sha}`
        : null,
    );
  });

  protected readonly listMessageIsError = computed(() => {
    const kind = this.scope().kind;
    if (kind === 'branch') return this.review.error() !== null;
    return (
      (kind === 'worktree' || kind === 'staged') &&
      this.gitStatus.isStatusUnavailable() &&
      this.gitStatus.files().length === 0
    );
  });

  /** Loading, error or empty copy for the list; `null` when files show. */
  protected readonly listMessage = computed<string | null>(() => {
    const kind = this.scope().kind;
    if (kind === 'branch') {
      const error = this.review.error();
      if (error) return error;
      if (this.review.loading() && this.files().length === 0) {
        return 'Loading the branch review…';
      }
    }
    if (this.listMessageIsError()) {
      return 'Git status could not be read for this workspace.';
    }
    if (this.visibleFiles().length > 0) return null;
    if (this.files().length > 0) return 'No files match the filter.';
    if (kind === 'worktree') return 'No changes in the working tree.';
    if (kind === 'staged') return 'Nothing is staged.';
    return 'No files changed in this comparison.';
  });

  constructor() {
    void this.launchers.detect();

    afterNextRender(() => this.attach());
    inject(DestroyRef).onDestroy(() => this.detach());

    // Observe exactly the sections on screen.
    effect(() => {
      const elements = this.sectionElements().map((ref) => ref.nativeElement);
      untracked(() => this.syncObserved(elements));
    });

    // Navigation: bring a targeted file into view; restore a comparison's
    // last position when it is shown again.
    effect(() => {
      const navigation = this.navigation.current();
      const files = this.visibleFiles();
      const comparisonId = this.comparisonId();
      untracked(() => this.applyNavigation(navigation, files, comparisonId));
    });

    // The draft bar disappears at zero drafts; keep focus inside the canvas.
    let previousDrafts = 0;
    effect(() => {
      const count = this.draftCount();
      const lost = previousDrafts > 0 && count === 0;
      previousDrafts = count;
      if (!lost) return;
      afterNextRender(
        () => {
          const active = document.activeElement;
          const dropped =
            !active ||
            active === document.body ||
            this.draftFooter().nativeElement.contains(active);
          if (dropped) this.scroller().nativeElement.focus();
        },
        { injector: this.injector },
      );
    });
  }

  protected isNear(id: string): boolean {
    return !this.windowed || this.nearIds().has(id);
  }

  /** Measured height when known, else an estimate from the line counts. */
  protected reservedHeight(file: ReviewCanvasFile): number {
    const measured = this.measuredHeights.get(this.heightKey(file.id));
    if (measured !== undefined) return measured;
    if (file.additions === null || file.deletions === null) {
      return UNKNOWN_SIZE_PX;
    }
    const rows =
      this.diffStyle() === 'split'
        ? Math.max(file.additions, file.deletions)
        : file.additions + file.deletions;
    return ESTIMATED_CHROME_PX + rows * ESTIMATED_ROW_PX;
  }

  protected onFileSelected(selection: ChangedFileSelection): void {
    const kind = this.scope().kind;
    const sectionKind =
      kind === 'worktree' || kind === 'staged'
        ? selection.staged
          ? 'staged'
          : 'worktree'
        : kind;
    this.scrollToFile(
      fileId(sectionKind, selection.path, selection.originalPath),
    );
    this.active.set({ path: selection.path, staged: sectionKind === 'staged' });
  }

  protected onListKeydown(event: KeyboardEvent): void {
    if (!event.altKey || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp'))
      return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    event.preventDefault();
    this.tree().selectAdjacentFile(event.key === 'ArrowDown' ? 1 : -1);
  }

  /** A section's "Edit": the spot editor, editable, in the active workspace. */
  protected onEdit(request: ReviewFileEditRequest): void {
    const root = this.workspaceRoot();
    this.navigation.openFile(request.path, request.line, {
      editable: true,
      ...(root ? { workspaceRoot: root } : {}),
    });
  }

  protected openInEditor(request: OpenInRequest): void {
    const root = this.workspaceRoot();
    if (root && request.path) {
      void this.launchers.openFile(
        request.target,
        root,
        request.path,
        request.line,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Window
  // ---------------------------------------------------------------------------

  private attach(): void {
    const root = this.scroller().nativeElement;
    this.root = root;
    root.addEventListener('scroll', this.onScroll, { passive: true });
    if (!this.windowed) return;
    this.observer = new IntersectionObserver(
      (entries) => this.onIntersect(entries),
      // One viewport above and below: percentages are of the root's size.
      { root, rootMargin: '100% 0px' },
    );
    for (const element of this.observed) this.observer.observe(element);
  }

  private detach(): void {
    this.root?.removeEventListener('scroll', this.onScroll);
    this.root = null;
    if (this.scrollFrame !== null) cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;
    this.observer?.disconnect();
    this.observer = null;
    this.observed.clear();
  }

  private syncObserved(elements: readonly HTMLElement[]): void {
    const next = new Set(elements);
    for (const element of this.observed) {
      if (!next.has(element)) {
        this.observer?.unobserve(element);
        this.observed.delete(element);
      }
    }
    for (const element of next) {
      if (this.observed.has(element)) continue;
      this.observed.add(element);
      this.observer?.observe(element);
    }
    // Ids of removed sections leave the near set.
    const ids = new Set(elements.map((element) => this.idOf(element)));
    const near = this.nearIds();
    if ([...near].some((id) => !ids.has(id))) {
      this.nearIds.set(new Set([...near].filter((id) => ids.has(id))));
    }
  }

  private onIntersect(entries: readonly IntersectionObserverEntry[]): void {
    const near = new Set(this.nearIds());
    let changed = false;
    for (const entry of entries) {
      if (!(entry.target instanceof HTMLElement)) continue;
      const id = this.idOf(entry.target);
      if (!id) continue;
      if (entry.isIntersecting) {
        if (!near.has(id)) {
          near.add(id);
          changed = true;
        }
      } else if (near.delete(id)) {
        // Leaving the window with its diff still rendered: the exact height
        // its placeholder should hold from now on.
        const height = entry.boundingClientRect.height;
        if (height > 0) this.measuredHeights.set(this.heightKey(id), height);
        changed = true;
      }
    }
    if (changed) this.nearIds.set(near);
  }

  private readonly onScroll = (): void => {
    if (this.scrollFrame !== null) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = null;
      this.trackActiveFile();
    });
  };

  /** The file at the top of the viewport is the active one. */
  private trackActiveFile(): void {
    const root = this.scroller().nativeElement;
    const top = root.getBoundingClientRect().top;
    const element = this.sectionElements()
      .map((ref) => ref.nativeElement)
      .find((section) => section.getBoundingClientRect().bottom > top + 1);
    if (!element) return;
    const id = this.idOf(element);
    const file = this.visibleFiles().find((candidate) => candidate.id === id);
    if (!file) return;
    this.setActive(file);
    rememberAnchor(this.comparisonId(), {
      fileId: id,
      offset: top - element.getBoundingClientRect().top,
    });
  }

  private applyNavigation(
    navigation: ReturnType<ReviewNavigationService['current']>,
    files: readonly ReviewCanvasFile[],
    comparisonId: string,
  ): void {
    if (files.length === 0) return;
    const target = navigation.target;
    if (navigation.seq !== this.handledSeq && target.kind === 'diff') {
      const path = normalizeDiffPath(target.path);
      const match = files.find((file) => normalizeDiffPath(file.path) === path);
      if (match) {
        this.handledSeq = navigation.seq;
        this.restoredFor = comparisonId;
        afterNextRender(() => this.scrollToFile(match.id), {
          injector: this.injector,
        });
        this.setActive(match);
        return;
      }
    }
    // An unmatched diff target stays pending: its file may not be listed yet.
    if (this.restoredFor === comparisonId) return;
    this.restoredFor = comparisonId;
    const anchor = scrollAnchors.get(comparisonId);
    afterNextRender(
      () => {
        const root = this.scroller().nativeElement;
        const section = anchor ? this.sectionFor(anchor.fileId) : null;
        if (anchor && section) {
          // The list is the sections' offset parent (`relative`).
          root.scrollTop = section.offsetTop + Math.max(0, anchor.offset);
        } else {
          root.scrollTop = 0;
        }
      },
      { injector: this.injector },
    );
  }

  private setActive(file: ReviewCanvasFile): void {
    const current = this.active();
    const staged = file.comparison === 'staged';
    if (current?.path !== file.path || current.staged !== staged) {
      this.active.set({ path: file.path, staged });
    }
  }

  private scrollToFile(id: string): void {
    const section = this.sectionFor(id);
    if (section && typeof section.scrollIntoView === 'function') {
      section.scrollIntoView({ block: 'start' });
    }
  }

  private sectionFor(id: string): HTMLElement | null {
    return (
      this.sectionElements()
        .map((ref) => ref.nativeElement)
        .find((element) => this.idOf(element) === id) ?? null
    );
  }

  private idOf(element: HTMLElement): string {
    return element.dataset['fileId'] ?? '';
  }

  private heightKey(id: string): string {
    return `${this.diffStyle()}\u0000${id}`;
  }
}
