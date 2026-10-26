import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  InspectorShellController,
  PreviousSessionsDialogService,
  ProjectSetupCardComponent,
  RailTranscriptRetentionCoordinator,
  RecentSessionsStore,
  SessionRowActionsService,
  TabManagerService,
} from '@ptah-extension/chat';
import { SURFACE_ACTIVE, VSCodeService } from '@ptah-extension/core';
import {
  StatsTileExpansionState,
  type CompactRailState,
} from '@ptah-extension/chat-ui';
import { CanvasStore } from '../canvas.store';
import { railWidthBand, railWidthPx } from '../canvas-board-mode';
import { RUNNING_CAP_MESSAGE } from '../canvas-running-cap';
import { CanvasLayoutService } from '../canvas-layout.service';
import { CanvasLayoutPersistenceService } from '../canvas-layout-persistence.service';
import { CanvasRenderMetricsService } from '../canvas-render-metrics.service';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { effectiveCanvasLaneKind } from '../canvas-detail/canvas-lane-view.component';
import { AgentMonitorStore, BackgroundAgentStore } from '@ptah-extension/chat-streaming';
import { CanvasInspectorDockComponent, injectCanvasInspectorDockState, isCanvasInspectorTabbable } from './canvas-inspector-dock.component';
import { CanvasRailComponent } from './canvas-rail.component';
import { CanvasFocusAreaComponent } from './canvas-focus-area.component';
import { LucideAngularModule, Sparkles, TriangleAlert, X } from 'lucide-angular';
import { AuroraEffectComponent } from '@ptah-extension/ui';
import type { ChatSessionSummary } from '@ptah-extension/shared';
import {
  checkRailGeometry,
  railAnchorScrollTop,
  railCardHeight,
  type RailGeometryBaseline,
} from './canvas-rail-geometry';

const TABBABLE =
  'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]';
/** Open layers inside a pane that own their focus: Details dialog, menus, an overlay dock. */
const PANE_OVERLAYS =
  '[role="dialog"], [role="menu"], ptah-display-sheet [role="region"].full';
// Compact the left rail before two rails crowd the session pane.
const RAIL_AUTO_COLLAPSE_PX = 640;

/** One current board condition, stamped by the shell so a refreshed source can reappear. */
export interface CanvasBoardNotice {
  readonly kind: 'write-failure' | 'read-only' | 'cap';
  readonly text: string;
  readonly key: string;
}

