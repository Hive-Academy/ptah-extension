import {
  ChangeDetectionStrategy, Component, DestroyRef, Injector,
  afterNextRender, computed, effect, inject, input, linkedSignal, model, output, signal, untracked,
} from '@angular/core';
import {
  INSPECTOR_TAB_WIDTH, InspectorDockController, InspectorOpenStateService,
  TabManagerService, injectSessionStatsSource,
} from '@ptah-extension/chat';
import { SessionInspectorComponent } from '@ptah-extension/chat/inspector';
import { SplitHandleComponent, type CompactRailState } from '@ptah-extension/chat-ui';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasLaneTabsComponent } from '../canvas-detail/canvas-lane-tabs.component';

const TABBABLE =
  'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';
/** Narrowest chat beside the docked sidebar (px); below it the sidebar opens as an overlay. */
const CHAT_MIN_BESIDE_DOCK = 560;
const PANE_OVERLAYS =
  '[role="dialog"], [role="menu"], ptah-display-sheet [role="region"].full';

export function isCanvasInspectorTabbable(element: HTMLElement, sheet?: HTMLElement): boolean {
  if (element.tabIndex < 0 || (element as HTMLButtonElement).disabled)
    return false;
  if (element.closest('[hidden], [inert]')) return false;
  const overlay = element.closest(PANE_OVERLAYS);
  const inspectorDialog =
    sheet &&
    overlay?.parentElement?.matches('ptah-session-inspector') &&
    overlay.parentElement.parentElement === sheet;
  if (overlay && overlay !== sheet && !inspectorDialog) return false;
  if (typeof element.checkVisibility === 'function')
    return element.checkVisibility({ visibilityProperty: true });
  // Environments without checkVisibility (jsdom): walk the computed styles.
  const view = element.ownerDocument.defaultView;
  for (
    let node: Element | null = element;
    node && view;
    node = node.parentElement
  ) {
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}


/**
 * Inspector state shared by the board's header and its dock composition.
 * Sources can depend on required inputs: consume this state after input binding.
 */
export function injectCanvasInspectorDockState(sources: {
  focusedId: () => string | null;
  focusedTab: () => NonNullable<ReturnType<TabManagerService['findTabByIdAcrossWorkspaces']>>['tab'] | null;
  width: () => number;
  leftRailWidth: () => number;
  splitDisplayed: () => boolean;
}) {
  const openState = inject(InspectorOpenStateService);
  const detailsOpen = signal(false);
  const compactSheet = computed(() => sources.width() > 0 && sources.width() < 400);
  const compactSheetOpen = computed(() => compactSheet() && detailsOpen());
  const stats = injectSessionStatsSource({
    tab: sources.focusedTab,
    sessionId: () => sources.focusedTab()?.claudeSessionId ?? null,
    budget: () => sources.focusedTab()?.sessionBudget ?? null,
    available: () => sources.focusedTab() !== null,
  });
  const dockOpenByDefault = computed(() => sources.width() >= 1200);
  const dockOpen = linkedSignal<{ split: boolean; open: boolean }, boolean>({
    source: () => {
      // Split shows the expanded sidebar only as an overlay: start from the rail, never auto-open.
      if (sources.splitDisplayed()) return { split: true, open: false };
      const id = sources.focusedId();
      return {
        split: false,
        open: id ? openState.dockedOpen(
          id, sources.focusedTab()?.viewMode ?? 'full',
          dockOpenByDefault(),
        ) : false,
      };
    },
    // While split stays on, a focused-pane switch or a tab update keeps the user's choice;
    // entering split starts collapsed and leaving it restores the persisted single-view state.
    computation: (source, previous) =>
      source.split && previous?.source.split ? previous.value : source.open,
  });
  const dockShown = computed(() =>
    sources.focusedId() !== null,
  );
  // The compact inspector replaces the expanded dock; it never reduces this input.
  const dockAvailableWidth = computed(() => Math.max(0, sources.width() - sources.leftRailWidth()));
  return {
    detailsOpen, compactSheet, compactSheetOpen, stats,
    dockOpen, dockShown, dockAvailableWidth,
  };
}

@Component({
  selector: 'ptah-canvas-inspector-dock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SessionInspectorComponent,
    SplitHandleComponent, CanvasLaneTabsComponent],
  providers: [InspectorDockController],
  host: { class: 'contents', '(document:keydown.escape)': 'onDocumentEscape($event)' },
  template: `
        @if (dockShown() && !compactSheetOpen()) {
          @if (focusedId(); as id) {
            <!-- Every inspector reference is deferred so it stays out of the initial bundle.
                 The block wraps the rail's @if, so it loads while the dock is open too and a
                 later collapse renders the rail (and its focus target) synchronously.
                 @loading holds the rail's width while the chunk loads. -->
            @defer (on immediate) {
              @if (!dockOpen()) {
                <ptah-session-inspector
                  class="block h-full shrink-0"
                  [style.width.px]="occupiedWidth()"
                  data-inspector-rail
                  [tabId]="id"
                  presentation="rail"
                  [limitSummary]="stats()?.limitSummary"
                  [hasLaneSurface]="true"
                  [stats]="stats()"
                  [selectedAgentKey]="detail.laneKeyFor(id)"
                  [sessionTitle]="sessionTab(id)?.title ?? ''"
                  (expandRequested)="expandInspector($event)"
                >
                  <ptah-canvas-lane-tabs inspectorRailAgents
                    [panelId]="panelId()" [tabId]="id" [rail]="true"
                    [laneKey]="detail.laneKeyFor(id)"
                    (laneSelected)="detail.selectLaneFor(id, $event)"
                    (railPicked)="selectRailAgent(id, $event)"
                    (expandRequested)="expandInspector('agents')" />
                </ptah-session-inspector>
              }
            } @loading {
              @if (!dockOpen()) {
                <div class="block h-full shrink-0" [style.width.px]="occupiedWidth()" aria-hidden="true"></div>
              }
            }
            @if (dockShown() && dockOpen()) {
              @if (overlay()) { <div class="w-14 shrink-0" aria-hidden="true"></div> }
              <!-- 0 px slot: the grip overlays the dock's leading edge and adds no layout width. -->
              @if (!overlay()) {
              <div class="relative z-10 w-0 shrink-0">
                <ptah-split-handle
                  class="absolute inset-y-0 left-0 w-3"
                  orientation="vertical"
                  appearance="grip"
                  label="Resize session details"
                  [inverted]="true"
                  [size]="dock.width()"
                  [min]="dock.minWidth"
                  [max]="dockedMaxWidth()"
                  (sizeChange)="dock.preview($event)"
                  (sizeCommit)="dock.commit()"
                  (sizeCancel)="dock.cancel()"
                  (sizeReset)="dock.reset()"
                />
              </div>
              }
              <!-- The overlay is absolute inside the board's relative layout box, never fixed to the
                   window: the app top bar and the Git rail must not cover its title row or edge. -->
              <aside
                class="flex h-full max-w-full shrink-0 flex-col border-l border-base-content/10 bg-base-100"
                tabindex="-1"
                [class.absolute]="overlay()"
                [class.right-0]="overlay()"
                [class.z-50]="overlay()"
                [attr.role]="overlay() ? 'dialog' : null"
                aria-label="Session details"
                [class.inset-y-0]="overlay()"
                (keydown.escape)="closeDock()"
                (keydown)="overlay() && onSheetKeydown($event)"
                data-inspector-dock
                [style.width.px]="dock.width()"
              >
                <!-- The expanded inspector loads on open; @loading shows a skeleton meanwhile. -->
                @defer (when dockOpen()) {
                  <ptah-session-inspector
                    class="min-h-0 flex-1"
                    [tabId]="id"
                    presentation="embedded"
                    [hasLaneSurface]="true"
                    [stats]="stats()"
                    (laneRequested)="detail.selectLaneFor(id, $event)"
                    (agentSelected)="detail.selectLaneFor(id, $event)"
                    (closeRequested)="closeDock()"
                    [sessionTitle]="sessionTab(id)?.title ?? ''"
                    [sessionStatus]="state()"
                    [workflow]="sessionTab(id)?.workflow ?? null"
                    [branch]="sessionTab(id)?.agentOrigin?.branch ?? null"
                    [selectedAgentKey]="detail.laneKeyFor(id)"
                    [focusSection]="inspectorSection()"
                  />
                } @loading {
                  <div
                    class="flex min-h-0 flex-1 flex-col gap-2 p-4"
                    role="status"
                    aria-label="Loading session details"
                    data-inspector-skeleton
                  >
                    <div class="skeleton h-4 w-32"></div>
                    <div class="skeleton h-3 w-full"></div>
                    <div class="skeleton h-3 w-3/4"></div>
                  </div>
                }
              </aside>
            }
          }
        }
        @if (compactSheetOpen()) {
          @if (focusedId(); as id) {
            <div
              class="absolute inset-0 z-50 overflow-y-auto bg-base-100"
              role="dialog"
              aria-modal="true"
              aria-label="Session details"
              tabindex="-1"
              data-compact-sheet
              (keydown)="onSheetKeydown($event)"
            >
              @defer (when compactSheetOpen()) {
                <ptah-session-inspector
                  [tabId]="id"
                  presentation="sheet"
                  [hasLaneSurface]="true"
                  [stats]="stats()"
                  (laneRequested)="openLaneFromCompactSheet(id, $event)"
                  (agentSelected)="detail.selectLaneFor(id, $event)"
                  (closeRequested)="closeCompactSheet()"
                  [sessionTitle]="sessionTab(id)?.title ?? ''"
                  [sessionStatus]="state()"
                  [workflow]="sessionTab(id)?.workflow ?? null"
                  [branch]="sessionTab(id)?.agentOrigin?.branch ?? null"
                  [selectedAgentKey]="detail.laneKeyFor(id)"
                  [focusSection]="inspectorSection()"
                />
              } @loading {
                <div
                  class="flex flex-col gap-2 p-4"
                  role="status"
                  aria-label="Loading session details"
                  data-inspector-skeleton
                >
                  <div class="skeleton h-4 w-32"></div>
                  <div class="skeleton h-3 w-full"></div>
                  <div class="skeleton h-3 w-3/4"></div>
                </div>
              }
            </div>
          }
        }

  `,
})
export class CanvasInspectorDockComponent {
  readonly root = input.required<HTMLElement>();
  readonly focusedId = input<string | null>(null);
  readonly splitDisplayed = input(false);
  readonly visible = input(true);
  readonly compactSheet = input(false);
  readonly dockShown = input(false);
  readonly availableWidth = input(0);
  readonly panelId = input('');
  readonly state = input<CompactRailState>('idle');
  readonly stats = input<ReturnType<SessionInspectorComponent['stats']>>(null);
  readonly dockOpen = model(false);
  readonly detailsOpen = model(false);
  readonly layoutChanged = output<void>();
  readonly overlay = computed(() =>
    this.splitDisplayed() || this.availableWidth() - this.dock.width() < CHAT_MIN_BESIDE_DOCK,
  );
  /**
   * The grip's maximum keeps the chat at least `CHAT_MIN_BESIDE_DOCK` wide, so a drag
   * can never flip the dock into the overlay and unmount the grip mid-drag.
   */
  readonly dockedMaxWidth = computed(() =>
    Math.max(
      this.dock.minWidth,
      Math.min(this.dock.maxWidth(), Math.floor(this.availableWidth() - CHAT_MIN_BESIDE_DOCK)),
    ),
  );
  readonly compactWidth = INSPECTOR_TAB_WIDTH;
  readonly dock = inject(InspectorDockController);
  readonly detail = inject(CanvasDetailService);
  private readonly tabs = inject(TabManagerService);
  private readonly openState = inject(InspectorOpenStateService);
  private readonly injector = inject(Injector);
  private detailsFocusObserver: MutationObserver | null = null;
  readonly inspectorSection =
    signal<ReturnType<SessionInspectorComponent['focusSection']>>(null);
  readonly compactSheetOpen = computed(() => this.compactSheet() && this.detailsOpen());
  /** The rail replaces the expanded dock; neither width is subtracted twice. */
  readonly occupiedWidth = computed(() =>
    this.dockShown() ? (this.dockOpen() && !this.overlay() ? this.dock.width() : this.compactWidth) : 0,
  );

