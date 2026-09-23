/**
 * CatalogCardComponent - Storefront catalogue card (logo slot, name, meta, badge).
 *
 * The shared card of every discovery view (Smithery, MCP Registry, Custom URL,
 * Ptah Plugins, skills.sh, external marketplaces) and of the marketplace
 * connectors page. Purely presentational: the consumer owns data, actions and
 * behaviour; the card owns chrome, typography and accessibility structure.
 * While data loads, render `CatalogCardSkeletonComponent`, which shares this
 * card's shell.
 *
 * THE MARK IS A SLOT. There is deliberately no brand/slug input: the card never
 * imports brand artwork, so an eager host (the dashboard skill picker) that
 * renders catalog cards cannot pull vendored logos into the initial chunk.
 * Lazy consumers project `<ptah-brand-mark card-mark>`, eager ones project
 * `<ptah-monogram-tile card-mark>`.
 *
 * Slots (each wrapper collapses via `:empty` when nothing is projected, so an
 * unused slot never adds gap spacing):
 *
 * - `[card-mark]`      — the logo tile, left of the heading
 * - `[card-status]`    — spinner / polling / inline error text
 * - `[card-actions]`   — the consumer's primary and secondary actions (footer)
 * - `[card-expansion]` — full-width content under the body (e.g. a config form)
 *
 * INTERACTION. When `interactive` is true the heading text renders as a
 * `<button>` stretched over the whole card (the stretched-link pattern):
 * clicking the card surface activates it, but there is never an interactive
 * element nested inside another. Every slot wrapper and the badge sit above
 * the stretched target (`relative z-10`), so projected content keeps its own
 * clicks, tooltips and popovers. `activated` can only be emitted in that mode.
 *
 * DENSITY. Description clamps to 2 lines; inside a `ptah-catalog` container
 * (see `CatalogGridComponent`) narrower than 480px the card tightens its
 * padding and clamps the description to 1 line. No tier input is needed.
 *
 * @example
 * ```html
 * <ptah-catalog-grid>
 *   <ptah-catalog-card
 *     role="listitem"
 *     [heading]="server.name"
 *     [description]="server.description"
 *     [meta]="[server.category, server.version]"
 *     [badge]="{ label: 'Installed', tone: 'success' }"
 *     [interactive]="true"
 *     (activated)="openDetail(server.id)"
 *   >
 *     <ptah-brand-mark card-mark [brandSlug]="server.brandSlug" [label]="server.name" />
 *     <div card-actions>
 *       <button type="button" class="btn btn-sm btn-primary">Install</button>
 *     </div>
 *   </ptah-catalog-card>
 * </ptah-catalog-grid>
 * ```
 */
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import {
  CATALOG_CARD_SHELL_CLASS,
  CATALOG_CARD_SHELL_STYLES,
} from './catalog-card-shell.styles';

/** Semantic tone of the card badge; maps onto daisyUI badge colours. */
export type CatalogCardBadgeTone =
  'neutral' | 'info' | 'success' | 'warning' | 'error';

/**
 * Status badge (Installed, Verified, Connected, Enabled). The label is always
 * rendered as text — the tone is never the only carrier of meaning.
 */
export interface CatalogCardBadge {
  readonly label: string;
  readonly tone: CatalogCardBadgeTone;
}

/** Heading level of the card heading inside the host page's outline. */
export type CatalogHeadingLevel = 2 | 3 | 4;

/** Maximum number of meta items rendered on one line. */
export const CATALOG_CARD_MAX_META = 3;

const BADGE_TONE_CLASS: Record<CatalogCardBadgeTone, string> = {
  neutral: 'badge-ghost',
  info: 'badge-info',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
};

/** Card-only affordances layered on the shared shell. */
const ARTICLE_CLASS = `${CATALOG_CARD_SHELL_CLASS} group transition-transform duration-150 hover:-translate-y-px hover:border-base-content/20 focus-within:ring-2 focus-within:ring-primary/60 motion-reduce:transition-none motion-reduce:hover:translate-y-0`;

let instanceCounter = 0;

