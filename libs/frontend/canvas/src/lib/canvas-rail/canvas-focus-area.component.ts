import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat';
import { CanvasRenderMetricsService } from '../canvas-render-metrics.service';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasLaneTabsComponent } from '../canvas-detail/canvas-lane-tabs.component';
import { CanvasLaneViewComponent } from '../canvas-detail/canvas-lane-view.component';
import { CanvasFocusHeaderComponent } from './canvas-focus-header.component';

@Component({
  selector: 'ptah-canvas-focus-area',
  standalone: true,
  imports: [
    CanvasFocusHeaderComponent,
    CanvasLaneTabsComponent,
    CanvasLaneViewComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full min-h-0 min-w-0' },
  styles: [
    `
      /* Glass on (any theme): the pane's own glass shows through the whole column, from
         the title row to the composer (styles.css "Ptah chat column"). */
      :host {
        --chat-content-max-width: 1100px;
      }
      :host-context([data-theme][data-glass='on']) > section {
        background-color: transparent;
      }
    `,
  ],
  template: `
    <section class="group/pane relative flex h-full min-h-0 flex-col bg-base-100">
      @if (focusedTabId(); as id) {
        @if (splitDisplayed()) {
        <ptah-canvas-focus-header
          class="absolute right-2 top-2 z-20 rounded bg-base-100 opacity-0 hover:opacity-100 group-hover/pane:opacity-100 focus-within:opacity-100"
          (closeSplitRequested)="closeSplitRequested.emit(paneId())"
          (closePaneRequested)="closePaneRequested.emit(paneId())"
          (swapPanesRequested)="swapPanesRequested.emit(paneId())"
        />
        }
        <ptah-canvas-lane-tabs
          [panelId]="panelId()"
          [tabId]="id"
          [laneKey]="detail.laneKeyFor(id)"
          (laneSelected)="detail.selectLaneFor(id, $event)"
        />
        <div class="min-h-0 flex-1">
          <ptah-canvas-lane-view
            [panelId]="panelId()"
            [paneFocused]="paneFocused()"
            [splitDisplayed]="splitDisplayed()"
            [tabId]="id"
            [sessionId]="tab()?.claudeSessionId ?? null"
            [laneKey]="detail.laneKeyFor(id)"
          />
        </div>
      } @else {
        <div
          class="flex h-full items-center justify-center text-sm text-base-content-muted"
        >
          No session in focus
        </div>
      }
    </section>
  `,
})
export class CanvasFocusAreaComponent {
  readonly focusedTabId = input<string | null>(null);
  readonly paneId = input<'left' | 'right'>('left');
  readonly paneFocused = input(true);
  readonly splitDisplayed = input(false);
  readonly panelId = computed(() => `rail-${this.paneId()}-lane-panel`);
  /** Pane actions, forwarded with this pane's stable id. */
  readonly closeSplitRequested = output<'left' | 'right'>();
  readonly closePaneRequested = output<'left' | 'right'>();
  readonly swapPanesRequested = output<'left' | 'right'>();
  readonly tabs = inject(TabManagerService);
  readonly detail = inject(CanvasDetailService);
  private readonly metrics = inject(CanvasRenderMetricsService);
  readonly tab = computed(
    () =>
      this.tabs.findTabByIdAcrossWorkspaces(this.focusedTabId() ?? '')?.tab ??
      null,
  );
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
}
