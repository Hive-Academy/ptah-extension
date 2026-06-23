import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { GridStackOptions } from 'gridstack';
import {
  GridstackComponent,
  GridstackItemComponent,
  nodesCB,
} from 'gridstack/dist/angular';
import { LucideAngularModule, Lock, Unlock } from 'lucide-angular';
import { TribunalStateService } from './services/tribunal-state.service';
import { TribunalRunService } from './services/tribunal-run.service';
import {
  TribunalTileHostComponent,
  type TribunalTileStatus,
} from './tribunal-tile-host.component';
import { TribunalEmptyStateComponent } from './components/tribunal-empty-state.component';
import { ConductorTileComponent } from './components/conductor-tile.component';
import { VendorCardComponent } from './components/vendor-card.component';
import { TribunalWizardComponent } from './wizard/tribunal-wizard.component';
import type { TribunalTile, VendorLane } from './types/tribunal-ui.types';

@Component({
  selector: 'ptah-tribunal-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GridstackComponent,
    GridstackItemComponent,
    LucideAngularModule,
    TribunalTileHostComponent,
    TribunalEmptyStateComponent,
    ConductorTileComponent,
    VendorCardComponent,
    TribunalWizardComponent,
  ],
  template: `
    <div class="flex h-full flex-col bg-base-100" data-testid="tribunal-grid">
      @if (showWizard()) {
        <ptah-tribunal-wizard (launched)="onLaunched()" />
      } @else if (tribunalState.tiles().length === 0) {
        <ptah-tribunal-empty-state (convene)="convene.set(true)" />
      } @else {
        <div
          class="flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-2"
          data-testid="tribunal-top-bar"
        >
          <span class="text-sm font-semibold text-base-content">Tribunal</span>
          <span
            class="rounded-full bg-base-300 px-2 py-0.5 text-[10px] uppercase tracking-wide text-base-content/70"
          >
            {{ tribunalState.move() }}
          </span>
          <button
            type="button"
            class="btn btn-ghost btn-xs ml-auto shrink-0"
            data-testid="tribunal-close-run"
            (click)="onCloseRun()"
          >
            Close Tribunal
          </button>
        </div>

        <div class="flex min-h-0 flex-1">
          <aside
            class="flex h-full min-h-0 w-[380px] min-w-[320px] shrink-0 flex-col border-r border-base-300 lg:w-[30%]"
            data-testid="tribunal-conductor-pane"
          >
            <ptah-conductor-tile class="flex h-full min-h-0 flex-1" />
          </aside>

          <div class="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              class="flex shrink-0 items-center gap-2 border-b border-base-300 px-4 py-2"
              data-testid="tribunal-panelist-bar"
            >
              <span
                class="text-xs font-semibold uppercase tracking-wide text-base-content/60"
              >
                Panelists
              </span>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square ml-auto shrink-0 text-base-content/60"
                [attr.aria-pressed]="locked()"
                [title]="
                  locked()
                    ? 'Unlock tiles (enable drag & resize)'
                    : 'Lock tiles (freeze layout)'
                "
                [attr.aria-label]="locked() ? 'Unlock tiles' : 'Lock tiles'"
                data-testid="tribunal-lock-toggle"
                (click)="toggleLock()"
              >
                <lucide-angular
                  [img]="locked() ? LockIcon : UnlockIcon"
                  class="h-3.5 w-3.5"
                />
              </button>
            </div>

            <div class="min-h-0 flex-1 overflow-auto p-3">
              <gridstack
                [options]="gsOptions"
                (changeCB)="onGridChange($event)"
              >
                @for (tile of tribunalState.tiles(); track tile.tileId) {
                  <gridstack-item
                    [options]="{
                      x: tile.position.x,
                      y: tile.position.y,
                      w: tile.position.w,
                      h: tile.position.h,
                      id: tile.tileId,
                    }"
                  >
                    <ptah-tribunal-tile-host
                      class="min-h-0 min-w-0"
                      data-testid="tribunal-tile"
                      [tile]="tile"
                      [label]="tileLabel(tile)"
                      [model]="tileModel(tile)"
                      [status]="tileStatus(tile)"
                      [focused]="focusedTileId() === tile.tileId"
                      (focusRequested)="focusedTileId.set(tile.tileId)"
                    >
                      @if (laneFor(tile); as lane) {
                        <ptah-vendor-card
                          [lane]="lane"
                          [tribunalSessionId]="tribunalSessionId() ?? ''"
                        />
                      } @else {
                        <div class="p-3 text-xs text-base-content/50">
                          {{ tileLabel(tile) }}
                        </div>
                      }
                    </ptah-tribunal-tile-host>
                  </gridstack-item>
                }
              </gridstack>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      gridstack {
        min-height: 200px;
      }

      gridstack-item ::ng-deep .grid-stack-item-content {
        inset: 0;
        overflow: hidden;
      }
    `,
  ],
})
export class TribunalPageComponent {
  protected readonly tribunalState = inject(TribunalStateService);
  private readonly runService = inject(TribunalRunService);

  protected readonly convene = signal(false);
  protected readonly focusedTileId = signal<string | null>(null);
  protected readonly locked = signal(false);

  private readonly gridComp = viewChild(GridstackComponent);

  protected readonly LockIcon = Lock;
  protected readonly UnlockIcon = Unlock;

  protected readonly gsOptions: GridStackOptions = {
    column: 12,
    cellHeight: 90,
    float: true,
    margin: 8,
    draggable: { handle: '.tile-header' },
    resizable: { handles: 'e, se, s, sw, w' },
    animate: true,
  };

  protected readonly showWizard = computed(
    () => this.convene() && this.tribunalState.tiles().length === 0,
  );

  protected readonly tribunalSessionId = this.tribunalState.tribunalSessionId;

  protected onLaunched(): void {
    this.convene.set(false);
  }

  protected async onCloseRun(): Promise<void> {
    const closed = await this.runService.endRun();
    if (!closed) return;
    this.convene.set(false);
    this.focusedTileId.set(null);
    this.locked.set(false);
  }

  protected toggleLock(): void {
    const next = !this.locked();
    this.locked.set(next);
    this.gridComp()?.grid?.setStatic(next);
  }

  protected onGridChange(data: nodesCB): void {
    for (const node of data.nodes) {
      if (typeof node.id !== 'string') continue;
      this.tribunalState.updateTilePosition(node.id, {
        x: node.x ?? 0,
        y: node.y ?? 0,
        w: node.w ?? 4,
        h: node.h ?? 6,
      });
    }
  }

  protected laneFor(tile: TribunalTile): VendorLane | null {
    if (!tile.laneId) return null;
    return (
      this.tribunalState.lanes().find((l) => l.laneId === tile.laneId) ?? null
    );
  }

  protected tileLabel(tile: TribunalTile): string {
    const lane = this.laneFor(tile);
    return lane ? lane.displayName : 'Vendor';
  }

  protected tileModel(tile: TribunalTile): string {
    return this.laneFor(tile)?.model ?? '';
  }

  protected tileStatus(tile: TribunalTile): TribunalTileStatus {
    if (!tile.laneId) return 'idle';
    return this.statusForLaneId(tile.laneId);
  }

  private statusForLaneId(laneId: string): TribunalTileStatus {
    const agent = this.tribunalState.laneBindings().get(laneId) ?? null;
    if (!agent) return 'idle';
    switch (agent.status) {
      case 'running':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'idle';
    }
  }
}