  constructor() {
    this.dock.bind(() => this.dockShown() && this.dockOpen(), this.availableWidth);
    // A host resize can still flip the overlay and unmount the grip, which then reports
    // nothing: drop its uncommitted draft so it cannot outlive the drag.
    effect(() => {
      if (this.overlay()) untracked(() => this.dock.cancel());
    });
    inject(DestroyRef).onDestroy(() => this.stopDetailsFocusObserver());
  }
  selectRailAgent(id: string, key: string): void {
    this.detail.selectLaneFor(id, key);
    this.expandInspector('agents');
  }
  sessionTab(id: string) {
    return this.tabs.findTabByIdAcrossWorkspaces(id)?.tab;
  }
  /** After the next render, focus the open compact sheet, then its close once the inspector loads. */
  private focusDetailsShell(): void {
    this.stopDetailsFocusObserver();
    afterNextRender(
      () => {
        const shell = this.root().querySelector<HTMLElement>('[data-compact-sheet]');
        if (!shell || !this.detailsOpen()) return;
        shell.focus();
        const focusClose = () => {
          const close = shell.querySelector<HTMLElement>(
            '[data-inspector-close]',
          );
          if (!close || !this.detailsOpen()) return;
          close.focus();
          this.stopDetailsFocusObserver();
        };
        this.detailsFocusObserver = new MutationObserver(focusClose);
        this.detailsFocusObserver.observe(shell, {
          childList: true,
          subtree: true,
        });
        focusClose();
      },
      { injector: this.injector },
    );
  }

