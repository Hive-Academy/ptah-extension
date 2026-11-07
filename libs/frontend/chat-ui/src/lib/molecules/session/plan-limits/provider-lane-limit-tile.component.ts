import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PlanLimitTileModel, ProviderLaneLimitModel } from './stats-limit-view-model.types';

function percent(tile: PlanLimitTileModel): number | null {
  const value = tile.window?.percent;
  return value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
}

@Component({
  selector: 'ptah-provider-lane-limit-tile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = provider();
    <div class="rounded-lg border border-surface-border bg-surface-1 p-3" [attr.data-provider-id]="p.id">
      @if (primary(); as tile) {
        <div [attr.data-tile-id]="tile.id">
        <div class="flex items-baseline justify-between gap-2 text-xs">
          <span class="min-w-0 font-semibold text-base-content">{{ p.label }}</span>
          <span class="shrink-0 font-semibold tabular-nums" [class.text-warning]="tone(tile) === 'warning'"
            [class.text-error]="tone(tile) === 'error'">{{ tile.value }}</span>
        </div>
        @if (tile.window?.percent !== undefined) {
          <progress class="progress mt-2 h-2 w-full" [class.progress-success]="tone(tile) === 'success'"
            [class.progress-warning]="tone(tile) === 'warning'" [class.progress-error]="tone(tile) === 'error'"
            [value]="percent(tile)" max="100" [attr.aria-label]="p.label + ' ' + tile.label + ' usage'"
            [attr.aria-valuenow]="percent(tile)" [attr.aria-valuetext]="tile.value"></progress>
        }
        <p class="mt-1 text-[11px] text-base-content-muted">{{ tile.label }}@if (tile.resetLine) { · {{ tile.resetLine }} }</p>
        @if (tile.chip; as chip) {
          <p class="text-[11px]" [class.text-warning]="chip.tone === 'warning'" [class.text-error]="chip.tone === 'error'">{{ chip.text }}</p>
        }
        @if (tile.caption || tile.sourceChips.length) {
          <p class="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-base-content-muted">
            @if (tile.caption) { <span>{{ tile.caption }}</span> }
            @for (source of tile.sourceChips; track source) { <span class="badge badge-ghost badge-xs">{{ source }}</span> }
          </p>
        }
        @if (tile.kind !== 'window') {
          @for (line of tile.detailLines; track $index) { <p class="text-[10.5px] text-base-content-muted">{{ line }}</p> }
        }
        </div>
      } @else {
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="font-semibold">{{ p.label }}</span>
          <span class="text-base-content-muted">Usage · Unavailable</span>
        </div>
        <p class="mt-1 text-[11px] text-base-content-muted" data-testid="provider-limit-message">{{ p.message || 'Limits not tracked' }}</p>
      }
      @for (tile of extras(); track tile.id) {
        <div class="mt-2 border-t border-surface-border pt-2" [attr.data-tile-id]="tile.id" [attr.data-testid]="tile.kind === 'window' ? 'plan-extra-window' : 'plan-extra-tile'">
          <div class="flex justify-between gap-2 text-[11px] text-base-content-muted">
            <span>{{ tile.label }}</span><span class="tabular-nums" [class.text-warning]="tone(tile) === 'warning'"
              [class.text-error]="tone(tile) === 'error'">{{ tile.value }}</span>
          </div>
          @if (tile.window?.percent !== undefined) {
            <progress class="progress mt-1 h-1 w-full" [class.progress-success]="tone(tile) === 'success'"
              [class.progress-warning]="tone(tile) === 'warning'" [class.progress-error]="tone(tile) === 'error'"
              [value]="percent(tile)" max="100" [attr.aria-label]="p.label + ' ' + tile.label + ' usage'"
              [attr.aria-valuenow]="percent(tile)" [attr.aria-valuetext]="tile.value"></progress>
          }
          @if (tile.resetLine) { <p class="text-[10.5px] text-base-content-muted">{{ tile.resetLine }}</p> }
          @if (tile.kind !== 'window') {
            @if (tile.chip; as chip) {
              <p class="text-[11px]" [class.text-warning]="chip.tone === 'warning'" [class.text-error]="chip.tone === 'error'">{{ chip.text }}</p>
            }
            @for (line of tile.detailLines; track $index) { <p class="text-[10.5px] text-base-content-muted">{{ line }}</p> }
          }
        </div>
      }
    </div>
  `,
})
export class ProviderLaneLimitTileComponent {
  readonly provider = input.required<ProviderLaneLimitModel>();
  protected readonly windows = computed(() => this.provider().windows.filter(tile => tile.kind === 'window')
    .sort((a, b) => (percent(b) ?? -1) - (percent(a) ?? -1)));
  protected readonly primary = computed(() => this.windows()[0] ?? this.provider().windows[0] ?? null);
  protected readonly extras = computed(() => this.provider().windows.filter(tile => tile !== this.primary())
    .sort((a, b) => a.kind === 'window' && b.kind !== 'window' ? -1 : a.kind !== 'window' && b.kind === 'window' ? 1 : 0));
  protected readonly percent = percent;
  protected tone(tile: PlanLimitTileModel): 'success' | 'warning' | 'error' {
    return tile.tone === 'error' ? 'error' : tile.tone === 'warning' || (percent(tile) ?? 0) >= 75 ? 'warning' : 'success';
  }
}
