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
  KeyRound,
  LoaderCircle,
  LucideAngularModule,
  Plug,
  RotateCw,
  Unplug,
  X,
} from 'lucide-angular';
import {
  ptahConnectorCategoryLabel,
  ptahConnectorKindHint,
  type PtahConnector,
} from '@ptah-extension/shared';
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
import type { ProviderStatus } from '../data/provider-row';
import { StatusPillComponent } from './status-pill.component';

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
 * The store's `actionError`, pinned to the connector the page last acted on,
 * so the message shows on that card and nowhere else.
 */
export interface ConnectorActionErrorView {
  readonly connectorId: string;
  readonly message: string;
}

/** Load state of the connection picture the featured row depends on. */
export type FeaturedConnectorsState = 'loading' | 'ready' | 'error';

/** The primary actions a connector card offers (plan C9). */
export type ConnectorCardAction = 'connect' | 'authorize' | 'disconnect';

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

/**
 * The status pill word for a connector state, through the shared
 * `ProviderStatus` vocabulary so a connector and an installed row read the
 * same. `not-connected` has no pill: the Connect button already says it,
 * and "Disconnected" would claim a connection that never existed.
 */
export function connectorPillStatus(
  status: ConnectorStatus,
): ProviderStatus | null {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'needs-auth':
      return 'needs-auth';
    case 'error':
      return 'failed';
    case 'not-connected':
      return null;
  }
}

/** A card as the template draws it. */
interface FeaturedCardView {
  readonly connector: PtahConnector;
  readonly meta: readonly string[];
  readonly pill: ProviderStatus | null;
  readonly detail: string | null;
  readonly activity: 'busy' | 'polling' | null;
  readonly error: string | null;
  readonly managedElsewhere: boolean;
  readonly canConnect: boolean;
  readonly canAuthorize: boolean;
  readonly canDisconnect: boolean;
  readonly locked: boolean;
  readonly hasStatus: boolean;
}

function toCardView(
  item: FeaturedConnectorView,
  actionError: ConnectorActionErrorView | null,
): FeaturedCardView {
  const { connector, status } = item;
  const pill = connectorPillStatus(status);
  const detailText = item.detail?.trim() ?? '';
  const detail =
    status === 'error' && detailText.length > 0 ? detailText : null;
  const activity = item.polling ? 'polling' : item.busy ? 'busy' : null;
  const errorText =
    actionError?.connectorId === connector.id ? actionError.message.trim() : '';
  const error = errorText.length > 0 ? errorText : null;
  const managedElsewhere = item.managedElsewhere && status !== 'not-connected';
  return {
    connector,
    meta: [
      ptahConnectorCategoryLabel(connector.category),
      ptahConnectorKindHint(connector.kind),
    ],
    pill,
    detail,
    activity,
    error,
    managedElsewhere,
    canConnect: status === 'not-connected',
    canAuthorize: status === 'needs-auth' || status === 'error',
    canDisconnect: status !== 'not-connected' && !item.managedElsewhere,
    locked: activity !== null,
    hasStatus:
      pill !== null ||
      detail !== null ||
      activity !== null ||
      error !== null ||
      managedElsewhere,
  };
}

let instanceCounter = 0;

