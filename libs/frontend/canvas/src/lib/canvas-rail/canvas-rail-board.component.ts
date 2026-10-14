import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  isDevMode,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RailTranscriptRetentionCoordinator, TabManagerService } from '@ptah-extension/chat';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import type { CompactRailState } from '@ptah-extension/chat-ui';
import { CanvasStore } from '../canvas.store';
import { railWidthBand } from '../canvas-board-mode';
import { RUNNING_CAP_MESSAGE } from '../canvas-running-cap';
import { CanvasLayoutService } from '../canvas-layout.service';
import { CanvasLayoutPersistenceService } from '../canvas-layout-persistence.service';
import { CanvasRenderMetricsService } from '../canvas-render-metrics.service';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasSessionDetailsComponent } from '../canvas-detail/canvas-session-details.component';
import { CanvasRailComponent } from './canvas-rail.component';
import { CanvasFocusAreaComponent } from './canvas-focus-area.component';
import {
  checkRailGeometry,
  railAnchorScrollTop,
  railCardHeight,
  type RailGeometryBaseline,
} from './canvas-rail-geometry';

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';
/** Open layers inside a pane that own their focus: Details dialog, menus, an overlay dock. */
const PANE_OVERLAYS = '[role="dialog"], [role="menu"], ptah-display-dock.absolute';

function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || (element as HTMLButtonElement).disabled) return false;
  if (element.closest(`[hidden], [inert], ${PANE_OVERLAYS}`)) return false;
  if (typeof element.checkVisibility === 'function') return element.checkVisibility({ visibilityProperty: true });
  // Environments without checkVisibility (jsdom): walk the computed styles.
  const view = element.ownerDocument.defaultView;
  for (let node: Element | null = element; node && view; node = node.parentElement) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

