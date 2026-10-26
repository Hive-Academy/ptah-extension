import {
  ChangeDetectionStrategy, Component, DestroyRef, Injector, TemplateRef,
  afterNextRender, computed, inject, input, linkedSignal, model, output, signal, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  INSPECTOR_TAB_WIDTH, InspectorDockController, InspectorOpenStateService,
  SendToMessagingComponent, SessionInspectorStore, TabManagerService, injectSessionStatsSource,
} from '@ptah-extension/chat';
import { SessionInspectorComponent } from '@ptah-extension/chat/inspector';
import { SplitHandleComponent, inspectorToggleDescription, type CompactRailState } from '@ptah-extension/chat-ui';
import { railWidthBand } from '../canvas-board-mode';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { CanvasLaneTabsComponent } from '../canvas-detail/canvas-lane-tabs.component';

const TABBABLE =
  'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';
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
  const inspectorStore = inject(SessionInspectorStore);
  const detailsOpen = signal(false);
  const compactSheet = computed(() => sources.width() > 0 && sources.width() < 400);
  const compactSheetOpen = computed(() => compactSheet() && detailsOpen());
  const stats = injectSessionStatsSource({
    tab: sources.focusedTab,
    sessionId: () => sources.focusedTab()?.claudeSessionId ?? null,
    budget: () => sources.focusedTab()?.sessionBudget ?? null,
    available: () => sources.focusedTab() !== null,
  });
  const closedDetailsDescription = computed(() => {
    const current = stats.inputs();
    const id = sources.focusedId();
    return current && id
      ? inspectorToggleDescription(
          current.context, current.limitSummary,
          inspectorStore.modelFor(id)().needsYouCount,
        )
      : '';
  });
  const dockOpenByDefault = computed(() => railWidthBand(sources.width()) !== 'sm');
  const dockOpen = linkedSignal({
    source: () => {
      const id = sources.focusedId();
      return id ? openState.dockedOpen(
        id, sources.focusedTab()?.viewMode ?? 'full',
        dockOpenByDefault(),
      ) : false;
    },
    computation: (open: boolean) => open,
  });
  const dockShown = computed(() =>
    !sources.splitDisplayed() && !compactSheet() && sources.focusedId() !== null,
  );
  const dockSlotShown = computed(() => dockShown() && dockOpen());
  // The compact inspector replaces the expanded dock; it never reduces this input.
  const dockAvailableWidth = computed(() => Math.max(0, sources.width() - sources.leftRailWidth()));
  return {
    detailsOpen, compactSheet, compactSheetOpen, stats, closedDetailsDescription,
    dockOpen, dockShown, dockSlotShown, dockAvailableWidth,
  };
}

