import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, RefreshCw, Settings } from 'lucide-angular';
import { WebviewNavigationService } from '@ptah-extension/core';
import {
  TribunalDiscoveryService,
  type DiscoveredVendor,
} from '../services/tribunal-discovery.service';
import type { VendorLane } from '../types/tribunal-ui.types';

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
            Toggle the vendors to convene. Up to {{ maxVendors }} lanes.
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
            >Selected</span
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

      @if (loading() && vendors().length === 0) {
        <div class="flex items-center justify-center py-8">
          <span class="loading loading-dots loading-md"></span>
        </div>
      } @else if (vendors().length === 0) {
        <p class="py-6 text-center text-sm text-base-content/50">
          No vendors discovered. Install a CLI agent to convene a panel.
        </p>
      } @else {
        <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          @for (vendor of vendors(); track vendor.lane.laneId) {
            <button
              type="button"
              class="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors"
              [class.border-primary]="isSelected(vendor.lane.laneId)"
              [class.bg-primary/5]="isSelected(vendor.lane.laneId)"
              [class.border-base-300]="!isSelected(vendor.lane.laneId)"
              [class.opacity-50]="vendor.needsSetup"
              [disabled]="!canToggle(vendor)"
              [attr.aria-pressed]="isSelected(vendor.lane.laneId)"
              [attr.aria-label]="vendor.lane.displayName"
              (click)="toggle(vendor)"
            >
              <span
                class="h-2.5 w-2.5 shrink-0 rounded-full"
                [class.bg-success]="vendor.available"
                [class.bg-base-content]="vendor.needsSetup"
                [class.opacity-40]="vendor.needsSetup"
                aria-hidden="true"
              ></span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm font-medium text-base-content">{{
                  vendor.lane.displayName
                }}</span>
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
                  class="rounded border px-2 py-0.5 text-[11px]"
                  [class.border-primary]="isSelected(vendor.lane.laneId)"
                  [class.text-primary]="isSelected(vendor.lane.laneId)"
                  [class.border-base-300]="!isSelected(vendor.lane.laneId)"
                  [class.text-base-content/50]="!isSelected(vendor.lane.laneId)"
                >
                  {{ isSelected(vendor.lane.laneId) ? 'On' : 'Off' }}
                </span>
              }
            </button>
          }
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
  protected readonly maxVendors = this.discovery.maxVendors;

  private readonly _vendors = signal<readonly DiscoveredVendor[]>([]);
  private readonly _loading = signal(false);

  protected readonly vendors = this._vendors.asReadonly();
  protected readonly loading = this._loading.asReadonly();

  private readonly selectedIds = computed(
    () => new Set(this.selectedLanes().map((lane) => lane.laneId)),
  );

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
    } finally {
      this._loading.set(false);
    }
  }

  protected isSelected(laneId: string): boolean {
    return this.selectedIds().has(laneId);
  }

  protected statusText(vendor: DiscoveredVendor): string {
    if (vendor.available) return 'Available';
    return vendor.lane.cli === 'ptah-cli' ? 'Needs API key' : 'Not installed';
  }

  protected canToggle(vendor: DiscoveredVendor): boolean {
    if (this.isSelected(vendor.lane.laneId)) return true;
    if (!vendor.available) return false;
    return this.selectedCount() < this.maxVendors;
  }

  protected configure(event: Event, vendor: DiscoveredVendor): void {
    event.preventDefault();
    event.stopPropagation();
    void this.navigation.navigateToSettingsTab(
      'orchestration',
      vendor.lane.providerId,
    );
  }

  protected toggle(vendor: DiscoveredVendor): void {
    if (!this.canToggle(vendor)) return;
    const laneId = vendor.lane.laneId;
    const current = this.selectedLanes();
    if (this.isSelected(laneId)) {
      this.lanesChanged.emit(current.filter((lane) => lane.laneId !== laneId));
      return;
    }
    if (current.length >= this.maxVendors) return;
    this.lanesChanged.emit([...current, vendor.lane]);
  }
}