  stopDetailsFocusObserver(): void {
    this.detailsFocusObserver?.disconnect();
    this.detailsFocusObserver = null;
  }

  closeCompactSheet(event?: Event): void {
    event?.stopPropagation();
    this.stopDetailsFocusObserver();
    this.detailsOpen.set(false);
    afterNextRender(() => this.focusRailExpand(), { injector: this.injector });
  }

  /**
   * Focus the rail's expand control. The rail sits in a @defer block that the sheet
   * or a cold load can leave unmounted, so wait for it while focus has not moved.
   */
  private focusRailExpand(): void {
    this.stopDetailsFocusObserver();
    const root = this.root();
    const find = () =>
      root.querySelector<HTMLElement>('[data-inspector-rail] [data-inspector-expand]');
    const expand = find();
    if (expand) {
      expand.focus();
      return;
    }
    const doc = root.ownerDocument;
    this.detailsFocusObserver = new MutationObserver(() => {
      const loaded = find();
      if (!loaded) return;
      const active = doc.activeElement;
      if (!active || active === doc.body || !active.isConnected) loaded.focus();
      this.stopDetailsFocusObserver();
    });
    this.detailsFocusObserver.observe(root, { childList: true, subtree: true });
  }

  onDocumentEscape(event: Event): void {
    if (this.visible() && this.compactSheetOpen())
      this.closeCompactSheet(event);
  }

