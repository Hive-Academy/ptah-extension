/**
 * StorefrontPanelComponent - Single storefront panel for forms and gates.
 *
 * The one-panel treatment of the storefront card language, for content that
 * is not a card grid: the Custom URL form, Smithery's API-key gate and setup
 * form, the external marketplaces "add marketplace" form, and the Registry /
 * Smithery install-and-config expansion. Purely presentational: the consumer
 * owns the form, its state and its actions.
 *
 * Structure: a `<section>` labelled by its own heading, so the panel is a
 * named region for assistive technology.
 *
 * Slots (each wrapper collapses via `:empty` when nothing is projected):
 *
 * - `[panel-mark]`   — logo or icon tile left of the heading
 * - default          — the body (fields, disclosures, lists)
 * - `[panel-footer]` — the consumer's actions (Save, Cancel, Install)
 *
 * Inside a `ptah-catalog` container narrower than 480px (a single-column
 * `CatalogGridComponent`, e.g. a `col-span-full` expansion) the panel tightens
 * its padding the same way the catalog card does.
 *
 * @example
 * ```html
 * <ptah-storefront-panel
 *   [heading]="'Connect a custom server'"
 *   [subtitle]="'Any MCP server that speaks OAuth over HTTP.'"
 *   [headingLevel]="2"
 * >
 *   <ptah-monogram-tile panel-mark [label]="'Custom URL'" />
 *   <form id="custom-url-form">…</form>
 *   <div panel-footer>
 *     <button type="submit" form="custom-url-form" class="btn btn-sm btn-primary">
 *       Connect
 *     </button>
 *   </div>
 * </ptah-storefront-panel>
 * ```
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import type { CatalogHeadingLevel } from './catalog-card.component';

let instanceCounter = 0;

@Component({
  selector: 'ptah-storefront-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="ptah-storefront-panel flex flex-col rounded-xl border border-base-300 bg-base-200"
      [attr.aria-labelledby]="headingId"
      data-testid="storefront-panel"
    >
      <header class="flex min-w-0 items-start gap-3">
        <div class="shrink-0 empty:hidden" data-testid="storefront-panel-mark">
          <ng-content select="[panel-mark]" />
        </div>

        <div class="min-w-0 flex-1">
          @switch (headingLevel()) {
            @case (2) {
              <h2 class="ptah-storefront-panel__heading" [id]="headingId">
                {{ heading() }}
              </h2>
            }
            @case (4) {
              <h4 class="ptah-storefront-panel__heading" [id]="headingId">
                {{ heading() }}
              </h4>
            }
            @default {
              <h3 class="ptah-storefront-panel__heading" [id]="headingId">
                {{ heading() }}
              </h3>
            }
          }

          @if (visibleSubtitle(); as text) {
            <p
              class="mt-1 text-xs leading-relaxed text-base-content-muted"
              data-testid="storefront-panel-subtitle"
            >
              {{ text }}
            </p>
          }
        </div>
      </header>

      <div class="min-w-0 empty:hidden" data-testid="storefront-panel-body">
        <ng-content />
      </div>

      <div
        class="flex flex-wrap items-center justify-end gap-2 border-t border-base-300 pt-4 empty:hidden"
        data-testid="storefront-panel-footer"
      >
        <ng-content select="[panel-footer]" />
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }

      .ptah-storefront-panel {
        gap: 1rem;
        padding: 1.5rem;
      }

      .ptah-storefront-panel__heading {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        line-height: 1.5rem;
        overflow-wrap: anywhere;
      }

      /* Compact density: inside a single-column catalog grid (< 480px). */
      @container ptah-catalog (width < 480px) {
        .ptah-storefront-panel {
          gap: 0.75rem;
          padding: 1rem;
        }
      }
    `,
  ],
})
export class StorefrontPanelComponent {
  private readonly instanceId = `psp-${(instanceCounter++).toString(36)}`;

  /** DOM id of the panel heading; the `<section>` is labelled by it. */
  protected readonly headingId = `${this.instanceId}-heading`;

  /** Panel heading text. Also the accessible name of the region. */
  readonly heading = input.required<string>();

  /** Supporting line under the heading; `null` or blank renders none. */
  readonly subtitle = input<string | null>(null);

  /** Heading level within the host page. @default 3 */
  readonly headingLevel = input<CatalogHeadingLevel>(3);

  protected readonly visibleSubtitle = computed(() => {
    const text = this.subtitle()?.trim() ?? '';
    return text.length > 0 ? text : null;
  });
}
