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
import { LucideAngularModule, MessageSquarePlus } from 'lucide-angular';
import type { EditorTarget, GitConflictKind } from '@ptah-extension/shared';
import {
  FileStatusBadgeComponent,
  type FileStatusCode,
} from '@ptah-extension/ui';
import { PierreDiffHostComponent } from '../renderer/pierre-diff-host.component';
import type { PierreDiffStyle } from '../renderer/pierre-config';
import {
  ReviewDiffService,
  reviewDiffKey,
  type ReviewDiffRequest,
} from '../services/review-diff.service';
import {
  ReviewCommentDraftStore,
  type ReviewDraftOwner,
} from '../services/review-comment-draft.store';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import {
  HunkToolbarComponent,
  type HunkToolbarComparison,
} from './hunk-toolbar.component';

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

type DraftSide = 'additions' | 'deletions';

interface CommentComposer {
  readonly side: DraftSide;
  readonly from: number;
  readonly to: number;
  readonly body: string;
}

const LABEL_ROW: Readonly<
  Record<ReviewFileLabel, { icon: string; text: string; iconClass: string }>
> = {
  binary: {
    icon: '⊘',
    text: 'Binary file — diff not shown',
    iconClass: 'text-base-content',
  },
  submodule: {
    icon: '▤',
    text: 'Submodule',
    iconClass: 'text-base-content-muted',
  },
  conflicted: {
    icon: '⚠',
    text: 'Conflicted — resolve to review',
    iconClass: 'text-error',
  },
};

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

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
 * - A sticky header: status badge, path, rename source, hunk count, chips,
 *   +N/−N, a "Comment" action and Open-in.
 * - The body mounts only while the canvas reports the section {@link near} the
 *   viewport: `ReviewDiffService.mount` reads the diff lazily, and Pierre's
 *   host is created inside `@defer`, so the renderer and its observers exist
 *   only for near-visible files. Off-screen, the section keeps the reserved
 *   height so the scrollbar stays accurate.
 * - Labelled rows (binary, submodule, conflicted) never read or render text.
 * - A failed read shows its sanitized message with Retry, never as content.
 * - Each hunk carries a `HunkToolbarComponent` through Pierre's slot. While a
 *   refusal chip shows, the diff body is dimmed to 85% until the re-read.
 * - "Comment" opens a small composer (side, line range, text) that adds a
 *   draft to `ReviewCommentDraftStore` with the quoted lines.
 */
