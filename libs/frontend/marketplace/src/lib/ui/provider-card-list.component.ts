import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  CircleAlert,
  Inbox,
  LucideAngularModule,
  RefreshCw,
} from 'lucide-angular';
import { BrandMarkComponent } from '@ptah-extension/ui';

import { PTAH_SESSIONS_LABEL } from '../data/coverage';
import type { ProviderRow } from '../data/provider-row';
import {
  isProviderRowSelectable,
  providerRemovalAction,
  providerRowCheckboxLabel,
  providerRowFixCommand,
  providerRowKindLabel,
  providerRowLockReason,
  withRefSelected,
} from './provider-table.component';
import { RemovalLockBadgeComponent } from './removal-lock-badge.component';
import { StatusPillComponent } from './status-pill.component';
import { TargetMarksComponent } from './target-marks.component';

const SKELETON_CARDS = [0, 1, 2] as const;

/**
 * Installed servers as a list of cards — the compact-tier equivalent of
 * `ProviderTableComponent` (plan C8 `ProviderCardList`).
 *
 * Same contract as the table minus sorting (the compact tier has no column
 * headers): the page owns rows, selection and the active row. A
 * `<ul role="list">` — the explicit role keeps list semantics where a
 * `list-style: none` reset would drop them in WebKit.
 *
 * Each card: checkbox ("Select <name>", disabled with the reason on blocked
 * and `manage-link` rows), brand mark, the name as the card's open control
 * (its hit area covers the card), status pill, origin, CLI marks or
 * "Ptah sessions", and the removal button or lock badge.
 *
 * Stacking: the lock badge's popover renders in place (`z-50`), so no card
 * ancestor may form a stacking context or a `fixed` containing block while
 * it is open. The action wrapper is only `relative` (it follows the name's
 * hit area in tree order), and the hover lift is dropped — without a
 * transition — while a control in the card is expanded; the popover's
 * backdrop keeps the card hovered for as long as it is open.
 *
 * @example
 * ```html
 * <ptah-provider-card-list
 *   [rows]="visibleRows()"
 *   [selected]="selection()"
 *   [activeRef]="activeRef()"
 *   (selectionChange)="selection.set($event)"
 *   (openRequested)="openDetail($event.ref)"
 *   (removeRequested)="remove($event)"
 * />
 * ```
 */
