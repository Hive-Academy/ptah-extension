import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  LucideAngularModule,
  RefreshCw,
  TriangleAlert,
} from 'lucide-angular';

import type {
  NeedsAttentionItem,
  NeedsAttentionTarget,
} from '../data/attention';
import { marketplaceRouteLink } from '../shell/marketplace-route-url';

/**
 * Router commands for an item's "Review" link.
 *
 * - `server`: that server's detail under the installed list
 *   (`/marketplace/servers/<serverRef>`).
 * - `servers`: the installed list.
 * - `smithery`: the Smithery source page.
 * - `harness`: Skills & Plugins, the page that carries the harness health
 *   badge and its repair flow (`skills-section.component.ts:69`); there is no
 *   harness route of its own.
 */
export function needsAttentionLink(target: NeedsAttentionTarget): string[] {
  switch (target.kind) {
    case 'server':
      return [...marketplaceRouteLink({ page: 'servers' }), target.ref];
    case 'servers':
      return marketplaceRouteLink({ page: 'servers' });
    case 'smithery':
      return marketplaceRouteLink({ page: 'servers', source: 'smithery' });
    case 'harness':
      return marketplaceRouteLink({ page: 'skills' });
  }
}

/** Per-instance suffix for the heading id. */
let nextNeedsAttentionId = 0;

/**
 * The Overview's "Needs attention" panel (plan C8 `NeedsAttention`): one
 * entry per `NeedsAttentionItem` (`data/attention.ts`), each with a severity
 * icon plus a visually hidden severity word (never colour alone), the title,
 * the detail and a "Review" `routerLink` to the route that fixes it.
 *
 * States: `loading` (skeleton), `error` (message and a Retry output), and an
 * empty state when nothing needs attention. The empty state has no call to
 * action: there is nothing to do.
 *
 * Presentational apart from `RouterLink` (a directive, not an injected
 * service): the page derives the items with `needsAttention()`.
 *
 * @example
 * ```html
 * <ptah-needs-attention
 *   [items]="attentionItems()"
 *   [state]="attentionState()"
 *   (retryRequested)="reload()"
 * />
 * ```
 */
@Component({
  selector: 'ptah-needs-attention',
  standalone: true,
  imports: [LucideAngularModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="rounded-xl border border-base-300 bg-base-200"
      [attr.aria-labelledby]="headingId"
      [attr.aria-busy]="state() === 'loading'"
      data-testid="needs-attention"
    >
      <h2
        [id]="headingId"
        class="flex items-center gap-2 px-3 pb-1 pt-3 text-sm font-semibold text-base-content"
      >
        <lucide-angular
          [img]="WarningIcon"
          class="h-4 w-4 text-warning"
          aria-hidden="true"
        />
        {{ heading() }}
        @if (state() === 'ready' && items().length > 0) {
          <span
            class="badge badge-ghost badge-sm font-normal tabular-nums"
            data-testid="needs-attention-count"
            >{{ items().length }}</span
          >
        }
      </h2>

      @switch (state()) {
        @case ('loading') {
          <div
            class="space-y-2 px-3 pb-3 pt-1"
            data-testid="needs-attention-loading"
          >
            <span class="sr-only">Loading…</span>
            @for (line of skeletonLines; track line) {
              <div class="flex items-center gap-2" aria-hidden="true">
                <div class="skeleton h-4 w-4 rounded-full"></div>
                <div class="skeleton h-4 flex-1 rounded"></div>
              </div>
            }
          </div>
        }
        @case ('error') {
          <div
            role="alert"
            class="space-y-2 px-3 pb-3 pt-1"
            data-testid="needs-attention-error"
          >
            <p class="flex items-start gap-1.5 text-xs text-error">
              <lucide-angular
                [img]="ErrorIcon"
                class="mt-px h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>{{
                errorMessage() || 'Could not check what needs attention.'
              }}</span>
            </p>
            <button
              type="button"
              class="btn btn-outline btn-xs gap-1"
              data-testid="needs-attention-retry"
              (click)="retryRequested.emit()"
            >
              <lucide-angular
                [img]="RetryIcon"
                class="h-3 w-3"
                aria-hidden="true"
              />
              Retry
            </button>
          </div>
        }
        @default {
          @if (items().length === 0) {
            <p
              class="flex items-center gap-2 px-3 pb-3 pt-1 text-xs text-base-content-muted"
              data-testid="needs-attention-empty"
            >
              <lucide-angular
                [img]="AllClearIcon"
                class="h-4 w-4 text-success"
                aria-hidden="true"
              />
              Nothing needs attention.
            </p>
          } @else {
            <ul
              class="space-y-0.5 px-1 pb-2"
              data-testid="needs-attention-list"
            >
              @for (entry of entries(); track entry.item.id) {
                <li
                  class="flex items-start gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-base-300/60"
                  [attr.data-severity]="entry.item.severity"
                  [attr.data-source]="entry.item.source"
                  data-testid="needs-attention-item"
                >
                  <span
                    class="mt-0.5 inline-flex shrink-0"
                    [class.text-error]="entry.item.severity === 'error'"
                    [class.text-warning]="entry.item.severity === 'warning'"
                    aria-hidden="true"
                    data-testid="needs-attention-icon"
                  >
                    <lucide-angular
                      [img]="
                        entry.item.severity === 'error'
                          ? ErrorItemIcon
                          : WarningIcon
                      "
                      class="h-4 w-4"
                    />
                  </span>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-medium text-base-content">
                      <span class="sr-only">{{
                        entry.item.severity === 'error' ? 'Error:' : 'Warning:'
                      }}</span>
                      {{ entry.item.title }}
                    </p>
                    @if (entry.item.detail) {
                      <p
                        class="truncate text-xs text-base-content-muted"
                        [attr.title]="entry.item.detail"
                      >
                        {{ entry.item.detail }}
                      </p>
                    }
                  </div>
                  <a
                    class="btn btn-ghost btn-xs shrink-0"
                    [routerLink]="entry.link"
                    [attr.aria-label]="'Review ' + entry.item.title"
                    data-testid="needs-attention-review"
                    >Review</a
                  >
                </li>
              }
            </ul>
          }
        }
      }
    </section>
  `,
})
export class NeedsAttentionComponent {
  /** The items, in the order `needsAttention()` returns them. */
  public readonly items = input.required<readonly NeedsAttentionItem[]>();

  /** Load state of the sources the items come from. @default 'ready' */
  public readonly state = input<'loading' | 'ready' | 'error'>('ready');

  /** Shown in the error state; a generic line when absent. */
  public readonly errorMessage = input<string | null>(null);

  /** The panel heading. @default 'Needs attention' */
  public readonly heading = input<string>('Needs attention');

  /** The user asked to retry the failed load. */
  public readonly retryRequested = output<void>();

  protected readonly WarningIcon = TriangleAlert;
  protected readonly ErrorItemIcon = CircleX;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly AllClearIcon = CircleCheck;
  protected readonly RetryIcon = RefreshCw;
  protected readonly skeletonLines = [0, 1, 2] as const;
  protected readonly headingId = `ptah-needs-attention-${nextNeedsAttentionId++}`;

  /** Each item with its link commands, computed once per items change. */
  protected readonly entries = computed(() =>
    this.items().map((item) => ({
      item,
      link: needsAttentionLink(item.target),
    })),
  );
}
