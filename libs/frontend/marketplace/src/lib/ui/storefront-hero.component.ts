import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, RotateCw, Sparkles } from 'lucide-angular';

import { STOREFRONT_SURFACE_CLASS } from './storefront-surface.styles';
import {
  TargetMarksComponent,
  type TargetMarkItem,
} from './target-marks.component';

/** Load state of one "Your stack" tile; each tile loads on its own. */
export type StackTileState = 'loading' | 'ready' | 'error';

/**
 * One "Your stack" snapshot tile. The page builds these from the stores'
 * real answers (installed servers, connected apps, installed skills, CLI
 * targets); the hero never invents a number.
 */
export interface StorefrontStackTile {
  /** Stable key; also what {@link StorefrontHeroComponent.retryTile} emits. */
  readonly id: string;
  readonly label: string;
  readonly state: StackTileState;
  /** The real count. Read only when `state` is `ready`. */
  readonly count: number | null;
  /** A short sub-line under the count ("2 need sign-in"); optional. */
  readonly detail?: string | null;
}

/** Heading level of the hero title. The hero title is the page's `<h1>`. */
export type StorefrontHeroHeadingLevel = 1 | 2;

/** A tile as the template draws it. */
interface StackTileView {
  readonly id: string;
  readonly label: string;
  readonly state: StackTileState;
  /** The formatted count, or `null` when the tile has no number to show. */
  readonly value: string | null;
  readonly detail: string | null;
}

let instanceCounter = 0;

const COUNT_FORMAT = new Intl.NumberFormat('en-US');

/**
 * A tile whose `ready` count is missing, negative or not a number has no
 * honest value: it renders the "—" of an unavailable tile, never a 0.
 */
function toTileView(tile: StorefrontStackTile): StackTileView {
  const count = tile.count;
  const valid =
    tile.state === 'ready' &&
    count !== null &&
    Number.isFinite(count) &&
    count >= 0;
  const detail = tile.detail?.trim() ?? '';
  return {
    id: tile.id,
    label: tile.label,
    state: tile.state,
    value: valid ? COUNT_FORMAT.format(Math.floor(count)) : null,
    detail: detail.length > 0 ? detail : null,
  };
}

/**
 * The wide-tier storefront header of the Marketplace (plan C8).
 *
 * Left: an eyebrow in the gold accent (`text-secondary` — the only gold on
 * the hero), the title, one sentence, and the page's calls to action through
 * the `[hero-actions]` slot. Right: a "Your stack" snapshot — one tile per
 * count the page passes in, each with its own loading / error state and a
 * Retry output — and the "Synced to" row: the CLI targets Ptah detected,
 * drawn through `ptah-target-marks` (brand marks from `CLI_TARGET_BRANDS`).
 *
 * The background is the storefront gradient
 * `from-base-200 via-base-100 to-primary/10`. The two columns sit side by
 * side once the Marketplace content region (`ptah-mp-content`) is 800px wide
 * and stack below that.
 *
 * Presentational: nothing is injected. There is deliberately no search field
 * here (no global ⌘K search) and no "My Stack" link: both were dropped.
 *
 * @example
 * ```html
 * <ptah-storefront-hero
 *   eyebrow="One-click connectors"
 *   heading="Connect the apps your agents use"
 *   [tiles]="stackTiles()"
 *   [syncedTargets]="detectedTargets()"
 *   (retryTile)="retry($event)"
 * >
 *   <a hero-actions class="btn btn-primary btn-sm" [routerLink]="…">Browse connectors</a>
 * </ptah-storefront-hero>
 * ```
 */
