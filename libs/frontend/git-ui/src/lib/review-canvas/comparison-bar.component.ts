import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  OnInit,
  model,
  output,
  signal,
} from '@angular/core';
import { ChevronDown, LucideAngularModule } from 'lucide-angular';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { GitBranchesService } from '../services/git-branches.service';
import { GitReviewService } from '../services/git-review.service';
import {
  ReviewNavigationService,
  type ReviewComparisonKind,
} from '../services/review-navigation.service';

/** The same key the existing diff view persists its layout under. */
const DIFF_LAYOUT_SETTING_KEY = 'diff.renderSideBySide';

/** Running totals of the comparison on screen. */
export interface ComparisonTotals {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
  readonly binaryFiles: number;
}

const COMPARISON_LABEL: Readonly<Record<ReviewComparisonKind, string>> = {
  worktree: 'Working tree',
  staged: 'Staged',
  branch: 'Branch review',
};

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

/**
 * ComparisonBarComponent — the top row of the review canvas (implementation-plan
 * Component 24, design-spec §6.1, §6.2).
 *
 * - The comparison picker (`NativePopoverComponent` chrome): Working tree,
 *   Staged, or Branch review with its base/head selects (`GitReviewService`).
 *   A historical comparison (a commit or stash opened from History or the stash
 *   popover) shows its label; picking any option leaves it.
 * - The path filter, owned by the canvas (`filter` in, `filterChange` out).
 * - Split / Unified (`aria-pressed`), two-way bound as `sideBySide` and
 *   persisted as `diff.renderSideBySide` through `settings:get/set`, the key the
 *   existing diff view uses, so the choice carries over.
 * - The totals. The row wraps rather than clipping at narrow dock widths.
 */
