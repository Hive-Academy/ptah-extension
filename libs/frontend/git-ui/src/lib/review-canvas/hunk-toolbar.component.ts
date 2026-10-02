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
import { ChevronLeft, ChevronRight, LucideAngularModule } from 'lucide-angular';
import type {
  GitApplyHunksOperation,
  GitHunkRef,
} from '@ptah-extension/shared';
import { ReviewDiffService } from '../services/review-diff.service';
import type { DiffTabState } from '../types/diff-tab.types';
import type { ReviewScope } from '../services/review-navigation.service';
import { GitConfirmDialogComponent } from '../shared/git-confirm-dialog.component';

/** The comparison the toolbar's hunk belongs to. */
export type HunkToolbarComparison = ReviewScope['kind'];

type ToolbarControl = 'prev' | 'next' | GitApplyHunksOperation;

/**
 * The result of the last apply, held until the re-read it forced lands. `diff`
 * is the entry's diff object when the result arrived: the outcome lasts while
 * that object is still current or a read is in flight, and ends with the
 * first completed read after it.
 */
type Outcome =
  | { readonly diff: DiffTabState | null; readonly kind: 'consumed' }
  | {
      readonly diff: DiffTabState | null;
      readonly kind: 'refused';
      readonly message: string;
    };

const REFUSED_FALLBACK_MESSAGE =
  'The hunk could not be applied. Nothing was written.';

const ACTION_TEXT: Readonly<Record<GitApplyHunksOperation, string>> = {
  stage: 'Accept',
  revert: 'Reject',
  unstage: 'Unstage',
};

const ACTION_CLASS: Readonly<Record<GitApplyHunksOperation, string>> = {
  stage: 'btn btn-success btn-xs ok-solid-text',
  revert: 'btn btn-error btn-xs err-solid-text',
  unstage: 'btn btn-ghost btn-xs',
};

/**
 * HunkToolbarComponent — the per-hunk header row of the review canvas
 * (implementation-plan Component 24, design-spec §6.1), projected into the
 * hunk's slot through `PierreDiffHostComponent`'s `hunkToolbar` template.
 *
 * - "Hunk i of n", Previous/Next (emitted as {@link navigate}; the canvas
 *   owns scrolling), and the comparison's actions: worktree Accept (stage) and
 *   Reject (revert, confirmed); staged Unstage; branch and historical show
 *   Accept/Reject `aria-disabled`, never removed.
 * - One tab stop: a roving tabindex with Left/Right/Home/End between buttons
 *   (`diff-view.component.ts` toolbar pattern). Unavailable buttons stay
 *   focusable and carry `aria-disabled` so arrow navigation never skips.
 * - Every action sends the snapshot token this toolbar was rendered with; a
 *   reject sends the token captured when its dialog OPENED. A renumbered hunk
 *   therefore arrives with a new token and is refused by `ReviewDiffService`
 *   rather than re-aimed (Requirement 6.6).
 * - A refusal replaces the buttons with the sanitized reason chip until the
 *   forced re-read delivers a new token; a success leaves the buttons inert
 *   until then too, so one snapshot is never applied twice.
 */
