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
  viewChild,
} from '@angular/core';
import {
  ChevronDown,
  ChevronRight,
  LucideAngularModule,
  MessageSquarePlus,
  Pencil,
} from 'lucide-angular';
import type { EditorTarget, GitConflictKind } from '@ptah-extension/shared';
import {
  FileStatusBadgeComponent,
  type FileStatusCode,
} from '@ptah-extension/ui';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import type { HunkToolbarComparison } from './hunk-toolbar.component';

/** What the header shows about its file. */
export interface FileSectionHeaderFile {
  readonly path: string;
  readonly originalPath?: string;
  readonly status: FileStatusCode;
  readonly conflictKind?: GitConflictKind;
  readonly comparison: HunkToolbarComparison;
}

/** Line totals from the file list; absent while the list has no counts. */
export interface FileSectionTotals {
  readonly additions: number;
  readonly deletions: number;
}

/**
 * The side a status comparison reads. A file with staged and unstaged changes
 * is listed twice; this is what tells the two headers apart (parity row 136).
 */
const SIDE_LABEL: Partial<Record<HunkToolbarComparison, string>> = {
  worktree: 'Working tree',
  staged: 'Staged',
};

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

/**
 * FileSectionHeaderComponent — the sticky header of one file in the review
 * canvas (design-spec §6.1), split out of `FileDiffSectionComponent`.
 * Presentational: the section owns the read, the composer and the collapsed
 * state; this renders them and reports the user's intent.
 *
 * - Collapse toggle (a disclosure button) and status badge, path, the
 *   pre-rename path, the comparison side for the two status comparisons,
 *   chips, +N/−N, then Comment, Edit and Open-in.
 * - Delete anywhere in the header collapses the file: the successor of the
 *   old diff tab's close button and its Delete key (parity rows 39, 40).
 *   Focus lands on the toggle, since the actions it came from can go away.
 */
@Component({
  selector: 'ptah-file-section-header',
  standalone: true,
  imports: [
    LucideAngularModule,
    FileStatusBadgeComponent,
    OpenInButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Sticky on the host: it is the section's direct child, so it stays pinned
  // while the file's diff scrolls under it. Delete is a shortcut bubbling up
  // from the header's own buttons; every action is also a button.
  host: {
    class:
      'sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-base-content/10 bg-base-200/95 px-2 py-1.5 text-xs backdrop-blur-sm',
    'aria-keyshortcuts': 'Delete',
    'data-testid': 'file-section-header',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <button
      #toggle
      type="button"
      class="btn btn-ghost btn-xs h-auto min-h-0 p-0.5 {{ focusRing }}"
      [attr.aria-expanded]="!collapsed()"
      [attr.aria-controls]="bodyId()"
      [attr.aria-label]="(collapsed() ? 'Expand ' : 'Collapse ') + file().path"
      [title]="collapsed() ? 'Expand this file' : 'Collapse this file'"
      data-testid="file-section-toggle"
      (click)="collapsedChange.emit(!collapsed())"
    >
      <lucide-angular
        [img]="collapsed() ? ChevronRightIcon : ChevronDownIcon"
        class="h-3 w-3"
        aria-hidden="true"
      />
    </button>
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
      <span
        class="min-w-0 truncate text-[11px] text-base-content-muted"
        data-testid="file-section-renamed"
      >
        renamed from {{ from }}
      </span>
    }
    @if (sideLabel(); as side) {
      <span
        class="badge badge-outline badge-xs text-base-content"
        data-testid="file-section-side"
        >{{ side }}</span
      >
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
          [attr.aria-expanded]="composerOpen()"
          [attr.aria-label]="'Comment on lines of ' + file().path"
          data-testid="file-section-comment"
          (click)="commentToggle.emit()"
        >
          <lucide-angular
            [img]="CommentIcon"
            class="h-3 w-3"
            aria-hidden="true"
          />
          Comment
        </button>
      }
      @if (canEdit()) {
        <button
          type="button"
          class="btn btn-ghost btn-xs {{ focusRing }}"
          [attr.aria-label]="'Edit ' + file().path"
          data-testid="file-section-edit"
          (click)="edit.emit()"
        >
          <lucide-angular [img]="EditIcon" class="h-3 w-3" aria-hidden="true" />
          Edit
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
  `,
})
export class FileSectionHeaderComponent {
  private readonly injector = inject(Injector);

  readonly file = input.required<FileSectionHeaderFile>();
  readonly chips = input<readonly string[]>([]);
  readonly totals = input<FileSectionTotals | null>(null);
  readonly collapsed = input(false);
  /** Id of the body the toggle shows and hides. */
  readonly bodyId = input.required<string>();
  readonly canComment = input(false);
  readonly composerOpen = input(false);
  readonly canEdit = input(false);
  readonly editorTargets = input<readonly EditorTarget[]>([]);
  readonly workspaceRoot = input('');

  readonly collapsedChange = output<boolean>();
  readonly commentToggle = output<void>();
  readonly edit = output<void>();
  readonly openFile = output<OpenInRequest>();

  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly CommentIcon = MessageSquarePlus;
  protected readonly EditIcon = Pencil;
  protected readonly focusRing = FOCUS_RING;

  protected readonly sideLabel = computed(
    () => SIDE_LABEL[this.file().comparison] ?? null,
  );

  private readonly toggle =
    viewChild.required<ElementRef<HTMLButtonElement>>('toggle');
  private readonly commentButton =
    viewChild<ElementRef<HTMLButtonElement>>('commentButton');

  /** Return focus to Comment once the composer it opened has closed. */
  focusComment(): void {
    afterNextRender(() => this.commentButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Delete' || this.collapsed()) return;
    event.preventDefault();
    this.collapsedChange.emit(true);
    afterNextRender(() => this.toggle().nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
