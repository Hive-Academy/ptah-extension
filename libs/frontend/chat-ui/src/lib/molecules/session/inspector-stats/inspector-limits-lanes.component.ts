import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ProviderLaneLimitTileComponent } from '../plan-limits/provider-lane-limit-tile.component';
import type { ProviderLaneLimitModel, StatsLimitViewModel } from '../plan-limits/stats-limit-view-model.types';

@Component({
  selector: 'ptah-inspector-limits-lanes',
  standalone: true,
  imports: [ProviderLaneLimitTileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let vm = limits();
    @if (providers().length || vm.refreshNotice) {
      <section class="border-t border-surface-border p-4" aria-labelledby="inspector-plan-limits-heading">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h3 id="inspector-plan-limits-heading" tabindex="-1" class="sec-label text-[10.5px] font-semibold uppercase">PLAN LIMITS</h3>
          <span data-testid="providers-count" class="text-[10.5px] text-base-content-muted">{{ providers().length }} {{ providers().length === 1 ? 'provider' : 'providers' }}</span>
        </div>
        @if (vm.refreshNotice) {
          <p role="status" data-testid="limits-refresh-failed" class="border-l-2 border-info pl-2 text-[11px] text-base-content-muted">{{ vm.refreshNotice }}</p>
        }
        <div class="grid gap-2">
          @for (provider of providers(); track provider.id) {
            <ptah-provider-lane-limit-tile [provider]="provider" />
          }
        </div>
      </section>
    }
  `,
})
export class InspectorLimitsLanesComponent {
  readonly limits = input.required<StatsLimitViewModel>();
  readonly sessionId = input<string | null>(null);
  protected readonly providers = computed((): readonly ProviderLaneLimitModel[] => {
    const vm = this.limits();
    const session: ProviderLaneLimitModel[] = vm.planTiles.length ? [{
      id: 'session-provider', label: 'Claude', ownerState: 'single',
      windows: vm.planTiles, message: 'Limits not tracked', ownerDetails: [],
    }] : [];
    return [...session, ...vm.providerLimits.map(provider => ({
      ...provider,
      label: provider.id === 'provider:codex' ? 'Codex'
        : provider.id === 'provider:kimi-code' || provider.id === 'provider:kimi' ? 'Kimi Code'
        : provider.label,
    }))];
  });
}