@Component({
  selector: 'ptah-hunk-toolbar',
  standalone: true,
  imports: [LucideAngularModule, GitConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center justify-between gap-1 bg-base-200/60 px-2 py-1 text-[11px] border-y border-base-content/5"
      data-testid="hunk-toolbar-row"
    >
      <span class="flex min-w-0 items-center gap-2">
        <span
          class="font-mono truncate text-base-content-muted"
          [attr.title]="hunk().header"
          >{{ hunk().header }}</span
        >
        <span
          class="whitespace-nowrap text-base-content"
          data-testid="hunk-position"
          >{{ positionLabel() }}</span
        >
      </span>

      @if (refusal(); as message) {
        <div
          #refusalChip
          class="motion-safe:animate-glow-urgent inline-flex items-center gap-1.5 border border-error/60 bg-error/10 rounded px-2 py-0.5 basis-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          role="alert"
          tabindex="-1"
          data-testid="hunk-refused"
        >
          <span class="text-error text-xs" aria-hidden="true">⚠</span>
          <span class="font-medium text-base-content">{{ message }}</span>
        </div>
      } @else {
        <!-- The roving tabindex lives on the buttons; the container only
             receives the bubbled arrow keys. -->
        <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
        <div
          class="flex flex-wrap items-center gap-1"
          role="toolbar"
          aria-orientation="horizontal"
          [attr.aria-label]="positionLabel() + ' actions'"
          [attr.aria-busy]="inFlight() || null"
          data-testid="hunk-toolbar"
          (keydown)="onKeydown($event)"
        >
          <button
            #control
            type="button"
            class="btn btn-ghost btn-xs px-1"
            data-control="prev"
            data-testid="hunk-prev"
            aria-label="Previous hunk"
            [attr.tabindex]="tabIndexFor('prev')"
            [attr.aria-disabled]="!canStep() || null"
            (click)="step(-1)"
          >
            <lucide-angular
              [img]="ChevronLeftIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
          </button>
          <button
            #control
            type="button"
            class="btn btn-ghost btn-xs px-1"
            data-control="next"
            data-testid="hunk-next"
            aria-label="Next hunk"
            [attr.tabindex]="tabIndexFor('next')"
            [attr.aria-disabled]="!canStep() || null"
            (click)="step(1)"
          >
            <lucide-angular
              [img]="ChevronRightIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
          </button>
          @for (action of actions(); track action) {
            <button
              #control
              type="button"
              [class]="actionClass(action)"
              [attr.data-control]="action"
              [attr.data-testid]="'hunk-' + action"
              [attr.tabindex]="tabIndexFor(action)"
              [attr.aria-disabled]="!canApply() || null"
              [attr.aria-label]="actionLabel(action)"
              [attr.title]="actionTitle(action)"
              (click)="onAction(action, $event)"
            >
              {{ actionText(action) }}
            </button>
          }
        </div>
      }
    </div>

    <ptah-git-confirm-dialog
      title="Reject this hunk?"
      description="This reverts the change in your working tree. It cannot be undone from here."
      confirmLabel="Reject hunk"
      tone="danger"
      (confirmed)="confirmRevert()"
      (cancelled)="pendingRevertToken = null"
    />
  `,
})
export class HunkToolbarComponent {
  private readonly reviewDiff = inject(ReviewDiffService);
  private readonly injector = inject(Injector);

  /** The hunk this row heads (`PierreHunkToolbarContext.$implicit`). */
  readonly hunk = input.required<GitHunkRef>();
  /** How many hunks the file has. */
  readonly hunkCount = input.required<number>();
  readonly comparison = input.required<HunkToolbarComparison>();
  /** `ReviewDiffService` entry key of the file. */
  readonly entryKey = input.required<string>();
  /** Token of the diff this hunk was rendered from. */
  readonly snapshotToken = input.required<string>();

  /** Previous/Next: the ordinal (0-based, wrapping) of the hunk to bring into view. */
  readonly navigate = output<number>();

  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;

  protected readonly inFlight = signal(false);
  private readonly outcome = signal<Outcome | null>(null);
  private readonly focusedControl = signal<ToolbarControl>('prev');

  /** Token captured when the reject dialog opened; null when it is closed. */
  protected pendingRevertToken: string | null = null;

  private readonly dialog = viewChild.required(GitConfirmDialogComponent);
  private readonly controls =
    viewChildren<ElementRef<HTMLButtonElement>>('control');
  private readonly refusalChip =
    viewChild<ElementRef<HTMLElement>>('refusalChip');

  protected readonly positionLabel = computed(
    () => `Hunk ${this.hunk().index + 1} of ${this.hunkCount()}`,
  );

  /** Branch and historical keep Accept/Reject visible but `aria-disabled`. */
  protected readonly actions = computed<readonly GitApplyHunksOperation[]>(
    () => (this.comparison() === 'staged' ? ['unstage'] : ['stage', 'revert']),
  );

  private readonly mutable = computed(() => {
    const kind = this.comparison();
    return kind === 'worktree' || kind === 'staged';
  });

  private readonly entryDiff = computed(
    () => this.reviewDiff.entries().get(this.entryKey())?.diff ?? null,
  );

  /**
   * The last outcome, until the forced re-read completes. Keyed to the read
   * rather than to the token: a reject confirmed after the diff changed sends
   * the dialog's older token, and its refusal must still be shown.
   */
  private readonly currentOutcome = computed(() => {
    const outcome = this.outcome();
    if (!outcome) return null;
    const diff = this.entryDiff();
    return diff === outcome.diff || diff?.status === 'refreshing'
      ? outcome
      : null;
  });

  protected readonly refusal = computed(() => {
    const outcome = this.currentOutcome();
    return outcome?.kind === 'refused' ? outcome.message : null;
  });

  protected readonly canApply = computed(
    () =>
      this.mutable() &&
      this.snapshotToken() !== '' &&
      !this.inFlight() &&
      this.currentOutcome() === null,
  );

  protected readonly canStep = computed(() => this.hunkCount() > 1);

  private readonly controlOrder = computed<readonly ToolbarControl[]>(() => [
    'prev',
    'next',
    ...this.actions(),
  ]);

  protected tabIndexFor(control: ToolbarControl): number {
    const order = this.controlOrder();
    const active = order.includes(this.focusedControl())
      ? this.focusedControl()
      : order[0];
    return control === active ? 0 : -1;
  }

  protected actionClass(action: GitApplyHunksOperation): string {
    return this.canApply()
      ? ACTION_CLASS[action]
      : `${ACTION_CLASS[action]} btn-disabled`;
  }

  protected actionText(action: GitApplyHunksOperation): string {
    return ACTION_TEXT[action];
  }

  protected actionLabel(action: GitApplyHunksOperation): string {
    return `${ACTION_TEXT[action]} hunk ${this.hunk().index + 1} of ${this.hunkCount()}`;
  }

  protected actionTitle(action: GitApplyHunksOperation): string {
    if (!this.mutable()) return 'This comparison is read-only';
    if (action === 'stage') return 'Stage this hunk';
    if (action === 'revert') return 'Revert this hunk in the working tree';
    return 'Remove this hunk from the index';
  }

  protected step(delta: 1 | -1): void {
    if (!this.canStep()) return;
    const count = this.hunkCount();
    this.navigate.emit((this.hunk().index + delta + count) % count);
  }

  /**
   * Stage and unstage go straight through: each is the other's inverse. Revert
   * opens the confirmation and writes nothing yet.
   */
  protected onAction(action: GitApplyHunksOperation, event: MouseEvent): void {
    if (!this.canApply()) return;
    if (action === 'revert') {
      this.pendingRevertToken = this.snapshotToken();
      const invoker = event.currentTarget;
      this.dialog().open(
        invoker instanceof HTMLElement ? invoker : document.body,
      );
      return;
    }
    void this.apply(action, this.snapshotToken());
  }

  /** Revert the hunk the dialog was opened for, with that moment's token. */
  protected confirmRevert(): void {
    const token = this.pendingRevertToken;
    this.pendingRevertToken = null;
    if (token === null || !this.mutable() || this.inFlight()) return;
    void this.apply('revert', token);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const order = this.controlOrder();
    const from = Math.max(0, order.indexOf(this.domFocusedControl() ?? order[0]));
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (from + 1) % order.length;
        break;
      case 'ArrowLeft':
        next = (from - 1 + order.length) % order.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = order.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const control = order[next];
    this.focusedControl.set(control);
    this.controls()
      .find((ref) => ref.nativeElement.dataset['control'] === control)
      ?.nativeElement.focus();
  }

  /** Read from the DOM so arrowing from a clicked button starts there. */
  private domFocusedControl(): ToolbarControl | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const id = active.dataset['control'];
    return this.controlOrder().find((c) => c === id) ?? null;
  }

  private async apply(
    operation: GitApplyHunksOperation,
    token: string,
  ): Promise<void> {
    this.inFlight.set(true);
    try {
      const result = await this.reviewDiff.applyHunks({
        key: this.entryKey(),
        operation,
        hunkIndices: [this.hunk().index],
        snapshotToken: token,
      });
      const diff = this.entryDiff();
      this.outcome.set(
        result.success
          ? { diff, kind: 'consumed' }
          : {
              diff,
              kind: 'refused',
              message: result.message || REFUSED_FALLBACK_MESSAGE,
            },
      );
    } catch (error: unknown) {
      // `applyHunks` resolves its failures; a throw is a frontend defect whose
      // text was never sanitized for display.
      console.error('[HunkToolbarComponent] applyHunks threw', error);
      this.outcome.set({
        diff: this.entryDiff(),
        kind: 'refused',
        message: REFUSED_FALLBACK_MESSAGE,
      });
    } finally {
      this.inFlight.set(false);
    }
    // The pressed button is gone once the chip replaces the toolbar; move
    // focus to the reason instead of leaving it on <body>.
    if (this.refusal() !== null) {
      afterNextRender(() => this.refusalChip()?.nativeElement.focus(), {
        injector: this.injector,
      });
    }
  }
}
