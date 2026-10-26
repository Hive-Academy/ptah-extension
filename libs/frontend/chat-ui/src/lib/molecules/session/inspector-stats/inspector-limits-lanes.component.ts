import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input } from '@angular/core';
import { Gauge, Info, LucideAngularModule } from 'lucide-angular';
import { LaneSubtotalTileComponent } from '../plan-limits/lane-subtotal-tile.component';
import { LaneUsageTileComponent } from '../plan-limits/lane-usage-tile.component';
import { PlanLimitTileComponent } from '../plan-limits/plan-limit-tile.component';
import { planSectionProvenance, sharedLaneCaption } from '../plan-limits/stats-limit-sections';
import { StatsTileExpansionState } from '../plan-limits/stats-tile-expansion.state';
import { sourceChipClass } from '../plan-limits/stats-tile.styles';
import type { StatsLimitViewModel } from '../plan-limits/stats-limit-view-model.types';
import { lanesAriaLabelFor } from '../session-stats-view';

let nextSectionId = 0;

@Component({
  selector: 'ptah-inspector-limits-lanes',
  standalone: true,
  imports: [LucideAngularModule, PlanLimitTileComponent, LaneUsageTileComponent, LaneSubtotalTileComponent],
  template: `
    @let vm = limits();
    @if (vm.planTiles.length || vm.refreshNotice) {
      <section class="p-4 border-t border-surface-border" [attr.aria-labelledby]="planHeadingId">
        <h3 [id]="planHeadingId" tabindex="-1" class="sec-label text-[10.5px] font-semibold uppercase">PLAN LIMITS</h3>
        @if (vm.refreshNotice) {
          <p role="status" class="border-l-2 border-info pl-2 text-[11px] text-base-content-muted">{{ vm.refreshNotice }}</p>
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
    @if (vm.laneTiles.length || vm.subtotal) {
      <section class="p-4 border-t border-surface-border" [attr.aria-labelledby]="lanesHeadingId">
        <div class="flex items-center justify-between gap-2">
          <h3 [id]="lanesHeadingId" tabindex="-1" class="sec-label text-[10.5px] font-semibold uppercase">LANES</h3>
          <span role="img" class="text-[11px] text-base-content-muted" [attr.aria-label]="lanesAriaLabelFor(vm.lanesCount)">
            {{ vm.laneTiles.length }} {{ vm.laneTiles.length === 1 ? 'lane' : 'lanes' }} · {{ vm.lanesCount }} runs
          </span>
        </div>
        @if (laneCaption(); as caption) {
          <p class="mb-2 flex items-center gap-1 text-[11px] text-base-content-muted">
            <lucide-angular [img]="InfoIcon" class="size-3" aria-hidden="true" /> {{ caption }}
          </p>
        }
        <div class="grid gap-2">
          @for (tile of vm.laneTiles; track tile.id) {
            <ptah-lane-usage-tile [tile]="tile" [open]="isOpen(tile.id)"
              [captionShared]="!!laneCaption()" [linkPlanTiles]="true"
              (toggled)="toggle(tile.id)" (planTileRequested)="openPlanTile($event)" />
          }
          @if (vm.subtotal; as subtotal) {
            <ptah-lane-subtotal-tile [tile]="subtotal" [captionShared]="!!laneCaption()" variant="inspector" />
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
  protected readonly InfoIcon = Info;
  protected readonly sourceChipClass = sourceChipClass;
  protected readonly lanesAriaLabelFor = lanesAriaLabelFor;
  protected readonly planProvenance = computed(() => planSectionProvenance(this.limits().planTiles));
  protected readonly laneCaption = computed(() => sharedLaneCaption(this.limits().laneTiles, this.limits().subtotal));

  protected isOpen(tileId: string): boolean { return this.expansion.isOpen(this.expansion.sessionKey(this, this.sessionId()), tileId); }
  protected toggle(tileId: string): void { this.expansion.toggle(this.expansion.sessionKey(this, this.sessionId()), tileId); }
  public focusHeading(which: 'session' | 'lane'): void {
    const id = which === 'session' ? this.planHeadingId : this.lanesHeadingId;
    (this.host.nativeElement.querySelector(`#${id}`) as HTMLElement | null)?.focus();
  }
  protected openPlanTile(tileId: string): void {
    if (!this.limits().planTiles.some(tile => tile.id === tileId)) return;
    this.expansion.setOpen(this.expansion.sessionKey(this, this.sessionId()), tileId, true);
    queueMicrotask(() => {
      const tiles = this.host.nativeElement.querySelectorAll('ptah-plan-limit-tile');
      for (const tile of tiles) {
        if (tile.getAttribute('data-tile-id') === tileId) {
          tile.querySelector('button')?.focus();
          break;
        }
      }
    });
  }
}