@Component({
  selector: 'ptah-canvas-rail-board',
  standalone: true,
  imports: [
    CanvasRailComponent,
    CanvasInspectorDockComponent,
    CanvasFocusAreaComponent,
    ProjectSetupCardComponent,
    AuroraEffectComponent,
    NgTemplateOutlet,
    DatePipe,
    LucideAngularModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    RailTranscriptRetentionCoordinator,
    InspectorShellController,
    StatsTileExpansionState,
  ],
  host: {
    class: 'block h-full min-h-0',
    '[style.display]': 'visible() ? null : "none"',
    'data-canvas-board-mode': 'rail',
    '[attr.data-canvas-live-views]': 'liveViews()',
    '[attr.data-canvas-focus-swaps]': 'focusSwaps()',
    '[attr.data-canvas-rail-shifts]': 'railShifts()',
    '(keydown)': 'onTabKey($event)',
  },
  styles: [
    `
      :host-context([data-glass='on']) ptah-aurora-effect {
        display: none;
      }
      :host-context([data-glass='on']) .canvas-rail-board-layout {
        gap: 8px;
      }
      @keyframes rail-pane-enter {
        from {
          opacity: 0;
          transform: translateX(8px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }
      @media (prefers-reduced-motion: no-preference) {
        .rail-pane-enter {
          animation: rail-pane-enter 180ms var(--ptah-ease-soft) both;
        }
        [data-testid='rail-pane-container']:has(> .rail-pane-enter) {
          overflow: clip;
        }
      }
    `,
  ],
  template: `
    @if (visible()) {
      <div
        class="canvas-rail-board-layout relative flex h-full min-h-0 min-w-0"
      >
        <ptah-canvas-rail
          [attr.inert]="compactSheetOpen() ? '' : null" [tiles]="orderedTiles()"
          [workspacePath]="workspacePath()" [states]="railStates()"
          [focusedTabId]="focusedId()" [density]="board().railDensity"
          [collapsed]="effectiveCollapsed()" [autoCollapsed]="autoCollapsed()"
          [band]="band()" [runningCount]="store.runningSessionCount()"
          [canStart]="store.canStartRunningSession()" [canAdd]="store.canAddTile()"
          [holdTabId]="holdTabId()" [surfaceActive]="visible()"
          [previousSessionsOpen]="previousSessions.isOpen()"
          [splitDisabledReason]="splitDisabledReason()"
          (focusRequested)="focus($event)" (collapseToggled)="toggleCollapse()"
          (densityToggled)="toggleDensity()" (jumpTo)="jumpTo($event)"
          (newSession)="newSession($event)" (previousSessionsRequested)="previousSessions.open()"
          (scrolled)="store.setRailScrollTop(workspacePath(), $event)"
          (railState)="onRailState($event)"
          (staleAction)="
            announce('This request has changed. Open the current request.')
          "
          (lanesRequested)="onLanesRequested($event)" (openBesideRequested)="openBeside($event)"
          (moveUpRequested)="move($event, -1)" (moveDownRequested)="move($event, 1)"
        />
        @if (orderedTiles().length === 0) {
          <main
            class="relative order-first flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
            [attr.data-glass-surface]="isElectron ? null : 'chrome'"
            data-testid="canvas-rail-empty-board" aria-labelledby="canvas-rail-empty-board-title"
          >
            <ptah-aurora-effect variant="board" [visible]="surfaceActive()" />
            <div
              class="relative z-10 mx-auto w-full max-w-[780px] px-6 pb-[70px] pt-[58px] max-[850px]:px-5 max-[850px]:pt-6"
              data-testid="canvas-rail-empty-board-content"
            >
              @if (notice()) {
                <ng-container [ngTemplateOutlet]="noticeTemplate" />
              }
              <div
                class="mx-auto flex min-h-[251px] flex-col items-center justify-center text-center"
              >
                <span
                  class="mb-4 flex size-[45px] items-center justify-center rounded-xl border border-[color:var(--surface-border-strong)] bg-surface-3 text-secondary"
                  aria-hidden="true"
                  ><lucide-angular [img]="sparklesIcon" class="size-6"
                /></span>
                <h1
                  id="canvas-rail-empty-board-title"
                  class="font-display text-[29px] font-semibold text-base-content"
                >
                  A fresh space to work
                </h1>
                <p class="mt-2 text-[13px] text-base-content">
                  Start a session to explore, build, and make progress.
                </p>
                <button
                  type="button" data-testid="canvas-hero-new-session"
                  class="btn btn-primary mt-5 min-w-[153px]"
                  [attr.aria-disabled]="newSessionBlockReason() ? 'true' : null"
                  [attr.title]="newSessionBlockReason()"
                  [attr.aria-describedby]="
                    newSessionBlockReason()
                      ? 'canvas-rail-empty-board-reason'
                      : null
                  "
                  (click)="emptyBoardNewSession($event)"
                >
                  <span aria-hidden="true">+</span> New session
                </button>
                @if (newSessionBlockReason(); as reason) {
                  <p
                    id="canvas-rail-empty-board-reason" class="text-xs text-base-content-muted"
                  >
                    {{ reason }}
                  </p>
                }
              </div>
              <div class="mx-auto w-full max-w-[588px]">
                <ptah-project-setup-card class="block w-full" />
                @if (
                  recentSessions.confirmed() && recentSessions.sessions().length
                ) {
                  <section class="mt-6" aria-labelledby="canvas-recent-heading">
                    <h2
                      id="canvas-recent-heading" class="mb-3 text-sm font-semibold"
                    >
                      Recent sessions
                    </h2>
                    <div
                      class="grid grid-cols-3 gap-[9px] max-[850px]:grid-cols-1"
                    >
                      @for (
                        session of recentSessions.sessions().slice(0, 3);
                        track session.id
                      ) {
                        <button
                          type="button"
                          class="surface-3 min-h-[84px] min-w-0 rounded-xl p-3 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2"
                          [attr.aria-label]="
                            'Open ' +
                            (session.name || 'Untitled session') +
                            (recentActivity(session.lastActivityAt)
                              ? ', ' + recentActivity(session.lastActivityAt)
                              : '')
                          "
                          (click)="openRecentSession(session)"
                        >
                          <span class="line-clamp-2 text-xs font-semibold">{{
                            session.name || 'Untitled session'
                          }}</span>
                          <span
                            class="mt-2 block text-xs text-base-content-muted"
                            [attr.title]="
                              session.lastActivityAt === null ||
                              session.lastActivityAt === undefined
                                ? null
                                : (session.lastActivityAt | date: 'medium')
                            "
                            >{{ recentActivity(session.lastActivityAt) }}</span
                          >
                        </button>
                      }
                    </div>
                  </section>
                }
              </div>
            </div>
          </main>
        } @else {
          <div
            class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto"
            [attr.data-glass-surface]="isElectron ? null : 'chrome'"
          >
            @if (notice()) {
              <div class="mx-auto w-full max-w-[780px] shrink-0 p-4">
                <ng-container [ngTemplateOutlet]="noticeTemplate" />
              </div>
            }
            <div
              class="flex min-h-0 min-w-0 flex-1 overflow-x-auto"
              [class.overflow-y-auto]="splitStacked() && splitDisplayed()"
              [class.overflow-y-hidden]="!splitStacked() || !splitDisplayed()"
              [class.flex-col]="splitStacked() && splitDisplayed()"
              [class.flex-row]="!splitStacked() || !splitDisplayed()" [class.gap-1]="splitDisplayed()"
              [attr.inert]="compactSheetOpen() ? '' : null" data-testid="rail-pane-container"
            >
              @for (side of sides; track side) {
                @if (paneTab(side); as id) {
                  @let orchestratorLane =
                    effectiveLaneKind(id) === 'orchestrator';
                  <section
                    class="relative flex-1" data-testid="canvas-tile"
                    [animate.enter]="splitDisplayed() ? 'rail-pane-enter' : ''"
                    [class.min-w-[360px]]="splitDisplayed()"
                    [class.min-h-0]="!splitDisplayed() || !splitStacked()"
                    [class.min-h-[240px]]="splitDisplayed() && splitStacked()"
                    [class.overflow-hidden]="orchestratorLane" [class.overflow-y-auto]="!orchestratorLane"
                    [class.border-base-content-muted]="splitDisplayed()"
                    [class.border-l]="
                      splitDisplayed() &&
                      !splitStacked() &&
                      paneNumber(side) === 2
                    "
                    [class.border-t]="
                      splitDisplayed() &&
                      splitStacked() &&
                      paneNumber(side) === 2
                    "
                    [attr.data-pane-divider]="
                      splitDisplayed() && paneNumber(side) === 2
                        ? splitStacked()
                          ? 'horizontal'
                          : 'vertical'
                        : null
                    "
                    [style.order]="visualOrder().indexOf(side)" [attr.data-pane-side]="side"
                    [attr.aria-label]="paneLabel(side, id)" (click)="activatePane(side)"
                    (focusin)="activatePane(side)"
                  >
                    <ptah-canvas-focus-area
                      class="block h-full min-h-0 min-w-0"
                      [focusedTabId]="id" [paneId]="side"
                      [paneFocused]="activeSide() === side" [splitDisplayed]="splitDisplayed()"
                      (closeRequested)="close($event)" (closeSplitRequested)="closeSplit()"
                      (closePaneRequested)="closePane($event)" (swapPanesRequested)="swapPanes()"
                    />
                  </section>
                }
              }
            </div>
          </div>
        }
        <ng-template #noticeTemplate>
          @if (notice(); as currentNotice) {
            <div
              class="surface-3 mx-auto flex min-h-12 w-full items-center gap-3 rounded-lg border border-warning px-3 py-2.5 text-sm text-base-content"
              [class.max-w-[588px]]="orderedTiles().length === 0"
              [attr.role]="currentNotice.kind === 'cap' ? 'status' : 'alert'"
              data-testid="canvas-board-notice"
            >
              <lucide-angular
                [img]="alertIcon" class="size-4 shrink-0"
                aria-hidden="true"
              /><span class="flex-1">{{ currentNotice.text }}</span>
              <button
                type="button" class="btn btn-ghost btn-xs"
                aria-label="Dismiss notice" (click)="noticeDismissed.emit(currentNotice.key)"
              >
                <lucide-angular
                  [img]="closeIcon" class="size-3.5"
                  aria-hidden="true"
                />
              </button>
            </div>
          }
        </ng-template>
        <ptah-canvas-inspector-dock
          [root]="boardElement" [focusedId]="focusedId()"
          [splitDisplayed]="splitDisplayed()" [visible]="visible()"
          [compactSheet]="compactSheet()" [dockShown]="dockShown()"
          [availableWidth]="dockAvailableWidth()" [panelId]="inspectorPanelId(focusedId() ?? '')"
          [stats]="stats.inputs()" [state]="railStates().get(focusedId() ?? '') ?? 'idle'"
          [(dockOpen)]="dockOpen" [(detailsOpen)]="detailsOpen"
          (layoutChanged)="anchor()" (closeRequested)="close($event)"
        />
      </div>
      <div class="sr-only" aria-live="polite">{{ announcement() }}</div>
    }
  `,
})
export class CanvasRailBoardComponent {
  readonly isElectron = inject(VSCodeService).isElectron;
  recentActivity(timestamp: number | null | undefined): string {
    if (timestamp == null) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const elapsed = now.getTime() - timestamp;
    if (elapsed >= 0 && elapsed < 60 * 60_000)
      return `${Math.max(1, Math.floor(elapsed / 60_000))}m ago`;
    if (date.toDateString() === now.toDateString() && elapsed >= 0)
      return `${Math.floor(elapsed / 3_600_000)}h ago`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
    }).format(date);
  }
  readonly sparklesIcon = Sparkles;
  readonly alertIcon = TriangleAlert;
  readonly closeIcon = X;
  readonly sides = ['left', 'right'] as const;
  readonly workspacePath = input.required<string>();
  readonly visible = input.required<boolean>();
  readonly notice = input<CanvasBoardNotice | null>(null);
  readonly noticeDismissed = output<string>();
  /** The footer or empty board asked for the host's named New session popover. */
  readonly newSessionRequested = output<HTMLElement>();
  readonly recentSessions = inject(RecentSessionsStore);
  private readonly sessionActions = inject(SessionRowActionsService);
  readonly store = inject(CanvasStore);
  readonly previousSessions = inject(PreviousSessionsDialogService);
  readonly layout = inject(CanvasLayoutService);
  readonly persistence = inject(CanvasLayoutPersistenceService);
  readonly detail = inject(CanvasDetailService);
  private readonly monitor = inject(AgentMonitorStore);
  private readonly background = inject(BackgroundAgentStore);
  readonly metrics = inject(CanvasRenderMetricsService);
  private readonly tabs = inject(TabManagerService);
  sessionTab(id: string) {
    return this.tabs.findTabByIdAcrossWorkspaces(id)?.tab;
  }
  inspectorPanelId(id: string): string {
    return `rail-${this.paneTab('right') === id ? 'right' : 'left'}-lane-panel`;
  }
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly boardElement = this.host.nativeElement;
  private readonly inspector = viewChild(CanvasInspectorDockComponent);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  readonly railStates = signal<ReadonlyMap<string, CompactRailState>>(new Map());
  readonly holdTabId = signal<string | null>(null);
  readonly activeSide = signal<'left' | 'right'>('left');
  readonly otherTabId = signal<string | null>(null);
  readonly visualOrder = signal<readonly ('left' | 'right')[]>(['left', 'right']);
  readonly splitDisplayed = computed(() => !!this.otherTabId());
  readonly splitStacked = computed(() => this.layout.containerWidth() < 1440);
  effectiveLaneKind(
    tabId: string,
  ): 'orchestrator' | 'cli' | 'subagent' | 'background' {
    const sessionId =
      this.tabs.findTabByIdAcrossWorkspaces(tabId)?.tab.claudeSessionId ?? null;
    return effectiveCanvasLaneKind(
      this.detail.laneKeyFor(tabId),
      sessionId,
      this.monitor,
      this.background,
    );
  }
  readonly splitDisabledReason = computed(() =>
    this.orderedTiles().length < 2
      ? 'Open another session first to split'
      : null,
  );
  private lastFocusedId: string | null = null;
  private lastOrderedIds: readonly string[] = [];
  private readonly parentActive =
    inject(SURFACE_ACTIVE, { optional: true }) ?? signal(true);
  /**
   * This board is the active workspace's AND the canvas surface is on screen.
   * A standalone route keeps the canvas mounted but hidden (`*ptahRetainWhile`),
   * so `visible()` alone would let a focus repair call `switchTab` behind the
   * user's back (C1).
   */
  readonly surfaceActive = computed(
    () => this.visible() && this.parentActive(),
  );
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
  readonly isEmptyBoard = computed(() => this.orderedTiles().length === 0);
  readonly focusedId = computed(() => {
    const tiles = this.orderedTiles();
    const id = this.store.focusedTabIdFor(this.workspacePath());
    return (
      tiles.find((tile) => tile.tabId === id)?.tabId ?? tiles[0]?.tabId ?? null
    );
  });
  readonly focusedTab = computed(() => {
    const id = this.focusedId();
    return id ? (this.tabs.findTabByIdAcrossWorkspaces(id)?.tab ?? null) : null;
  });
  private readonly inspectorState = injectCanvasInspectorDockState({
    focusedId: this.focusedId,
    focusedTab: this.focusedTab,
    width: this.layout.containerWidth,
    leftRailWidth: () => railWidthPx(this.effectiveCollapsed(), this.band()),
    splitDisplayed: this.splitDisplayed,
  });
  readonly detailsOpen = this.inspectorState.detailsOpen;
  readonly compactSheet = this.inspectorState.compactSheet;
  readonly compactSheetOpen = this.inspectorState.compactSheetOpen;
  readonly stats = this.inspectorState.stats;
  readonly dockOpen = this.inspectorState.dockOpen;
  readonly dockShown = this.inspectorState.dockShown;
  readonly dockAvailableWidth = this.inspectorState.dockAvailableWidth;
  readonly band = computed(() => railWidthBand(this.layout.containerWidth()));
  readonly newSessionBlockReason = computed(() =>
    this.store.canStartRunningSession() ? null : RUNNING_CAP_MESSAGE,
  );
  /** The board width forces the 56 px Rail, whatever the persisted preference. */
  readonly autoCollapsed = computed(
    () =>
      (this.layout.containerWidth() > 0 &&
        this.layout.containerWidth() < RAIL_AUTO_COLLAPSE_PX) ||
      (!this.splitDisplayed() && this.band() === 'sm' && this.dockOpen()),
  );
  readonly effectiveCollapsed = computed(
    () => this.board().railCollapsed || this.autoCollapsed(),
  );
  private geometryBaseline: RailGeometryBaseline | null = null;
  private restoredScroll = false;

  constructor() {
    effect(() => {
      const isEmpty = this.isEmptyBoard();
      const visible = this.visible();
      const workspacePath = this.workspacePath();
      if (visible && isEmpty)
        untracked(() => void this.recentSessions.load(workspacePath));
    });
    effect((onCleanup) => {
      if (!this.visible()) return;
      const document = this.host.nativeElement.ownerDocument;
      const window = document.defaultView;
      // A press places a caret, and its `selectionchange` fires before
      // `pointerup`; the press hold must survive it, so `up` re-reads instead.
      const activePointerIds = new Set<number>();
      const stopTracking = () => {
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        this.host.nativeElement.removeEventListener(
          'lostpointercapture',
          lostCapture,
        );
        window?.removeEventListener('blur', releaseAll);
        document.removeEventListener('visibilitychange', hidden);
      };
      const releaseAll = () => {
        if (activePointerIds.size === 0) return;
        activePointerIds.clear();
        stopTracking();
        selection();
      };
      const hidden = () => {
        if (document.hidden) releaseAll();
      };
      // One pointer losing capture ends only that pointer; the hold ends with
      // the last tracked pointer, exactly as the last `up` does.
      const lostCapture = (event: PointerEvent) => up(event);
      const selection = () => {
        if (activePointerIds.size > 0) return;
        // Hold only for selected text. A collapsed caret (left by a plain click,
        // or by a focused field such as the Rename input) is not a selection to
        // protect; holding on it kept a renamed card's visible title stale.
        const current = document.getSelection();
        const node =
          current && !current.isCollapsed && current.toString()
            ? current.anchorNode
            : null;
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
        if (activePointerIds.size === 0) {
          document.addEventListener('pointerup', up);
          document.addEventListener('pointercancel', up);
          this.host.nativeElement.addEventListener(
            'lostpointercapture',
            lostCapture,
          );
          window?.addEventListener('blur', releaseAll);
          document.addEventListener('visibilitychange', hidden);
        }
        activePointerIds.add(event.pointerId);
        this.holdTabId.set(
          target.closest<HTMLElement>('[data-rail-card]')?.dataset['tabId'] ??
            null,
        );
      };
      const up = (event: PointerEvent) => {
        if (
          !activePointerIds.delete(event.pointerId) ||
          activePointerIds.size > 0
        )
          return;
        stopTracking();
        selection();
      };
      document.addEventListener('selectionchange', selection);
      this.host.nativeElement.addEventListener('pointerdown', down);
      onCleanup(() => {
        document.removeEventListener('selectionchange', selection);
        this.host.nativeElement.removeEventListener('pointerdown', down);
        stopTracking();
        activePointerIds.clear();
        // A hide or destroy mid-press ends the press; no card stays held.
        this.holdTabId.set(null);
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
        const neighbours =
          removedAt < 0
            ? []
            : [
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
      if (
        other &&
        (!ids.has(other) || !ids.has(focused ?? this.lastFocusedId ?? ''))
      ) {
        const survivor = ids.has(other) ? other : this.activeId();
        this.collapseSplit();
        if (writable && survivor && focused !== survivor)
          this.store.focusTile(survivor);
        this.lastFocusedId = survivor;
        this.announce('Split closed because a session was removed.');
        return;
      }
      if (!focused || !ids.has(focused) || focused === this.lastFocusedId)
        return;
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
        this.announce(
          stacked
            ? 'Sessions stacked top and bottom.'
            : 'Sessions side by side.',
        );
      }
      wasStacked = stacked;
    });
    effect(() => {
      const failed = this.persistence.writeFailed();
      if (failed && this.visible())
        this.announce('Layout changes could not be saved.');
    });
    let wasCompact = this.compactSheet();
    let dockWasOpen = false; // Capture the bound input state on the first effect run.
    effect(() => {
      const compact = this.compactSheet();
      // A hidden board measures 0 px; that is not a resize across the threshold.
      if (this.layout.containerWidth() === 0) return;
      // One resize can cross sm/md and 400 px at once; the band reset (D-3) has
      // then already closed `dockOpen`, so hand off the state from the last run.
      const dockOpenBefore = dockWasOpen;
      dockWasOpen = this.dockOpen();
      if (compact === wasCompact) return;
      wasCompact = compact;
      untracked(() => this.inspector()?.handOffInspector(compact, dockOpenBefore));
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
        heights: cards.map(
          (card) =>
            card.getBoundingClientRect().height -
            Number(card.dataset['attentionExtra'] ?? 0),
        ),
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

  anchor(targetId?: string): void {
    afterNextRender(
      () => {
        const list = this.list();
        const card = [
          ...(list?.querySelectorAll<HTMLElement>('[data-rail-card]') ?? []),
        ].find(
          (element) =>
            element.dataset['tabId'] === (targetId ?? this.focusedId()),
        );
        if (list && card) {
          const hasAttention = !!list.querySelector(
            '[data-attention-count]:not([data-attention-count="0"])',
          );
          if (!hasAttention) {
            const index = this.orderedTiles().findIndex(
              (tile) => tile.tabId === (targetId ?? this.focusedId()),
            );
            list.scrollTop = railAnchorScrollTop(
              index,
              railCardHeight(
                this.board().railDensity,
                this.effectiveCollapsed(),
              ),
              list.clientHeight,
              list.scrollTop,
            );
            return;
          }
          const top =
            card.getBoundingClientRect().top -
            list.getBoundingClientRect().top +
            list.scrollTop;
          const bottom = top + card.getBoundingClientRect().height;
          if (top < list.scrollTop) list.scrollTop = top;
          else if (bottom > list.scrollTop + list.clientHeight)
            list.scrollTop = bottom - list.clientHeight;
        }
      },
      { injector: this.injector },
    );
  }
  private opposite(side: 'left' | 'right'): 'left' | 'right' {
    return side === 'left' ? 'right' : 'left';
  }
  private assertDistinct(): void {
    if (
      isDevMode() &&
      this.otherTabId() &&
      this.otherTabId() === this.store.focusedTabIdFor(this.workspacePath())
    ) {
      throw new Error('Rail panes must show distinct sessions');
    }
  }
  private activeId(): string | null {
    const ids = this.orderedTiles().map((tile) => tile.tabId);
    const focused = this.store.focusedTabIdFor(this.workspacePath());
    if (focused && ids.includes(focused)) return focused;
    return this.lastFocusedId && ids.includes(this.lastFocusedId)
      ? this.lastFocusedId
      : null;
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
      return this.orderedTiles().some((tile) => tile.tabId === other)
        ? other
        : null;
    }
    return this.activeId();
  }
  /** Visual position of a pane: 1 for left/top, 2 for right/bottom. Follows Swap panes. */
  paneNumber(side: 'left' | 'right'): 1 | 2 {
    return this.visualOrder().indexOf(side) === 0 ? 1 : 2;
  }

  panePlace(side: 'left' | 'right'): 'Left' | 'Right' | 'Top' | 'Bottom' {
    const first = this.paneNumber(side) === 1;
    return this.splitStacked()
      ? first
        ? 'Top'
        : 'Bottom'
      : first
        ? 'Left'
        : 'Right';
  }

  paneLabel(side: 'left' | 'right', id: string): string {
    const title = this.title(id);
    return this.splitDisplayed()
      ? `${this.panePlace(side)} session: ${title}${this.activeSide() === side ? ', active' : ''}`
      : `Focused session: ${title}`;
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
    this.detailsOpen.set(false);
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
      if (
        survivor &&
        this.store.focusedTabIdFor(this.workspacePath()) !== survivor
      )
        this.store.focusTile(survivor);
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
    const label = (side: 'left' | 'right') =>
      this.paneLabel(side, this.paneTab(side) ?? '');
    this.announce(`Panes swapped. ${label(second)}; ${label(first)}.`);
    this.restoreHeaderFocus();
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
    this.geometryBaseline = {
      key: `${this.board().railDensity}|${this.effectiveCollapsed()}`,
      order: ids,
    };
    this.store.reorderTiles(ids);
    this.announce(
      `${this.title(id)} moved to position ${destination + 1} of ${ids.length}.`,
    );
    afterNextRender(
      () => {
        const card = [
          ...(this.list()?.querySelectorAll<HTMLElement>('[data-rail-card]') ??
            []),
        ].find((node) => node.dataset['tabId'] === id);
        card
          ?.querySelector<HTMLElement>('.rc-select, .rail-collapsed')
          ?.focus();
        this.anchor(id);
      },
      { injector: this.injector },
    );
  }

  focus(id: string): void {
    if (id === this.otherTabId()) {
      this.activatePane(this.opposite(this.activeSide()));
      this.anchor();
      return;
    }
    if (this.splitDisplayed() && id !== this.lastFocusedId)
      this.announceReplaced(id);
    this.lastFocusedId = id;
    this.store.focusTile(id);
    this.anchor();
  }
  toggleCollapse(): void {
    // A click cannot change what is shown here, so it must not rewrite the preference.
    if (this.autoCollapsed()) return;
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
  toggleDetails(): void { this.inspector()?.toggleDetails(); }
  closeDock(): void { this.inspector()?.closeDock(); }
  /**
   * Footer and zero-tile empty-board "New session": ask the host to open its
   * one named popover. The board never creates a session itself; the host
   * stays the final cap gate and announces a refusal in its dock status line.
   */
  newSession(element: HTMLElement): void {
    this.newSessionRequested.emit(element);
  }
  /**
   * The empty-board trigger stays focusable while `aria-disabled`, so its
   * reason is still read out; activating it then does nothing. A native
   * button turns Enter and Space into this click, so the guard covers the
   * keyboard too.
   */
  emptyBoardNewSession(event: MouseEvent): void {
    if (this.newSessionBlockReason()) return;
    if (event.currentTarget instanceof HTMLElement)
      this.newSession(event.currentTarget);
  }
  async openRecentSession(session: ChatSessionSummary): Promise<void> {
    try {
      if ((await this.sessionActions.openSession(session)) === 'opened') return;
    } catch {
      // Keep the card and give the same safe announcement as a failed result.
    }
    this.announce('Unable to open session. Try again.');
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
    const survivor = wasSplit
      ? wasFocused
        ? this.otherTabId()
        : active
      : null;
    await this.store.removeTile(id);
    if (this.orderedTiles().some((tile) => tile.tabId === id)) return;
    this.geometryBaseline = null;
    if (wasSplit) {
      this.collapseSplit();
      if (survivor) {
        this.lastFocusedId = survivor;
        if (this.store.focusedTabIdFor(this.workspacePath()) !== survivor)
          this.store.focusTile(survivor);
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
    afterNextRender(
      () => {
        const active = this.host.nativeElement.ownerDocument.activeElement;
        if (
          active &&
          active !== active.ownerDocument.body &&
          active.isConnected
        )
          return;
        this.host.nativeElement
          .querySelector<HTMLElement>(
            `[data-pane-side="${this.activeSide()}"] [data-header-menu]`,
          )
          ?.focus();
      },
      { injector: this.injector },
    );
  }
  /**
   * B3: stacked panes with a swapped `visualOrder` would Tab bottom-first in
   * DOM order. At a pane boundary, and on entry from the Rail, move focus in
   * visual order instead: Rail, top pane, bottom pane, then what follows.
   * Inert side by side (DOM order kept there by design) and in the default
   * order. Open overlays own their focus and are never counted as tabbable.
   */
  onTabKey(event: KeyboardEvent): void {
    if (
      event.key !== 'Tab' ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const [top, bottom] = this.visualOrder();
    if (!this.splitDisplayed() || !this.splitStacked() || top === 'left')
      return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(PANE_OVERLAYS))
      return;
    const container = this.host.nativeElement.querySelector<HTMLElement>(
      '[data-testid="rail-pane-container"]',
    );
    const topPane = container?.querySelector<HTMLElement>(
      `:scope > [data-pane-side="${top}"]`,
    );
    const bottomPane = container?.querySelector<HTMLElement>(
      `:scope > [data-pane-side="${bottom}"]`,
    );
    if (!container || !topPane || !bottomPane) return;
    const dom = [
      ...this.host.nativeElement.ownerDocument.querySelectorAll<HTMLElement>(
        TABBABLE,
      ),
    ].filter((element) => isCanvasInspectorTabbable(element));
    const outside = (position: number) =>
      dom.filter(
        (el) =>
          !container.contains(el) &&
          !!(container.compareDocumentPosition(el) & position),
      );
    const visual = [
      ...outside(Node.DOCUMENT_POSITION_PRECEDING),
      ...dom.filter((el) => topPane.contains(el)),
      ...dom.filter((el) => bottomPane.contains(el)),
      ...outside(Node.DOCUMENT_POSITION_FOLLOWING),
    ];
    const index = visual.indexOf(target);
    if (index < 0) return;
    const step = event.shiftKey ? -1 : 1;
    const wrap = (list: readonly HTMLElement[], at: number) =>
      list[(at + list.length) % list.length];
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
