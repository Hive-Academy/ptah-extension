import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { ArrowRight, LucideAngularModule } from 'lucide-angular';
import {
  PTAH_CONNECTOR_CATEGORIES,
  ptahConnectorCategoryLabel,
  type PtahConnector,
  type PtahConnectorCategory,
} from '@ptah-extension/shared';
import { BrandMarkComponent } from '@ptah-extension/ui';

/** The query parameter the Connectors page filters on (`?category=`). */
export const CONNECTOR_CATEGORY_QUERY_PARAM = 'category';

/** Sample brand marks drawn per category tile. */
export const CATEGORY_BENTO_SAMPLE_SIZE = 4;

/** One brand drawn on a category tile. */
export interface CategoryBentoSample {
  readonly brandSlug: string;
  readonly label: string;
}

/** One category tile: its label, its connector count and a few brands. */
export interface CategoryBentoItem {
  readonly category: PtahConnectorCategory;
  readonly label: string;
  readonly count: number;
  readonly samples: readonly CategoryBentoSample[];
}

/**
 * The query params that open the Connectors page on one category. The page
 * navigates with these when {@link CategoryBentoComponent.categorySelected}
 * fires, so the key is spelt out once.
 */
export function connectorCategoryQueryParams(
  category: PtahConnectorCategory,
): Readonly<
  Record<typeof CONNECTOR_CATEGORY_QUERY_PARAM, PtahConnectorCategory>
> {
  return { [CONNECTOR_CATEGORY_QUERY_PARAM]: category };
}

/**
 * Group connectors into category tiles, in `PTAH_CONNECTOR_CATEGORIES` order.
 * A category with no connector gets no tile. Samples are the first distinct
 * brands in catalogue order — two entries of one product (Asana v1 and v2)
 * share a slug and are drawn once — so the count can exceed the marks.
 */
export function groupConnectorsByCategory(
  connectors: readonly PtahConnector[],
  sampleSize: number = CATEGORY_BENTO_SAMPLE_SIZE,
): CategoryBentoItem[] {
  const max = Number.isFinite(sampleSize)
    ? Math.max(0, Math.floor(sampleSize))
    : 0;
  const byCategory = new Map<PtahConnectorCategory, PtahConnector[]>();
  for (const connector of connectors) {
    const bucket = byCategory.get(connector.category);
    if (bucket) bucket.push(connector);
    else byCategory.set(connector.category, [connector]);
  }

  const items: CategoryBentoItem[] = [];
  for (const category of PTAH_CONNECTOR_CATEGORIES) {
    const members = byCategory.get(category);
    if (!members || members.length === 0) continue;
    const samples: CategoryBentoSample[] = [];
    const seen = new Set<string>();
    for (const connector of members) {
      if (samples.length >= max) break;
      if (seen.has(connector.brandSlug)) continue;
      seen.add(connector.brandSlug);
      samples.push({ brandSlug: connector.brandSlug, label: connector.label });
    }
    items.push({
      category,
      label: ptahConnectorCategoryLabel(category),
      count: members.length,
      samples,
    });
  }
  return items;
}

let instanceCounter = 0;

/**
 * "Explore by category": one tile per connector category with its label, its
 * connector count and a few sample brand marks (plan C8).
 *
 * A tile is a `<button>`; pressing it emits {@link categorySelected} and the
 * page navigates to the Connectors page with
 * {@link connectorCategoryQueryParams} (`?category=<id>`). The tile of the
 * category the page is already filtered on carries `aria-current="true"`.
 *
 * Presentational: the connectors come in through an input (the curated
 * catalogue is static, so there is no loading or error state); with none, an
 * empty note renders instead of the grid. Columns follow the Marketplace
 * content region (`ptah-mp-content`): 1, then 2 from 480px, 4 from 800px.
 */
