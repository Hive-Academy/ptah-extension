import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  ArrowRight,
  CircleAlert,
  LucideAngularModule,
  RotateCw,
} from 'lucide-angular';
import type { PtahConnector } from '@ptah-extension/shared';
import {
  BrandMarkComponent,
  CatalogCardComponent,
  CatalogCardSkeletonComponent,
  CatalogGridComponent,
} from '@ptah-extension/ui';

import type {
  ConnectorLink,
  ConnectorStatus,
} from '../data/connector-links.store';
import { ConnectorCardActionsComponent } from './connector-card-actions.component';
import { ConnectorCardStatusComponent } from './connector-card-status.component';
import {
  connectorCardState,
  type ConnectorCardAction,
} from './connector-card-state';

/** How many connectors the featured row shows (plan C9). */
export const FEATURED_CONNECTOR_LIMIT = 6;

/**
 * One featured card: the catalogue entry plus what `ConnectorLinksStore`
 * says about it. The page builds it from `linkOf`, `isBusy` / `isPolling` and
 * `isManagedElsewhere`; the component injects nothing.
 */
export interface FeaturedConnectorView {
  readonly connector: PtahConnector;
  readonly status: ConnectorStatus;
  /** The reason text of an `error` link (`ConnectorLink.detail`). */
  readonly detail?: string | null;
  /** An action is in flight for this connector. */
  readonly busy: boolean;
  /** A Smithery setup poll is waiting for the browser step to finish. */
  readonly polling: boolean;
  /** The connection is not Ptah's; Disconnect is withheld. */
  readonly managedElsewhere: boolean;
}

/**
 * A failed action, pinned to the connector it was run on, so the message
 * shows on that card and nowhere else.
 */
export interface ConnectorActionErrorView {
  readonly connectorId: string;
  readonly message: string;
}

/** Load state of the connection picture the featured row depends on. */
export type FeaturedConnectorsState = 'loading' | 'ready' | 'error';

/** What {@link FeaturedConnectorsComponent.action} emits. */
export interface ConnectorActionRequest {
  readonly action: ConnectorCardAction;
  readonly connector: PtahConnector;
}

/**
 * The featured rule (plan C9): the first {@link FEATURED_CONNECTOR_LIMIT}
 * `oauth-dcr` entries in catalogue order that are not connected. A connector
 * the link map does not know is not connected. Pure, so the page and its
 * spec share one rule.
 */
export function selectFeaturedConnectors(
  connectors: readonly PtahConnector[],
  links: ReadonlyMap<string, ConnectorLink>,
  limit: number = FEATURED_CONNECTOR_LIMIT,
): PtahConnector[] {
  const max = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const featured: PtahConnector[] = [];
  for (const connector of connectors) {
    if (featured.length >= max) break;
    if (connector.kind !== 'oauth-dcr') continue;
    const status = links.get(connector.id)?.status ?? 'not-connected';
    if (status === 'not-connected') featured.push(connector);
  }
  return featured;
}

let instanceCounter = 0;

/**
 * The featured connectors row of the Connectors storefront (plan C8/C9).
 *
 * Each connector is a `ptah-catalog-card` — there is no separate connector
 * card component — with its brand projected as `ptah-brand-mark` and its
 * state and actions drawn by the shared `ptah-connector-card-status` and
 * `ptah-connector-card-actions` (the same content the Connectors grid and
 * the connector detail use). Activating the card emits {@link details}.
 *
 * States: `loading` renders skeleton cards; `error` renders the message with
 * a Retry output; `ready` with no items renders an empty note with a
 * "Browse all connectors" output.
 *
 * Presentational: which connectors are featured, and their link state, come
 * in through inputs ({@link selectFeaturedConnectors} is the rule).
 */
