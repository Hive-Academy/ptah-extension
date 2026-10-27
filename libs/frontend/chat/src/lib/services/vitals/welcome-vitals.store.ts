import {
  Injectable,
  computed,
  effect,
  inject,
  untracked,
  type Signal,
} from '@angular/core';
import { PlanLimitsStore } from '@ptah-extension/core';
import type { PlanRingData } from '@ptah-extension/chat-ui';
import type { RecentWorkspace } from '@ptah-extension/shared';
import { HostInventoryCache } from './host-inventory.cache';
import { RecentWorkspacesStore } from './recent-workspaces.store';
import { hasUsage } from './usage-vitals.model';
import { UsageVitalsCache } from './usage-vitals.cache';
import {
  injectVitalsSource,
  injectVitalsTick,
  toActivityVitals,
  toPlanRingLoad,
  toSpendVitals,
  usageDayWindows,
  type ActivityVitals,
  type SpendVitals,
} from './usage-vitals.view';
import type { VitalsLoad } from './vitals-load';

/**
 * View model of the no-workspace welcome (`ptah-electron-welcome`). Provide it
 * on the component: its reads start when the screen opens and its lifetime is
 * the screen's. Every figure is across all workspaces.
 *
 * The cache reads run in effects (they start fetches, so never inside
 * `computed()`), at open and on every shared clock tick while the screen is
 * open: the caches decide whether a read is due, so a failed read is retried
 * and a good one refreshed after its age. A failed recents read is reread on
 * the next tick too.
 */
@Injectable()
export class WelcomeVitalsStore {
  private readonly recentWorkspaces = inject(RecentWorkspacesStore);
  private readonly planLimits = inject(PlanLimitsStore);
  private readonly usage = inject(UsageVitalsCache);
  private readonly inventory = inject(HostInventoryCache);
  private readonly tick = injectVitalsTick();
  private readonly windows = usageDayWindows(this.tick);
  private readonly usage90 = injectVitalsSource(
    () => null,
    () => this.usage.summary(null, 90),
    this.tick,
  );
  private readonly usage7 = injectVitalsSource(
    () => null,
    () => this.usage.summary(null, 7),
    this.tick,
  );

  /** Most recently used workspaces, newest first (`empty` off Electron). */
  readonly recents: Signal<VitalsLoad<readonly RecentWorkspace[]>> =
    this.recentWorkspaces.recents;

  /** The 91-day grid and its totals, all workspaces. */
  readonly activity90: Signal<VitalsLoad<ActivityVitals>> = computed(() =>
    toActivityVitals(this.usage90(), this.windows.activity()),
  );

  /** The 7-day spend bars and their totals, all workspaces. */
  readonly spend7: Signal<VitalsLoad<SpendVitals>> = computed(() =>
    toSpendVitals(this.usage7(), this.windows.spend()),
  );

  /** No session here: the first account with a known plan window. */
  readonly planRing: Signal<VitalsLoad<PlanRingData>> = computed(() =>
    toPlanRingLoad(this.planLimits.snapshot(), null, this.planLimits.now()),
  );

  /** Installed, enabled CLI agents (D18: the welcome "Agents" stat). */
  readonly cliCount: Signal<VitalsLoad<number>> = injectVitalsSource(
    () => null,
    () => this.inventory.cliCount(),
    this.tick,
  );

  /** Installed skills. */
  readonly skillCount: Signal<VitalsLoad<number>> = injectVitalsSource(
    () => null,
    () => this.inventory.skillCount(),
    this.tick,
  );

  /**
   * True when there is no recent workspace and no usage at all: the first-run
   * hero. `null` while either source is still loading (the hero shimmers).
   * When either source failed, a first run cannot be claimed, so it is
   * `false` and the screen shows its error states.
   */
  readonly isFirstRun: Signal<boolean | null> = computed(() => {
    const recents = this.recents();
    const usage = this.usage90();
    if (recents.status === 'loading' || usage.status === 'loading') return null;
    if (recents.status === 'error' || usage.status === 'error') return false;
    const noUsage = usage.status === 'empty' || !hasUsage(usage.value);
    return recents.status === 'empty' && noUsage;
  });

  constructor() {
    // Opening a folder changes the list, so every visit rereads it.
    untracked(() => void this.recentWorkspaces.load());
    effect(() => {
      this.tick();
      untracked(() => {
        if (this.recents().status === 'error')
          void this.recentWorkspaces.load();
      });
    });
  }
}
