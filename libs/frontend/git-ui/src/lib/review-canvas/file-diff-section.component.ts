import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { EditorTarget, GitConflictKind } from '@ptah-extension/shared';
import type { FileStatusCode } from '@ptah-extension/ui';
import { PierreDiffHostComponent } from '../renderer/pierre-diff-host.component';
import type {
  DiffTabState,
  DiffUnrenderable,
} from '../types/review-diff.types';
import type {
  PierreDiffStyle,
  PierreThemeMode,
} from '../renderer/pierre-config';
import {
  ReviewDiffService,
  reviewDiffKey,
  type ReviewDiffRequest,
} from '../services/review-diff.service';
import {
  ReviewCommentDraftStore,
  type ReviewDraftOwner,
} from '../services/review-comment-draft.store';
import type { OpenInRequest } from '../open-in/open-in-button.component';
import {
  HunkToolbarComponent,
  type HunkToolbarComparison,
} from './hunk-toolbar.component';
import { FileSectionHeaderComponent } from './file-section-header.component';

/** Rows that never mount the renderer (Requirement 6.10). */
export type ReviewFileLabel = 'binary' | 'submodule' | 'conflicted';

/** One file of the continuous diff, as the canvas lists it. */
export interface ReviewCanvasFile {
  /** Stable within a comparison: section comparison plus both paths. */
  readonly id: string;
  /** Workspace-relative path, modified side. */
  readonly path: string;
  /** Pre-rename path; absent when the file was not renamed. */
  readonly originalPath?: string;
  readonly status: FileStatusCode;
  readonly conflictKind?: GitConflictKind;
  readonly additions: number | null;
  readonly deletions: number | null;
  /** What the hunk toolbar offers for this file. */
  readonly comparison: HunkToolbarComparison;
  /** The diff read; `null` for a file that is labelled before any read. */
  readonly request: ReviewDiffRequest | null;
  /** Known from the file list alone; such a row never reads or renders text. */
  readonly label: ReviewFileLabel | null;
}

/** What the section's "Edit" action asks the canvas to open. */
export interface ReviewFileEditRequest {
  /** Workspace-relative path, modified side. */
  readonly path: string;
  readonly line?: number;
}

type DraftSide = 'additions' | 'deletions';

interface CommentComposer {
  readonly side: DraftSide;
  readonly from: number;
  readonly to: number;
  readonly body: string;
  /** {@link draftOwnerIdentity} of the owner the composer was opened for. */
  readonly owner: string;
}

/**
 * Who a draft belongs to: the workspace and the session together, so a
 * composer opened for one change set is never submitted under another.
 */
function draftOwnerIdentity(owner: ReviewDraftOwner): string {
  return JSON.stringify([owner.workspaceRoot, owner.ownerSessionId ?? null]);
}

/** A list label, or a read outcome that also replaces the diff body. */
type LabelKind = ReviewFileLabel | DiffUnrenderable['reason'];

interface LabelRow {
  readonly icon: string;
  readonly text: string;
  readonly iconClass: string;
  readonly textClass: string;
}

/**
 * Copy and colours from design-spec §6 (Requirement 6.10): LFS, submodule and
 * too-large are informational (`text-base-content-muted`); the conflicted
 * icon is `text-error` (non-text, 3:1) with its label in `text-base-content`.
 */
const LABEL_ROW: Readonly<Record<LabelKind, LabelRow>> = {
  binary: {
    icon: '⊘',
    text: 'Binary file — diff not shown',
    iconClass: 'text-base-content',
    textClass: 'text-base-content',
  },
  submodule: {
    icon: '▤',
    text: 'Submodule',
    iconClass: 'text-base-content-muted',
    textClass: 'text-base-content-muted',
  },
  conflicted: {
    icon: '⚠',
    text: 'Conflicted — resolve to review',
    iconClass: 'text-error',
    textClass: 'text-base-content',
  },
  'lfs-pointer': {
    icon: '⇪',
    text: 'Git LFS pointer — diff not shown',
    iconClass: 'text-base-content-muted',
    textClass: 'text-base-content-muted',
  },
  'too-large': {
    icon: '▦',
    text: 'Too large to display',
    iconClass: 'text-base-content-muted',
    textClass: 'text-base-content-muted',
  },
};

/**
 * Above this many changed lines (additions + deletions) a file is shown as the
 * too-large row with Open-in instead of mounting Pierre, and is never read
 * (gate-p4-a9-pierre-perf Q2: a 10,000-line file blocked the main thread for
 * 0.5-2 s in every renderer variant).
 */