@Component({
  selector: 'ptah-storefront-hero',
  standalone: true,
  imports: [NgTemplateOutlet, LucideAngularModule, TargetMarksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      [class]="surfaceClass"
      [attr.aria-labelledby]="headingId"
      data-testid="storefront-hero"
    >
      <div class="ptah-storefront-hero__grid">
        <div class="flex min-w-0 flex-col gap-4">
          @if (visibleEyebrow(); as text) {
            <p
              class="inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-secondary/30 bg-secondary/10 px-3 py-1 text-xs font-medium text-secondary"
              data-testid="storefront-hero-eyebrow"
            >
              <lucide-angular
                [img]="SparklesIcon"
                class="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span class="truncate">{{ text }}</span>
            </p>
          }

          @switch (headingLevel()) {
            @case (2) {
              <h2
                [id]="headingId"
                [class]="headingClass"
                data-testid="storefront-hero-heading"
              >
                <ng-container [ngTemplateOutlet]="headingContent" />
              </h2>
            }
            @default {
              <h1
                [id]="headingId"
                [class]="headingClass"
                data-testid="storefront-hero-heading"
              >
                <ng-container [ngTemplateOutlet]="headingContent" />
              </h1>
            }
          }

          @if (visibleDescription(); as text) {
            <p
              class="max-w-2xl text-sm leading-relaxed text-base-content-muted"
              data-testid="storefront-hero-description"
            >
              {{ text }}
            </p>
          }

          <div
            class="flex flex-wrap items-center gap-2 empty:hidden"
            data-testid="storefront-hero-actions"
          >
            <ng-content select="[hero-actions]" />
          </div>
        </div>

        <div
          class="flex min-w-0 flex-col gap-4 rounded-xl border border-base-300 bg-base-200/90 p-4"
          data-testid="storefront-hero-stack"
        >
          @switch (headingLevel()) {
            @case (2) {
              <h3 [class]="stackHeadingClass">
                <ng-container [ngTemplateOutlet]="stackHeadingContent" />
              </h3>
            }
            @default {
              <h2 [class]="stackHeadingClass">
                <ng-container [ngTemplateOutlet]="stackHeadingContent" />
              </h2>
            }
          }

          @if (tileViews().length > 0) {
            <dl class="grid grid-cols-2 gap-2">
              @for (tile of tileViews(); track tile.id) {
                <div
                  class="flex min-w-0 flex-col gap-1 rounded-lg border border-base-300 bg-base-100 p-3"
                  [attr.data-tile]="tile.id"
                  [attr.data-state]="tile.state"
                  data-testid="storefront-hero-tile"
                >
                  <dt
                    class="truncate text-[11px] font-medium text-base-content-muted"
                  >
                    {{ tile.label }}
                  </dt>
                  <dd class="m-0 flex min-h-8 items-center gap-2">
                    @switch (tile.state) {
                      @case ('loading') {
                        <span
                          class="skeleton h-7 w-10 rounded"
                          aria-hidden="true"
                        ></span>
                        <span class="sr-only">Loading</span>
                      }
                      @case ('error') {
                        <span
                          class="text-2xl font-bold text-base-content-muted"
                          aria-hidden="true"
                          >—</span
                        >
                        <span class="sr-only">Unavailable</span>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs gap-1"
                          [attr.aria-label]="'Retry loading ' + tile.label"
                          data-testid="storefront-hero-tile-retry"
                          (click)="retryTile.emit(tile.id)"
                        >
                          <lucide-angular
                            [img]="RetryIcon"
                            class="h-3 w-3"
                            aria-hidden="true"
                          />
                          Retry
                        </button>
                      }
                      @default {
                        @if (tile.value; as value) {
                          <span
                            class="text-2xl font-bold tabular-nums text-base-content"
                            data-testid="storefront-hero-tile-count"
                            >{{ value }}</span
                          >
                        } @else {
                          <span
                            class="text-2xl font-bold text-base-content-muted"
                            aria-hidden="true"
                            >—</span
                          >
                          <span class="sr-only">Not available</span>
                        }
                      }
                    }
                  </dd>
                  @if (tile.state === 'ready' && tile.detail; as detail) {
                    <dd
                      class="m-0 truncate text-[11px] text-base-content-muted"
                      data-testid="storefront-hero-tile-detail"
                    >
                      {{ detail }}
                    </dd>
                  }
                </div>
              }
            </dl>
          }

          <div
            class="flex flex-wrap items-center justify-between gap-2 border-t border-base-300 pt-3"
            data-testid="storefront-hero-synced"
          >
            <span class="text-[11px] text-base-content-muted">Synced to</span>
            @if (syncedTargets(); as targets) {
              @if (targets.length > 0) {
                <ptah-target-marks [targets]="targets" [maxVisible]="6" />
              } @else {
                <span
                  class="text-[11px] text-base-content-muted"
                  data-testid="storefront-hero-synced-empty"
                  >No CLI detected</span
                >
              }
            } @else {
              <span
                class="skeleton h-6 w-20 rounded-md"
                aria-hidden="true"
              ></span>
              <span class="sr-only">Detecting CLIs</span>
            }
          </div>
        </div>
      </div>
    </section>

    <ng-template #headingContent>{{ heading() }}</ng-template>
    <ng-template #stackHeadingContent>Your stack</ng-template>
  `,
  styles: `
    .ptah-storefront-hero__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 1.5rem;
    }

    /* Side by side once the Marketplace content region is wide enough. */
    @container ptah-mp-content (width >= 800px) {
      .ptah-storefront-hero__grid {
        grid-template-columns: minmax(0, 7fr) minmax(0, 5fr);
        align-items: center;
      }
    }
  `,
})
export class StorefrontHeroComponent {
  /** DOM id of the title; the hero `<section>` is labelled by it. */
  protected readonly headingId = `psh-${(instanceCounter++).toString(36)}-heading`;

  protected readonly SparklesIcon = Sparkles;

  protected readonly surfaceClass = STOREFRONT_SURFACE_CLASS;
  protected readonly headingClass =
    'text-3xl font-extrabold leading-tight tracking-tight text-base-content';
  protected readonly stackHeadingClass =
    'text-xs font-bold uppercase tracking-wider text-base-content';
  protected readonly RetryIcon = RotateCw;

  /** The hero title ("One-click connectors"). */
  public readonly heading = input.required<string>();

  /** Kicker above the title, in the gold accent; `null` or blank renders none. */
  public readonly eyebrow = input<string | null>(null);

  /** One sentence under the title; `null` or blank renders none. */
  public readonly description = input<string | null>(null);

  /** The "Your stack" tiles, in display order. Empty renders no tile grid. */
  public readonly tiles = input<readonly StorefrontStackTile[]>([]);

  /**
   * The CLI targets Ptah detected. `null` = not known yet (a skeleton);
   * an empty list = none detected.
   */
  public readonly syncedTargets = input<readonly TargetMarkItem[] | null>(null);

  /** @default 1 — at the wide tier the hero title is the page's `<h1>`. */
  public readonly headingLevel = input<StorefrontHeroHeadingLevel>(1);

  /** The id of a tile in the `error` state whose Retry was pressed. */
  public readonly retryTile = output<string>();

  protected readonly visibleEyebrow = computed(() =>
    blankToNull(this.eyebrow()),
  );

  protected readonly visibleDescription = computed(() =>
    blankToNull(this.description()),
  );

  protected readonly tileViews = computed(() => this.tiles().map(toTileView));
}

function blankToNull(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
}