@Component({
  selector: 'ptah-canvas-inspector-dock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, SessionInspectorComponent, SendToMessagingComponent,
    SplitHandleComponent, CanvasLaneTabsComponent],
  providers: [InspectorDockController],
  host: { class: 'contents', '(document:keydown.escape)': 'onDocumentEscape($event)' },
  template: `
    <ng-template #laneStrip>
      @if (focusedId(); as id) {
        <ptah-canvas-lane-tabs
          [panelId]="panelId()" [tabId]="id"
          [laneKey]="detail.laneKeyFor(id)"
          (laneSelected)="detail.selectLaneFor(id, $event)"
        />
      }
    </ng-template>
    <ng-template #splitInspector>
      @if (focusedId(); as id) {
                      <aside
                        class="absolute inset-y-0 right-0 z-20 w-[min(360px,100%)] overflow-auto border-l border-base-content/10 bg-base-100 shadow-xl"
                        role="dialog"
                        aria-label="Session details"
                        tabindex="-1"
                        (keydown.escape)="closeSplitDetails($event)"
                      >
                        @defer (when detailsOpen()) {
                          <ptah-session-inspector
                            [tabId]="id"
                            presentation="embedded"
                            [hasLaneSurface]="true"
                            [stats]="stats()"
                            (laneRequested)="detail.selectLaneFor(id, $event)"
                            (closeRequested)="closeSplitDetails()"
                            [sessionTitle]="sessionTab(id)?.title ?? ''"
                            [sessionStatus]="state()"
                            [workflow]="sessionTab(id)?.workflow ?? null"
                            [branch]="
                              sessionTab(id)?.agentOrigin?.branch ?? null
                            "
                            [selectedAgentKey]="detail.laneKeyFor(id)"
                            [focusSection]="inspectorSection()"
                          >
                            <ptah-send-to-messaging
                              inspectorActions
                              [tabId]="id"
                            />
                            <ng-container inspectorSection [ngTemplateOutlet]="laneStrip" />
                          </ptah-session-inspector>
                        } @loading {
                          <div
                            class="flex flex-col gap-2 p-4"
                            role="status"
                            aria-label="Loading session details"
                            data-inspector-skeleton
                          >
                            <ng-container [ngTemplateOutlet]="laneStrip" />
                    <div class="skeleton h-4 w-32"></div>
                            <div class="skeleton h-3 w-full"></div>
                            <div class="skeleton h-3 w-3/4"></div>
                          </div>
                        }
                      </aside>

      }
    </ng-template>
        @if (dockShown()) {
          @if (focusedId(); as id) {
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
                (expandRequested)="expandInspector($event)"
              />
            }
            @if (dockShown() && dockOpen()) {
              <!-- 0 px slot: the grip overlays the dock's leading edge and adds no layout width. -->
              <div class="relative z-10 w-0 shrink-0">
                <ptah-split-handle
                  class="absolute inset-y-0 left-0 w-3"
                  orientation="vertical"
                  appearance="grip"
                  label="Resize session details"
                  [inverted]="true"
                  [size]="dock.width()"
                  [min]="dock.minWidth"
                  [max]="dock.maxWidth()"
                  (sizeChange)="dock.preview($event)"
                  (sizeCommit)="dock.commit()"
                  (sizeCancel)="dock.cancel()"
                  (sizeReset)="dock.reset()"
                />
              </div>
              <aside
                class="flex h-full shrink-0 flex-col border-l border-base-content/10 bg-base-100"
                tabindex="-1"
                [class.absolute]="availableWidth() < 660"
                [class.right-0]="availableWidth() < 660"
                [class.z-20]="availableWidth() < 660"
                [attr.role]="availableWidth() < 660 ? 'dialog' : null"
                aria-label="Session details"
                data-inspector-dock
                [style.width.px]="occupiedWidth()"
              >
                <!-- The expanded inspector loads on open; its @loading block keeps the lane strip mounted meanwhile. -->
                @defer (when dockOpen()) {
                  <ptah-session-inspector
                    class="min-h-0 flex-1"
                    [tabId]="id"
                    presentation="embedded"
                    [hasLaneSurface]="true"
                    [stats]="stats()"
                    (laneRequested)="detail.selectLaneFor(id, $event)"
                    (closeRequested)="closeDock()"
                    [sessionTitle]="sessionTab(id)?.title ?? ''"
                    [sessionStatus]="state()"
                    [workflow]="sessionTab(id)?.workflow ?? null"
                    [branch]="sessionTab(id)?.agentOrigin?.branch ?? null"
                    [selectedAgentKey]="detail.laneKeyFor(id)"
                    [focusSection]="inspectorSection()"
                  >
                    <ptah-send-to-messaging inspectorActions [tabId]="id" />
                    <ng-container inspectorSection [ngTemplateOutlet]="laneStrip" />
                  </ptah-session-inspector>
                } @loading {
                  <div
                    class="flex min-h-0 flex-1 flex-col gap-2 p-4"
                    role="status"
                    aria-label="Loading session details"
                    data-inspector-skeleton
                  >
                    <ng-container [ngTemplateOutlet]="laneStrip" />
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
              class="fixed inset-0 z-50 overflow-y-auto bg-base-100"
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
                  (closeRequested)="closeCompactSheet()"
                  [sessionTitle]="sessionTab(id)?.title ?? ''"
                  [sessionStatus]="state()"
                  [workflow]="sessionTab(id)?.workflow ?? null"
                  [branch]="sessionTab(id)?.agentOrigin?.branch ?? null"
                  [selectedAgentKey]="detail.laneKeyFor(id)"
                  [focusSection]="inspectorSection()"
                >
                  <ptah-send-to-messaging inspectorActions [tabId]="id" />
                  <ng-container inspectorSection [ngTemplateOutlet]="laneStrip" />
                </ptah-session-inspector>
              } @loading {
                <div
                  class="flex flex-col gap-2 p-4"
                  role="status"
                  aria-label="Loading session details"
                  data-inspector-skeleton
                >
                  <ng-container [ngTemplateOutlet]="laneStrip" />
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
  readonly activeSide = input<'left' | 'right'>('left');
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
  readonly splitTemplate = viewChild<TemplateRef<unknown>>('splitInspector');
  readonly compactWidth = INSPECTOR_TAB_WIDTH;
  readonly dock = inject(InspectorDockController);
  readonly detail = inject(CanvasDetailService);
  private readonly tabs = inject(TabManagerService);
  private readonly openState = inject(InspectorOpenStateService);
  private readonly injector = inject(Injector);
  private detailsFocusObserver: MutationObserver | null = null;
  private detailsFocusReturn = false;
  readonly inspectorSection =
    signal<ReturnType<SessionInspectorComponent['focusSection']>>(null);
  readonly compactSheetOpen = computed(() => this.compactSheet() && this.detailsOpen());
  /** The rail replaces the expanded dock; neither width is subtracted twice. */
  readonly occupiedWidth = computed(() =>
    this.dockShown() ? (this.dockOpen() ? this.dock.width() : this.compactWidth) : 0,
  );

  constructor() {
    this.dock.bind(() => this.dockShown() && this.dockOpen(), this.availableWidth);
    inject(DestroyRef).onDestroy(() => this.stopDetailsFocusObserver());
  }
  sessionTab(id: string) {
    return this.tabs.findTabByIdAcrossWorkspaces(id)?.tab;
  }
  openSplitDetails(): void {
    this.detailsFocusReturn = true;
    this.detailsOpen.set(true);
    this.focusDetailsShell();
  }
  /** After the next render, focus the open overlay or sheet, then its close once the inspector loads. */
  private focusDetailsShell(): void {
    this.stopDetailsFocusObserver();
    afterNextRender(
      () => {
        const shell = this.root().querySelector<HTMLElement>(
          this.compactSheet()
            ? '[data-compact-sheet]'
            : '[role="dialog"][aria-label="Session details"]',
        );
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

  closeSplitDetails(event?: Event): void {
    event?.stopPropagation();
    this.stopDetailsFocusObserver();
    this.detailsOpen.set(false);
    if (!this.detailsFocusReturn) return;
    this.detailsFocusReturn = false;
    afterNextRender(
      () => {
        const opener = this.root().querySelector<HTMLElement>(
          `[data-pane-side="${this.activeSide()}"] [aria-label="Open details"]`,
        );
        if (this.splitDisplayed() && opener) opener.focus();
        else {
          const id = this.focusedId();
          const card = [
            ...this.root().querySelectorAll<HTMLElement>(
              '[data-rail-card]',
            ),
          ].find((node) => node.dataset['tabId'] === id);
          (
            card?.querySelector<HTMLElement>('.rc-select, .rail-collapsed') ??
            this.root().querySelector<HTMLElement>(
              `[data-pane-side="${this.activeSide()}"] [role="tab"][aria-selected="true"]`,
            )
          )?.focus();
        }
      },
      { injector: this.injector },
    );
  }

  closeCompactSheet(event?: Event): void {
    event?.stopPropagation();
    this.stopDetailsFocusObserver();
    this.detailsOpen.set(false);
    this.detailsFocusReturn = false;
    afterNextRender(
      () =>
        this.root()
          .querySelector<HTMLElement>(
            `[data-pane-side="${this.activeSide()}"] [aria-label="Open details"]`,
          )
          ?.focus(),
      { injector: this.injector },
    );
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
    if (id)
      this.openState.setDocked(id, this.sessionTab(id)?.viewMode ?? 'full', open);
    this.dockOpen.set(open);
  }

  expandInspector(
    section?: NonNullable<
      ReturnType<SessionInspectorComponent['focusSection']>
    >,
  ): void {
    this.inspectorSection.set(section ?? null);
    this.setDockExpanded(true);
    this.layoutChanged.emit();
    if (!section)
      afterNextRender(() => this.focusDock(), { injector: this.injector });
  }

  /** The Stats tab opens or closes the single-focus dock. */
  toggleDetails(): void {
    this.stopDetailsFocusObserver();
    this.setDockExpanded(!this.dockOpen());
    this.layoutChanged.emit();
  }
  /** Collapse details and return focus to the compact rail's expand control. */
  closeDock(): void {
    this.stopDetailsFocusObserver();
    this.setDockExpanded(false);
    this.inspectorSection.set(null);
    this.layoutChanged.emit();
    afterNextRender(
      () =>
        this.root()
          .querySelector<HTMLElement>(
            '[data-inspector-rail] [data-inspector-expand]',
          )
          ?.focus(),
      { injector: this.injector },
    );
  }
  /**
   * The board crossed the 400 px compact threshold. In single focus the dock
   * (`dockOpen`) and the compact sheet (`detailsOpen`) are separate surfaces,
   * so an open inspector moves to the destination surface, the source closes,
   * and focus follows. In split both use `detailsOpen`; only focus moves.
   */
  handOffInspector(compact: boolean, dockWasOpen: boolean): void {
    if (this.splitDisplayed()) {
      if (this.detailsOpen()) this.focusDetailsShell();
      return;
    }
    if (compact && dockWasOpen) {
      this.dockOpen.set(false);
      this.detailsFocusReturn = false;
      this.detailsOpen.set(true);
      this.focusDetailsShell();
    } else if (!compact && this.detailsOpen()) {
      this.stopDetailsFocusObserver();
      this.detailsOpen.set(false);
      this.detailsFocusReturn = false;
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