@Component({
  selector: 'ptah-category-bento',
  standalone: true,
  imports: [LucideAngularModule, BrandMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="flex flex-col gap-4"
      [attr.aria-labelledby]="headingId"
      data-testid="category-bento"
    >
      <div class="min-w-0">
        <h2 [id]="headingId" class="text-lg font-semibold text-base-content">
          Explore by category
        </h2>
        <p class="mt-0.5 text-xs text-base-content-muted">
          Connectors grouped by what they are for.
        </p>
      </div>

      @if (items().length === 0) {
        <p
          class="m-0 rounded-xl border border-base-300 bg-base-200 p-4 text-sm text-base-content-muted"
          data-testid="category-bento-empty"
        >
          No connectors to browse yet.
        </p>
      } @else {
        <ul class="ptah-category-bento__grid m-0 list-none p-0" role="list">
          @for (item of items(); track item.category) {
            <li class="flex">
              <button
                type="button"
                class="group flex w-full flex-col gap-4 rounded-xl border border-base-300 bg-base-200 p-4 text-left transition-transform duration-150 hover:-translate-y-px hover:border-base-content/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                [class.border-primary]="item.category === activeCategory()"
                [attr.aria-current]="
                  item.category === activeCategory() ? 'true' : null
                "
                [attr.aria-label]="item.label + ', ' + countText(item.count)"
                [attr.data-category]="item.category"
                data-testid="category-bento-tile"
                (click)="categorySelected.emit(item.category)"
              >
                <span class="flex w-full items-center justify-between gap-2">
                  <span
                    class="truncate text-sm font-semibold text-base-content"
                  >
                    {{ item.label }}
                  </span>
                  <span
                    class="shrink-0 text-[11px] tabular-nums text-base-content-muted"
                    data-testid="category-bento-count"
                    >{{ countText(item.count) }}</span
                  >
                </span>
                <span
                  class="mt-auto flex w-full items-center justify-between gap-2 border-t border-base-300 pt-3"
                >
                  <span
                    class="flex items-center -space-x-1.5"
                    aria-hidden="true"
                  >
                    @for (sample of item.samples; track sample.brandSlug) {
                      <span
                        class="inline-flex rounded-md ring-2 ring-base-200"
                        [attr.title]="sample.label"
                        [attr.data-brand]="sample.brandSlug"
                      >
                        <ptah-brand-mark
                          size="sm"
                          [brandSlug]="sample.brandSlug"
                          [label]="sample.label"
                        />
                      </span>
                    }
                  </span>
                  <span
                    class="flex items-center gap-0.5 text-[11px] font-medium text-base-content-muted group-hover:text-base-content"
                    aria-hidden="true"
                  >
                    Browse
                    <lucide-angular
                      [img]="ArrowRightIcon"
                      class="h-3 w-3 transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
                    />
                  </span>
                </span>
              </button>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    .ptah-category-bento__grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 1rem;
    }

    @container ptah-mp-content (width >= 480px) {
      .ptah-category-bento__grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @container ptah-mp-content (width >= 800px) {
      .ptah-category-bento__grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }
  `,
})
export class CategoryBentoComponent {
  protected readonly ArrowRightIcon = ArrowRight;

  /** DOM id of the section heading; the section is labelled by it. */
  protected readonly headingId = `pcb-${(instanceCounter++).toString(36)}-heading`;

  /** The catalogue to group (normally `PTAH_CONNECTORS`). */
  public readonly connectors = input.required<readonly PtahConnector[]>();

  /** The category the Connectors page is filtered on, or `null`. */
  public readonly activeCategory = input<PtahConnectorCategory | null>(null);

  /** A tile was pressed; navigate with {@link connectorCategoryQueryParams}. */
  public readonly categorySelected = output<PtahConnectorCategory>();

  protected readonly items = computed(() =>
    groupConnectorsByCategory(this.connectors()),
  );

  protected countText(count: number): string {
    return count === 1 ? '1 connector' : `${count} connectors`;
  }
}
