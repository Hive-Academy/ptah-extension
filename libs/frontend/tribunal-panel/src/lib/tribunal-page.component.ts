import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { GridStackOptions } from 'gridstack';
import {
  GridstackComponent,
  GridstackItemComponent,
  nodesCB,
} from 'gridstack/dist/angular';
import { CanvasLayoutService } from '@ptah-extension/canvas';
import type { TileLayout } from '@ptah-extension/canvas';
import {
  PermissionRequestCardComponent,
  QuestionCardComponent,
} from '@ptah-extension/chat';
import { PermissionHandlerService } from '@ptah-extension/chat-streaming';
import type {
  PermissionResponse,
  AskUserQuestionResponse,
} from '@ptah-extension/shared';
import { TribunalStateService } from './services/tribunal-state.service';
import {
  TribunalTileHostComponent,
  type TribunalTileStatus,
} from './tribunal-tile-host.component';
import { TribunalEmptyStateComponent } from './components/tribunal-empty-state.component';
import { ConductorStripComponent } from './components/conductor-strip.component';
import { VendorCardComponent } from './components/vendor-card.component';
import { TribunalWizardComponent } from './wizard/tribunal-wizard.component';
import type { TribunalTile, VendorLane } from './types/tribunal-ui.types';

@Component({
  selector: 'ptah-tribunal-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CanvasLayoutService],
  imports: [
    GridstackComponent,
    GridstackItemComponent,
    TribunalTileHostComponent,
    TribunalEmptyStateComponent,
    ConductorStripComponent,
    VendorCardComponent,
    TribunalWizardComponent,
    PermissionRequestCardComponent,
    QuestionCardComponent,
  ],
  template: `
    <div
      #tribunalContainer
      class="flex h-full flex-col bg-base-100"
      data-testid="tribunal-grid"
    >
      @if (showWizard()) {
        <ptah-tribunal-wizard (launched)="onLaunched()" />
      } @else if (tribunalState.tiles().length === 0) {
        <ptah-tribunal-empty-state (convene)="convene.set(true)" />
      } @else {
        <div
          class="flex items-center justify-between border-b border-base-300 px-4 py-2"
        >
          <ptah-conductor-strip class="min-w-0 flex-1" />
          <button
            type="button"
            class="btn btn-ghost btn-xs ml-2 shrink-0"
            data-testid="tribunal-close-run"
            (click)="onCloseRun()"
          >
            Close Tribunal
          </button>
        </div>

        @if (surfacePermissions().length > 0 || surfaceQuestions().length > 0) {
          <div
            class="flex flex-col gap-2 border-b border-base-300 bg-base-200/40 px-4 py-2"
            data-testid="tribunal-conductor-prompts"
          >
            @for (perm of surfacePermissions(); track perm.id) {
              <ptah-permission-request-card
                [request]="perm"
                (responded)="onPermissionResponse($event)"
              />
            }
            @for (question of surfaceQuestions(); track question.id) {
              <ptah-question-card
                [request]="question"
                (answered)="onQuestionResponse($event)"
              />
            }
          </div>
        }

        <div class="flex-1 overflow-auto w-[97%]">
          <gridstack [options]="gsOptions" (changeCB)="onGridChange($event)">
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
                  data-testid="tribunal-tile"
                  [tile]="tile"
                  [label]="tileLabel(tile)"
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
    `,
  ],
})
export class TribunalPageComponent {
  protected readonly tribunalState = inject(TribunalStateService);
  private readonly layoutService = inject(CanvasLayoutService);
  private readonly permissionHandler = inject(PermissionHandlerService);

  protected readonly convene = signal(false);
  protected readonly focusedTileId = signal<string | null>(null);

  protected readonly showWizard = computed(
    () => this.convene() && this.tribunalState.tiles().length === 0,
  );

  private readonly tribunalContainer =
    viewChild<ElementRef<HTMLElement>>('tribunalContainer');
  private readonly gridComp = viewChild(GridstackComponent);

  readonly gsOptions: GridStackOptions = {
    column: 12,
    cellHeight: 120,
    float: true,
    margin: 8,
    draggable: { handle: '.tile-header' },
    resizable: { handles: 'e, se, s, sw, w' },
    animate: true,
  };

  protected readonly layout = computed(() => {
    this.layoutService.containerWidth();
    this.layoutService.containerHeight();
    return this.layoutService.computeLayout(this.tribunalState.tiles().length);
  });

  protected readonly surfacePermissions = computed(() =>
    this.permissionHandler
      .permissionRequests()
      .filter((p) => this.permissionHandler.hasSurfaceTargets(p.id)),
  );

  protected readonly surfaceQuestions = computed(() =>
    this.permissionHandler
      .questionRequests()
      .filter((q) => this.permissionHandler.hasSurfaceTargets(q.id)),
  );

  constructor() {
    afterNextRender(() => {
      const el = this.tribunalContainer()?.nativeElement;
      if (el) {
        this.layoutService.observe(el);
      }
      this.tribunalState.refreshSessionId();
    });

    effect(() => {
      const { cellHeight, tiles: tileLayouts } = this.layout();
      const gridComp = this.gridComp();
      if (!gridComp?.grid || tileLayouts.length === 0) return;

      const grid = gridComp.grid;
      const tiles = untracked(() => this.tribunalState.tiles());

      grid.batchUpdate(true);
      grid.cellHeight(cellHeight);

      for (const node of grid.engine.nodes) {
        const idx = tiles.findIndex((t) => t.tileId === node.id);
        if (idx >= 0 && tileLayouts[idx] && node.el) {
          grid.update(node.el, tileLayouts[idx]);
        }
      }

      grid.batchUpdate(false);
    });
  }

  protected readonly tribunalSessionId = this.tribunalState.tribunalSessionId;

  protected onLaunched(): void {
    this.convene.set(false);
  }

  protected onCloseRun(): void {
    this.tribunalState.endRun();
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
    const lane = this.tribunalState
      .lanes()
      .find((l) => l.laneId === tile.laneId);
    return lane ? lane.displayName : 'Vendor';
  }

  protected tileStatus(tile: TribunalTile): TribunalTileStatus {
    if (!tile.laneId) return 'idle';
    const agent = this.tribunalState.laneBindings().get(tile.laneId) ?? null;
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

  protected onPermissionResponse(response: PermissionResponse): void {
    this.permissionHandler.handlePermissionResponse(response);
  }

  protected onQuestionResponse(response: AskUserQuestionResponse): void {
    this.permissionHandler.handleQuestionResponse(response);
  }

  onGridChange(data: nodesCB): void {
    for (const node of data.nodes) {
      if (typeof node.id !== 'string') continue;
      const next: TileLayout = {
        x: node.x ?? 0,
        y: node.y ?? 0,
        w: node.w ?? 4,
        h: node.h ?? 6,
      };
      const tile = this.tribunalState.tiles().find((t) => t.tileId === node.id);
      if (tile) {
        this.tribunalState.replaceTile(tile.tileId, {
          ...tile,
          position: next,
        });
      }
    }
  }
}
