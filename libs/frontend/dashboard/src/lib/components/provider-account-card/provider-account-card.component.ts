/**
 * Dashboard provider account card (TASK_2026_596, Component 16; design §4;
 * relaid out as a provider list in TASK_2026_631; compact uniform tiles in
 * TASK_2026_707).
 *
 * One compact tile per quota owner, three to four per row on desktop, all
 * with the same anatomy whatever state each owner is in. The card owns the
 * data flow: it selects the owners (the selected provider's owner first),
 * passes each owner snapshot and the shared `PlanLimitsStore` clock value
 * to `ProviderAccountTileComponent`, and routes refresh and inline actions.
 * The tile presentation itself is pure: every derived text comes from
 * `plan-tile-view.model.ts`, which this rewrite extracted from the former
 * 838-line card. `ProviderAccountRowComponent` is gone.
 *
 * The card is its own Dashboard section (heading + grid), placed by
 * `DashboardGridComponent` above Session Analytics; it does not depend on
 * the analytics date range.
 *
 * Selection: `AuthStateService.persistedProviderId()` drives `load({providerId})`.
 * The store merges only the fields a call names, so the card passes exactly
 * `providerId` and never touches the chat view's `sessionIds` / `ownerKeys`.
 * The store owns the generation guard and the single 30 s clock; this card
 * and every tile in it start no timer of their own.
 */
import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import {
  AppStateManager,
  AuthStateService,
  PlanLimitsStore,
} from '@ptah-extension/core';
import {
  formatLocalAbsolute,
  NEAR_LIMIT_PERCENT,
  windowObservedAt,
  type LocalTimeOptions,
  type PlanLimitOwnerSnapshot,
  type PlanLimitsSnapshot,
} from '@ptah-extension/shared';
import type { PlanTileActionView } from './plan-tile-view.model';
import { ProviderAccountTileComponent } from '../provider-account-tile/provider-account-tile.component';

@Component({
  selector: 'ptah-provider-account-card',
  standalone: true,
  imports: [ProviderAccountTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    // TASK_2026_707: one compact tile per owner, 3–4 per desktop row, all
    // rows equal height (grid stretch). Each tile renders its own layout.
    `
      :host {
        display: block;
      }
      .tiles {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
        gap: 0.5rem;
        align-items: stretch;
      }
      .tiles > li {
        min-width: 0;
      }
    `,
  ],
  template: `
    <section
      class="surface-1 flex flex-col gap-3 rounded-xl p-5"
      aria-labelledby="provider-accounts-heading"
      data-testid="dashboard-section-provider-accounts"
    >
      <div>
        <h3 id="provider-accounts-heading" class="text-base font-semibold">
          Provider accounts &amp; plan limits
        </h3>
        <p class="mt-0.5 text-xs text-base-content-muted">
          One tile per quota owner. The tick on each bar marks
          {{ nearLimitPercent }}% (near limit); bars highlight a reached limit.
        </p>
      </div>
      @if (owners(); as list) {
        @if (refreshNotice(); as notice) {
          <p
            role="status"
            class="mb-2 border-l-2 border-info pl-2 text-xs text-base-content-muted"
            data-testid="refresh-failed"
          >
            {{ notice }}
          </p>
        }
        @if (list.length === 0) {
          <section class="surface-2 rounded-lg p-3" aria-label="Account usage">
            <div class="flex items-center justify-between gap-3">
              <h5 class="font-medium text-sm">Account usage</h5>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                [disabled]="loading()"
                (click)="refresh()"
              >
                Refresh
              </button>
            </div>
            @if (loading()) {
              <span
                class="loading loading-spinner loading-xs mt-3"
                aria-label="Loading account usage"
              ></span>
            } @else {
              <p
                class="text-xs text-base-content-muted mt-3"
                data-testid="usage-unavailable"
              >
                Account usage unavailable
              </p>
            }
          </section>
        } @else {
          <ul class="tiles">
            @for (owner of list; track owner.owner.key) {
              <li>
                <ptah-provider-account-tile
                  [owner]="owner"
                  [now]="now()"
                  [refreshing]="loading()"
                  (refresh)="refresh()"
                  (actionClick)="onTileAction($event)"
                />
              </li>
            }
          </ul>
        }
      } @else if (loading()) {
        <span
          class="loading loading-spinner loading-xs"
          aria-label="Loading account usage"
        ></span>
      }
    </section>
  `,
})
export class ProviderAccountCardComponent {
  private readonly planLimits = inject(PlanLimitsStore);
  private readonly auth = inject(AuthStateService);
  /** Tile inline actions navigate through existing app-state routes. */
  private readonly appState = inject(AppStateManager);

