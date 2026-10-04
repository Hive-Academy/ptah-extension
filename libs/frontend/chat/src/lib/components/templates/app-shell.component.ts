import {
  Component,
  computed,
  inject,
  linkedSignal,
  signal,
  effect,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass, NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import {
  LucideAngularModule,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  LayoutGrid,
  MessageSquare,
  Pencil,
  Plus,
  RadioTower,
  Scale,
  Search,
  Settings,
  Store,
  Tag,
  Trash2,
  X,
  BarChart3,
} from 'lucide-angular';
import { ChatViewComponent } from './chat-view.component';
import { TabBarComponent } from '../organisms/tab-bar.component';
import { ConfirmationDialogComponent } from '../molecules/confirmation-dialog.component';
import { SessionFilterBarComponent } from '../molecules/session-filter-bar/session-filter-bar.component';
import { SessionOrganizationEditorComponent } from '../molecules/session-organization-editor/session-organization-editor.component';
import { SessionOrganizationChipsComponent } from '../atoms/session-organization-chips/session-organization-chips.component';
import { SessionLivePhaseIndicatorComponent } from '../atoms/session-organization-chips/session-live-phase-indicator.component';
import { groupSessionRows, type SessionRowGroup } from './session-row-groups';
import {
  SESSION_SIDEBAR_DEFAULT_WIDTH,
  SESSION_SIDEBAR_MIN_WIDTH,
  SESSION_SIDEBAR_WIDTH_STEP,
  SESSION_SIDEBAR_WIDTH_STORAGE_KEY,
  clampSessionSidebarWidth,
  parseStoredSessionSidebarWidth,
  sessionSidebarWidthCap,
} from './session-sidebar-width';
import { SubagentTranscriptOverlayComponent } from '../organisms/subagent-transcript-overlay.component';
import {
  SidebarTabComponent,
  SkeletonBlockComponent,
  ThemeToggleComponent,
} from '@ptah-extension/chat-ui';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { ChatStore } from '../../services/chat.store';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { SessionDisplayUtils } from '../../services/session-display-utils.service';
import { SubagentTranscriptViewerService } from '../../services/subagent-transcript-viewer.service';
import {
  AppStateManager,
  SurfaceActiveDirective,
  AuthStateService,
  BootStatusService,
  defaultSessionName,
  VSCodeService,
  ClaudeRpcService,
  DEFAULT_SURFACE_ID,
  ORCHESTRA_CANVAS_COMPONENT,
  NOTIFICATION_FOCUS_ROUTER,
  SurfaceRouterService,
} from '@ptah-extension/core';
import { NotificationCenterComponent } from '@ptah-extension/notification-center';
import { NotificationFocusCoordinator } from '../../services/notification-focus-coordinator.service';
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';
import type { ChatSessionSummary } from '@ptah-extension/shared';
import type { SessionListQuery } from '../../services/chat-store/session-loader.service';
import type { TitleOrigin } from '@ptah-extension/chat-types';

/**
 * AppShellComponent - Main application layout with collapsible sidebar
 *
 * Complexity Level: 2 (Template with flexbox sidebar)
 * Patterns: Signal-based sidebar state, Session list
 *
 * Uses simple flexbox layout with toggleable sidebar (no drawer overlay).
 * Optimized for VS Code sidebar panel width constraints.
 *
 * Displays session list in sidebar with active session highlighting.
 *
 * **View Switching Architecture**:
 * - Every standalone surface is a ROUTE. `<router-outlet />` at the top of the
 *   template renders it, and the route table lives in
 *   `apps/ptah-extension-webview/src/app/app.routes.ts` — not here, and not in
 *   a library, because half the route components live in libraries that
 *   `@ptah-extension/core` is imported by.
 * - `currentView()` still answers "which surface", but it now reads the Router
 *   through `SurfaceRouterService` instead of a signal write.
 * - The chat and canvas content area is deliberately NOT routed: it stays
 *   mounted and is toggled with `[class.hidden]` so `CanvasStore` and the
 *   gridstack instance survive navigation.
 *
 * **Signal Dependencies**:
 * - currentView: AppStateManager.currentView (Router-derived)
 * - sidebarOpen: Local signal for sidebar visibility
 * - chatStore.sessions: Session list for sidebar
 *
 * @see AppStateManager
 * @see ChatViewComponent
 */

@Component({
  selector: 'ptah-app-shell',
  standalone: true,
  imports: [
    ChatViewComponent,
    SurfaceActiveDirective,
    RouterOutlet,
    NgComponentOutlet,
    NgTemplateOutlet,
    NgClass,
    TabBarComponent,
    ConfirmationDialogComponent,
    SubagentTranscriptOverlayComponent,
    ThemeToggleComponent,
    LucideAngularModule,
    FormsModule,
    NativePopoverComponent,
    SidebarTabComponent,
    SkeletonBlockComponent,
    NotificationCenterComponent,
    SessionFilterBarComponent,
    SessionOrganizationChipsComponent,
    SessionLivePhaseIndicatorComponent,
    SessionOrganizationEditorComponent,
  ],
  providers: [
    {
      provide: NOTIFICATION_FOCUS_ROUTER,
      useExisting: NotificationFocusCoordinator,
    },
  ],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly keyboardShortcuts = inject(KeyboardShortcutsService);

  readonly chatStore = inject(ChatStore);
  /**
   * Boot progress, for the two skeleton sites (TASK_2026_380). Reports `ready`
   * under VS Code, so both skeletons are unreachable there by construction.
   */
  readonly bootStatus = inject(BootStatusService);
  readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly authState = inject(AuthStateService);
  /** Read by the template to create the deferred dialog on first open. */
  protected readonly confirmDialog = inject(ConfirmationDialogService);
  /** Read by the template to create the deferred overlay on first open. */
  protected readonly transcriptViewer = inject(SubagentTranscriptViewerService);
  private readonly sessionDisplayUtils = inject(SessionDisplayUtils);
  /**
   * Read ONLY for `pendingSurface()` in the post-auth guard below. Every
   * navigation this component starts still goes through
   * `AppStateManager.setCurrentView`, so there is one write path.
   */
  private readonly surfaceRouter = inject(SurfaceRouterService);
  // Injected only to instantiate the root singleton eagerly: it ends the backend session of a closed tab.
  private readonly _closedTabSessionEnder = inject(
    ClosedTabSessionEnderService,
  );
  readonly currentView = this.appState.currentView;
  readonly layoutMode = this.appState.layoutMode;

  /**
   * True when a standalone surface is showing, so the shared chrome is hidden.
   *
   * This used to be a hand-maintained `STANDALONE_VIEWS` list that the class
   * doc required be "kept in sync with the @switch cases" — a fourth copy of
   * the surface list, next to the three `initialView` allow-lists. It is now
   * derived: `currentView()` reads the Router, and every route except the
   * component-less `chat` route IS a standalone surface, so there is nothing
   * left to keep in sync.
   */
  readonly isStandaloneView = computed(
    () => this.currentView() !== DEFAULT_SURFACE_ID,
  );

  /**
   * OrchestraCanvasComponent provided via DI token — breaks circular dependency between chat and canvas.
   * canvas imports from chat (TabManagerService), so chat cannot import canvas directly.
   * Provided by the application bootstrapper (app.config.ts).
   *
   * **Eager on purpose.** This was deferred during TASK_2026_187 and reverted on
   * measured evidence: `ElectronShellComponent` (which embeds this component)
   * forces grid mode in its constructor, so the canvas is the Electron launch
   * surface and deferring it cost 50-70 ms of startup TTI with no path on which
   * it helped.
   *
   * This is the LAST remaining `*ngComponentOutlet` surface in this template.
   * The five deferred ones (harness builder, setup hub, marketplace, tribunal,
   * tasks) became `loadComponent` routes in TASK_2026_524; the canvas did not,
   * because it must stay mounted while the user is elsewhere.
   */
  readonly orchestraCanvasComponent =
    inject(ORCHESTRA_CANVAS_COMPONENT, { optional: true }) ?? null;

  private readonly _sidebarOpen = signal(this.vscodeService.isElectron);
  readonly sidebarOpen = this._sidebarOpen.asReadonly();

  /**
   * The user's chosen open-sidebar width in px, set by the right-edge resize
   * handle (pointer drag, ArrowLeft/ArrowRight, double-click reset) and
   * persisted in localStorage. The rendered width is {@link sidebarWidth}.
   */
  private readonly chosenSidebarWidth = signal<number>(
    this.readStoredSidebarWidth(),
  );
  /** Width of the shell row (sidebar + tab + main); 0 until measured. */
  private readonly shellRowWidth = signal(0);
  /** The widest the sidebar may render now; see session-sidebar-width.ts. */
  readonly sidebarMaxWidth = computed(() =>
    sessionSidebarWidthCap(this.shellRowWidth()),
  );
  /** The rendered open-sidebar width: the choice, capped by the room left. */
  readonly sidebarWidth = computed(() =>
    Math.min(this.chosenSidebarWidth(), this.sidebarMaxWidth()),
  );
  /**
   * True while a handle drag is active. The template swaps the width
   * `transition-all` for `transition-none` while this is set, so the drag
   * tracks the pointer 1:1 instead of lagging behind the animation.
   */
  private readonly _sidebarResizing = signal(false);
  readonly sidebarResizing = this._sidebarResizing.asReadonly();
  /** Lower bound, read by the handle's aria-valuemin binding. */
  readonly sidebarMinWidth = SESSION_SIDEBAR_MIN_WIDTH;
  /** Pointer position and width where the current drag started. */
  private sidebarResizeStartX = 0;
  private sidebarResizeStartWidth = SESSION_SIDEBAR_DEFAULT_WIDTH;
  readonly CalendarDaysIcon = CalendarDays;
  readonly CheckIcon = Check;
  readonly ChevronDownIcon = ChevronDown;
  readonly MessageSquareIcon = MessageSquare;
  readonly PlusIcon = Plus;
  readonly SearchIcon = Search;
  readonly SettingsIcon = Settings;
  readonly PencilIcon = Pencil;
  readonly Trash2Icon = Trash2;
  readonly XIcon = X;
  readonly ExternalLinkIcon = ExternalLink;
  readonly BarChart3Icon = BarChart3;
  readonly LayoutGridIcon = LayoutGrid;
  readonly RadioTowerIcon = RadioTower;
  readonly StoreIcon = Store;
  readonly ScaleIcon = Scale;
  readonly ClipboardListIcon = ClipboardList;
  readonly TagIcon = Tag;
  readonly thothFirstRunDismissed = this.appState.thothFirstRunDismissed;
  /**
   * Tooltip for sessions whose SDK transcript was pruned by the Claude CLI's
   * `cleanupPeriodDays` retention (default 30 days). The metadata row survives,
   * so the session still lists — it just opens with no history.
   */
  readonly expiredTranscriptHint =
    'Claude removed this session’s transcript after its retention period, so it will open empty. Raise "cleanupPeriodDays" in ~/.claude/settings.json to keep transcripts longer.';
  readonly editingSessionId = signal<string | null>(null);
  readonly editingSessionName = signal('');
  readonly isElectron = this.vscodeService.isElectron;
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();
  private readonly _sessionNamePopoverOpen = signal(false);
  readonly sessionNamePopoverOpen = this._sessionNamePopoverOpen.asReadonly();
  readonly sessionNameInput = signal('');
  private readonly _searchQuery = signal('');
  private readonly _dateFrom = signal('');
  private readonly _dateTo = signal('');
  private readonly _dateFilterOpen = signal(false);
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly dateFrom = this._dateFrom.asReadonly();
  readonly dateTo = this._dateTo.asReadonly();
  readonly dateFilterOpen = this._dateFilterOpen.asReadonly();

  /**
   * Whether the host serves session organization (TASK_2026_580). When false
   * (VS Code) the sidebar is exactly today's: the local search box, the date
   * filter and plain rows (AC7).
   */
  readonly organizationAvailable = this.chatStore.organizationAvailable;
  /** The query the server answers; the filter bar's seed. */
  readonly listQuery = this.chatStore.listQuery;

  /** Filters applied here, over the loaded pages. */
  readonly hasClientFilters = computed(() => {
    const dateActive = this._dateFrom().length > 0 || this._dateTo().length > 0;
    // With organization the search text goes to the server instead.
    return this.organizationAvailable()
      ? dateActive
      : dateActive || this._searchQuery().length > 0;
  });

  /** Filters the server applied to the rows (organization hosts only). */
  readonly hasServerFilters = computed(() => {
    if (!this.organizationAvailable()) return false;
    const q = this.listQuery();
    return (
      (q.status?.length ?? 0) > 0 ||
      (q.priority?.length ?? 0) > 0 ||
      !!q.taskId ||
      q.pinned !== undefined ||
      q.hasPr !== undefined ||
      !!q.text
    );
  });

  readonly hasActiveFilters = computed(
    () => this.hasClientFilters() || this.hasServerFilters(),
  );

  readonly filteredSessions = computed(() => {
    const sessions = this.chatStore.sessions();
    const query = this.organizationAvailable()
      ? ''
      : this._searchQuery().toLowerCase().trim();
    const fromStr = this._dateFrom();
    const toStr = this._dateTo();

    if (!query && !fromStr && !toStr) {
      return sessions;
    }
    let fromMs = 0;
    let toMs = 0;
    if (fromStr) {
      const [y, m, d] = fromStr.split('-').map(Number);
      fromMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    }
    if (toStr) {
      const [y, m, d] = toStr.split('-').map(Number);
      toMs = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    }

    return sessions.filter((session) => {
      if (query && !(session.name || '').toLowerCase().includes(query)) {
        return false;
      }
      if (fromMs && session.lastActivityAt < fromMs) {
        return false;
      }
      if (toMs && session.lastActivityAt > toMs) {
        return false;
      }

      return true;
    });
  });

  /**
   * The rows as the sidebar draws them. Without organization this is one
   * headerless group of today's rows; with it, headers follow the query's
   * `groupBy` and children nest under parents for `parent`.
   */
  readonly sessionGroups = computed<SessionRowGroup[]>(() =>
    groupSessionRows(
      this.filteredSessions(),
      this.organizationAvailable()
        ? (this.listQuery().groupBy ?? 'none')
        : 'none',
    ),
  );

  /** Id of the session whose organization editor is open, or null. */
  private readonly organizingSessionId = signal<string | null>(null);

  /**
   * The row the editor shows. It follows the list, so a reload after a
   * mutation hands the editor the fresh record; when the row leaves the
   * loaded list (e.g. it was archived under a status filter) the editor keeps
   * the last copy instead of closing under the user.
   */
  readonly organizingSession = linkedSignal<
    { id: string | null; sessions: readonly ChatSessionSummary[] },
    ChatSessionSummary | null
  >({
    source: () => ({
      id: this.organizingSessionId(),
      sessions: this.chatStore.sessions(),
    }),
    computation: ({ id, sessions }, previous) => {
      if (id === null) return null;
      const row = sessions.find((s) => s.id === id);
      if (row) return row;
      return previous?.value?.id === id ? previous.value : null;
    },
  });

  readonly sessionNameInputRef = viewChild<ElementRef<HTMLInputElement>>(
    'sessionNameInputRef',
  );
  readonly editSessionInput =
    viewChild<ElementRef<HTMLInputElement>>('editSessionInput');
  /** The sidebar resize handle: the pointer-capture target while dragging. */
  private readonly sidebarResizeHandle =
    viewChild<ElementRef<HTMLElement>>('sidebarResizeHandle');
  private readonly shellRow = viewChild<ElementRef<HTMLElement>>('shellRow');

  /**
   * Flag to ensure auth redirect check runs only once.
   * Prevents re-triggering on subsequent signal changes.
   */
  private authCheckDone = false;

  constructor() {
    effect((onCleanup) => {
      const row = this.shellRow()?.nativeElement;
      if (row) onCleanup(this.observeShellRowWidth(row));
    });
    effect(() => {
      if (this.sessionNamePopoverOpen()) {
        setTimeout(() => {
          this.sessionNameInputRef()?.nativeElement.focus();
        }, 0);
      }
    });
    effect(() => {
      const view = this.currentView();
      if (view !== 'chat' || this.authCheckDone) {
        return;
      }
      this.authCheckDone = true;
      // Goes through AuthStateService, never `rpcService.call` directly: that
      // direct call was one of three independent boot callers of a 2-5s
      // handler, and the service's single-flight guard could not see it
      // (TASK_2026_342). `loadAuthStatus()` is a no-op once loaded.
      this.authState
        .loadAuthStatus()
        .then(() => {
          if (!this.authState.isLoaded()) return;
          if (this.currentView() !== DEFAULT_SURFACE_ID) return;
          // `currentView()` follows NavigationEnd, so it still reads `chat`
          // for as long as a lazy route's chunk is loading. Click Thoth, let
          // `loadAuthStatus()` resolve with no credentials before that chunk
          // arrives, and the line below used to cancel the click and land the
          // user on Settings (TASK_2026_524 revision 1, F2).
          //
          // The fix belongs here, at the consumer, NOT as an optimistic mirror
          // of the view in `AppStateManager` — that mirror is the TASK_2026_317
          // bug. `pendingSurface()` is the Router's own in-flight intent.
          const pending = this.surfaceRouter.pendingSurface();
          if (pending !== null && pending !== DEFAULT_SURFACE_ID) return;
          if (!this.authState.hasAnyAuth()) {
            this.appState.setCurrentView('settings');
          }
        })
        .catch(() => {});
    });
  }

  /**
   * Toggle sidebar visibility
   */
  toggleSidebar(): void {
    this._sidebarOpen.update((open) => !open);
  }

  /**
   * Pointer-down on the sidebar resize handle: capture the pointer on the
   * handle and remember where the drag started. Only the primary button
   * starts a drag; the capture keeps the move/up events flowing to the
   * handle while the pointer is anywhere over the window.
   */
  onSidebarResizeStart(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    this._sidebarResizing.set(true);
    this.sidebarResizeStartX = event.clientX;
    this.sidebarResizeStartWidth = this.sidebarWidth();
    this.sidebarResizeHandle()?.nativeElement.setPointerCapture(
      event.pointerId,
    );
  }

  /**
   * Pointer-move while the handle holds the capture: the width follows the
   * pointer, clamped to the bounds. Not persisted yet — the drag end writes
   * the settled width once.
   */
  onSidebarResizeMove(event: PointerEvent): void {
    if (!this._sidebarResizing()) {
      return;
    }
    this.applySidebarWidth(
      this.sidebarResizeStartWidth +
        (event.clientX - this.sidebarResizeStartX),
    );
  }

  /**
   * Drag end (pointerup or pointercancel; the browser releases the capture
   * on both): stop resizing and persist the settled width.
   */
  onSidebarResizeEnd(): void {
    if (!this._sidebarResizing()) {
      return;
    }
    this._sidebarResizing.set(false);
    this.persistSidebarWidth();
  }

  /**
   * Keyboard resize on the focused handle: ArrowLeft/ArrowRight step the
   * width by 16 px, clamped and persisted. Other keys pass through.
   */
  onSidebarResizeKeydown(event: KeyboardEvent): void {
    let next: number | null = null;
    if (event.key === 'ArrowLeft') {
      next = this.sidebarWidth() - SESSION_SIDEBAR_WIDTH_STEP;
    } else if (event.key === 'ArrowRight') {
      next = this.sidebarWidth() + SESSION_SIDEBAR_WIDTH_STEP;
    }
    if (next === null) {
      return;
    }
    event.preventDefault();
    this.applySidebarWidth(next);
    this.persistSidebarWidth();
  }

  /**
   * Double-click on the handle: back to the 272 px default. Stored uncapped,
   * so a narrow shell still widens to it once there is room.
   */
  resetSidebarWidth(): void {
    this.chosenSidebarWidth.set(SESSION_SIDEBAR_DEFAULT_WIDTH);
    this.persistSidebarWidth();
  }

  /**
   * Track the shell row's width so the open sidebar leaves room for the main
   * area. A hidden row (standalone view) reports 0 and keeps the last width.
   */
  private observeShellRowWidth(row: HTMLElement): () => void {
    if (typeof ResizeObserver === 'undefined') return () => undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      if (width > 0) this.shellRowWidth.set(width);
    });
    observer.observe(row);
    return () => observer.disconnect();
  }

  /** Clamp to the bounds and the current cap, and store as the choice. */
  private applySidebarWidth(width: number): void {
    this.chosenSidebarWidth.set(
      clampSessionSidebarWidth(width, this.sidebarMaxWidth()),
    );
  }

  /** Read the persisted sidebar width; see parseStoredSessionSidebarWidth. */
  private readStoredSidebarWidth(): number {
    try {
      return parseStoredSessionSidebarWidth(
        localStorage.getItem(SESSION_SIDEBAR_WIDTH_STORAGE_KEY),
      );
    } catch {
      // Storage unavailable (sandboxed webview, blocked storage): default.
      return SESSION_SIDEBAR_DEFAULT_WIDTH;
    }
  }

  /** Persist the current width; storage failures keep it session-only. */
  private persistSidebarWidth(): void {
    try {
      localStorage.setItem(
        SESSION_SIDEBAR_WIDTH_STORAGE_KEY,
        String(this.chosenSidebarWidth()),
      );
    } catch {
      // Storage unavailable: the width still applies to this session.
    }
  }

  /**
   * Navigate to settings view
   */
  openSettings(): void {
    this.appState.setCurrentView('settings');
  }

  /**
   * Navigate to analytics dashboard view
   */
  openDashboard(): void {
    this.appState.setCurrentView('analytics');
  }

  /**
   * Navigate to the Thoth hub view. Opening Thoth also dismisses the
   * first-run hint — once the user has clicked through, they don't need
   * the explanatory tooltip on subsequent visits.
   */
  openThoth(): void {
    if (!this.thothFirstRunDismissed()) {
      this.appState.dismissThothFirstRun();
    }
    this.appState.setCurrentView('thoth');
  }

  /**
   * Navigate to the Marketplace hub view (skills + MCP providers).
   */
  openMarketplace(): void {
    this.appState.setCurrentView('marketplace');
  }

  openTribunal(): void {
    this.appState.setCurrentView('tribunal');
  }

  openTasks(): void {
    this.appState.setCurrentView('tasks');
  }

  /**
   * Dismiss the Thoth first-run hint without navigating to Thoth.
   * Triggered by the X button on the tooltip.
   */
  dismissThothFirstRun(): void {
    this.appState.dismissThothFirstRun();
  }

  /**
   * Toggle between single-chat and canvas-grid layout modes.
   * Replaces the old openCanvas() which navigated to a separate view.
   */
  toggleLayoutMode(): void {
    this.appState.toggleLayoutMode();
  }

  /** Guard to prevent double-click opening multiple panels */
  private _isOpeningPanel = false;

  /**
   * Open current chat in a full editor panel for more screen space.
   * Passes the active session so the new panel auto-loads it,
   * then force-closes the tab in the sidebar to avoid duplication.
   * Blocked during active streaming to prevent orphaned events.
   */
  async openInEditor(): Promise<void> {
    if (this._isOpeningPanel) return;

    const activeTab = this.tabManager.activeTab();
    if (activeTab?.status === 'streaming' || activeTab?.status === 'resuming') {
      console.warn('[AppShell] Cannot pop out during streaming/resuming');
      return;
    }

    this._isOpeningPanel = true;
    try {
      const sessionId = activeTab?.claudeSessionId;
      const sessionName = activeTab?.name || activeTab?.title;

      await this.rpcService.call('command:execute', {
        command: 'ptah.openFullPanel',
        args: [
          {
            initialSessionId: sessionId || undefined,
            initialSessionName: sessionName || undefined,
          },
        ],
      });
      if (activeTab && sessionId) {
        this.tabManager.forceCloseTab(activeTab.id);
      }
    } catch (error) {
      console.error('[AppShell] Failed to open editor panel:', error);
    } finally {
      this._isOpeningPanel = false;
    }
  }

  /**
   * Open session name popover
   */
  createNewSession(): void {
    this.sessionNameInput.set('');
    this._sessionNamePopoverOpen.set(true);
  }

  /**
   * Handle session creation from popover.
   * Layout-mode-aware: in grid mode, requests a new canvas tile instead of a tab.
   */
  handleCreateSession(): void {
    const name = this.sessionNameInput().trim();
    const sessionName = name || defaultSessionName();

    if (this.layoutMode() === 'grid') {
      this.appState.requestNewCanvasSession(sessionName);
    } else {
      const titleOrigin: TitleOrigin = name ? 'user' : 'default';
      this.tabManager.createTab(sessionName, titleOrigin);
    }
    this._sessionNamePopoverOpen.set(false);
  }

  /**
   * Handle popover close (backdrop click or ESC)
   */
  handleCancelSession(): void {
    this._sessionNamePopoverOpen.set(false);
    this.sessionNameInput.set('');
  }

  /**
   * Clear all session search/filter inputs
   */
  clearFilters(): void {
    this._searchQuery.set('');
    this._dateFrom.set('');
    this._dateTo.set('');
    this._dateFilterOpen.set(false);
    if (this.hasServerFilters()) {
      // Filters only: the chosen sort and grouping are a view preference.
      const { sort, groupBy } = this.listQuery();
      this.chatStore.setListQuery({
        sort,
        ...(groupBy !== undefined ? { groupBy } : {}),
      });
    }
  }

  /** The filter bar settled on a new query; the server answers it. */
  onListQueryChange(query: SessionListQuery): void {
    this.chatStore.setListQuery(query);
  }

  /** Open the organization editor for a row (row menu, next to rename). */
  openOrganizer(event: Event, session: ChatSessionSummary): void {
    event.stopPropagation();
    this.organizingSessionId.set(session.id);
  }

  closeOrganizer(): void {
    this.organizingSessionId.set(null);
  }

  /**
   * Toggle date filter visibility
   */
  toggleDateFilter(): void {
    this._dateFilterOpen.update((open) => !open);
  }
  setSearchQuery(value: string): void {
    this._searchQuery.set(value);
  }

  setDateFrom(value: string): void {
    this._dateFrom.set(value);
  }

  setDateTo(value: string): void {
    this._dateTo.set(value);
  }

  /**
   * Format timestamp as relative date for sidebar display.
   * Delegates to SessionDisplayUtils shared service.
   */
  formatRelativeDate(date: Date | string | number): string {
    return this.sessionDisplayUtils.formatRelativeDate(date);
  }

  /**
   * Get display name for session.
   * Delegates to SessionDisplayUtils shared service.
   */
  getSessionDisplayName(session: ChatSessionSummary): string {
    return this.sessionDisplayUtils.getSessionDisplayName(session);
  }

  /**
   * Layout-mode-aware session click handler for sidebar.
   * In grid mode: requests canvas to open/focus a tile for the session.
   * In single mode: switches to the session's tab (existing behavior).
   */
  onSessionClick(session: ChatSessionSummary): void {
    if (this.layoutMode() === 'grid') {
      this.appState.requestCanvasSession(session.id, session.name);
    } else {
      this.chatStore.switchSession(session.id);
    }
  }

  /**
   * Check if a session has an open tab
   * Used to highlight sessions in the sidebar
   */
  isSessionOpen(sessionId: string): boolean {
    return this.tabManager.findTabBySessionId(sessionId) !== null;
  }

  /**
   * Delete session from storage.
   * Shows confirmation dialog before deleting
   */
  /**
   * Start inline editing of a session name
   */
  startEditingSession(event: Event, session: ChatSessionSummary): void {
    event.stopPropagation();
    this.editingSessionId.set(session.id);
    this.editingSessionName.set(session.name || '');
    setTimeout(() => this.editSessionInput()?.nativeElement.focus(), 0);
  }

  /**
   * Cancel inline editing
   */
  cancelEditingSession(): void {
    this.editingSessionId.set(null);
    this.editingSessionName.set('');
  }

  /**
   * Save the edited session name via RPC.
   * Guarded against double-fire (Enter + blur).
   */
  async saveSessionName(
    event: Event,
    session: ChatSessionSummary,
  ): Promise<void> {
    event.stopPropagation();
    if (this.editingSessionId() !== session.id) {
      return;
    }

    const newName = this.editingSessionName().trim();
    if (!newName || newName === (session.name || '')) {
      this.cancelEditingSession();
      return;
    }
    this.cancelEditingSession();

    try {
      const result = await this.rpcService.renameSession(session.id, newName);

      if (result.isSuccess() && result.data?.success) {
        this.chatStore.updateSessionName(session.id, newName);
        const tab = this.tabManager.findTabBySessionId(session.id);
        if (tab) {
          this.tabManager.setNameAndTitle(tab.id, newName, newName);
        }
      } else {
        console.error(
          '[AppShell] Failed to rename session:',
          result.error || result.data?.error,
        );
      }
    } catch (error) {
      console.error('[AppShell] Error renaming session:', error);
    }
  }

  async deleteSession(
    event: Event,
    session: ChatSessionSummary,
  ): Promise<void> {
    event.stopPropagation();

    const sessionName = this.getSessionDisplayName(session);
    const confirmed = await this.confirmDialog.confirm({
      title: 'Delete Session',
      message: `Are you sure you want to delete "${sessionName}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      confirmStyle: 'error',
    });

    if (!confirmed) {
      return;
    }

    try {
      const result = await this.rpcService.deleteSession(session.id);

      if (result.isSuccess() && result.data?.success) {
        this.chatStore.removeSessionFromList(session.id);
        if (this.organizingSessionId() === session.id) {
          this.closeOrganizer();
        }
        if (this.chatStore.currentSession()?.id === session.id) {
          this.chatStore.clearCurrentSession();
        }
        const tab = this.tabManager.findTabBySessionId(session.id);
        if (tab) {
          this.tabManager.closeTab(tab.id);
        }
      } else {
        console.error(
          '[AppShell] Failed to delete session:',
          result.error || result.data?.error,
        );
      }
    } catch (error) {
      console.error('[AppShell] Error deleting session:', error);
    }
  }
}