@Component({
  selector: 'ptah-canvas-rail-board',
  standalone: true,
  imports: [
    CanvasRailComponent,
    CanvasFocusAreaComponent,
    CanvasSessionDetailsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [RailTranscriptRetentionCoordinator],
  host: {
    class: 'block h-full min-h-0',
    '[style.display]': 'visible() ? null : "none"',
    'data-canvas-board-mode': 'rail',
    '[attr.data-canvas-live-views]': 'liveViews()',
    '[attr.data-canvas-focus-swaps]': 'focusSwaps()',
    '[attr.data-canvas-rail-shifts]': 'railShifts()',
    '(keydown)': 'onTabKey($event)',
  },
  template: `
    @if (visible()) {
      <div class="flex h-full min-h-0 min-w-0">
        <ptah-canvas-rail
          [tiles]="orderedTiles()"
          [states]="railStates()"
          [focusedTabId]="focusedId()"
          [density]="board().railDensity"
          [collapsed]="effectiveCollapsed()"
          [band]="band()"
          [runningCount]="store.runningSessionCount()"
          [canStart]="store.canStartRunningSession()"
          [canAdd]="store.canAddTile()"
          [holdTabId]="holdTabId()"
          [surfaceActive]="visible()"
          [splitDisabledReason]="splitDisabledReason()"
          (focusRequested)="focus($event)"
          (collapseToggled)="toggleCollapse()"
          (densityToggled)="toggleDensity()"
          (jumpTo)="jumpTo($event)"
          (newSession)="newSession()"
          (scrolled)="store.setRailScrollTop(workspacePath(), $event)"
          (railState)="onRailState($event)"
          (staleAction)="
            announce('This request has changed. Open the current request.')
          "
          (lanesRequested)="onLanesRequested($event)"
          (openBesideRequested)="openBeside($event)"
          (moveUpRequested)="move($event, -1)"
          (moveDownRequested)="move($event, 1)"
        />
        @if (orderedTiles().length === 0) {
          <section
            class="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
            data-testid="canvas-rail-empty-board"
            aria-labelledby="canvas-rail-empty-board-title"
          >
            <h2
              id="canvas-rail-empty-board-title"
              class="text-sm font-semibold text-base-content"
            >
              No sessions on this board
            </h2>
            <p class="max-w-xs text-xs text-base-content-muted">
              Start a session to see it here.
            </p>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              [attr.aria-disabled]="newSessionBlockReason() ? 'true' : null"
              [attr.aria-describedby]="
                newSessionBlockReason() ? 'canvas-rail-empty-board-reason' : null
              "
              (click)="emptyBoardNewSession()"
            >
              New session
            </button>
            @if (newSessionBlockReason(); as reason) {
              <p
                id="canvas-rail-empty-board-reason"
                class="text-xs text-base-content-muted"
              >
                {{ reason }}
              </p>
            }
          </section>
        } @else {
          <div class="flex min-w-0 flex-1 overflow-x-auto" [class.flex-col]="splitStacked() && splitDisplayed()" [class.flex-row]="!splitStacked() || !splitDisplayed()" data-testid="rail-pane-container">
            @for (side of sides; track side) {
              @if (paneTab(side); as id) {
                <section class="relative overflow-y-auto" [class.min-w-[360px]]="splitDisplayed()" [class.min-h-[400px]]="splitDisplayed()" [class.flex-1]="true" [style.order]="visualOrder().indexOf(side)" [attr.data-pane-side]="side" [attr.aria-label]="paneLabel(side, id)" (click)="activatePane(side)" (focusin)="activatePane(side)">
                  <ptah-canvas-focus-area
                    class="block h-full min-w-0"
                    [focusedTabId]="id"
                    [paneId]="side"
                    [paneLabel]="paneLabel(side, id)"
                    [paneFocused]="activeSide() === side"
                    [splitDisplayed]="splitDisplayed()"
                    [detailsOpen]="detailsOpen() && activeSide() === side"
                    [state]="railStates().get(id) ?? 'idle'"
                    [band]="band()"
                    (closeRequested)="close($event)"
                    (closeSplitRequested)="closeSplit()"
                    (closePaneRequested)="closePane($event)"
                    (swapPanesRequested)="swapPanes()"
                    (detailsRequested)="openSplitDetails($event)"
                  />
                  @if (splitDisplayed() && detailsOpen() && activeSide() === side) {
                    <aside class="absolute inset-y-0 right-0 z-20 w-[min(360px,100%)] overflow-auto border-l border-base-content/10 bg-base-100 shadow-xl" role="dialog" aria-label="Session details" (keydown.escape)="closeSplitDetails($event)">
                      <button type="button" class="btn btn-ghost btn-sm" aria-label="Close details" (click)="closeSplitDetails()">Close details</button>
                      <ptah-canvas-session-details [tabId]="id" />
                    </aside>
                  }
                </section>
              }
            }
          </div>
        }
        @if (!splitDisplayed() && band() === 'sm') {
          @if (detailsOpen()) {
            <aside
              class="flex h-full w-[288px] shrink-0 flex-col border-l border-base-content/10 bg-base-100"
            >
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                aria-label="Close details"
                aria-expanded="true"
                (click)="toggleDetails()"
              >
                Close details
              </button>
              @if (focusedId(); as id) {
                <ptah-canvas-session-details
                  class="min-h-0 flex-1 overflow-auto"
                  [tabId]="id"
                />
              }
            </aside>
          } @else {
            <button
              type="button"
              class="btn btn-ghost w-11 shrink-0 border-l border-base-content/10"
              aria-label="Open details"
              aria-expanded="false"
              (click)="toggleDetails()"
            >
              i
            </button>
          }
        } @else if (!splitDisplayed()) {
          <aside
            class="h-full shrink-0 overflow-auto border-l border-base-content/10 bg-base-100"
            [class.w-[360px]]="band() === 'xl'"
            [class.w-[320px]]="band() === 'lg'"
            [class.w-[296px]]="band() === 'md'"
          >
            @if (focusedId(); as id) {
              <ptah-canvas-session-details [tabId]="id" />
            }
          </aside>
        }
      </div>
      <div class="sr-only" aria-live="polite">{{ announcement() }}</div>
    }
  `,
})
export class CanvasRailBoardComponent {
  readonly sides = ['left', 'right'] as const;
  readonly workspacePath = input.required<string>();
  readonly visible = input.required<boolean>();
  /** The footer or empty board asked for the host's named New session popover. */
  readonly newSessionRequested = output<void>();
  readonly store = inject(CanvasStore);
  readonly layout = inject(CanvasLayoutService);
  readonly persistence = inject(CanvasLayoutPersistenceService);
  readonly detail = inject(CanvasDetailService);
  readonly metrics = inject(CanvasRenderMetricsService);
  private readonly tabs = inject(TabManagerService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  readonly railStates = signal<ReadonlyMap<string, CompactRailState>>(
    new Map(),
  );
  readonly holdTabId = signal<string | null>(null);
  readonly detailsOpen = signal(false);
  readonly activeSide = signal<'left' | 'right'>('left');
  readonly otherTabId = signal<string | null>(null);
  readonly visualOrder = signal<readonly ('left' | 'right')[]>(['left', 'right']);
  readonly splitDisplayed = computed(() => !!this.otherTabId());
  readonly splitStacked = computed(() => this.layout.containerWidth() < 1440);
  readonly splitDisabledReason = computed(() => this.orderedTiles().length < 2 ? 'Open another session first to split' : null);
  private lastFocusedId: string | null = null;
  private lastOrderedIds: readonly string[] = [];
  private detailsFocusReturn = false;
  private readonly parentActive = inject(SURFACE_ACTIVE, { optional: true }) ?? signal(true);
  /**
   * This board is the active workspace's AND the canvas surface is on screen.
   * Single-chat mode keeps the canvas mounted but hidden, so `visible()` alone
   * would let a focus repair call `switchTab` behind the user's back (C1).
   */
  readonly surfaceActive = computed(() => this.visible() && this.parentActive());
  readonly announcement = signal('');
  readonly liveViews = signal(0);
  readonly focusSwaps = computed(() => {
    this.metrics.version();
    return this.metrics.snapshot().focusSwaps;
  });
  readonly railShifts = computed(() => {
    this.metrics.version();
    return this.metrics.snapshot().railShifts;
  });
  readonly board = computed(() => this.store.boardFor(this.workspacePath()));
  readonly orderedTiles = computed(() =>
    [...this.store.tilesFor(this.workspacePath())()].sort(
      (a, b) => a.order - b.order,
    ),
  );
  readonly focusedId = computed(() => {
    const tiles = this.orderedTiles();
    const id = this.store.focusedTabIdFor(this.workspacePath());
    return (
      tiles.find((tile) => tile.tabId === id)?.tabId ?? tiles[0]?.tabId ?? null
    );
  });
  readonly band = computed(() => railWidthBand(this.layout.containerWidth()));
  readonly newSessionBlockReason = computed(() =>
    this.store.canStartRunningSession() ? null : RUNNING_CAP_MESSAGE,
  );
  readonly effectiveCollapsed = computed(
    () =>
      this.board().railCollapsed ||
      (!this.splitDisplayed() && this.band() === 'sm' && this.detailsOpen()),
  );
  private geometryBaseline: RailGeometryBaseline | null = null;
  private restoredScroll = false;

  constructor() {
    effect((onCleanup) => {
      if (!this.visible()) return;
      const document = this.host.nativeElement.ownerDocument;
      const selection = () => {
        const node = document.getSelection()?.anchorNode;
        const element = node instanceof Element ? node : node?.parentElement;
        this.holdTabId.set(
          element && this.host.nativeElement.contains(element)
            ? (element.closest<HTMLElement>('[data-rail-card]')?.dataset[
                'tabId'
              ] ?? null)
            : null,
        );
      };
      const down = (event: PointerEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        this.holdTabId.set(
          target.closest<HTMLElement>('[data-rail-card]')?.dataset['tabId'] ??
            null,
        );
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
    effect(() => {
      const ids = new Set(this.orderedTiles().map((tile) => tile.tabId));
      const focused = this.store.focusedTabIdFor(this.workspacePath());
      const other = this.otherTabId();
      const writable = this.surfaceActive();
      if (!other && !this.activeId() && ids.size) {
        const removedAt = this.lastOrderedIds.indexOf(this.lastFocusedId ?? '');
        const neighbours = removedAt < 0 ? [] : [
          ...this.lastOrderedIds.slice(removedAt + 1),
          ...this.lastOrderedIds.slice(0, removedAt).reverse(),
        ];
        this.lastFocusedId = neighbours.find((id) => ids.has(id)) ?? null;
      }
      this.lastOrderedIds = [...ids];
      if (!this.visible()) {
        if (other) {
          // C2: the focused pane's tab is gone, so the other pane survives the collapse.
          if (!this.activeId() && ids.has(other)) this.lastFocusedId = other;
          this.collapseSplit();
        }
        return;
      }
      // C1: store writes (`focusTile` -> `switchTab`) wait for an active surface;
      // `lastFocusedId` keeps the choice and this effect re-runs on activation.
      if (!other && ids.size && (!focused || !ids.has(focused))) {
        const id = this.activeId() ?? [...ids][0];
        this.lastFocusedId = id;
        if (writable && focused !== id) this.store.focusTile(id);
        return;
      }
      if (other && (!ids.has(other) || !ids.has(focused ?? this.lastFocusedId ?? ''))) {
        const survivor = ids.has(other) ? other : this.activeId();
        this.collapseSplit();
        if (writable && survivor && focused !== survivor) this.store.focusTile(survivor);
        this.lastFocusedId = survivor;
        this.announce('Split closed because a session was removed.');
        return;
      }
      if (!focused || !ids.has(focused) || focused === this.lastFocusedId) return;
      if (other && focused === other) {
        this.otherTabId.set(this.lastFocusedId);
        this.activeSide.set(this.opposite(this.activeSide()));
      } else if (other) {
        this.announceReplaced(focused);
      }
      this.lastFocusedId = focused;
      this.assertDistinct();
    });
    let wasStacked = this.splitStacked();
    effect(() => {
      const stacked = this.splitStacked();
      if (stacked !== wasStacked && this.splitDisplayed()) {
        this.announce(stacked ? 'Sessions stacked top and bottom.' : 'Sessions side by side.');
      }
      wasStacked = stacked;
    });
    effect(() => {
      const failed = this.persistence.writeFailed();
      if (failed && this.visible()) this.announce('Layout changes could not be saved.');
    });
    let previousBand = this.band();
    effect(() => {
      const band = this.band();
      if (band !== previousBand) {
        previousBand = band;
        this.anchor();
      }
    });
    afterRenderEffect(() => {
      // Pane hosts mount and unmount with the pane tabs (Open beside, Close pane),
      // so the live-view count must re-measure when they change.
      for (const side of this.sides) this.paneTab(side);
      const mounted = this.host.nativeElement.querySelectorAll(
        'ptah-canvas-lane-view',
      ).length;
      if (this.liveViews() !== mounted) this.liveViews.set(mounted);
      if (!this.visible()) return;
      const tiles = this.orderedTiles();
      const density = this.board().railDensity;
      const collapsed = this.effectiveCollapsed();
      this.railStates();
      const cards = [
        ...(this.list()?.querySelectorAll<HTMLElement>('[data-rail-card]') ??
          []),
      ];
      const sample = {
        key: `${density}|${collapsed}`,
        order: cards.map((card) => card.dataset['tabId'] ?? ''),
        heights: cards.map((card) => card.getBoundingClientRect().height),
      };
      if (cards.length !== tiles.length) return;
      const result = checkRailGeometry(
        this.geometryBaseline,
        sample,
        railCardHeight(density, collapsed),
      );
      this.geometryBaseline = result.baseline;
      if (result.shifts) this.metrics.increment('railShifts', result.shifts);
      if (!this.restoredScroll) {
        this.restoredScroll = true;
        const list = this.list();
        if (list)
          list.scrollTop = Math.min(
            this.board().railScrollTop,
            Math.max(0, list.scrollHeight - list.clientHeight),
          );
      }
    });
  }

  private list(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(
      'ptah-canvas-rail .overflow-y-auto',
    );
  }

  private anchor(targetId?: string): void {
    afterNextRender(
      () => {
        const list = this.list();
        const index = this.orderedTiles().findIndex(
          (tile) => tile.tabId === (targetId ?? this.focusedId()),
        );
        if (list && index >= 0)
          list.scrollTop = railAnchorScrollTop(
            index,
            railCardHeight(this.board().railDensity, this.effectiveCollapsed()),
            list.clientHeight,
            list.scrollTop,
          );
      },
      { injector: this.injector },
    );
  }

  private opposite(side: 'left' | 'right'): 'left' | 'right' {
    return side === 'left' ? 'right' : 'left';
  }

  private assertDistinct(): void {
    if (isDevMode() && this.otherTabId() && this.otherTabId() === this.store.focusedTabIdFor(this.workspacePath())) {
      throw new Error('Rail panes must show distinct sessions');
    }
  }

  private activeId(): string | null {
    const ids = this.orderedTiles().map((tile) => tile.tabId);
    const focused = this.store.focusedTabIdFor(this.workspacePath());
    if (focused && ids.includes(focused)) return focused;
    return this.lastFocusedId && ids.includes(this.lastFocusedId) ? this.lastFocusedId : null;
  }

  paneTab(side: 'left' | 'right'): string | null {
    const focused = this.store.focusedTabIdFor(this.workspacePath());
    const other = this.otherTabId();
    if (side !== this.activeSide()) {
      if (!other) return null;
      if (focused === other) {
        const fallback = this.activeId();
        return fallback !== other ? fallback : null;
      }
      return this.orderedTiles().some((tile) => tile.tabId === other) ? other : null;
    }
    return this.activeId();
  }

  paneLabel(side: 'left' | 'right', id: string): string {
    const position = this.visualOrder().indexOf(side);
    const place = this.splitStacked() ? (position === 0 ? 'Top' : 'Bottom') : (position === 0 ? 'Left' : 'Right');
    const title = this.title(id);
    return this.splitDisplayed() ? `${place} session: ${title}${this.activeSide() === side ? ', active' : ''}` : `Focused session: ${title}`;
  }

  activatePane(side: 'left' | 'right'): void {
    if (side === this.activeSide()) return;
    const id = this.otherTabId();
    if (!id) return;
    // A Rail card or lane action can write store focus before its event reaches
    // the board. The board's last focused tab is the pane being vacated.
    const current = this.lastFocusedId;
    if (!current || current === id) return;
    this.otherTabId.set(current);
    this.activeSide.set(side);
    this.lastFocusedId = id;
    this.store.focusTile(id);
    this.assertDistinct();
  }

  openBeside(id: string): void {
    const ids = this.orderedTiles().map((tile) => tile.tabId);
    const current = this.activeId();
    if (!ids.includes(id) || !current || !ids.includes(current)) {
      this.announce('This session is no longer on this board.');
      return;
    }
    if (id === current) {
      this.announce('This session is already focused.');
      return;
    }
    if (id === this.otherTabId()) {
      this.activatePane(this.opposite(this.activeSide()));
      return;
    }
    if (!this.splitDisplayed()) {
      this.detailsOpen.set(false);
      this.activeSide.set('left');
    }
    this.otherTabId.set(current);
    this.activeSide.set(this.opposite(this.activeSide()));
    this.lastFocusedId = id;
    this.store.focusTile(id);
    this.assertDistinct();
    this.announce(`${this.title(id)} opened beside ${this.title(current)}.`);
  }

  /** Collapse to single focus; a new split always starts in the default visual order. */
  private collapseSplit(): void {
    this.otherTabId.set(null);
    this.visualOrder.set(['left', 'right']);
    this.closeSplitDetails();
  }

  /** Header "Close split": keep the active tab in its own host. */
  closeSplit(): void {
    if (!this.splitDisplayed()) return;
    this.lastFocusedId = this.activeId();
    this.collapseSplit();
    this.announce('Split closed.');
    this.restoreHeaderFocus();
  }

  /**
   * Header "Close pane": release the invoked pane's host. Closing the active
   * pane focuses the survivor, which stays in its own host; closing the
   * inactive pane leaves store focus untouched. No session is closed.
   */
  closePane(side: 'left' | 'right'): void {
    if (!this.splitDisplayed()) return;
    const closingActive = side === this.activeSide();
    const survivor = closingActive ? this.otherTabId() : this.activeId();
    this.collapseSplit();
    this.lastFocusedId = survivor;
    if (closingActive) {
      this.activeSide.set(this.opposite(side));
      if (survivor && this.store.focusedTabIdFor(this.workspacePath()) !== survivor) this.store.focusTile(survivor);
    }
    this.announce(`Pane closed. ${this.title(survivor ?? '')} stays open.`);
    this.restoreHeaderFocus();
  }

  /**
   * Header "Swap panes": only the CSS `order` of the two stable wrappers
   * changes. Tab ids, hosts, lane panel ids and transcripts stay put.
   */
  swapPanes(): void {
    if (!this.splitDisplayed()) return;
    const [first, second] = this.visualOrder();
    this.visualOrder.set([second, first]);
    const label = (side: 'left' | 'right') => this.paneLabel(side, this.paneTab(side) ?? '');
    this.announce(`Panes swapped. ${label(second)}; ${label(first)}.`);
    this.restoreHeaderFocus();
  }

  /** Header Details control (split only): the overlay opens on the invoking pane, made active. */
  openSplitDetails(side: 'left' | 'right'): void {
    if (!this.splitDisplayed()) return;
    this.activatePane(side);
    this.detailsFocusReturn = true;
    this.detailsOpen.set(true);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('[role="dialog"] [aria-label="Close details"]')?.focus(), { injector: this.injector });
  }

  closeSplitDetails(event?: Event): void {
    event?.stopPropagation();
    this.detailsOpen.set(false);
    if (!this.detailsFocusReturn) return;
    this.detailsFocusReturn = false;
    afterNextRender(() => {
      const opener = this.host.nativeElement.querySelector<HTMLElement>(`[data-pane-side="${this.activeSide()}"] [aria-label="Open details"]`);
      if (this.splitDisplayed() && opener) opener.focus();
      else {
        const id = this.activeId();
        const card = [...this.host.nativeElement.querySelectorAll<HTMLElement>('[data-rail-card]')].find((node) => node.dataset['tabId'] === id);
        (card?.querySelector<HTMLElement>('.rc-select, .rail-collapsed') ?? this.host.nativeElement.querySelector<HTMLElement>(`[data-pane-side="${this.activeSide()}"] [role="tab"][aria-selected="true"]`))?.focus();
      }
    }, { injector: this.injector });
  }

  move(id: string, direction: -1 | 1): void {
    const tiles = this.orderedTiles();
    const index = tiles.findIndex((tile) => tile.tabId === id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= tiles.length) {
      this.announce('This session cannot move in that direction.');
      return;
    }
    const ids = tiles.map((tile) => tile.tabId);
    [ids[index], ids[destination]] = [ids[destination], ids[index]];
    this.geometryBaseline = { key: `${this.board().railDensity}|${this.effectiveCollapsed()}`, order: ids };
    this.store.reorderTiles(ids);
    this.announce(`${this.title(id)} moved to position ${destination + 1} of ${ids.length}.`);
    afterNextRender(() => {
      const card = [...(this.list()?.querySelectorAll<HTMLElement>('[data-rail-card]') ?? [])].find((node) => node.dataset['tabId'] === id);
      card?.querySelector<HTMLElement>('.rc-select, .rail-collapsed')?.focus();
      this.anchor(id);
    }, { injector: this.injector });
  }

  focus(id: string): void {
    if (id === this.otherTabId()) {
      this.activatePane(this.opposite(this.activeSide()));
      this.anchor();
      return;
    }
    if (this.splitDisplayed() && id !== this.lastFocusedId) this.announceReplaced(id);
    this.lastFocusedId = id;
    this.store.focusTile(id);
    this.anchor();
  }
  toggleCollapse(): void {
    this.geometryBaseline = null;
    this.store.setRailCollapsed(
      this.workspacePath(),
      !this.board().railCollapsed,
    );
    this.anchor();
  }
  toggleDensity(): void {
    this.geometryBaseline = null;
    this.holdTabId.set(null);
    this.store.setRailDensity(
      this.workspacePath(),
      this.board().railDensity === 'dense' ? 'comfortable' : 'dense',
    );
    this.anchor();
  }
  toggleDetails(): void {
    this.detailsOpen.update((open) => !open);
    this.anchor();
  }
  /**
   * Footer and zero-tile empty-board "New session": ask the host to open its
   * one named popover. The board never creates a session itself; the host
   * stays the final cap gate and announces a refusal in its dock status line.
   */
  newSession(): void {
    this.newSessionRequested.emit();
  }
  /**
   * The empty-board trigger stays focusable while `aria-disabled`, so its
   * reason is still read out; activating it then does nothing. A native
   * button turns Enter and Space into this click, so the guard covers the
   * keyboard too.
   */
  emptyBoardNewSession(): void {
    if (this.newSessionBlockReason()) return;
    this.newSession();
  }
  /** Called by the host after its popover added `id` to this board. */
  sessionCreated(id: string): void {
    this.geometryBaseline = null;
    this.focus(id);
  }
  async close(id: string): Promise<void> {
    const ids = this.orderedTiles().map((tile) => tile.tabId);
    const index = ids.indexOf(id);
    const neighbour = ids[index + 1] ?? ids[index - 1] ?? null;
    const active = this.activeId();
    const wasFocused = active === id;
    const wasSplit = this.splitDisplayed();
    const survivor = wasSplit ? (wasFocused ? this.otherTabId() : active) : null;
    await this.store.removeTile(id);
    if (this.orderedTiles().some((tile) => tile.tabId === id)) return;
    this.geometryBaseline = null;
    if (wasSplit) {
      this.collapseSplit();
      if (survivor) {
        this.lastFocusedId = survivor;
        if (this.store.focusedTabIdFor(this.workspacePath()) !== survivor) this.store.focusTile(survivor);
      }
    } else if (wasFocused && neighbour) {
      this.lastFocusedId = neighbour;
      this.store.focusTile(neighbour);
    }
    this.anchor();
  }
  jumpTo(state: CompactRailState): void {
    const tiles = this.orderedTiles();
    const start = tiles.findIndex((tile) => tile.tabId === this.focusedId());
    for (let step = 1; step <= tiles.length; step++) {
      const id = tiles[(start + step) % tiles.length]?.tabId;
      if (this.railStates().get(id) === state) {
        this.focus(id);
        return;
      }
    }
  }
  onRailState(event: { tabId: string; state: CompactRailState }): void {
    const previous = this.railStates().get(event.tabId);
    if (previous === event.state) return;
    this.railStates.update((states) =>
      new Map(states).set(event.tabId, event.state),
    );
    if (previous && (event.state === 'needs' || event.state === 'error')) {
      const title =
        this.tabs.findTabByIdAcrossWorkspaces(event.tabId)?.tab.title ??
        'Session';
      this.announce(
        `${title} ${event.state === 'needs' ? 'needs you' : 'stopped with an error'}`,
      );
    }
  }
  announce(message: string): void {
    this.announcement.set(message);
  }

  private announceReplaced(id: string): void {
    this.announce(`${this.title(id)} replaced the active pane.`);
  }

  private title(id: string): string {
    return this.tabs.findTabByIdAcrossWorkspaces(id)?.tab.title ?? 'Session';
  }

  /**
   * When the control that had focus went away with its pane, focus the
   * surviving pane's header menu trigger. Focus that is still on a live
   * element (the header's own trigger, or a Details return) is left alone.
   */
  private restoreHeaderFocus(): void {
    afterNextRender(() => {
      const active = this.host.nativeElement.ownerDocument.activeElement;
      if (active && active !== active.ownerDocument.body && active.isConnected) return;
      this.host.nativeElement.querySelector<HTMLElement>(`[data-pane-side="${this.activeSide()}"] [data-header-menu]`)?.focus();
    }, { injector: this.injector });
  }

  /**
   * B3: stacked panes with a swapped `visualOrder` would Tab bottom-first in
   * DOM order. At a pane boundary, and on entry from the Rail, move focus in
   * visual order instead: Rail, top pane, bottom pane, then what follows.
   * Inert side by side (DOM order kept there by design) and in the default
   * order. Open overlays own their focus and are never counted as tabbable.
   */
  onTabKey(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const [top, bottom] = this.visualOrder();
    if (!this.splitDisplayed() || !this.splitStacked() || top === 'left') return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(PANE_OVERLAYS)) return;
    const container = this.host.nativeElement.querySelector<HTMLElement>('[data-testid="rail-pane-container"]');
    const topPane = container?.querySelector<HTMLElement>(`:scope > [data-pane-side="${top}"]`);
    const bottomPane = container?.querySelector<HTMLElement>(`:scope > [data-pane-side="${bottom}"]`);
    if (!container || !topPane || !bottomPane) return;
    const dom = [...this.host.nativeElement.ownerDocument.querySelectorAll<HTMLElement>(TABBABLE)].filter(isTabbable);
    const outside = (position: number) =>
      dom.filter((el) => !container.contains(el) && !!(container.compareDocumentPosition(el) & position));
    const visual = [
      ...outside(Node.DOCUMENT_POSITION_PRECEDING),
      ...dom.filter((el) => topPane.contains(el)),
      ...dom.filter((el) => bottomPane.contains(el)),
      ...outside(Node.DOCUMENT_POSITION_FOLLOWING),
    ];
    const index = visual.indexOf(target);
    if (index < 0) return;
    const step = event.shiftKey ? -1 : 1;
    const wrap = (list: readonly HTMLElement[], at: number) => list[(at + list.length) % list.length];
    const next = wrap(visual, index + step);
    if (next === wrap(dom, dom.indexOf(target) + step)) return;
    event.preventDefault();
    next.focus();
  }
  onLanesRequested(id: string): void {
    this.focus(id);
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLElement>(
            `[data-pane-side="${this.activeSide()}"] ptah-canvas-focus-area [role="tab"][aria-selected="true"]`,
          )
          ?.focus(),
      { injector: this.injector },
    );
  }
}