@Component({
  selector: 'ptah-provider-card-list',
  standalone: true,
  imports: [
    LucideAngularModule,
    BrandMarkComponent,
    RemovalLockBadgeComponent,
    StatusPillComponent,
    TargetMarksComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @switch (state()) {
      @case ('loading') {
        <div
          role="status"
          aria-busy="true"
          class="space-y-2"
          data-testid="provider-cards-loading"
        >
          <span class="sr-only">Loading {{ label() }}…</span>
          @for (card of skeletonCards; track card) {
            <div
              class="flex items-center gap-3 rounded-xl border border-base-300 bg-base-200 p-3"
              aria-hidden="true"
            >
              <div class="skeleton h-6 w-6 rounded-md"></div>
              <div class="flex-1 space-y-1.5">
                <div class="skeleton h-4 w-1/2 rounded"></div>
                <div class="skeleton h-3 w-1/3 rounded"></div>
              </div>
            </div>
          }
        </div>
      }
      @case ('error') {
        <div
          role="alert"
          class="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="provider-cards-error"
        >
          <lucide-angular
            [img]="ErrorIcon"
            class="h-6 w-6 text-error"
            aria-hidden="true"
          />
          <p class="text-sm font-medium text-base-content">
            Could not load {{ label() }}
          </p>
          @if (errorMessage()) {
            <p class="text-xs text-base-content-muted">{{ errorMessage() }}</p>
          }
          <button
            type="button"
            class="btn btn-outline btn-sm gap-1"
            data-testid="provider-cards-retry"
            (click)="retryRequested.emit()"
          >
            <lucide-angular
              [img]="RetryIcon"
              class="h-3.5 w-3.5"
              aria-hidden="true"
            />
            Retry
          </button>
        </div>
      }
      @default {
        @if (rows().length === 0) {
          <div
            class="flex flex-col items-center gap-2 px-4 py-8 text-center"
            data-testid="provider-cards-empty"
          >
            <lucide-angular
              [img]="EmptyIcon"
              class="h-6 w-6 text-base-content-muted"
              aria-hidden="true"
            />
            <p class="text-sm font-medium text-base-content">
              {{ emptyTitle() }}
            </p>
            @if (emptyDetail()) {
              <p class="text-xs text-base-content-muted">{{ emptyDetail() }}</p>
            }
            @if (emptyActionLabel(); as actionLabel) {
              <button
                type="button"
                class="btn btn-primary btn-sm"
                data-testid="provider-cards-empty-action"
                (click)="emptyActionRequested.emit()"
              >
                {{ actionLabel }}
              </button>
            }
          </div>
        } @else {
          <ul
            role="list"
            class="space-y-2"
            [attr.aria-label]="label()"
            data-testid="provider-cards"
          >
            @for (row of rows(); track row.ref) {
              <li
                class="relative rounded-xl border bg-base-200 p-3 transition-transform duration-150 hover:-translate-y-px has-[[aria-expanded=true]]:transform-none has-[[aria-expanded=true]]:transition-none motion-reduce:transition-none motion-reduce:hover:transform-none"
                [class]="cardClass(row.ref)"
                [attr.aria-current]="row.ref === activeRef() ? 'true' : null"
                [attr.data-active]="row.ref === activeRef()"
                [attr.data-ref]="row.ref"
                data-testid="provider-card"
              >
                <div class="flex items-start gap-2">
                  <input
                    #cardBox
                    type="checkbox"
                    class="checkbox checkbox-xs relative z-10 mt-1"
                    data-testid="provider-card-checkbox"
                    [attr.aria-label]="checkboxLabel(row)"
                    [attr.title]="isSelectable(row) ? null : checkboxLabel(row)"
                    [checked]="isSelectable(row) && selected().has(row.ref)"
                    [disabled]="!isSelectable(row)"
                    (change)="toggleRow(row, cardBox.checked)"
                  />
                  <ptah-brand-mark
                    [brandSlug]="row.brand"
                    [label]="row.title"
                    size="sm"
                  />
                  <div class="min-w-0 flex-1">
                    <button
                      type="button"
                      class="block max-w-full truncate text-left text-sm font-medium text-base-content after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      [attr.title]="row.title"
                      data-testid="provider-card-open"
                      (click)="openRequested.emit(row)"
                    >
                      {{ row.title }}
                    </button>
                    <p class="truncate text-[11px] text-base-content-muted">
                      {{ kindLabel(row) }} · {{ row.originLabel }}
                    </p>
                  </div>
                  <ptah-status-pill
                    class="shrink-0"
                    [status]="row.status"
                    [statusText]="row.statusText"
                  />
                </div>
                <div class="mt-2 flex items-center gap-2 pl-6">
                  @if (row.kind === 'config') {
                    <ptah-target-marks
                      [targets]="row.targets"
                      [maxVisible]="3"
                    />
                  } @else {
                    <span
                      class="text-xs text-base-content-muted"
                      data-testid="provider-card-session-targets"
                      >{{ sessionTargetsLabel }}</span
                    >
                  }
                  <div class="relative ml-auto">
                    @if (removalAction(row); as action) {
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs gap-1"
                        data-testid="provider-card-remove"
                        [attr.aria-label]="action.ariaLabel"
                        [disabled]="busyRefs().has(row.ref)"
                        [attr.aria-busy]="busyRefs().has(row.ref)"
                        (click)="removeRequested.emit(row)"
                      >
                        @if (busyRefs().has(row.ref)) {
                          <span
                            class="loading loading-spinner loading-xs"
                            aria-hidden="true"
                          ></span>
                        } @else {
                          <lucide-angular
                            [img]="action.icon"
                            class="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        }
                        {{ action.label }}
                      </button>
                    } @else {
                      <ptah-removal-lock-badge
                        [serverName]="row.title"
                        [reason]="lockReason(row) ?? ''"
                        [fixCommand]="fixCommand(row)"
                      />
                    }
                  </div>
                </div>
              </li>
            }
          </ul>
        }
      }
    }
  `,
})
export class ProviderCardListComponent {
  /** The rows to show, already filtered and sorted by the page. */
  public readonly rows = input.required<readonly ProviderRow[]>();

  /** Refs of the selected rows. */
  public readonly selected = input<ReadonlySet<string>>(new Set());

  /** Ref of the keyboard-active card, or `null`. */
  public readonly activeRef = input<string | null>(null);

  /** Refs whose removal is running: their button is disabled. */
  public readonly busyRefs = input<ReadonlySet<string>>(new Set());

  /** Load state of the slice the rows come from. @default 'ready' */
  public readonly state = input<'loading' | 'ready' | 'error'>('ready');

  /** Shown under the error title. */
  public readonly errorMessage = input<string | null>(null);

  /** The list's accessible name and the loading/error noun. */
  public readonly label = input<string>('installed servers');

  /** Empty-state title. @default 'No servers to show' */
  public readonly emptyTitle = input<string>('No servers to show');

  /** Empty-state detail line. */
  public readonly emptyDetail = input<string | null>(null);

  /** Empty-state button label; no button when `null`. */
  public readonly emptyActionLabel = input<string | null>(null);

  /** The new selection after a checkbox change. */
  public readonly selectionChange = output<ReadonlySet<string>>();

  /** The user asked to open a card's detail. */
  public readonly openRequested = output<ProviderRow>();

  /** The user asked to remove (or disconnect) a card's server. */
  public readonly removeRequested = output<ProviderRow>();

  /** The user asked to retry the failed load. */
  public readonly retryRequested = output<void>();

  /** The user pressed the empty-state button. */
  public readonly emptyActionRequested = output<void>();

  protected readonly skeletonCards = SKELETON_CARDS;
  /** Connections and account connectors reach Ptah sessions only (A5). */
  protected readonly sessionTargetsLabel = PTAH_SESSIONS_LABEL;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly RetryIcon = RefreshCw;
  protected readonly EmptyIcon = Inbox;

  protected readonly isSelectable = isProviderRowSelectable;
  protected readonly checkboxLabel = providerRowCheckboxLabel;
  protected readonly removalAction = providerRemovalAction;
  protected readonly fixCommand = providerRowFixCommand;
  protected readonly lockReason = providerRowLockReason;
  protected readonly kindLabel = providerRowKindLabel;

  protected cardClass(ref: string): string {
    return ref === this.activeRef()
      ? 'border-primary/60 bg-primary/10'
      : 'border-base-300';
  }

  protected toggleRow(row: ProviderRow, checked: boolean): void {
    if (!isProviderRowSelectable(row)) return;
    this.selectionChange.emit(
      withRefSelected(this.selected(), row.ref, checked),
    );
  }
}
