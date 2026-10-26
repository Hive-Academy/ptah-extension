import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { TabManagerService, ChatStore } from '@ptah-extension/chat';
import type {
  CompactRailState,
  SessionLimitSummary,
} from '@ptah-extension/chat-ui';
import { CanvasStore } from '../canvas.store';
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
    <section class="flex h-full min-h-0 flex-col bg-base-100">
      @if (focusedTabId(); as id) {
        <ptah-canvas-focus-header
          [tabId]="id"
          [title]="tab()?.title ?? ''"
          [state]="state()"
          [branch]="tab()?.agentOrigin?.branch ?? null"
          [running]="canvasStore.isSessionRunning(id)"
          [viewMode]="tab()?.viewMode ?? 'full'"
          [band]="band()"
          [splitDisplayed]="splitDisplayed()"
          [detailsOpen]="detailsOpen()"
          [inspectorExpanded]="inspectorExpanded()"
          [limitCue]="limitCue()"
          [contextRingPercent]="contextRingPercent()"
          [toggleDescription]="toggleDescription()"
          [paneFocused]="paneFocused()"
          [paneNumber]="paneNumber()"
          [panePlace]="panePlace()"
          (stop)="stop(id)"
          (toggleViewMode)="toggleViewMode(id)"
          (closeRequested)="closeRequested.emit(id)"
          (closeSplitRequested)="closeSplitRequested.emit(paneId())"
          (closePaneRequested)="closePaneRequested.emit(paneId())"
          (swapPanesRequested)="swapPanesRequested.emit(paneId())"
          (detailsRequested)="detailsRequested.emit(paneId())"
        />
        @if (!inspectorExpanded()) {
          <ptah-canvas-lane-tabs
            [panelId]="panelId()"
            [tabId]="id"
            [laneKey]="detail.laneKeyFor(id)"
            (laneSelected)="detail.selectLaneFor(id, $event)"
          />
        }
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
  /** Split only: visual position (1 = left/top) and its positional word, for the header marker. */
  readonly paneNumber = input<1 | 2 | null>(null);
  readonly panePlace = input('');
  /** The split Details overlay is open on this pane. */
  readonly detailsOpen = input(false);
  readonly inspectorExpanded = input(false);
  readonly limitCue = input<SessionLimitSummary | null>(null);
  readonly contextRingPercent = input<number | null>(null);
  readonly toggleDescription = input('');
  readonly panelId = computed(() => `rail-${this.paneId()}-lane-panel`);
  readonly state = input<CompactRailState>('idle');
  readonly band = input<'xl' | 'lg' | 'md' | 'sm'>('lg');
  readonly closeRequested = output<string>();
  /** Header split actions, forwarded with this pane's stable id. */
  readonly closeSplitRequested = output<'left' | 'right'>();
  readonly closePaneRequested = output<'left' | 'right'>();
  readonly swapPanesRequested = output<'left' | 'right'>();
  readonly detailsRequested = output<'left' | 'right'>();
  readonly canvasStore = inject(CanvasStore);
  readonly tabs = inject(TabManagerService);
  readonly detail = inject(CanvasDetailService);
  private readonly chatStore = inject(ChatStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
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

  toggleViewMode(id: string): void {
    this.tabs.toggleTabViewMode(id);
    afterNextRender(
      () => {
        const document = this.host.nativeElement.ownerDocument;
        document
          .getElementById(`${this.panelId()}-tab-${this.detail.laneKeyFor(id)}`)
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  async stop(id: string): Promise<void> {
    if (this.tabs.activeTabId() !== id) this.canvasStore.focusTile(id);
    try {
      await this.chatStore.abortWithConfirmation();
    } catch (error) {
      console.error('Could not stop session', error);
    }
  }
}