@Component({
  selector: 'ptah-file-diff-section',
  standalone: true,
  imports: [
    LucideAngularModule,
    FileStatusBadgeComponent,
    OpenInButtonComponent,
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
    <div
      class="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-base-content/10 bg-base-200/95 px-2 py-1.5 text-xs backdrop-blur-sm"
      data-testid="file-section-header"
    >
      <ptah-file-status-badge
        [status]="file().status"
        [conflictKind]="file().conflictKind"
      />
      <h3
        class="min-w-0 truncate font-mono font-medium text-base-content"
        [attr.title]="file().path"
        data-testid="file-section-path"
      >
        {{ file().path }}
      </h3>
      @if (file().originalPath; as from) {
        <span class="min-w-0 truncate text-[11px] text-base-content-muted">
          renamed from {{ from }}
        </span>
      }
      @for (chip of chips(); track chip) {
        <span class="badge badge-ghost badge-xs" data-testid="file-chip">{{
          chip
        }}</span>
      }
      <span class="ml-auto flex items-center gap-2">
        @if (totals(); as t) {
          <span class="whitespace-nowrap" data-testid="file-section-totals">
            <span class="sr-only"
              >{{ t.additions }} additions, {{ t.deletions }} deletions</span
            >
            <span class="diff-add-text" aria-hidden="true"
              >+{{ t.additions }}</span
            >
            <span class="diff-del-text" aria-hidden="true"
              >−{{ t.deletions }}</span
            >
          </span>
        }
        @if (canComment()) {
          <button
            #commentButton
            type="button"
            class="btn btn-ghost btn-xs {{ focusRing }}"
            [attr.aria-expanded]="composer() !== null"
            [attr.aria-label]="'Comment on lines of ' + file().path"
            data-testid="file-section-comment"
            (click)="toggleComposer()"
          >
            <lucide-angular
              [img]="CommentIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
            Comment
          </button>
        }
        @if (editorTargets().length > 0) {
          <ptah-open-in-button
            mode="icon-only"
            [targets]="editorTargets()"
            [path]="file().path"
            [root]="workspaceRoot()"
            (open)="openFile.emit($event)"
          />
        }
      </span>
    </div>

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
            <option value="additions" [selected]="draft.side === 'additions'">
              New
            </option>
            <option value="deletions" [selected]="draft.side === 'deletions'">
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
        <span [class]="row.iconClass" aria-hidden="true">{{ row.icon }}</span>
        <span
          [class]="
            labelKind() === 'submodule'
              ? 'text-base-content-muted'
              : 'text-base-content'
          "
          >{{ row.text }}</span
        >
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
          class="has-[[data-testid=hunk-refused]]:opacity-[0.85]"
          [attr.aria-busy]="d.status === 'refreshing' || null"
          data-testid="file-diff-body"
        >
          @defer (on immediate) {
            <ptah-pierre-diff-host
              [oldText]="d.originalRef.kind === 'absent' ? null : d.original"
              [newText]="d.modifiedRef.kind === 'absent' ? null : d.modified"
              [fileName]="d.path"
              [hunks]="d.hunks"
              [diffStyle]="diffStyle()"
              [hunkToolbar]="hunkToolbar"
            />
          } @placeholder {
            <div class="skeleton h-16 rounded-none" aria-hidden="true"></div>
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

  readonly openFile = output<OpenInRequest>();

  protected readonly CommentIcon = MessageSquarePlus;
  protected readonly focusRing = FOCUS_RING;
  protected readonly readFailedMessage = 'Git could not read this file.';
  protected readonly staleMessage =
    'Could not refresh this diff. Showing the last successful read.';

  /** `ReviewDiffService` key while the body is mounted, else `null`. */
  protected readonly entryKey = signal<string | null>(null);
  protected readonly composer = signal<CommentComposer | null>(null);
  protected readonly composerError = signal<string | null>(null);

  private readonly commentButton =
    viewChild<ElementRef<HTMLButtonElement>>('commentButton');
  private readonly composerStart =
    viewChild<ElementRef<HTMLElement>>('composerStart');

  /**
   * The read to keep mounted: only while near, never for a labelled row.
   * Compared by cache key, so a re-built file list does not remount.
   */
  private readonly mountRequest = computed<ReviewDiffRequest | null>(
    () => {
      const file = this.file();
      return this.near() && file.label === null ? file.request : null;
    },
    {
      equal: (a, b) =>
        a === b || (!!a && !!b && reviewDiffKey(a) === reviewDiffKey(b)),
    },
  );

  protected readonly diff = computed(() => {
    const key = this.entryKey();
    return key ? (this.reviewDiff.entries().get(key)?.diff ?? null) : null;
  });

  /** The list's label, or binary once a read says so. */
  protected readonly labelKind = computed<ReviewFileLabel | null>(
    () => this.file().label ?? (this.diff()?.isBinary ? 'binary' : null),
  );
  protected readonly labelRow = computed(() => {
    const kind = this.labelKind();
    return kind ? LABEL_ROW[kind] : null;
  });

  /** Placeholder height while nothing measurable is rendered. */
  protected readonly minHeight = computed(() => {
    if (this.labelKind() !== null) return null;
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
    }
    return chips;
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

    // A composer outlives neither the readable diff nor the owner.
    effect(() => {
      if (!this.canComment() && untracked(this.composer) !== null) {
        this.composer.set(null);
        this.composerError.set(null);
      }
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
    if (!diff) return;
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
    this.composer.set({ side, from: start, to: start, body: '' });
    afterNextRender(() => this.composerStart()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected closeComposer(): void {
    this.composer.set(null);
    this.composerError.set(null);
    afterNextRender(() => this.commentButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
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
    if (!draft || !diff || !owner) return;
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