@Component({
  selector: 'ptah-comparison-bar',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center gap-2 border-b border-base-content/10 bg-base-200 px-2 py-1.5 text-xs"
      data-testid="comparison-bar"
    >
      <ptah-native-popover
        [isOpen]="pickerOpen()"
        placement="bottom-start"
        [hasBackdrop]="true"
        backdropClass="transparent"
        (closed)="pickerOpen.set(false)"
      >
        <button
          trigger
          type="button"
          class="btn btn-ghost btn-xs max-w-[16rem] gap-1 {{ focusRing }}"
          aria-haspopup="true"
          [attr.aria-expanded]="pickerOpen()"
          [attr.aria-label]="'Comparison: ' + currentLabel()"
          [title]="currentLabel()"
          data-testid="comparison-trigger"
          (click)="pickerOpen.set(!pickerOpen())"
        >
          <span class="truncate">{{ currentLabel() }}</span>
          <lucide-angular
            [img]="ChevronDownIcon"
            class="h-3 w-3 shrink-0"
            aria-hidden="true"
          />
        </button>
        <div
          content
          class="w-64 p-2 text-xs"
          role="group"
          aria-label="Choose a comparison"
        >
          @for (kind of simpleKinds; track kind) {
            <button
              type="button"
              class="btn btn-ghost btn-xs w-full justify-start {{ focusRing }}"
              [class.btn-active]="scopeKind() === kind"
              [attr.aria-pressed]="scopeKind() === kind"
              [attr.data-testid]="'comparison-option-' + kind"
              (click)="pick(kind)"
            >
              {{ label(kind) }}
            </button>
          }
          <div class="my-1 border-t border-base-content/10"></div>
          <button
            type="button"
            class="btn btn-ghost btn-xs w-full justify-start {{ focusRing }}"
            [class.btn-active]="scopeKind() === 'branch'"
            [attr.aria-pressed]="scopeKind() === 'branch'"
            data-testid="comparison-option-branch"
            (click)="pick('branch')"
          >
            Branch review…
          </button>
          @if (scopeKind() === 'branch') {
            <div class="mt-1 flex items-center gap-1 px-1">
              <select
                class="select select-bordered select-xs min-w-0 flex-1"
                aria-label="Review base"
                data-testid="comparison-base"
                (change)="review.setBase(selectValue($event))"
              >
                @for (branch of branches.localBranches(); track branch.name) {
                  <option
                    [value]="branch.name"
                    [selected]="branch.name === review.base()"
                  >
                    {{ branch.name }}
                  </option>
                }
              </select>
              <span class="shrink-0 text-base-content-muted" aria-hidden="true"
                >←</span
              >
              <select
                class="select select-bordered select-xs min-w-0 flex-1"
                aria-label="Review head"
                data-testid="comparison-head"
                (change)="review.setHead(selectValue($event))"
              >
                <option value="HEAD" [selected]="review.head() === 'HEAD'">
                  HEAD
                </option>
                @for (branch of branches.localBranches(); track branch.name) {
                  <option
                    [value]="branch.name"
                    [selected]="branch.name === review.head()"
                  >
                    {{ branch.name }}
                  </option>
                }
              </select>
            </div>
          }
        </div>
      </ptah-native-popover>

      <input
        type="text"
        class="input input-bordered input-xs w-32 min-w-[6rem] max-w-[12rem] flex-1"
        placeholder="Filter files…"
        aria-label="Filter changed files"
        data-testid="comparison-filter"
        [value]="filter()"
        (input)="filterChange.emit(inputValue($event))"
      />

      <div
        class="flex items-center gap-0.5"
        role="group"
        aria-label="Diff layout"
      >
        <button
          type="button"
          class="btn btn-ghost btn-xs {{ focusRing }}"
          [class.btn-active]="sideBySide()"
          [attr.aria-pressed]="sideBySide()"
          data-testid="layout-split"
          (click)="setSideBySide(true)"
        >
          <span aria-hidden="true">⊞</span> Split
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs {{ focusRing }}"
          [class.btn-active]="!sideBySide()"
          [attr.aria-pressed]="!sideBySide()"
          data-testid="layout-unified"
          (click)="setSideBySide(false)"
        >
          <span aria-hidden="true">▤</span> Unified
        </button>
      </div>

      @if (totals(); as t) {
        <!-- Full base-content ink: --bcm is measured against base-100, and on
             this row's base-200 the light theme falls just under 4.5:1. -->
        <span
          class="ml-auto whitespace-nowrap text-base-content"
          data-testid="comparison-totals"
        >
          <span class="sr-only">{{ totalsLabel() }}</span>
          <span aria-hidden="true"
            >{{ count(t.files) }} {{ t.files === 1 ? 'file' : 'files' }} ·
            <span class="diff-add-text">+{{ count(t.additions) }}</span>
            <span class="diff-del-text">−{{ count(t.deletions) }}</span>
            @if (t.binaryFiles > 0) {
              · {{ count(t.binaryFiles) }} binary
            }
          </span>
        </span>
      }
    </div>
  `,
})
export class ComparisonBarComponent implements OnInit {
  private readonly vscode = inject(VSCodeService);
  private readonly navigation = inject(ReviewNavigationService);
  protected readonly review = inject(GitReviewService);
  protected readonly branches = inject(GitBranchesService);

  /** The filter text the canvas applies to the tree and the diff list. */
  readonly filter = input('');
  /** Totals of the comparison on screen; nothing is shown while unknown. */
  readonly totals = input<ComparisonTotals | null>(null);
  /** Split (true) or unified (false); loaded from and saved to settings. */
  readonly sideBySide = model(true);

  readonly filterChange = output<string>();

  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly focusRing = FOCUS_RING;
  protected readonly simpleKinds: readonly ReviewComparisonKind[] = [
    'worktree',
    'staged',
  ];

  protected readonly pickerOpen = signal(false);

  /** Set by a toggle: a late settings read must not override the user. */
  private layoutChangedByUser = false;
  private destroyed = false;

  private readonly scope = computed(() => this.navigation.current().scope);
  protected readonly scopeKind = computed(() => this.scope().kind);

  protected readonly currentLabel = computed(() => {
    const scope = this.scope();
    return scope.kind === 'historical'
      ? scope.label
      : COMPARISON_LABEL[scope.kind];
  });

  protected readonly totalsLabel = computed(() => {
    const t = this.totals();
    if (!t) return null;
    const parts = [
      `${t.files} ${t.files === 1 ? 'file' : 'files'} changed`,
      `${t.additions} additions`,
      `${t.deletions} deletions`,
    ];
    if (t.binaryFiles > 0) parts.push(`${t.binaryFiles} binary`);
    return parts.join(', ');
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  ngOnInit(): void {
    void this.loadLayoutPreference();
  }

  protected label(kind: ReviewComparisonKind): string {
    return COMPARISON_LABEL[kind];
  }

  protected count(value: number): string {
    return value.toLocaleString();
  }

  /**
   * Switch the comparison. Branch review keeps the picker open for its
   * base/head selects; the others close it.
   */
  protected pick(kind: ReviewComparisonKind): void {
    this.review.setMode(kind === 'branch' ? 'branch-review' : 'working-tree');
    this.navigation.selectComparison(kind);
    if (kind !== 'branch') this.pickerOpen.set(false);
  }

  protected setSideBySide(sideBySide: boolean): void {
    if (this.sideBySide() === sideBySide) return;
    this.layoutChangedByUser = true;
    this.sideBySide.set(sideBySide);
    void this.persistLayoutPreference(sideBySide);
  }

  protected inputValue(event: Event): string {
    return event.target instanceof HTMLInputElement ? event.target.value : '';
  }

  protected selectValue(event: Event): string {
    return event.target instanceof HTMLSelectElement ? event.target.value : '';
  }

  private async loadLayoutPreference(): Promise<void> {
    try {
      const result = await rpcCall<{ value: unknown }>(
        this.vscode,
        'settings:get',
        { key: DIFF_LAYOUT_SETTING_KEY },
      );
      if (
        !this.destroyed &&
        !this.layoutChangedByUser &&
        result.success &&
        typeof result.data?.value === 'boolean'
      ) {
        this.sideBySide.set(result.data.value);
      }
    } catch (error: unknown) {
      // A missing or unreadable preference keeps the default; the toggle
      // still works. Not surfaced, matching the existing diff view.
      console.warn('[ComparisonBar] settings:get failed', error);
    }
  }

  private async persistLayoutPreference(sideBySide: boolean): Promise<void> {
    try {
      await rpcCall(this.vscode, 'settings:set', {
        key: DIFF_LAYOUT_SETTING_KEY,
        value: sideBySide,
      });
    } catch (error: unknown) {
      // The layout already changed on screen; only its persistence failed.
      console.warn('[ComparisonBar] settings:set failed', error);
    }
  }
}