export const MAX_RENDERABLE_CHANGED_LINES = 3000;

/** Changed lines from the file list, or `null` when the list has no counts. */
function changedLines(file: ReviewCanvasFile): number | null {
  return file.additions === null && file.deletions === null
    ? null
    : (file.additions ?? 0) + (file.deletions ?? 0);
}

/** Lines in `text`; a final terminator does not start a line. */
function lineCount(text: string): number {
  if (text === '') return 0;
  let lines = 1;
  for (
    let at = text.indexOf('\n');
    at !== -1;
    at = text.indexOf('\n', at + 1)
  ) {
    lines++;
  }
  return text.endsWith('\n') ? lines - 1 : lines;
}

/** `1.5 MB` style size, or `null` for a size not worth showing. */
function formatSize(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

/**
 * Both sides exist and are identical text (a file reverted to its base, say).
 * Driven by the resolved refs, never by empty text: an empty tracked file is
 * not a new one (parity row 136, the old diff header's "no changes" chip).
 */
function hasNoChanges(diff: DiffTabState): boolean {
  return (
    !diff.isBinary &&
    diff.originalRef.kind !== 'absent' &&
    diff.modifiedRef.kind !== 'absent' &&
    diff.original === diff.modified
  );
}

let nextBodyId = 0;

/** Split on line terminators; a final terminator does not start a line. */
function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * FileDiffSectionComponent — one file of the review canvas's continuous diff
 * (implementation-plan Component 24, design-spec §6.1).
 *
 * - A sticky header (`FileSectionHeaderComponent`): collapse toggle, status
 *   badge, path, rename source, comparison side, chips (hunk count, new,
 *   deleted, no changes), +N/−N, "Comment", "Edit" (working-tree files only)
 *   and Open-in. Collapsed (the canvas's state), only the header renders and
 *   the read is released.
 * - The body mounts only while the canvas reports the section {@link near} the
 *   viewport: `ReviewDiffService.mount` reads the diff lazily, and Pierre's
 *   host is created inside `@defer`, so the renderer and its observers exist
 *   only for near-visible files. Off-screen, the section keeps the reserved
 *   height so the scrollbar stays accurate.
 * - Labelled rows (binary, submodule, conflicted) never read or render text;
 *   a read that reports a binary, too-large or LFS-pointer side becomes a
 *   labelled row too, so Pierre never mounts empty text for it. A file with
 *   more than {@link MAX_RENDERABLE_CHANGED_LINES} changed lines is a
 *   too-large row from the list alone, and is never read either. A file the
 *   list has no counts for (untracked, or a stash row git could not count) is
 *   read, and becomes a too-large row when the read brings back more lines
 *   than the cap, before Pierre mounts.
 * - A failed read shows its sanitized message with Retry, never as content.
 * - Each hunk carries a `HunkToolbarComponent` through Pierre's slot. While a
 *   refused apply waits for its re-read, the diff body is dimmed to 85%.
 * - "Comment" opens a small composer (side, line range, text) that adds a
 *   draft to `ReviewCommentDraftStore` with the quoted lines.
 */
@Component({
  selector: 'ptah-file-diff-section',
  standalone: true,
  imports: [
    FileSectionHeaderComponent,
    PierreDiffHostComponent,
    HunkToolbarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block border-b border-base-content/10',
    '[attr.data-file-id]': 'file().id',
    '[style.min-height.px]': 'minHeight()',
  },
  template: `
    <ptah-file-section-header
      [file]="file()"
      [chips]="chips()"
      [totals]="totals()"
      [collapsed]="collapsed()"
      [bodyId]="bodyId"
      [canComment]="canComment()"
      [composerOpen]="composer() !== null"
      [canEdit]="canEdit()"
      [editorTargets]="editorTargets()"
      [workspaceRoot]="workspaceRoot()"
      (collapsedChange)="collapsedChange.emit($event)"
      (commentToggle)="toggleComposer()"
      (edit)="onEdit()"
      (openFile)="openFile.emit($event)"
    />

    <!-- Collapsed, the header stays and the body and its read are released. -->
    <div [id]="bodyId" data-testid="file-section-body">
      @if (!collapsed()) {
        @if (composer(); as draft) {
          <form
            class="flex flex-wrap items-end gap-2 border-b border-base-content/10 bg-base-200 px-2 py-2 text-xs"
            [attr.aria-label]="'Draft a comment on ' + file().path"
            data-testid="comment-composer"
            (submit)="addDraft($event)"
          >
            <label class="flex flex-col gap-0.5">
              <span class="text-base-content-muted">Side</span>
              <select
                #composerStart
                class="select select-bordered select-xs"
                data-testid="comment-side"
                (change)="patchComposer({ side: sideValue($event) })"
              >
                <option
                  value="additions"
                  [selected]="draft.side === 'additions'"
                >
                  New
                </option>
                <option
                  value="deletions"
                  [selected]="draft.side === 'deletions'"
                >
                  Old
                </option>
              </select>
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="text-base-content-muted">From line</span>
              <input
                type="number"
                min="1"
                class="input input-bordered input-xs w-20"
                data-testid="comment-from"
                [value]="draft.from"
                (input)="patchComposer({ from: numberValue($event) })"
              />
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="text-base-content-muted">To line</span>
              <input
                type="number"
                min="1"
                class="input input-bordered input-xs w-20"
                data-testid="comment-to"
                [value]="draft.to"
                (input)="patchComposer({ to: numberValue($event) })"
              />
            </label>
            <label class="flex min-w-[12rem] flex-1 flex-col gap-0.5">
              <span class="text-base-content-muted">Comment</span>
              <textarea
                class="textarea textarea-bordered textarea-xs"
                rows="2"
                data-testid="comment-body"
                [value]="draft.body"
                (input)="patchComposer({ body: textValue($event) })"
              ></textarea>
            </label>
            <span class="flex items-center gap-1">
              <button
                type="submit"
                class="btn btn-primary btn-xs"
                data-testid="comment-add"
                [disabled]="!canComment()"
                [attr.aria-describedby]="
                  canComment() ? null : bodyId + '-comment-unavailable'
                "
              >
                Add draft
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs {{ focusRing }}"
                data-testid="comment-cancel"
                (click)="closeComposer()"
              >
                Cancel
              </button>
            </span>
            @if (!canComment()) {
              <p
                class="basis-full text-base-content-muted"
                [id]="bodyId + '-comment-unavailable'"
                data-testid="comment-unavailable"
              >
                The diff is not available right now. Your comment is kept; add
                it once the diff is back.
              </p>
            }
            @if (composerError(); as message) {
              <p
                class="basis-full text-error"
                role="alert"
                data-testid="comment-error"
              >
                {{ message }}
              </p>
            }
          </form>
        }

        @if (labelRow(); as row) {
          <div
            class="flex items-center gap-2 px-2 py-2 text-xs"
            data-testid="file-label-row"
          >
            <span [class]="row.iconClass" aria-hidden="true">{{
              row.icon
            }}</span>
            <span [class]="row.textClass">{{ row.text }}</span>
          </div>
        } @else if (!near()) {
          <div aria-hidden="true" data-testid="file-placeholder"></div>
        } @else if (diff(); as d) {
          @if (d.status === 'error') {
            <div
              class="flex flex-wrap items-center gap-2 px-2 py-2 text-xs"
              role="alert"
              data-testid="file-read-error"
            >
              <span class="text-error" aria-hidden="true">⚠</span>
              <span class="text-base-content">{{
                d.errorMessage ?? readFailedMessage
              }}</span>
              <button
                type="button"
                class="btn btn-ghost btn-xs {{ focusRing }}"
                data-testid="file-read-retry"
                (click)="retry()"
              >
                Retry
              </button>
            </div>
          } @else {
            @if (d.status === 'stale') {
              <div
                class="flex flex-wrap items-center gap-2 px-2 py-1 text-[11px] text-base-content-muted"
                role="status"
                data-testid="file-stale-note"
              >
                <span>{{ d.errorMessage ?? staleMessage }}</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs {{ focusRing }}"
                  data-testid="file-stale-retry"
                  (click)="retry()"
                >
                  Retry
                </button>
              </div>
            }
            <div
              class="has-[[data-awaiting-reread]]:opacity-[0.85]"
              [attr.aria-busy]="d.status === 'refreshing' || null"
              data-testid="file-diff-body"
            >
              @defer (on immediate) {
                <ptah-pierre-diff-host
                  [oldText]="
                    d.originalRef.kind === 'absent' ? null : d.original
                  "
                  [newText]="
                    d.modifiedRef.kind === 'absent' ? null : d.modified
                  "
                  [fileName]="d.path"
                  [hunks]="d.hunks"
                  [diffStyle]="effectiveDiffStyle()"
                  [themeType]="themeType()"
                  [hunkToolbar]="hunkToolbar"
                />
              } @placeholder {
                <div
                  class="skeleton h-16 rounded-none"
                  aria-hidden="true"
                ></div>
              } @error {
                <p class="px-2 py-2 text-xs text-base-content" role="alert">
                  The diff viewer could not be loaded.
                </p>
              }
            </div>
            <ng-template #hunkToolbar let-hunk>
              <ptah-hunk-toolbar
                [hunk]="hunk"
                [hunkCount]="d.hunks.length"
                [comparison]="file().comparison"
                [entryKey]="entryKey() ?? ''"
                [snapshotToken]="d.snapshotToken"
                (navigate)="goToHunk($event)"
              />
            </ng-template>
          }
        } @else {
          <div
            class="skeleton h-16 rounded-none"
            role="status"
            aria-label="Loading diff"
            data-testid="file-loading"
          ></div>
        }
      }
    </div>
  `,
})
export class FileDiffSectionComponent {
  private readonly reviewDiff = inject(ReviewDiffService);
  private readonly drafts = inject(ReviewCommentDraftStore);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly file = input.required<ReviewCanvasFile>();
  /** Set by the canvas while the section is within one viewport of view. */
  readonly near = input(false);
  readonly diffStyle = input<PierreDiffStyle>('split');
  /** Height held while the body is not rendered (estimated, then measured). */
  readonly reservedHeight = input(0);
  /** Whose drafts a comment goes to; `null` disables commenting. */
  readonly draftOwner = input<ReviewDraftOwner | null>(null);
  readonly editorTargets = input<readonly EditorTarget[]>([]);
  readonly workspaceRoot = input('');
  /**
   * Header only: the body is not rendered and its read is released. The
   * canvas owns the state (parity rows 39, 40: the closed diff tab).
   */
  readonly collapsed = input(false);
  /** Pierre's light/dark theme; the canvas follows the app theme. */
  readonly themeType = input<PierreThemeMode>('dark');

  readonly openFile = output<OpenInRequest>();
  /** "Edit": open the file in the spot editor, editable (design-spec §3.3). */
  readonly edit = output<ReviewFileEditRequest>();
  /** The header's toggle or Delete asked to collapse (or expand) this file. */
  readonly collapsedChange = output<boolean>();

  protected readonly focusRing = FOCUS_RING;
  protected readonly bodyId = `file-section-body-${nextBodyId++}`;
  protected readonly readFailedMessage = 'Git could not read this file.';
  protected readonly staleMessage =
    'Could not refresh this diff. Showing the last successful read.';

  /** `ReviewDiffService` key while the body is mounted, else `null`. */
  protected readonly entryKey = signal<string | null>(null);
  protected readonly composer = signal<CommentComposer | null>(null);
  protected readonly composerError = signal<string | null>(null);

  private readonly header = viewChild.required(FileSectionHeaderComponent);
  private readonly composerStart =
    viewChild<ElementRef<HTMLElement>>('composerStart');

  /**
   * The read to keep mounted: only while near and expanded, never for a
   * labelled row. Compared by cache key, so a re-built file list does not
   * remount.
   */
  private readonly mountRequest = computed<ReviewDiffRequest | null>(
    () => {
      const file = this.file();
      return this.near() &&
        !this.collapsed() &&
        file.label === null &&
        !this.overLineCap()
        ? file.request
        : null;
    },
    {
      equal: (a, b) =>
        a === b || (!!a && !!b && reviewDiffKey(a) === reviewDiffKey(b)),
    },
  );

  /** The list's changed-line count is over the render cap. */
  private readonly overLineCap = computed(
    () => (changedLines(this.file()) ?? 0) > MAX_RENDERABLE_CHANGED_LINES,
  );

  /**
   * For a file the list has no counts for: the lines its read brought back,
   * on the longer side (Pierre lays out both). `null` when the list had
   * counts, or before a readable text read. Never feeds {@link mountRequest},
   * so labelling a file keeps its read mounted instead of re-reading it.
   */
  private readonly loadedLines = computed<number | null>(() => {
    if (changedLines(this.file()) !== null) return null;
    const diff = this.diff();
    if (!diff || diff.status === 'error' || diff.isBinary) return null;
    return Math.max(
      diff.originalRef.kind === 'absent' ? 0 : lineCount(diff.original),
      diff.modifiedRef.kind === 'absent' ? 0 : lineCount(diff.modified),
    );
  });

  /** The read of a file without list counts is over the render cap. */
  private readonly readOverLineCap = computed(
    () => (this.loadedLines() ?? 0) > MAX_RENDERABLE_CHANGED_LINES,
  );

  protected readonly diff = computed(() => {
    const key = this.entryKey();
    return key ? (this.reviewDiff.entries().get(key)?.diff ?? null) : null;
  });

  /**
   * The list's label, or what a read says replaces the text: binary, or a
   * side that was too large or an LFS pointer (shipped without content).
   */
  protected readonly labelKind = computed<LabelKind | null>(() => {
    const listed = this.file().label;
    if (listed) return listed;
    if (this.overLineCap() || this.readOverLineCap()) return 'too-large';
    const diff = this.diff();
    // A failed read keeps its error row and Retry; a label must not hide it.
    if (!diff || diff.status === 'error') return null;
    if (diff.isBinary) return 'binary';
    return diff.unrenderable?.reason ?? null;
  });
  protected readonly labelRow = computed<LabelRow | null>(() => {
    const kind = this.labelKind();
    if (!kind) return null;
    const row = LABEL_ROW[kind];
    if (kind === 'too-large' && this.overLineCap()) {
      const lines = changedLines(this.file()) ?? 0;
      return {
        ...row,
        text: `${row.text} (${lines.toLocaleString('en-US')} changed lines)`,
      };
    }
    if (kind === 'too-large' && this.readOverLineCap()) {
      const lines = this.loadedLines() ?? 0;
      return {
        ...row,
        text: `${row.text} (${lines.toLocaleString('en-US')} lines)`,
      };
    }
    const unrenderable = this.diff()?.unrenderable;
    const size =
      unrenderable?.reason === kind ? formatSize(unrenderable.size) : null;
    return size ? { ...row, text: `${row.text} (${size})` } : row;
  });

  /** Placeholder height while nothing measurable is rendered. */
  protected readonly minHeight = computed(() => {
    if (this.collapsed() || this.labelKind() !== null) return null;
    const rendered = this.near() && this.diff() !== null;
    return rendered ? null : this.reservedHeight() || null;
  });

  protected readonly chips = computed<readonly string[]>(() => {
    const diff = this.diff();
    const chips: string[] = [];
    if (diff && diff.status !== 'error') {
      const hunks = diff.hunks.length;
      if (hunks > 0) chips.push(hunks === 1 ? '1 hunk' : `${hunks} hunks`);
      if (diff.originalRef.kind === 'absent') chips.push('new');
      if (diff.modifiedRef.kind === 'absent') chips.push('deleted');
      if (hasNoChanges(diff)) chips.push('no changes');
    }
    // Collapsed, the composer is hidden but kept; say so.
    if (this.collapsed() && this.composer() !== null) {
      chips.push('comment in progress');
    }
    return chips;
  });

  /**
   * In branch review an added or deleted file has one empty side, so it is
   * always unified; every other file follows the canvas setting (parity row
   * 135, the old branch-review row's inline override).
   */
  protected readonly effectiveDiffStyle = computed<PierreDiffStyle>(() => {
    const { comparison, status } = this.file();
    return comparison === 'branch' && (status === 'A' || status === 'D')
      ? 'unified'
      : this.diffStyle();
  });

  protected readonly totals = computed(() => {
    const { additions, deletions } = this.file();
    return additions === null || deletions === null
      ? null
      : { additions, deletions };
  });

  /** Commenting needs an owner and readable text. */
  protected readonly canComment = computed(() => {
    const diff = this.diff();
    return (
      this.draftOwner() !== null &&
      this.labelKind() === null &&
      diff !== null &&
      diff.status !== 'error'
    );
  });

  /**
   * Only a file that exists in the working tree can be edited: the two status
   * comparisons, not a deleted file, and not a binary or submodule row.
   * Historical and branch comparisons are read-only.
   */
  protected readonly canEdit = computed(() => {
    const file = this.file();
    return (
      (file.comparison === 'worktree' || file.comparison === 'staged') &&
      file.status !== 'D' &&
      file.label !== 'binary' &&
      file.label !== 'submodule'
    );
  });

  constructor() {
    effect((onCleanup) => {
      const request = this.mountRequest();
      if (!request) {
        this.entryKey.set(null);
        return;
      }
      const key = untracked(() => this.reviewDiff.mount(request));
      this.entryKey.set(key);
      onCleanup(() => this.reviewDiff.unmount(key));
    });

    // A composer lives as long as the owner it was opened for: it is dropped
    // when that owner goes away or is replaced by another (a different
    // change-set session or workspace on the same file id). An unmounted,
    // failed or labelled read is not a reason: the text and line range are
    // kept, submission waits for readable text, and Cancel dismisses it.
    effect(() => {
      const owner = this.draftOwner();
      const current = untracked(this.composer);
      if (
        current !== null &&
        (owner === null || draftOwnerIdentity(owner) !== current.owner)
      ) {
        this.composer.set(null);
        this.composerError.set(null);
      }
    });
  }

  /** Opens at the first hunk's line on the working-tree side when it is known. */
  protected onEdit(): void {
    const diff = this.diff();
    const first =
      diff && diff.status !== 'error'
        ? diff.hunks[0]?.modifiedStart
        : undefined;
    this.edit.emit({
      path: this.file().path,
      ...(first !== undefined && first > 0 ? { line: first } : {}),
    });
  }

  protected retry(): void {
    const key = this.entryKey();
    if (key) void this.reviewDiff.retry(key);
  }

  /**
   * Toolbar Previous/Next: bring hunk `index` into view and move focus to its
   * toolbar so keyboard users keep their place.
   */
  protected goToHunk(index: number): void {
    const slot = this.host.nativeElement.querySelector<HTMLElement>(
      `[data-hunk-index="${index}"]`,
    );
    if (!slot) return;
    if (typeof slot.scrollIntoView === 'function') {
      slot.scrollIntoView({ block: 'center' });
    }
    slot.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }

  protected toggleComposer(): void {
    if (this.composer()) {
      this.closeComposer();
      return;
    }
    const diff = this.diff();
    const owner = this.draftOwner();
    if (!diff || !owner) return;
    const side: DraftSide =
      diff.modifiedRef.kind === 'absent' ? 'deletions' : 'additions';
    const first = diff.hunks[0];
    const start = first
      ? Math.max(
          1,
          side === 'additions' ? first.modifiedStart : first.originalStart,
        )
      : 1;
    this.composerError.set(null);
    this.composer.set({
      side,
      from: start,
      to: start,
      body: '',
      owner: draftOwnerIdentity(owner),
    });
    afterNextRender(() => this.composerStart()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected closeComposer(): void {
    this.composer.set(null);
    this.composerError.set(null);
    this.header().focusComment();
  }

  protected patchComposer(patch: Partial<CommentComposer>): void {
    const current = this.composer();
    if (current) this.composer.set({ ...current, ...patch });
  }

  /** Quote the chosen lines into a draft for the canvas's owner. */
  protected addDraft(event: Event): void {
    event.preventDefault();
    const draft = this.composer();
    const diff = this.diff();
    const owner = this.draftOwner();
    if (!draft || !diff || !owner || !this.canComment()) return;
    // Never submit under an owner other than the one it was written for.
    if (draftOwnerIdentity(owner) !== draft.owner) return;
    const text = draft.side === 'additions' ? diff.modified : diff.original;
    const lines = splitLines(text);
    const { from, to } = draft;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 1 ||
      to < from ||
      to > lines.length
    ) {
      this.composerError.set(
        lines.length === 0
          ? 'This side of the diff has no lines to quote.'
          : `Choose lines between 1 and ${lines.length}, with "From" not after "To".`,
      );
      return;
    }
    const added = this.drafts.add(owner, {
      path:
        draft.side === 'deletions'
          ? (this.file().originalPath ?? this.file().path)
          : this.file().path,
      startLine: from,
      endLine: to,
      lines: lines.slice(from - 1, to),
      body: draft.body.trim(),
    });
    if (!added) {
      this.composerError.set('This comment could not be added.');
      return;
    }
    this.closeComposer();
  }

  protected sideValue(event: Event): DraftSide {
    return event.target instanceof HTMLSelectElement &&
      event.target.value === 'deletions'
      ? 'deletions'
      : 'additions';
  }

  protected numberValue(event: Event): number {
    return event.target instanceof HTMLInputElement
      ? Number(event.target.value)
      : Number.NaN;
  }

  protected textValue(event: Event): string {
    return event.target instanceof HTMLTextAreaElement
      ? event.target.value
      : '';
  }
}
