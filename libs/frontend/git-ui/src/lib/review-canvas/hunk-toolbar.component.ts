import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
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

const REFUSAL_CHIP_CLASS =
  'inline-flex items-center gap-1.5 border border-error/60 bg-error/10 rounded px-2 py-0.5 basis-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

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
 * Focus the roving tab stop of the hunk row nearest `ordinal` (preferring the
 * row now at that ordinal, then earlier ones), else the nearest focusable
 * ancestor of `container`.
 */
function focusNearestHunkStop(container: HTMLElement, ordinal: number): void {
  const rows = Array.from(
    container.querySelectorAll<HTMLElement>(':scope > [data-hunk-index]'),
  );
  const byDistance = rows
    .map((row) => ({ row, index: Number(row.dataset['hunkIndex']) }))
    .filter(({ index }) => Number.isInteger(index))
    .sort(
      (a, b) =>
        Math.abs(a.index - ordinal) - Math.abs(b.index - ordinal) ||
        b.index - a.index,
    );
  for (const { row } of byDistance) {
    const stop = row.querySelector<HTMLElement>(
      '[role="toolbar"] [tabindex="0"]',
    );
    if (stop) {
      stop.focus();
      return;
    }
  }
  container.parentElement?.closest<HTMLElement>('[tabindex]')?.focus();
}

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
 *   until then too, so one snapshot is never applied twice. After the re-read
 *   the buttons return and the chip stays until it is dismissed or the next
 *   apply supersedes it.
 * - A success usually removes the hunk, and the re-read then destroys this
 *   row with focus still on the pressed button. Focus moves to the nearest
 *   remaining hunk's toolbar (or the nearest focusable ancestor) instead of
 *   falling to `<body>`.
 */
@Component({
  selector: 'ptah-hunk-toolbar',
  standalone: true,
  imports: [LucideAngularModule, GitConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(focusin)': 'focusWithin = true',
    '(focusout)': 'onFocusOut($event)',
  },
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
          [class]="refusalChipClass()"
          role="alert"
          tabindex="-1"
          data-testid="hunk-refused"
          [attr.data-awaiting-reread]="awaitingReread() || null"
        >
          <span class="text-error text-xs" aria-hidden="true">⚠</span>
          <span class="min-w-0 flex-1 font-medium text-base-content">{{
            message
          }}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs h-5 min-h-5 px-1"
            aria-label="Dismiss error"
            data-testid="hunk-refused-dismiss"
            (click)="dismissRefusal()"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      }
      @if (!awaitingReread()) {
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Outlives this component, for the focus hand-off scheduled on destroy. */
  private readonly environmentInjector = inject(EnvironmentInjector);

  /**
   * The element holding every hunk row of this file, captured when an apply
   * succeeds — after the re-read removes this row it can no longer be reached
   * from it.
   */
  private hunkRowsContainer: HTMLElement | null = null;

  /**
   * Whether focus is inside this row. Cleared only when focus moves to another
   * element: a focused node removed with the row may not report a focusout.
   */
  protected focusWithin = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.handOffFocus());
  }

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
  private readonly refusalMessage = signal<string | null>(null);
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

  /**
   * The last refusal's sanitized reason. It outlives the forced re-read: it
   * is the only feedback for a refused apply, so it stays until the user
   * dismisses it or a new apply supersedes it (parity row 146).
   */
  protected readonly refusal = this.refusalMessage.asReadonly();

  /** A refused apply whose re-read has not landed: its buttons stay away. */
  protected readonly awaitingReread = computed(
    () => this.currentOutcome()?.kind === 'refused',
  );

  /**
   * The glow is an infinite box-shadow animation, so it runs only while the
   * re-read is pending; the chip that stays afterwards is static.
   */
  protected readonly refusalChipClass = computed(
    () =>
      `${REFUSAL_CHIP_CLASS}${this.awaitingReread() ? ' motion-safe:animate-glow-urgent' : ''}`,
  );

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
    const from = Math.max(
      0,
      order.indexOf(this.domFocusedControl() ?? order[0]),
    );
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

  /**
   * Remove the refusal chip. Focus goes to the toolbar's tab stop, or, while
   * the re-read is still pending and the toolbar is away, to the nearest
   * focusable ancestor, so it never falls to `<body>`.
   */
  protected dismissRefusal(): void {
    this.refusalMessage.set(null);
    afterNextRender(
      () => {
        const host = this.host.nativeElement;
        const stop =
          host.querySelector<HTMLElement>('[role="toolbar"] [tabindex="0"]') ??
          host.parentElement?.closest<HTMLElement>('[tabindex]');
        stop?.focus();
      },
      { injector: this.injector },
    );
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && !this.host.nativeElement.contains(next)) {
      this.focusWithin = false;
    }
  }

  /** Read from the DOM so arrowing from a clicked button starts there. */
  private domFocusedControl(): ToolbarControl | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const id = active.dataset['control'];
    return this.controlOrder().find((c) => c === id) ?? null;
  }

  /**
   * Runs on destroy. When this row goes away because its own successful apply
   * removed the hunk, and focus went with it, focus the nearest remaining
   * hunk's tab stop — the same ordinal (the next hunk, renumbered) or the one
   * before it — else the nearest focusable ancestor. Focus the user has
   * already moved to a live element is left alone.
   */
  private handOffFocus(): void {
    const container = this.hunkRowsContainer;
    // The raw outcome: the re-read that destroys this row has already ended
    // `currentOutcome`.
    if (
      !container ||
      !this.focusWithin ||
      this.outcome()?.kind !== 'consumed'
    ) {
      return;
    }
    const ordinal = this.hunk().index;
    afterNextRender(
      () => {
        const active = document.activeElement;
        if (!container.isConnected) return;
        if (active && active !== document.body && active.isConnected) return;
        focusNearestHunkStop(container, ordinal);
      },
      { injector: this.environmentInjector },
    );
  }

  private async apply(
    operation: GitApplyHunksOperation,
    token: string,
  ): Promise<void> {
    this.inFlight.set(true);
    // A new apply supersedes the last refusal.
    this.refusalMessage.set(null);
    try {
      const result = await this.reviewDiff.applyHunks({
        key: this.entryKey(),
        operation,
        hunkIndices: [this.hunk().index],
        snapshotToken: token,
      });
      const diff = this.entryDiff();
      if (result.success) {
        this.hunkRowsContainer =
          this.host.nativeElement.closest('[data-hunk-index]')?.parentElement ??
          null;
      }
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
    const outcome = this.outcome();
    if (outcome?.kind === 'refused') this.refusalMessage.set(outcome.message);
    // The pressed button is gone once the chip replaces the toolbar; move
    // focus to the reason instead of leaving it on <body>.
    if (this.refusal() !== null) {
      afterNextRender(() => this.refusalChip()?.nativeElement.focus(), {
        injector: this.injector,
      });
    }
  }
}
