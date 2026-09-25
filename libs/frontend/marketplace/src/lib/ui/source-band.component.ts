import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { STOREFRONT_SURFACE_CLASS } from './storefront-surface.styles';

/**
 * How much room the band takes.
 *
 * - `storefront`: the wide-tier header — a padded panel on the storefront
 *   gradient with the eyebrow in the gold accent.
 * - `compact`: one tight row above the source's own surface, for the
 *   compact and regular tiers.
 */
export type SourceBandLayout = 'storefront' | 'compact';

/** Level of the band heading. A source page's band title is its `<h1>`. */
export type SourceBandHeadingLevel = 1 | 2;

/** The most facts rendered under the description; the rest are dropped. */
export const SOURCE_BAND_MAX_META = 3;

/** The compact row: a rule under the header, no surface. */
const COMPACT_CLASS = 'border-b border-base-300 pb-4';

/**
 * The header above one discovery source (Smithery, MCP Registry, Custom URL,
 * Ptah plugins, skills.sh, external marketplaces): which source this is, one
 * sentence about it, and room for the source's own actions.
 *
 * Presentational: nothing is injected, and the mark and the actions are
 * slots, so the host decides whether a source gets a brand mark, a monogram
 * or nothing. The heading is the page's `<h1>` by default — a source page has
 * no other title (Batch 12 contract: one `<h1>` per page).
 *
 * Slots (each wrapper collapses via `:empty` when nothing is projected):
 *
 * - `[band-mark]`    — the source's logo tile, left of the heading
 * - `[band-actions]` — the source's own buttons or links, right of the text
 *
 * @example
 * ```html
 * <ptah-source-band
 *   [layout]="tier() === 'wide' ? 'storefront' : 'compact'"
 *   eyebrow="MCP servers"
 *   heading="Smithery"
 *   description="Hosted MCP servers, installed and authorized through Smithery."
 * >
 *   <ptah-brand-mark band-mark brandSlug="smithery" label="Smithery" />
 * </ptah-source-band>
 * ```
 */
@Component({
  selector: 'ptah-source-band',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <header
      [class]="layoutClass()"
      [attr.data-layout]="layout()"
      data-testid="source-band"
    >
      <div class="flex min-w-0 flex-wrap items-start gap-4">
        <div class="shrink-0 empty:hidden" data-testid="source-band-mark">
          <ng-content select="[band-mark]" />
        </div>

        <div class="min-w-0 flex-1">
          @if (visibleEyebrow(); as text) {
            <p [class]="eyebrowClass()" data-testid="source-band-eyebrow">
              {{ text }}
            </p>
          }

          @switch (headingLevel()) {
            @case (2) {
              <h2 [class]="headingClass()" data-testid="source-band-heading">
                <ng-container [ngTemplateOutlet]="headingContent" />
              </h2>
            }
            @default {
              <h1 [class]="headingClass()" data-testid="source-band-heading">
                <ng-container [ngTemplateOutlet]="headingContent" />
              </h1>
            }
          }

          @if (visibleDescription(); as text) {
            <p
              class="mt-1 max-w-2xl text-sm leading-relaxed text-base-content-muted"
              data-testid="source-band-description"
            >
              {{ text }}
            </p>
          }

          @if (metaText(); as meta) {
            <p
              class="mt-2 text-xs text-base-content-muted"
              data-testid="source-band-meta"
            >
              {{ meta }}
            </p>
          }
        </div>

        <div
          class="flex shrink-0 flex-wrap items-center gap-2 empty:hidden"
          data-testid="source-band-actions"
        >
          <ng-content select="[band-actions]" />
        </div>
      </div>
    </header>

    <ng-template #headingContent>{{ heading() }}</ng-template>
  `,
})
export class SourceBandComponent {
  /** The source's name (Smithery, MCP Registry, …). */
  public readonly heading = input.required<string>();

  /** A short kicker above the heading; `null` or blank renders none. */
  public readonly eyebrow = input<string | null>(null);

  /** One sentence about the source; `null` or blank renders none. */
  public readonly description = input<string | null>(null);

  /**
   * Short facts (a count, a namespace). At most {@link SOURCE_BAND_MAX_META}
   * non-blank items render, joined with `·`.
   */
  public readonly meta = input<readonly string[]>([]);

  /** @default 'compact' */
  public readonly layout = input<SourceBandLayout>('compact');

  /** @default 1 — the band title is the source page's only `<h1>`. */
  public readonly headingLevel = input<SourceBandHeadingLevel>(1);

  protected readonly layoutClass = computed(() =>
    this.layout() === 'storefront' ? STOREFRONT_SURFACE_CLASS : COMPACT_CLASS,
  );

  /**
   * The gold accent is kept for the storefront layout only; the compact row
   * uses the muted text colour, so gold stays rare on a page.
   */
  protected readonly eyebrowClass = computed(() =>
    this.layout() === 'storefront'
      ? 'mb-1 text-xs font-semibold uppercase tracking-wider text-secondary'
      : 'mb-0.5 text-[11px] font-semibold uppercase tracking-wider text-base-content-muted',
  );

  protected readonly headingClass = computed(() =>
    this.layout() === 'storefront'
      ? 'text-2xl font-bold tracking-tight text-base-content'
      : 'text-lg font-semibold text-base-content',
  );

  protected readonly visibleEyebrow = computed(() =>
    blankToNull(this.eyebrow()),
  );

  protected readonly visibleDescription = computed(() =>
    blankToNull(this.description()),
  );

  protected readonly metaText = computed(() =>
    this.meta()
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .slice(0, SOURCE_BAND_MAX_META)
      .join(' · '),
  );
}

function blankToNull(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
}
