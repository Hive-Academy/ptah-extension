/**
 * CatalogGridComponent - Responsive list of catalog cards sized by its own width.
 *
 * The grid is a native CSS query container (`container: ptah-catalog /
 * inline-size`) and picks its column count from ITS OWN inline size, never
 * from the viewport or a tier input. The same grid therefore lays out
 * correctly in the full-width marketplace, a narrow VS Code side panel, a
 * chat-ui settings view and the dashboard's `max-w-2xl` skill-picker dialog
 * (where it falls to 2 columns by itself).
 *
 * | Container width | Columns |
 * | --------------- | ------- |
 * | < 480px         | 1       |
 * | 480 – 799px     | 2       |
 * | 800 – 1199px    | 3       |
 * | ≥ 1200px        | 4       |
 *
 * `CatalogCardComponent` keys its compact density off the same
 * `ptah-catalog` container, so cards tighten automatically in 1 column.
 *
 * ACCESSIBILITY. The track element is `role="list"`. Every direct child the
 * consumer projects must carry `role="listitem"` — a card, a skeleton tile, or
 * a full-width row. A child with `class="col-span-full"` spans the whole row
 * (used for an expanded setup form under the card that opened it).
 * `ariaLabel` names the list when the surrounding heading does not.
 *
 * The `@tailwindcss/container-queries` plugin is intentionally not used; the
 * rules are native `@container` CSS, following
 * `apps/ptah-extension-webview/src/styles.css` and `chat-input.component.ts`.
 *
 * @example
 * ```html
 * <ptah-catalog-grid ariaLabel="Smithery servers">
 *   @for (server of servers(); track server.id) {
 *     <ptah-catalog-card role="listitem" [heading]="server.name" … />
 *     @if (expandedId() === server.id) {
 *       <div role="listitem" class="col-span-full">…setup form…</div>
 *     }
 *   }
 * </ptah-catalog-grid>
 * ```
 */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Name of the query container the grid establishes. */
export const CATALOG_CONTAINER_NAME = 'ptah-catalog';

@Component({
  selector: 'ptah-catalog-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="ptah-catalog-grid"
      role="list"
      [attr.aria-label]="ariaLabel()"
      data-testid="catalog-grid"
    >
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
        container: ptah-catalog / inline-size;
      }

      .ptah-catalog-grid {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 1rem;
      }

      @container ptah-catalog (width >= 480px) {
        .ptah-catalog-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @container ptah-catalog (width >= 800px) {
        .ptah-catalog-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @container ptah-catalog (width >= 1200px) {
        .ptah-catalog-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
    `,
  ],
})
export class CatalogGridComponent {
  /** Accessible name of the list; `null` when a visible heading names it. */
  readonly ariaLabel = input<string | null>(null);
}
