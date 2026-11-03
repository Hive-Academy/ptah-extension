import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { Gauge, LucideAngularModule } from 'lucide-angular';
import { PlanLimitTileComponent } from '../plan-limits/plan-limit-tile.component';
import { planSectionProvenance } from '../plan-limits/stats-limit-sections';
import { StatsTileExpansionState } from '../plan-limits/stats-tile-expansion.state';
import { sourceChipClass } from '../plan-limits/stats-tile.styles';
import type { StatsLimitViewModel } from '../plan-limits/stats-limit-view-model.types';
import { ProviderLaneLimitTileComponent } from '../plan-limits/provider-lane-limit-tile.component';

let nextSectionId = 0;

@Component({
  selector: 'ptah-inspector-limits-lanes',
  standalone: true,
  imports: [LucideAngularModule, PlanLimitTileComponent, ProviderLaneLimitTileComponent],
  template: `
    @let vm = limits();
    @if (vm.planTiles.length || vm.refreshNotice) {
      <section class="p-4 border-t border-surface-border" [attr.aria-labelledby]="planHeadingId">
        <h3 [id]="planHeadingId" tabindex="-1" class="sec-label text-[10.5px] font-semibold uppercase">PLAN LIMITS</h3>
        @if (vm.refreshNotice) {
          <p role="status" data-testid="limits-refresh-failed" class="border-l-2 border-info pl-2 text-[11px] text-base-content-muted">{{ vm.refreshNotice }}</p>
        }
        @let provenance = planProvenance();
        @if (provenance.caption?.caption || provenance.sourceChips.length) {
          <div class="mb-2 flex items-center gap-1.5 text-[11px] text-base-content-muted">
            <lucide-angular [img]="GaugeIcon" class="size-3.5 shrink-0" aria-hidden="true" />
            @if (provenance.caption; as caption) {
              <span class="min-w-0 truncate">{{ caption.captionLead }}</span>
              @if (caption.captionTail) { <span class="shrink-0">{{ caption.captionTail }}</span> }
            }
            @for (source of provenance.sourceChips; track source) {
              <span [class]="sourceChipClass(source)">{{ source }}</span>
            }
          </div>
        }
        <div class="grid gap-2">
          @for (tile of vm.planTiles; track tile.id) {
            <ptah-plan-limit-tile [tile]="tile" [open]="isOpen(tile.id)"
              [captionShared]="!!provenance.caption" [sharedSources]="provenance.sourceChips"
              variant="inspector" (toggled)="toggle(tile.id)" />
          }
        </div>
      </section>
    }
    @if (vm.providerLimits.length) {
      <section class="p-4 border-t border-surface-border" [attr.aria-labelledby]="lanesHeadingId">
        <div class="mb-2 flex items-center justify-between">
          <h3 [id]="lanesHeadingId" tabindex="-1" class="sec-label text-[10.5px] font-semibold uppercase">LANES</h3>
          <span data-testid="lanes-count" class="text-[10.5px] text-base-content-muted">{{ vm.providerLimits.length }} {{ vm.providerLimits.length === 1 ? 'provider' : 'providers' }}</span>
        </div>
        <div class="grid gap-1.5">
          @for (provider of vm.providerLimits; track provider.id) {
            <ptah-provider-lane-limit-tile [provider]="provider" [planTileIds]="planTileIds()"
              (planTileRequested)="openPlanTile($event)" />
          }
        </div>
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorLimitsLanesComponent {
  readonly limits = input.required<StatsLimitViewModel>();
  readonly sessionId = input<string | null>(null);
  private readonly expansion = inject(StatsTileExpansionState, { optional: true }) ?? new StatsTileExpansionState();
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly instanceId = ++nextSectionId;
  protected readonly planHeadingId = `ptah-plan-h-${this.instanceId}`;
  protected readonly lanesHeadingId = `ptah-lanes-h-${this.instanceId}`;
  protected readonly GaugeIcon = Gauge;
  protected readonly sourceChipClass = sourceChipClass;
  protected readonly planProvenance = computed(() => planSectionProvenance(this.limits().planTiles));
  protected readonly planTileIds = computed(() => this.limits().planTiles.map(tile => tile.id));
  protected isOpen(tileId: string): boolean { return this.expansion.isOpen(this.expansion.sessionKey(this, this.sessionId()), tileId); }
  protected toggle(tileId: string): void { this.expansion.toggle(this.expansion.sessionKey(this, this.sessionId()), tileId); }
  protected openPlanTile(tileId: string): void {
    if (!this.planTileIds().includes(tileId)) return;
    this.expansion.setOpen(this.expansion.sessionKey(this, this.sessionId()), tileId, true);
    queueMicrotask(() => {
      for (const tile of this.host.nativeElement.querySelectorAll('ptah-plan-limit-tile')) {
        if (tile.getAttribute('data-tile-id') === tileId) {
          tile.querySelector('button')?.focus();
          break;
        }
      }
    });
  }
}