/**
 * The featured connectors row of the Connectors storefront (plan C8/C9).
 *
 * Each connector is a `ptah-catalog-card` — there is no separate connector
 * card component — with its brand projected as `ptah-brand-mark`, its state
 * as `ptah-status-pill`, and its actions (Connect, Authorize, Disconnect) as
 * buttons that emit {@link action}. Activating the card emits
 * {@link details}. Everything transient — an action in flight, a Smithery
 * setup poll, the last action's error — renders in the card's
 * `[card-status]` slot, and every action button is disabled while one runs.
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
    StatusPillComponent,
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
                    <div
                      card-status
                      class="flex flex-col gap-2"
                      data-testid="featured-card-status"
                    >
                      @if (card.pill || card.managedElsewhere) {
                        <div class="flex flex-wrap items-center gap-2">
                          @if (card.pill; as pill) {
                            <ptah-status-pill [status]="pill" />
                          }
                          @if (card.managedElsewhere) {
                            <span
                              class="text-[11px] text-base-content-muted"
                              data-testid="featured-card-managed"
                              >Managed outside Ptah</span
                            >
                          }
                        </div>
                      }
                      @if (card.detail; as detail) {
                        <p
                          class="m-0 text-xs text-base-content-muted"
                          data-testid="featured-card-detail"
                        >
                          {{ detail }}
                        </p>
                      }
                      @if (card.activity; as activity) {
                        <p
                          class="m-0 flex items-center gap-1.5 text-xs text-base-content-muted"
                          role="status"
                          [attr.data-activity]="activity"
                          data-testid="featured-card-activity"
                        >
                          <lucide-angular
                            [img]="SpinnerIcon"
                            class="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                            aria-hidden="true"
                          />
                          {{
                            activity === 'polling'
                              ? 'Finish the setup in your browser…'
                              : 'Working…'
                          }}
                        </p>
                      }
                      @if (card.error; as message) {
                        <div
                          class="flex items-start gap-1.5 rounded-lg border border-error/40 bg-error/10 px-2 py-1.5 text-xs text-base-content"
                          role="alert"
                          data-testid="featured-card-error"
                        >
                          <lucide-angular
                            [img]="AlertIcon"
                            class="mt-px h-3.5 w-3.5 shrink-0 text-error"
                            aria-hidden="true"
                          />
                          <span class="min-w-0 flex-1 break-words">{{
                            message
                          }}</span>
                          <button
                            type="button"
                            class="btn btn-ghost btn-xs h-5 min-h-0 w-5 p-0"
                            aria-label="Dismiss error"
                            data-testid="featured-card-error-dismiss"
                            (click)="dismissError.emit()"
                          >
                            <lucide-angular
                              [img]="DismissIcon"
                              class="h-3 w-3"
                              aria-hidden="true"
                            />
                          </button>
                        </div>
                      }
                    </div>
                  }

                  @if (
                    card.canConnect || card.canAuthorize || card.canDisconnect
                  ) {
                    <div
                      card-actions
                      class="flex flex-wrap items-center justify-end gap-2"
                    >
                      @if (card.canDisconnect) {
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs gap-1 text-error"
                          [disabled]="card.locked"
                          [attr.aria-label]="
                            'Disconnect ' + card.connector.label
                          "
                          data-action="disconnect"
                          (click)="emitAction('disconnect', card.connector)"
                        >
                          <lucide-angular
                            [img]="DisconnectIcon"
                            class="h-3 w-3"
                            aria-hidden="true"
                          />
                          Disconnect
                        </button>
                      }
                      @if (card.canAuthorize) {
                        <button
                          type="button"
                          class="btn btn-primary btn-xs gap-1"
                          [disabled]="card.locked"
                          [attr.aria-label]="
                            'Authorize ' + card.connector.label
                          "
                          data-action="authorize"
                          (click)="emitAction('authorize', card.connector)"
                        >
                          <lucide-angular
                            [img]="AuthorizeIcon"
                            class="h-3 w-3"
                            aria-hidden="true"
                          />
                          Authorize
                        </button>
                      }
                      @if (card.canConnect) {
                        <button
                          type="button"
                          class="btn btn-primary btn-xs gap-1"
                          [disabled]="card.locked"
                          [attr.aria-label]="'Connect ' + card.connector.label"
                          data-action="connect"
                          (click)="emitAction('connect', card.connector)"
                        >
                          <lucide-angular
                            [img]="ConnectIcon"
                            class="h-3 w-3"
                            aria-hidden="true"
                          />
                          Connect
                        </button>
                      }
                    </div>
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
  protected readonly SpinnerIcon = LoaderCircle;
  protected readonly DismissIcon = X;
  protected readonly ConnectIcon = Plug;
  protected readonly AuthorizeIcon = KeyRound;
  protected readonly DisconnectIcon = Unplug;

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

  /** The last action's failure, pinned to one connector; `null` shows none. */
  public readonly actionError = input<ConnectorActionErrorView | null>(null);

  /** Connect, Authorize or Disconnect was pressed on a card. */
  public readonly action = output<ConnectorActionRequest>();

  /** A card was activated: open `connectors/:id`. */
  public readonly details = output<PtahConnector>();

  /** Retry was pressed in the `error` state. */
  public readonly retry = output<void>();

  /** The inline action error was dismissed. */
  public readonly dismissError = output<void>();

  /** "Browse all connectors" was pressed. */
  public readonly browseAll = output<void>();

  protected readonly cards = computed(() => {
    const actionError = this.actionError();
    return this.items().map((item) => toCardView(item, actionError));
  });

  protected readonly errorText = computed(() => {
    const text = this.loadError()?.trim() ?? '';
    return text.length > 0 ? text : 'Could not load the connection status.';
  });

  protected emitAction(
    action: ConnectorCardAction,
    connector: PtahConnector,
  ): void {
    const item = this.items().find((i) => i.connector.id === connector.id);
    if (item === undefined || item.busy || item.polling) return;
    this.action.emit({ action, connector });
  }
}