@Component({
  selector: 'ptah-featured-connectors',
  standalone: true,
  imports: [
    LucideAngularModule,
    BrandMarkComponent,
    CatalogCardComponent,
    CatalogCardSkeletonComponent,
    CatalogGridComponent,
    ConnectorCardStatusComponent,
    ConnectorCardActionsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="flex flex-col gap-4"
      [attr.aria-labelledby]="headingId"
      [attr.aria-busy]="state() === 'loading' ? 'true' : null"
      data-testid="featured-connectors"
    >
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div class="min-w-0">
          <h2 [id]="headingId" class="text-lg font-semibold text-base-content">
            Featured connectors
          </h2>
          <p class="mt-0.5 text-xs text-base-content-muted">
            Sign in with your browser — no keys to copy.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm gap-1"
          data-testid="featured-connectors-browse"
          (click)="browseAll.emit()"
        >
          Browse all connectors
          <lucide-angular
            [img]="ArrowRightIcon"
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
        </button>
      </div>

      @switch (state()) {
        @case ('loading') {
          <ptah-catalog-grid ariaLabel="Featured connectors loading">
            @for (slot of skeletonSlots; track slot) {
              <ptah-catalog-card-skeleton role="listitem" />
            }
          </ptah-catalog-grid>
        }
        @case ('error') {
          <div
            class="flex flex-wrap items-center gap-3 rounded-xl border border-error/40 bg-error/10 p-4 text-sm"
            role="alert"
            data-testid="featured-connectors-error"
          >
            <lucide-angular
              [img]="AlertIcon"
              class="h-4 w-4 shrink-0 text-error"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 text-base-content">{{
              errorText()
            }}</span>
            <button
              type="button"
              class="btn btn-sm btn-outline gap-1"
              data-testid="featured-connectors-retry"
              (click)="retry.emit()"
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
          @if (cards().length === 0) {
            <div
              class="flex flex-wrap items-center gap-3 rounded-xl border border-base-300 bg-base-200 p-4 text-sm text-base-content-muted"
              data-testid="featured-connectors-empty"
            >
              <span class="min-w-0 flex-1">
                Every featured connector is already connected.
              </span>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                data-testid="featured-connectors-empty-browse"
                (click)="browseAll.emit()"
              >
                Browse all connectors
              </button>
            </div>
          } @else {
            <ptah-catalog-grid ariaLabel="Featured connectors">
              @for (card of cards(); track card.connector.id) {
                <ptah-catalog-card
                  role="listitem"
                  [heading]="card.connector.label"
                  [description]="card.connector.description"
                  [meta]="card.meta"
                  [interactive]="true"
                  [attr.data-connector]="card.connector.id"
                  (activated)="details.emit(card.connector)"
                >
                  <ptah-brand-mark
                    card-mark
                    size="lg"
                    [brandSlug]="card.connector.brandSlug"
                    [label]="card.connector.label"
                  />
                  @if (card.hasStatus) {
                    <ptah-connector-card-status
                      card-status
                      [card]="card"
                      (dismissError)="dismissError.emit(card.connector.id)"
                    />
                  }
                  @if (card.hasActions) {
                    <ptah-connector-card-actions
                      card-actions
                      [card]="card"
                      (action)="
                        action.emit({
                          action: $event,
                          connector: card.connector,
                        })
                      "
                    />
                  }
                </ptah-catalog-card>
              }
            </ptah-catalog-grid>
          }
        }
      }
    </section>
  `,
})
export class FeaturedConnectorsComponent {
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly AlertIcon = CircleAlert;
  protected readonly RetryIcon = RotateCw;

  /** DOM id of the section heading; the section is labelled by it. */
  protected readonly headingId = `pfc-${(instanceCounter++).toString(36)}-heading`;

  /** One skeleton card per featured slot. */
  protected readonly skeletonSlots = Array.from(
    { length: FEATURED_CONNECTOR_LIMIT },
    (_, index) => index,
  );

  /** The featured cards, in display order. */
  public readonly items = input<readonly FeaturedConnectorView[]>([]);

  /** @default 'ready' */
  public readonly state = input<FeaturedConnectorsState>('ready');

  /** The load failure text shown in the `error` state. */
  public readonly loadError = input<string | null>(null);

  /**
   * Failed actions, each pinned to one connector; a card shows the error of
   * its own connector only.
   */
  public readonly actionErrors = input<readonly ConnectorActionErrorView[]>([]);

  /** Connect, Authorize or Disconnect was pressed on an unlocked card. */
  public readonly action = output<ConnectorActionRequest>();

  /** A card was activated: open `connectors/:id`. */
  public readonly details = output<PtahConnector>();

  /** Retry was pressed in the `error` state. */
  public readonly retry = output<void>();

  /** The inline action error of this connector id was dismissed. */
  public readonly dismissError = output<string>();

  /** "Browse all connectors" was pressed. */
  public readonly browseAll = output<void>();

  protected readonly cards = computed(() => {
    const errors = new Map(
      this.actionErrors().map((e) => [e.connectorId, e.message] as const),
    );
    return this.items().map((item) =>
      connectorCardState(item.connector, {
        ...item,
        error: errors.get(item.connector.id) ?? null,
      }),
    );
  });

  protected readonly errorText = computed(() => {
    const text = this.loadError()?.trim() ?? '';
    return text.length > 0 ? text : 'Could not load the connection status.';
  });
}
