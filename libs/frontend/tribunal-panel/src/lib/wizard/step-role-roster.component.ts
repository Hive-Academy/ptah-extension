import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  RefreshCw,
  Settings,
  TriangleAlert,
  Info,
} from 'lucide-angular';
import { WebviewNavigationService } from '@ptah-extension/core';
import {
  TribunalDiscoveryService,
  type DiscoveredVendor,
  type TribunalModelOption,
} from '../services/tribunal-discovery.service';
import { validateRoster } from '../services/tribunal-roster-rules';
import {
  makeLaneId,
  rolesForMove,
  type LaneRole,
  type TribunalMove,
  type VendorLane,
} from '../types/tribunal-ui.types';

/** Human-readable label + one line of intent per role slot. */
const ROLE_COPY: Record<LaneRole, { label: string; hint: string }> = {
  plan: {
    label: 'Plan',
    hint: 'Scopes the task and writes the acceptance criteria.',
  },
  architect: {
    label: 'Architect',
    hint: 'Turns the scope into an implementation plan.',
  },
  implement: { label: 'Implement', hint: 'Writes the code.' },
  review: {
    label: 'Review',
    hint: 'Reviews the diff. Must not be the implement lane.',
  },
  executor: {
    label: 'Executor',
    hint: 'Cheap and fast. Writes the code, then revises it each round.',
  },
  judge: {
    label: 'Judge',
    hint: 'Strongest reasoning, a different family. Reads and scores; never edits.',
  },
};

