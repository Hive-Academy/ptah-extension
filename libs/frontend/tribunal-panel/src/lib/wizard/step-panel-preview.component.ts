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
  Plus,
  X,
} from 'lucide-angular';
import { WebviewNavigationService } from '@ptah-extension/core';
import type { ProviderModelInfo } from '@ptah-extension/shared';
import {
  TribunalDiscoveryService,
  type DiscoveredVendor,
} from '../services/tribunal-discovery.service';
import {
  laneBaseKey,
  makeLaneId,
  type VendorLane,
} from '../types/tribunal-ui.types';

@Component({
  selector: 'ptah-step-panel-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div class="flex flex-col gap-4" data-testid="tribunal-step-panel-preview">
      <header class="flex items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h3 class="text-base font-semibold text-base-content">
            Assemble the panel
          </h3>
          <p class="text-sm text-base-content/55">
            Add vendors and pick a model per lane. The same vendor can appear
            multiple times. Up to {{ maxVendors }} lanes.
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

      <div
        class="flex items-center gap-3 rounded-lg border border-base-300 bg-base-200/40 px-3 py-2"
      >
        <div class="flex flex-col">
          <span class="text-lg font-semibold tabular-nums text-base-content">{{
            selectedCount()
          }}</span>
          <span class="text-[10px] uppercase tracking-wide text-base-content/45"
            >Lanes</span
          >
        </div>
        <div class="h-8 w-px bg-base-300"></div>
        <div class="flex flex-col">
          <span class="text-lg font-semibold tabular-nums text-base-content">{{
            availableCount()
          }}</span>
          <span class="text-[10px] uppercase tracking-wide text-base-content/45"
            >Available</span
          >
        </div>
        <div class="h-8 w-px bg-base-300"></div>
        <div class="flex flex-col">
          <span class="text-lg font-semibold tabular-nums text-base-content"
            >{{ selectedCount() }}/{{ maxVendors }}</span
          >
          <span class="text-[10px] uppercase tracking-wide text-base-content/45"
            >Cap</span
          >
        </div>
      </div>

      @if (selectedLanes().length > 0) {
        <div class="flex flex-col gap-2" data-testid="tribunal-selected-lanes">
          @for (lane of selectedLanes(); track lane.laneId) {
            <div
              class="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="truncate text-sm font-medium text-base-content">{{
                  lane.displayName
                }}</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-square"
                  [attr.aria-label]="'Remove ' + lane.displayName + ' lane'"
                  (click)="removeLane(lane.laneId)"
                >
                  <lucide-angular
                    [img]="RemoveIcon"
                    class="h-3.5 w-3.5"
                    aria-hidden="true"
                  />
                </button>
              </div>
              @if (modelOptionsForLane(lane).length > 0) {
                <label class="flex flex-col gap-1">
                  <span
                    class="text-[10px] uppercase tracking-wide text-base-content/45"
                    >Model</span
                  >
                  <select
                    class="select select-bordered select-xs w-full font-mono"
                    [attr.aria-label]="lane.displayName + ' model'"
                    [value]="lane.model ?? ''"
                    (change)="onModelChange(lane.laneId, $event)"
                  >
                    @for (model of modelOptionsForLane(lane); track model.id) {
                      <option [value]="model.id">{{ model.name }}</option>
                    }
                  </select>
                </label>
              } @else if (laneSupportsModel(lane)) {
                <span class="text-[11px] text-base-content/50">
                  {{ lane.model ?? 'Provider default model' }}
                </span>
              } @else {
                <span class="text-[11px] text-base-content/50">
                  No model selection for this vendor.
                </span>
              }
            </div>
          }
        </div>
      }

      @if (loading() && vendors().length === 0) {
        <div class="flex items-center justify-center py-8">
          <span class="loading loading-dots loading-md"></span>
        </div>
      } @else if (vendors().length === 0) {
        <p class="py-6 text-center text-sm text-base-content/50">
          No vendors discovered. Install a CLI agent to convene a panel.
        </p>
      } @else {
        <div class="flex flex-col gap-1.5">
          <span class="text-[10px] uppercase tracking-wide text-base-content/45"
            >Add a lane</span
          >
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            @for (vendor of vendors(); track vendor.lane.laneId) {
              <button
                type="button"
                class="flex items-center gap-3 rounded-lg border border-base-300 p-3 text-left transition-colors"
                [class.opacity-50]="vendor.needsSetup"
                [disabled]="!canAdd(vendor)"
                [attr.aria-label]="'Add ' + vendor.lane.displayName"
                (click)="addInstance(vendor)"
              >
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  [class.bg-success]="vendor.available"
                  [class.bg-base-content]="vendor.needsSetup"
                  [class.opacity-40]="vendor.needsSetup"
                  aria-hidden="true"
                ></span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span
                    class="truncate text-sm font-medium text-base-content"
                    >{{ vendor.lane.displayName }}</span
                  >
                  <span class="text-[11px] text-base-content/50">
                    {{ statusText(vendor) }}
                  </span>
                </span>
                @if (vendor.needsSetup) {
                  <span
                    role="link"
                    tabindex="0"
                    class="flex shrink-0 items-center gap-1 rounded border border-base-300 px-2 py-0.5 text-[11px] text-base-content/70 hover:border-primary hover:text-primary"
                    [attr.aria-label]="'Configure ' + vendor.lane.displayName"
                    (click)="configure($event, vendor)"
                    (keydown.enter)="configure($event, vendor)"
                    (keydown.space)="configure($event, vendor)"
                  >
                    <lucide-angular
                      [img]="SettingsIcon"
                      class="h-3 w-3"
                      aria-hidden="true"
                    />
                    Configure
                  </span>
                } @else {
                  <span
                    class="flex shrink-0 items-center gap-1 rounded border border-base-300 px-2 py-0.5 text-[11px] text-base-content/60"
                  >
                    <lucide-angular
                      [img]="AddIcon"
                      class="h-3 w-3"
                      aria-hidden="true"
                    />
                    Add
                    @if (instanceCount(vendor.baseKey) > 0) {
                      <span class="tabular-nums"
                        >({{ instanceCount(vendor.baseKey) }})</span
                      >
                    }
                  </span>
                }
              </button>
            }
          </div>
        </div>
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
export class StepPanelPreviewComponent {
  readonly selectedLanes = input<readonly VendorLane[]>([]);
  readonly lanesChanged = output<readonly VendorLane[]>();

  private readonly discovery = inject(TribunalDiscoveryService);
  private readonly navigation = inject(WebviewNavigationService);

  protected readonly RefreshIcon = RefreshCw;
  protected readonly SettingsIcon = Settings;
  protected readonly AddIcon = Plus;
  protected readonly RemoveIcon = X;
  protected readonly maxVendors = this.discovery.maxVendors;

  private readonly _vendors = signal<readonly DiscoveredVendor[]>([]);
  private readonly _loading = signal(false);
  private readonly _modelsByBase = signal<
    ReadonlyMap<string, readonly ProviderModelInfo[]>
  >(new Map());

  protected readonly vendors = this._vendors.asReadonly();
  protected readonly loading = this._loading.asReadonly();

  protected readonly selectedCount = computed(
    () => this.selectedLanes().length,
  );
  protected readonly availableCount = computed(
    () => this._vendors().filter((v) => v.available).length,
  );

  constructor() {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this._loading.set(true);
    try {
      const vendors = await this.discovery.discover();
      this._vendors.set(vendors);
      await Promise.all(
        vendors
          .filter((v) => v.available && v.supportsModelList)
          .map((v) => this.ensureModelsLoaded(v)),
      );
    } finally {
      this._loading.set(false);
    }
  }

  protected statusText(vendor: DiscoveredVendor): string {
    if (vendor.available) return 'Available';
    return vendor.lane.cli === 'ptah-cli' ? 'Needs API key' : 'Not installed';
  }

  protected canAdd(vendor: DiscoveredVendor): boolean {
    if (!vendor.available) return false;
    return this.selectedCount() < this.maxVendors;
  }

  protected instanceCount(baseKey: string): number {
    return this.selectedLanes().filter((lane) => laneBaseKey(lane) === baseKey)
      .length;
  }

  protected laneSupportsModel(lane: VendorLane): boolean {
    return this.findVendor(lane)?.supportsModelList ?? false;
  }

  protected modelOptionsForLane(
    lane: VendorLane,
  ): readonly ProviderModelInfo[] {
    return this._modelsByBase().get(laneBaseKey(lane)) ?? [];
  }

  protected configure(event: Event, vendor: DiscoveredVendor): void {
    event.preventDefault();
    event.stopPropagation();
    void this.navigation.navigateToSettingsTab(
      'orchestration',
      vendor.lane.providerId,
    );
  }

  protected async addInstance(vendor: DiscoveredVendor): Promise<void> {
    if (!this.canAdd(vendor)) return;
    await this.ensureModelsLoaded(vendor);

    const current = this.selectedLanes();
    const usedIndices = new Set(
      current
        .filter((lane) => laneBaseKey(lane) === vendor.baseKey)
        .map((lane) => this.instanceIndexOf(lane.laneId)),
    );
    let nextIndex = 0;
    while (usedIndices.has(nextIndex)) nextIndex += 1;

    const defaultModel = this.defaultModelFor(vendor);
    const lane: VendorLane = {
      ...vendor.lane,
      laneId: makeLaneId(vendor.baseKey, nextIndex),
      ...(defaultModel ? { model: defaultModel } : {}),
    };
    this.lanesChanged.emit([...current, lane]);
  }

  protected removeLane(laneId: string): void {
    this.lanesChanged.emit(
      this.selectedLanes().filter((lane) => lane.laneId !== laneId),
    );
  }

  protected onModelChange(laneId: string, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.lanesChanged.emit(
      this.selectedLanes().map((lane) =>
        lane.laneId === laneId ? { ...lane, model: value } : lane,
      ),
    );
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

  private defaultModelFor(vendor: DiscoveredVendor): string | undefined {
    if (vendor.lane.model) return vendor.lane.model;
    const models = this._modelsByBase().get(vendor.baseKey);
    return models && models.length > 0 ? models[0].id : undefined;
  }

  private findVendor(lane: VendorLane): DiscoveredVendor | undefined {
    const base = laneBaseKey(lane);
    return this._vendors().find((v) => v.baseKey === base);
  }

  private instanceIndexOf(laneId: string): number {
    const idx = laneId.lastIndexOf('#');
    if (idx < 0) return 0;
    const parsed = Number.parseInt(laneId.slice(idx + 1), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
}
