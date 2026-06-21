import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
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

const MAX_VISIBLE_TILES = 3;

@Component({
  selector: 'ptah-tribunal-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
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
              class="flex shrink-0 flex-wrap items-center gap-2 border-b border-base-300 px-4 py-2"
              data-testid="tribunal-panelist-bar"
            >
              <span
                class="text-xs font-semibold uppercase tracking-wide text-base-content/60"
              >
                Panelists
              </span>
              @if (showSwitcher()) {
                <div
                  class="flex flex-wrap items-center gap-1.5"
                  role="group"
                  aria-label="Panelist switcher"
                  data-testid="tribunal-pill-switcher"
                >
                  @for (lane of tribunalState.lanes(); track lane.laneId) {
                    <button
                      type="button"
                      class="btn btn-xs gap-1.5 normal-case"
                      data-testid="tribunal-pill"
                      [class.btn-primary]="isVisible(lane.laneId)"
                      [class.btn-ghost]="!isVisible(lane.laneId)"
                      [attr.aria-pressed]="isVisible(lane.laneId)"
                      (click)="togglePill(lane.laneId)"
                    >
                      <span
                        class="h-1.5 w-1.5 rounded-full"
                        [class.bg-base-content]="laneStatus(lane) === 'idle'"
                        [class.opacity-40]="laneStatus(lane) === 'idle'"
                        [class.bg-info]="laneStatus(lane) === 'running'"
                        [class.animate-pulse]="laneStatus(lane) === 'running'"
                        [class.bg-success]="laneStatus(lane) === 'completed'"
                        [class.bg-error]="laneStatus(lane) === 'failed'"
                        aria-hidden="true"
                      ></span>
                      <span class="font-medium">{{ lane.displayName }}</span>
                      @if (lane.model) {
                        <span class="font-mono opacity-60">{{
                          lane.model
                        }}</span>
                      }
                    </button>
                  }
                </div>
              }
            </div>

            <div class="min-h-0 flex-1 overflow-hidden p-3">
              <div class="flex h-full gap-3">
                @for (tile of visibleTiles(); track tile.tileId) {
                  <ptah-tribunal-tile-host
                    class="min-h-0 min-w-0 flex-1"
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
                }
              </div>
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
    `,
  ],
})
export class TribunalPageComponent {
  protected readonly tribunalState = inject(TribunalStateService);
  private readonly runService = inject(TribunalRunService);

  protected readonly convene = signal(false);
  protected readonly focusedTileId = signal<string | null>(null);
  private readonly visibleLaneIds = signal<readonly string[]>([]);

  protected readonly showWizard = computed(
    () => this.convene() && this.tribunalState.tiles().length === 0,
  );

  protected readonly showSwitcher = computed(
    () => this.tribunalState.lanes().length > MAX_VISIBLE_TILES,
  );

  protected readonly visibleTiles = computed<readonly TribunalTile[]>(() => {
    const tiles = this.tribunalState.tiles();
    if (tiles.length <= MAX_VISIBLE_TILES) return tiles;
    const visible = new Set(this.visibleLaneIds());
    return tiles.filter((t) => t.laneId != null && visible.has(t.laneId));
  });

  constructor() {
    effect(() => {
      const lanes = this.tribunalState.lanes();
      untracked(() => {
        const current = this.visibleLaneIds().filter((id) =>
          lanes.some((l) => l.laneId === id),
        );
        if (current.length > 0) {
          this.visibleLaneIds.set(current.slice(0, MAX_VISIBLE_TILES));
          return;
        }
        this.visibleLaneIds.set(
          lanes.slice(0, MAX_VISIBLE_TILES).map((l) => l.laneId),
        );
      });
    });
  }

  protected readonly tribunalSessionId = this.tribunalState.tribunalSessionId;

  protected isVisible(laneId: string): boolean {
    return this.visibleLaneIds().includes(laneId);
  }

  protected togglePill(laneId: string): void {
    this.visibleLaneIds.update((prev) => {
      if (prev.includes(laneId)) {
        return prev.filter((id) => id !== laneId);
      }
      if (prev.length >= MAX_VISIBLE_TILES) {
        return [...prev.slice(1), laneId];
      }
      return [...prev, laneId];
    });
  }

  protected onLaunched(): void {
    this.convene.set(false);
  }

  protected async onCloseRun(): Promise<void> {
    const closed = await this.runService.endRun();
    if (!closed) return;
    this.convene.set(false);
    this.focusedTileId.set(null);
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

  protected laneStatus(lane: VendorLane): TribunalTileStatus {
    return this.statusForLaneId(lane.laneId);
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