@Component({
  selector: 'ptah-step-role-roster',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-col gap-4" data-testid="tribunal-step-role-roster">
      <header class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h3 class="text-base font-semibold text-base-content">
            Assign the roles
          </h3>
          <p class="text-sm text-base-content-muted">
            {{ move() }} runs its lanes in sequence, and each one has a
            different job. Pick a vendor per role — the same vendor may appear
            twice on different models.
          </p>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm gap-1"
          [disabled]="loading()"
          aria-label="Rediscover vendors"
          (click)="refresh()"
        >
          <lucide-angular
            [img]="RefreshIcon"
            class="h-4 w-4"
            [class.animate-spin]="loading()"
            aria-hidden="true"
          />
          Refresh
        </button>
      </header>

      @if (loading() && availableVendors().length === 0) {
        <div class="flex items-center justify-center py-8">
          <span class="loading loading-dots loading-md"></span>
        </div>
      } @else if (availableVendors().length === 0) {
        <p class="py-6 text-center text-sm text-base-content-muted">
          No vendors discovered. Install a CLI agent or configure a provider to
          fill these roles.
        </p>
      } @else {
        <div class="flex flex-col gap-3">
          @for (slot of slots(); track slot.role) {
            <div
              class="flex flex-col gap-2 rounded-lg border border-base-300 p-3"
              [attr.data-role]="slot.role"
            >
              <div class="flex flex-col gap-0.5">
                <span class="text-sm font-semibold text-base-content">
                  {{ slot.index + 1 }}. {{ slot.label }}
                </span>
                <span class="text-[11px] text-base-content-muted">{{
                  slot.hint
                }}</span>
              </div>

              <div class="flex flex-col gap-2 sm:flex-row">
                <label class="flex flex-1 flex-col gap-1">
                  <span
                    class="text-[10px] uppercase tracking-wide text-base-content-muted"
                    >Vendor</span
                  >
                  <select
                    class="select select-bordered select-xs w-full"
                    [attr.aria-label]="slot.label + ' vendor'"
                    [value]="slot.baseKey ?? ''"
                    (change)="onVendorChange(slot.role, $event)"
                  >
                    <option value="">Not assigned</option>
                    @for (vendor of availableVendors(); track vendor.baseKey) {
                      <option [value]="vendor.baseKey">
                        {{ vendor.lane.displayName }}
                      </option>
                    }
                  </select>
                </label>

                @if (slot.baseKey) {
                  @if (modelOptionsFor(slot.baseKey).length > 0) {
                    <label class="flex flex-1 flex-col gap-1">
                      <span
                        class="text-[10px] uppercase tracking-wide text-base-content-muted"
                        >Model</span
                      >
                      <select
                        class="select select-bordered select-xs w-full font-mono"
                        [attr.aria-label]="slot.label + ' model'"
                        [value]="slot.model ?? ''"
                        (change)="onModelChange(slot.role, $event)"
                      >
                        @for (
                          model of modelOptionsFor(slot.baseKey);
                          track model.id
                        ) {
                          <option [value]="model.id">{{ model.name }}</option>
                        }
                      </select>
                    </label>
                  } @else {
                    <span
                      class="flex-1 self-end text-[11px] text-base-content-muted"
                    >
                      {{ slot.model ?? 'No model selection for this vendor.' }}
                    </span>
                  }
                }
              </div>
            </div>
          }
        </div>

        @if (issues().length > 0) {
          <div class="flex flex-col gap-2" data-testid="tribunal-roster-issues">
            @for (issue of issues(); track issue.message) {
              <p
                class="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
                [class.bg-error/10]="issue.severity === 'block'"
                [class.text-error]="issue.severity === 'block'"
                [class.bg-warning/10]="issue.severity === 'warn'"
                [class.text-warning]="issue.severity === 'warn'"
                [attr.data-severity]="issue.severity"
                [attr.role]="issue.severity === 'block' ? 'alert' : 'note'"
              >
                <lucide-angular
                  [img]="issue.severity === 'block' ? WarningIcon : InfoIcon"
                  class="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span class="flex-1">{{ issue.message }}</span>
                @if (issue.severity === 'block') {
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs gap-1"
                    aria-label="Configure another provider"
                    (click)="openProviderSettings()"
                  >
                    <lucide-angular
                      [img]="SettingsIcon"
                      class="h-3 w-3"
                      aria-hidden="true"
                    />
                    Configure
                  </button>
                }
              </p>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StepRoleRosterComponent {
  readonly move = input<TribunalMove>('relay');
  readonly selectedLanes = input<readonly VendorLane[]>([]);
  /**
   * The SAME output contract as the flat panel picker, deliberately. One
   * `_lanes` signal upstream, one `prepare()` shape, no second run path — the
   * wizard's fork is one `@switch` over the editor, not two wizards.
   */
  readonly lanesChanged = output<readonly VendorLane[]>();

  private readonly discovery = inject(TribunalDiscoveryService);
  private readonly navigation = inject(WebviewNavigationService);

  protected readonly RefreshIcon = RefreshCw;
  protected readonly SettingsIcon = Settings;
  protected readonly WarningIcon = TriangleAlert;
  protected readonly InfoIcon = Info;

  private readonly _loading = signal(false);
  private readonly _modelsByBase = signal<
    ReadonlyMap<string, readonly TribunalModelOption[]>
  >(new Map());

  protected readonly loading = this._loading.asReadonly();

  protected readonly availableVendors = computed<readonly DiscoveredVendor[]>(
    () => this.discovery.vendors().filter((vendor) => vendor.available),
  );

  protected readonly slots = computed(() =>
    rolesForMove(this.move()).map((role, index) => {
      const lane = this.laneFor(role);
      return {
        role,
        index,
        label: ROLE_COPY[role].label,
        hint: ROLE_COPY[role].hint,
        baseKey: lane ? this.baseKeyOfLane(lane) : null,
        model: lane?.model ?? null,
      };
    }),
  );

  protected readonly issues = computed(() =>
    validateRoster(this.move(), this.selectedLanes()),
  );

  constructor() {
    void this.load(() => this.discovery.ensureDiscovered());
  }

  protected refresh(): void {
    void this.load(() => this.discovery.rediscover());
  }

  protected modelOptionsFor(baseKey: string): readonly TribunalModelOption[] {
    return this._modelsByBase().get(baseKey) ?? [];
  }

  protected openProviderSettings(): void {
    void this.navigation.navigateToSettingsTab('orchestration');
  }

  protected async onVendorChange(role: LaneRole, event: Event): Promise<void> {
    const baseKey = (event.target as HTMLSelectElement).value;
    if (!baseKey) {
      this.lanesChanged.emit(
        this.selectedLanes().filter((lane) => lane.role !== role),
      );
      return;
    }
    const vendor = this.availableVendors().find((v) => v.baseKey === baseKey);
    if (!vendor) return;

    await this.ensureModelsLoaded(vendor);
    const slotIndex = rolesForMove(this.move()).indexOf(role);
    const model = this.defaultModelFor(vendor);
    const lane: VendorLane = {
      ...vendor.lane,
      // Slot index, NOT a de-duplicated family index: two relay slots on the
      // same family must produce two distinct laneIds and must never collapse
      // into one (`relay.md:60`).
      laneId: makeLaneId(vendor.baseKey, slotIndex),
      role,
      ...(model ? { model } : {}),
    };
    this.lanesChanged.emit(this.withLane(lane, role));
  }

  protected onModelChange(role: LaneRole, event: Event): void {
    const model = (event.target as HTMLSelectElement).value;
    this.lanesChanged.emit(
      this.selectedLanes().map((lane) =>
        lane.role === role ? { ...lane, model } : lane,
      ),
    );
  }

  /** Replace this role's lane, keeping every slot in `rolesForMove` order. */
  private withLane(lane: VendorLane, role: LaneRole): readonly VendorLane[] {
    const others = this.selectedLanes().filter((entry) => entry.role !== role);
    const order = rolesForMove(this.move());
    return [...others, lane].sort(
      (a, b) =>
        order.indexOf(a.role as LaneRole) - order.indexOf(b.role as LaneRole),
    );
  }

  private laneFor(role: LaneRole): VendorLane | undefined {
    return this.selectedLanes().find((lane) => lane.role === role);
  }

  /**
   * A lane's vendor key. Read off the laneId rather than recomputed from
   * `cli`/`providerId`, because the slot index is part of the id and the base
   * is everything before it.
   */
  private baseKeyOfLane(lane: VendorLane): string {
    const idx = lane.laneId.lastIndexOf('#');
    return idx < 0 ? lane.laneId : lane.laneId.slice(0, idx);
  }

  private async load(
    source: () => Promise<readonly DiscoveredVendor[]>,
  ): Promise<void> {
    this._loading.set(true);
    try {
      const vendors = await source();
      await Promise.all(
        vendors
          .filter((vendor) => vendor.available && vendor.supportsModelList)
          .map((vendor) => this.ensureModelsLoaded(vendor)),
      );
    } finally {
      this._loading.set(false);
    }
  }

  private async ensureModelsLoaded(vendor: DiscoveredVendor): Promise<void> {
    if (!vendor.supportsModelList) return;
    if (this._modelsByBase().has(vendor.baseKey)) return;
    const models = await this.discovery.listModelsFor(vendor);
    this._modelsByBase.update((prev) => {
      const next = new Map(prev);
      next.set(vendor.baseKey, models);
      return next;
    });
  }

  /**
   * The model a freshly assigned slot starts on.
   *
   * A registry seed is honoured only when this vendor actually reports it;
   * otherwise the `<select>` would render a `[value]` matching no `<option>`,
   * the browser would silently show the first one, and the lane would carry an
   * id the user never saw into the run.
   */
  private defaultModelFor(vendor: DiscoveredVendor): string | undefined {
    const models = this._modelsByBase().get(vendor.baseKey) ?? [];
    const seeded = vendor.lane.model;
    if (seeded && models.some((model) => model.id === seeded)) return seeded;
    if (models.length > 0) return models[0].id;
    return seeded;
  }
}
