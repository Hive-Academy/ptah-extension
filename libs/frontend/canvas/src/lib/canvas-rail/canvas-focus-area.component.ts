import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output } from '@angular/core';
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import type { CompactRailState } from '@ptah-extension/chat-ui';
import { CanvasStore } from '../canvas.store';
import { CanvasRenderMetricsService } from '../canvas-render-metrics.service';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasLaneTabsComponent } from '../canvas-detail/canvas-lane-tabs.component';
import { CanvasLaneViewComponent } from '../canvas-detail/canvas-lane-view.component';
import { CanvasFocusHeaderComponent } from './canvas-focus-header.component';

@Component({
  selector: 'ptah-canvas-focus-area',
  standalone: true,
  imports: [CanvasFocusHeaderComponent, CanvasLaneTabsComponent, CanvasLaneViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0 min-w-0' },
  template: `
    <section aria-label="Focused session" class="flex h-full min-h-0 flex-col bg-base-100">
      @if (focusedTabId(); as id) {
        <ptah-canvas-focus-header [tabId]="id" [title]="tab()?.title ?? ''" [state]="state()"
          [running]="canvasStore.isSessionRunning(id)" [viewMode]="tab()?.viewMode ?? 'full'" [band]="band()"
          (stop)="stop(id)" (toggleViewMode)="tabs.toggleTabViewMode(id)" (closeRequested)="closeRequested.emit(id)" />
        <ptah-canvas-lane-tabs [sessionId]="tab()?.claudeSessionId ?? null" [laneKey]="detail.laneKeyFor(id)"
          (laneSelected)="detail.selectLaneFor(id, $event)" />
        <div class="min-h-0 flex-1">
          @for (focused of focusedIds(); track focused) {
            <ptah-canvas-lane-view [tabId]="focused" [sessionId]="tab()?.claudeSessionId ?? null"
              [laneKey]="detail.laneKeyFor(focused)" />
          }
        </div>
      } @else {
        <div class="flex h-full items-center justify-center text-sm text-base-content/60">No session in focus</div>
      }
    </section>
  `,
})
export class CanvasFocusAreaComponent {
  readonly focusedTabId = input<string | null>(null);
  readonly state = input<CompactRailState>('idle');
  readonly band = input<'xl' | 'lg' | 'md' | 'sm'>('lg');
  readonly closeRequested = output<string>();
  readonly canvasStore = inject(CanvasStore);
  readonly tabs = inject(TabManagerService);
  readonly detail = inject(CanvasDetailService);
  private readonly chatStore = inject(ChatStore);
  private readonly metrics = inject(CanvasRenderMetricsService);
  readonly focusedIds = computed(() => {
    const id = this.focusedTabId();
    return id ? [id] : [];
  });
  readonly tab = computed(() => this.tabs.findTabByIdAcrossWorkspaces(this.focusedTabId() ?? '')?.tab ?? null);
  private previousId: string | null = null;

  constructor() {
    effect(() => {
      const id = this.focusedTabId();
      if (id === this.previousId) return;
      if (id) {
        this.metrics.increment('liveViewMounts');
        if (this.previousId) this.metrics.increment('focusSwaps');
      }
      this.previousId = id;
    });
  }

  async stop(id: string): Promise<void> {
    if (this.tabs.activeTabId() !== id) this.canvasStore.focusTile(id);
    try { await this.chatStore.abortWithConfirmation(); }
    catch (error) { console.error('Could not stop session', error); }
  }
}
