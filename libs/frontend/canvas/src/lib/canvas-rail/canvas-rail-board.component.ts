import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, afterRenderEffect,
  computed, effect, inject, input, signal,
} from '@angular/core';
import { defaultSessionName } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat';
import type { CompactRailState } from '@ptah-extension/chat-ui';
import { CanvasStore } from '../canvas.store';
import { railWidthBand } from '../canvas-board-mode';
import { CanvasLayoutService } from '../canvas-layout.service';
import { CanvasRenderMetricsService } from '../canvas-render-metrics.service';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasSessionDetailsComponent } from '../canvas-detail/canvas-session-details.component';
import { CanvasRailComponent } from './canvas-rail.component';
import { CanvasFocusAreaComponent } from './canvas-focus-area.component';
import { checkRailGeometry, railAnchorScrollTop, railCardHeight, type RailGeometryBaseline } from './canvas-rail-geometry';

@Component({
  selector: 'ptah-canvas-rail-board',
  standalone: true,
  imports: [CanvasRailComponent, CanvasFocusAreaComponent, CanvasSessionDetailsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full min-h-0',
    '[style.display]': 'visible() ? null : "none"',
    'data-canvas-board-mode': 'rail',
    '[attr.data-canvas-live-views]': 'visible() && focusedId() ? 1 : 0',
    '[attr.data-canvas-focus-swaps]': 'focusSwaps()',
    '[attr.data-canvas-rail-shifts]': 'railShifts()',
  },
  template: `
    @if (visible()) {
      <div class="flex h-full min-h-0 min-w-0">
        <ptah-canvas-rail [tiles]="orderedTiles()" [states]="railStates()" [focusedTabId]="focusedId()"
          [density]="board().railDensity" [collapsed]="effectiveCollapsed()" [band]="band()"
          [runningCount]="store.runningSessionCount()" [canStart]="store.canStartRunningSession()"
          [canAdd]="store.canAddTile()" [holdTabId]="holdTabId()" [surfaceActive]="visible()"
          (focusRequested)="focus($event)" (collapseToggled)="toggleCollapse()"
          (densityToggled)="toggleDensity()" (jumpTo)="jumpTo($event)" (newSession)="newSession()"
          (scrolled)="store.setRailScrollTop(workspacePath(), $event)" (railState)="onRailState($event)"
          (staleAction)="announce('This request has changed. Open the current request.')"
          (lanesRequested)="onLanesRequested($event)" />
        <ptah-canvas-focus-area class="min-w-0 flex-1" [focusedTabId]="focusedId()"
          [state]="railStates().get(focusedId() ?? '') ?? 'idle'" [band]="band()"
          (closeRequested)="close($event)" />
        @if (band() === 'sm') {
          @if (detailsOpen()) {
            <aside class="flex h-full w-[288px] shrink-0 flex-col border-l border-base-content/10 bg-base-100">
              <button type="button" class="btn btn-ghost btn-sm" aria-label="Close details" aria-expanded="true"
                (click)="toggleDetails()">Close details</button>
              @if (focusedId(); as id) { <ptah-canvas-session-details class="min-h-0 flex-1 overflow-auto" [tabId]="id" /> }
            </aside>
          } @else {
            <button type="button" class="btn btn-ghost w-11 shrink-0 border-l border-base-content/10" aria-label="Open details"
              aria-expanded="false" (click)="toggleDetails()">i</button>
          }
        } @else {
          <aside class="h-full shrink-0 overflow-auto border-l border-base-content/10 bg-base-100"
            [class.w-[360px]]="band() === 'xl'" [class.w-[320px]]="band() === 'lg'" [class.w-[296px]]="band() === 'md'">
            @if (focusedId(); as id) { <ptah-canvas-session-details [tabId]="id" /> }
          </aside>
        }
      </div>
      <div class="sr-only" aria-live="polite">{{ announcement() }}</div>
    }
  `,
})
export class CanvasRailBoardComponent {
  readonly workspacePath = input.required<string>();
  readonly visible = input.required<boolean>();
  readonly store = inject(CanvasStore);
  readonly layout = inject(CanvasLayoutService);
  readonly detail = inject(CanvasDetailService);
  readonly metrics = inject(CanvasRenderMetricsService);
  private readonly tabs = inject(TabManagerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  readonly railStates = signal<ReadonlyMap<string, CompactRailState>>(new Map());
  readonly holdTabId = signal<string | null>(null);
  readonly detailsOpen = signal(false);
  readonly announcement = signal('');
  readonly focusSwaps = computed(() => { this.metrics.version(); return this.metrics.snapshot().focusSwaps; });
  readonly railShifts = computed(() => { this.metrics.version(); return this.metrics.snapshot().railShifts; });
  readonly board = computed(() => this.store.boardFor(this.workspacePath()));
  readonly orderedTiles = computed(() => [...this.store.tilesFor(this.workspacePath())()].sort((a, b) => a.order - b.order));
  readonly focusedId = computed(() => {
    const tiles = this.orderedTiles();
    const id = this.store.focusedTabIdFor(this.workspacePath());
    return tiles.find((tile) => tile.tabId === id)?.tabId ?? tiles[0]?.tabId ?? null;
  });
  readonly band = computed(() => railWidthBand(this.layout.containerWidth()));
  readonly effectiveCollapsed = computed(() => this.board().railCollapsed ||
    (this.band() === 'sm' && this.detailsOpen()));
  private geometryBaseline: RailGeometryBaseline | null = null;
  private restoredScroll = false;

  constructor() {
    effect((onCleanup) => {
      if (!this.visible()) return;
      const document = this.host.nativeElement.ownerDocument;
      const selection = () => {
        const node = document.getSelection()?.anchorNode;
        const element = node instanceof Element ? node : node?.parentElement;
        this.holdTabId.set(element && this.host.nativeElement.contains(element)
          ? element.closest<HTMLElement>('[data-rail-card]')?.dataset['tabId'] ?? null : null);
      };
      const down = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        this.holdTabId.set(target.closest<HTMLElement>('[data-rail-card]')?.dataset['tabId'] ?? null);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
      };
      const up = () => {
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        selection();
      };
      document.addEventListener('selectionchange', selection);
      this.host.nativeElement.addEventListener('pointerdown', down);
      onCleanup(() => {
        document.removeEventListener('selectionchange', selection);
        this.host.nativeElement.removeEventListener('pointerdown', down);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
      });
    });
    effect(() => {
      const ids = new Set(this.orderedTiles().map((tile) => tile.tabId));
      const states = this.railStates();
      if ([...states.keys()].every((id) => ids.has(id))) return;
      this.railStates.set(new Map([...states].filter(([id]) => ids.has(id))));
    });
    let previousBand = this.band();
    effect(() => {
      const band = this.band();
      if (band !== previousBand) { previousBand = band; this.anchor(); }
    });
    afterRenderEffect(() => {
      if (!this.visible()) return;
      const tiles = this.orderedTiles();
      const density = this.board().railDensity;
      const collapsed = this.effectiveCollapsed();
      this.railStates();
      const cards = [...(this.list()?.querySelectorAll<HTMLElement>('[data-rail-card]') ?? [])];
      const sample = {
        key: `${density}|${collapsed}`,
        order: cards.map((card) => card.dataset['tabId'] ?? ''),
        heights: cards.map((card) => card.getBoundingClientRect().height),
      };
      if (cards.length !== tiles.length) return;
      const result = checkRailGeometry(this.geometryBaseline, sample, railCardHeight(density, collapsed));
      this.geometryBaseline = result.baseline;
      if (result.shifts) this.metrics.increment('railShifts', result.shifts);
      if (!this.restoredScroll) {
        this.restoredScroll = true;
        const list = this.list();
        if (list) list.scrollTop = Math.min(this.board().railScrollTop, Math.max(0, list.scrollHeight - list.clientHeight));
      }
    });
  }