  openLaneFromCompactSheet(id: string, laneKey: string): void {
    this.detail.selectLaneFor(id, laneKey);
    this.closeCompactSheet();
  }

  onSheetKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const sheet = event.currentTarget;
    if (!(sheet instanceof HTMLElement)) return;
    const items = [...sheet.querySelectorAll<HTMLElement>(TABBABLE)].filter(
      (element) => isCanvasInspectorTabbable(element, sheet),
    );
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const active = sheet.ownerDocument.activeElement;
    if (event.shiftKey && active === items[0]) {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (!event.shiftKey && active === items[items.length - 1]) {
      event.preventDefault();
      items[0].focus();
    }
  }

  private setDockExpanded(open: boolean): void {
    const id = this.focusedId();
    // The split overlay is transient: it never overwrites the persisted single-view state.
    if (id && !this.splitDisplayed())
      this.openState.setDocked(id, this.sessionTab(id)?.viewMode ?? 'full', open);
    this.dockOpen.set(open);
  }

  expandInspector(
    section?: NonNullable<
      ReturnType<SessionInspectorComponent['focusSection']>
    >,
  ): void {
    this.inspectorSection.set(section ?? null);
    if (this.compactSheet()) {
      this.detailsOpen.set(true);
      this.focusDetailsShell();
      return;
    }
    this.setDockExpanded(true);
    this.layoutChanged.emit();
    if (!section)
      afterNextRender(() => this.focusDock(), { injector: this.injector });
  }