@Component({
  selector: 'ptah-catalog-card',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      [class]="articleClass"
      [attr.aria-labelledby]="headingId"
      [attr.data-interactive]="interactive() ? 'true' : null"
      data-testid="catalog-card"
    >
      <div class="flex min-w-0 items-start gap-3">
        <div
          class="relative z-10 shrink-0 empty:hidden"
          data-testid="catalog-card-mark"
        >
          <ng-content select="[card-mark]" />
        </div>

        <div class="min-w-0 flex-1">
          @switch (headingLevel()) {
            @case (2) {
              <h2 class="ptah-catalog-card__heading" [id]="headingId">
                <ng-container [ngTemplateOutlet]="headingContent" />
              </h2>
            }
            @case (4) {
              <h4 class="ptah-catalog-card__heading" [id]="headingId">
                <ng-container [ngTemplateOutlet]="headingContent" />
              </h4>
            }
            @default {
              <h3 class="ptah-catalog-card__heading" [id]="headingId">
                <ng-container [ngTemplateOutlet]="headingContent" />
              </h3>
            }
          }

          @if (metaText(); as meta) {
            <p
              class="mt-1 truncate text-xs text-base-content-muted"
              data-testid="catalog-card-meta"
            >
              {{ meta }}
            </p>
          }
        </div>

        @if (visibleBadge(); as badge) {
          <span
            [class]="badgeClass()"
            [attr.data-tone]="badge.tone"
            data-testid="catalog-card-badge"
          >
            {{ badge.label }}
          </span>
        }
      </div>

      @if (visibleDescription(); as text) {
        <p
          class="ptah-catalog-card__description text-xs leading-relaxed text-base-content-muted"
          [id]="descriptionId"
          data-testid="catalog-card-description"
        >
          {{ text }}
        </p>
      }

      <div class="relative z-10 empty:hidden" data-testid="catalog-card-status">
        <ng-content select="[card-status]" />
      </div>

      <div
        class="relative z-10 mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-base-300 pt-3 empty:hidden"
        data-testid="catalog-card-actions"
      >
        <ng-content select="[card-actions]" />
      </div>

      <div
        class="relative z-10 empty:hidden"
        data-testid="catalog-card-expansion"
      >
        <ng-content select="[card-expansion]" />
      </div>
    </article>

    <ng-template #headingContent>
      @if (interactive()) {
        <button
          type="button"
          class="ptah-catalog-card__activator text-left hover:underline focus-visible:outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
          [attr.aria-describedby]="visibleDescription() ? descriptionId : null"
          data-testid="catalog-card-activator"
          (click)="activate()"
        >
          {{ heading() }}
        </button>
      } @else {
        {{ heading() }}
      }
    </ng-template>
  `,
  styles: [
    CATALOG_CARD_SHELL_STYLES,
    `
      .ptah-catalog-card__heading {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        line-height: 1.25rem;
        overflow-wrap: anywhere;
      }

      .ptah-catalog-card__description {
        margin: 0;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
      }

      /* Compact density: a single-column catalog grid (< 480px). */
      @container ptah-catalog (width < 480px) {
        .ptah-catalog-card__description {
          -webkit-line-clamp: 1;
          line-clamp: 1;
        }
      }
    `,
  ],
})
export class CatalogCardComponent {
  private readonly instanceId = `pcc-${(instanceCounter++).toString(36)}`;

  protected readonly articleClass = ARTICLE_CLASS;

  /** DOM id of the heading; the `<article>` is labelled by it. */
  protected readonly headingId = `${this.instanceId}-heading`;

  /** DOM id of the description; describes the activation button. */
  protected readonly descriptionId = `${this.instanceId}-description`;

  /** Item name. Also the accessible name of the card and its activator. */
  readonly heading = input.required<string>();

  /** One-line summary, clamped to 2 lines (1 line in a compact container). */
  readonly description = input<string | null>(null);

  /**
   * Short facts (category, author or source, version, counts). At most
   * {@link CATALOG_CARD_MAX_META} non-blank items render, joined with `·`.
   */
  readonly meta = input<readonly string[]>([]);

  /** Status badge; `null` renders none. A blank label renders none. */
  readonly badge = input<CatalogCardBadge | null>(null);

  /** Heading level within the host page. @default 3 */
  readonly headingLevel = input<CatalogHeadingLevel>(3);

  /** Render the heading as a stretched activation button. @default false */
  readonly interactive = input<boolean>(false);

  /** Emitted when an interactive card's heading button is activated. */
  readonly activated = output<void>();

  protected readonly metaText = computed(() =>
    this.meta()
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, CATALOG_CARD_MAX_META)
      .join(' · '),
  );

  protected readonly visibleDescription = computed(() => {
    const text = this.description()?.trim() ?? '';
    return text.length > 0 ? text : null;
  });

  protected readonly visibleBadge = computed(() => {
    const badge = this.badge();
    if (badge === null) return null;
    const label = badge.label.trim();
    return label.length > 0 ? { label, tone: badge.tone } : null;
  });

  protected readonly badgeClass = computed(() => {
    const badge = this.visibleBadge();
    const tone = badge === null ? '' : BADGE_TONE_CLASS[badge.tone];
    return `badge badge-sm relative z-10 shrink-0 whitespace-nowrap ${tone}`;
  });

  protected activate(): void {
    if (!this.interactive()) return;
    this.activated.emit();
  }
}