  private list(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('ptah-canvas-rail .overflow-y-auto');
  }

  private anchor(): void {
    afterNextRender(() => {
      const list = this.list();
      const index = this.orderedTiles().findIndex((tile) => tile.tabId === this.focusedId());
      if (list && index >= 0) list.scrollTop = railAnchorScrollTop(index,
        railCardHeight(this.board().railDensity, this.effectiveCollapsed()), list.clientHeight, list.scrollTop);
    }, { injector: this.injector });
  }

  focus(id: string): void { this.store.focusTile(id); this.anchor(); }
  toggleCollapse(): void {
    this.geometryBaseline = null;
    this.store.setRailCollapsed(this.workspacePath(), !this.board().railCollapsed);
    this.anchor();
  }
  toggleDensity(): void {
    this.geometryBaseline = null;
    this.holdTabId.set(null);
    this.store.setRailDensity(this.workspacePath(), this.board().railDensity === 'dense' ? 'comfortable' : 'dense');
    this.anchor();
  }
  toggleDetails(): void { this.detailsOpen.update((open) => !open); this.anchor(); }
  newSession(): void {
    if (!this.store.canStartRunningSession() || !this.store.canAddTile()) return;
    const id = this.store.addTile(defaultSessionName());
    if (!id) return;
    this.geometryBaseline = null;
    this.store.focusTile(id);
    this.anchor();
  }
  async close(id: string): Promise<void> {
    const ids = this.orderedTiles().map((tile) => tile.tabId);
    const index = ids.indexOf(id);
    const neighbour = ids[index + 1] ?? ids[index - 1] ?? null;
    await this.store.removeTile(id);
    if (this.orderedTiles().some((tile) => tile.tabId === id)) return;
    this.geometryBaseline = null;
    if (neighbour) this.store.focusTile(neighbour);
    this.anchor();
  }
  jumpTo(state: CompactRailState): void {
    const tiles = this.orderedTiles();
    const start = tiles.findIndex((tile) => tile.tabId === this.focusedId());
    for (let step = 1; step <= tiles.length; step++) {
      const id = tiles[(start + step) % tiles.length]?.tabId;
      if (this.railStates().get(id) === state) { this.focus(id); return; }
    }
  }
  onRailState(event: { tabId: string; state: CompactRailState }): void {
    const previous = this.railStates().get(event.tabId);
    if (previous === event.state) return;
    this.railStates.update((states) => new Map(states).set(event.tabId, event.state));
    if (previous && (event.state === 'needs' || event.state === 'error')) {
      const title = this.tabs.findTabByIdAcrossWorkspaces(event.tabId)?.tab.title ?? 'Session';
      this.announce(`${title} ${event.state === 'needs' ? 'needs you' : 'stopped with an error'}`);
    }
  }
  announce(message: string): void { this.announcement.set(message); }
  onLanesRequested(id: string): void {
    this.focus(id);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('ptah-canvas-focus-area [role="tab"][aria-selected="true"]')?.focus(),
      { injector: this.injector });
  }
}