  /** The Stats tab opens or closes the single-focus dock. */
  toggleDetails(): void {
    this.stopDetailsFocusObserver();
    if (this.compactSheet()) {
      this.detailsOpen.set(!this.detailsOpen());
      if (this.detailsOpen()) this.focusDetailsShell();
      return;
    }
    this.setDockExpanded(!this.dockOpen());
    this.layoutChanged.emit();
  }
  /** Collapse details and return focus to the compact rail's expand control. */
  closeDock(): void {
    this.stopDetailsFocusObserver();
    this.setDockExpanded(false);
    this.inspectorSection.set(null);
    this.layoutChanged.emit();
    afterNextRender(() => this.focusRailExpand(), { injector: this.injector });
  }
  /**
   * The board crossed the 400 px compact threshold. The dock or split overlay
   * (`dockOpen`) and the compact sheet (`detailsOpen`) are separate surfaces,
   * so an open inspector moves to the destination surface, the source closes,
   * and focus follows.
   */
  handOffInspector(compact: boolean, dockWasOpen: boolean): void {
    if (compact && dockWasOpen) {
      this.dockOpen.set(false);
      this.detailsOpen.set(true);
      this.focusDetailsShell();
    } else if (!compact && this.detailsOpen()) {
      this.stopDetailsFocusObserver();
      this.detailsOpen.set(false);
      this.dockOpen.set(true);
      afterNextRender(() => this.focusDock(), { injector: this.injector });
    }
  }

  /**
   * Focus the dock's close control; until the deferred inspector has one,
   * hold focus on the dock shell and move it in once the close appears.
   */
  private focusDock(): void {
    this.stopDetailsFocusObserver();
    const root = this.root();
    const dock = root.querySelector<HTMLElement>('[data-inspector-dock]');
    const tab =
      dock ??
      root.querySelector<HTMLElement>(
        '[data-inspector-rail] [data-inspector-expand]',
      );
    const close = dock?.querySelector<HTMLElement>('[data-inspector-close]');
    if (close || !dock) {
      (close ?? tab)?.focus();
      return;
    }
    tab?.focus();
    this.detailsFocusObserver = new MutationObserver(() => {
      const loaded = dock.querySelector<HTMLElement>('[data-inspector-close]');
      if (!loaded) return;
      // Only move focus the user has not moved elsewhere meanwhile.
      if (this.dockShown() && this.dockOpen() && root.ownerDocument.activeElement === tab)
        loaded.focus();
      this.stopDetailsFocusObserver();
    });
    this.detailsFocusObserver.observe(dock, { childList: true, subtree: true });
  }

}
