import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { PlanLimitTileComponent } from './plan-limit-tile.component';
import type { ProviderLaneLimitModel } from './stats-limit-view-model.types';

@Component({
  selector: 'ptah-provider-lane-limit-tile',
  standalone: true,
  imports: [PlanLimitTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-lg border border-surface-border p-2" [attr.data-provider-id]="provider().id">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-semibold">{{ provider().label }}</span>
        @if (provider().windows.length > 1 || provider().ownerDetails.length > 1 || hasHiddenTiles()) {
          <button type="button" class="text-xs text-base-content-muted underline" [attr.aria-expanded]="expanded()"
            (click)="expanded.set(!expanded())">{{ expanded() ? 'Less detail' : 'More detail' }}</button>
        }
      </div>
      @if (provider().message) {
        <p class="text-xs text-base-content-muted" role="status">{{ provider().message }}</p>
      }
      @if (selected(); as tile) {
        <ptah-plan-limit-tile [tile]="tile" variant="inspector" [open]="tileOpen()"
          (toggled)="tileOpen.set(!tileOpen())" />
        @if (planTileIds().includes(tile.id)) {
          <button type="button" class="text-xs underline" (click)="planTileRequested.emit(tile.id)">
            Show in plan limits
          </button>
        }
      }
      @if (expanded()) {
        @if (windowTiles().length > 1) {
          <label class="block text-xs text-base-content-muted">Window
            <select #windowSelect class="select select-xs w-full" [value]="selected()?.id ?? ''"
              (change)="selectedId.set(windowSelect.value)" aria-label="Select plan window">
              @for (tile of windowTiles(); track tile.id) { <option [value]="tile.id">{{ tile.label }}</option> }
            </select>
          </label>
        }
        @for (owner of provider().ownerDetails; track owner) {
          <p class="text-xs text-base-content-muted">{{ owner }}</p>
        }
        @for (tile of provider().windows; track tile.id) {
          @if (tile.kind !== 'window') { <ptah-plan-limit-tile [tile]="tile" variant="inspector" /> }
        }
      }
    </div>
  `,
})
export class ProviderLaneLimitTileComponent {
  readonly provider = input.required<ProviderLaneLimitModel>();
  readonly planTileIds = input<readonly string[]>([]);
  readonly planTileRequested = output<string>();
  protected readonly expanded = signal(false);
  protected readonly tileOpen = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly windowTiles = computed(() => this.provider().windows.filter(tile => tile.kind === 'window'));
  protected readonly hasHiddenTiles = computed(() => this.provider().windows.some(tile => tile.kind !== 'window'));
  protected readonly selected = computed(() => this.windowTiles().find(tile => tile.id === this.selectedId()) ?? this.windowTiles()[0] ?? null);
}