  /** Explicit zone and zone-name locale (carry-forward from Batch 3). */
  private readonly timeOptions: LocalTimeOptions = {
    timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
    zoneNameLocale: inject(LOCALE_ID),
  };

  protected readonly loading = this.planLimits.loading;
  /** The near-limit threshold each tile's bar tick marks. */
  protected readonly nearLimitPercent = NEAR_LIMIT_PERCENT;
  /** The shared 30 s clock value; every tile consumes it as an input. */
  protected readonly now = this.planLimits.now;

  /**
   * `null` until the first snapshot; `[]` for an empty (failed) snapshot.
   * Owners keep snapshot order, the selected provider's owner first.
   */
  protected readonly owners = computed<readonly PlanLimitOwnerSnapshot[] | null>(
    () => {
      const snapshot = this.planLimits.snapshot();
      if (snapshot === null) return null;
      const selectedProviderId = this.auth.persistedProviderId();
      const selected = snapshot.owners.filter(
        (o) => o.owner.providerId === selectedProviderId,
      );
      const others = snapshot.owners.filter(
        (o) => o.owner.providerId !== selectedProviderId,
      );
      return [...selected, ...others];
    },
  );

  /**
   * Neutral notice while a failed pull leaves the last snapshot in place;
   * `null` after a good pull or push, and when no owner is held (the empty
   * placeholder renders "Account usage unavailable" instead).
   */
  protected readonly refreshNotice = computed<string | null>(() => {
    if (!this.planLimits.loadError()) return null;
    const snapshot = this.planLimits.snapshot();
    if (snapshot === null) return null;
    return refreshFailedNotice(
      snapshot,
      this.planLimits.now(),
      this.timeOptions,
    );
  });

  private readonly providerWatcher = effect(() => {
    const providerId = this.auth.persistedProviderId();
    untracked(() => void this.planLimits.load({ providerId }));
  });

  refresh(): void {
    void this.planLimits.load({
      providerId: this.auth.persistedProviderId(),
      refresh: true,
    });
  }

  /**
   * Tile inline actions — existing navigation only: "Go to chat" goes to
   * chat, where a session with the provider opens and its usage can be
   * read; "Add key" opens Settings on the Providers tab focused on this
   * provider.
   */
  onTileAction(action: PlanTileActionView): void {
    if (action.kind === 'open-session') {
      this.appState.setCurrentView('chat');
    } else {
      this.appState.openSettingsTab('providers', action.providerId);
    }
  }
}

/**
 * "Refresh failed — showing last observed data", with the newest host
 * observation among the held owners. `null` when no owner is held. Window
 * states keep their own age-based classification.
 */
export function refreshFailedNotice(
  snapshot: PlanLimitsSnapshot,
  now: number,
  time: LocalTimeOptions,
): string | null {
  if (snapshot.owners.length === 0) return null;
  let newest: number | undefined;
  for (const owner of snapshot.owners) {
    const instants = [
      ...owner.windows.map(windowObservedAt),
      ...owner.ownerEvidence.map((evidence) => evidence.observedAt),
    ];
    for (const instant of instants) {
      if (
        Number.isFinite(instant) &&
        (newest === undefined || instant > newest)
      ) {
        newest = instant;
      }
    }
  }
  return newest === undefined
    ? 'Refresh failed — showing last observed data'
    : `Refresh failed — showing last observed data (observed ${formatLocalAbsolute(newest, now, time)})`;
}