import {
  Component,
  computed,
  inject,
  signal,
  effect,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  CalendarDays,
  Check,
  ChevronDown,
  ExternalLink,
  LayoutGrid,
  MessageSquare,
  Pencil,
  Plus,
  RadioTower,
  Search,
  Settings,
  Store,
  Trash2,
  X,
  BarChart3,
} from 'lucide-angular';
import { ChatViewComponent } from './chat-view.component';
import { TabBarComponent } from '../organisms/tab-bar.component';
import { ConfirmationDialogComponent } from '../molecules/confirmation-dialog.component';
import {
  TrialEndedModalComponent,
  SidebarTabComponent,
  ThemeToggleComponent,
  NotificationBellComponent,
} from '@ptah-extension/chat-ui';
import { SettingsComponent } from '../../settings/settings.component';
import { WelcomeComponent } from './welcome.component';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { DashboardGridComponent } from '@ptah-extension/dashboard';
import { ThothShellComponent } from '@ptah-extension/thoth-shell';
import { ChatStore } from '../../services/chat.store';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { SessionDisplayUtils } from '../../services/session-display-utils.service';
import {
  AppStateManager,
  VSCodeService,
  ClaudeRpcService,
  WIZARD_VIEW_COMPONENT,
  ORCHESTRA_CANVAS_COMPONENT,
  HARNESS_BUILDER_COMPONENT,
  SETUP_HUB_COMPONENT,
  MARKETPLACE_COMPONENT,
  TRIBUNAL_COMPONENT,
} from '@ptah-extension/core';
import type { ChatSessionSummary, SessionId } from '@ptah-extension/shared';
import type { ViewType } from '@ptah-extension/core';

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
 * - Renders ONE view at a time via @switch directive
 * - View determined by AppStateManager.currentView() signal
 * - Supported views: 'chat' (default), 'settings', 'setup-wizard'
 * - Component lifecycle managed automatically (ngOnInit/ngOnDestroy)
 * - View state persists in respective state services
 *
 * **Signal Dependencies**:
 * - currentView: AppStateManager.currentView (determines active view)
 * - sidebarOpen: Local signal for sidebar visibility
 * - chatStore.sessions: Session list for sidebar
 *
 * @see AppStateManager
 * @see ChatViewComponent
 * @see SettingsComponent
 * @see WizardViewComponent
 */
@Component({
  selector: 'ptah-app-shell',
  standalone: true,
  imports: [
    ChatViewComponent,
    SettingsComponent,
    WelcomeComponent,
    NgComponentOutlet,
    TabBarComponent,
    ConfirmationDialogComponent,
    TrialEndedModalComponent,
    ThemeToggleComponent,
    NotificationBellComponent,
    LucideAngularModule,
    FormsModule,
    NativePopoverComponent,
    SidebarTabComponent,
    DashboardGridComponent,
    ThothShellComponent,
  ],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  private readonly keyboardShortcuts = inject(KeyboardShortcutsService);

  /**
   * Views that render full-screen ON TOP of the shared chrome (sidebar, header, agent panel).
   * Must be kept in sync with the @switch cases in app-shell.component.html.
   */
  private static readonly STANDALONE_VIEWS: readonly ViewType[] = [
    'setup-wizard',
    'settings',
    'welcome',
    'analytics',
    'harness-builder',
    'setup-hub',
    'thoth',
    'marketplace',
    'tribunal',
  ] as const;

  readonly chatStore = inject(ChatStore);
  readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly confirmDialog = inject(ConfirmationDialogService);
  private readonly sessionDisplayUtils = inject(SessionDisplayUtils);
  readonly currentView = this.appState.currentView;
  readonly layoutMode = this.appState.layoutMode;

  /** Computed: true when the current view is a standalone view (no shared chrome) */
  readonly isStandaloneView = computed(() =>
    AppShellComponent.STANDALONE_VIEWS.includes(this.currentView()),
  );

  /**
   * WizardViewComponent provided via DI token â€” breaks circular dependency between chat and setup-wizard.
   * Provided by the application bootstrapper (app.config.ts) so chat never imports setup-wizard directly.
   */
  readonly wizardComponent =
    inject(WIZARD_VIEW_COMPONENT, { optional: true }) ?? null;

  /**
   * OrchestraCanvasComponent provided via DI token â€” breaks circular dependency between chat and canvas.
   * canvas imports from chat (TabManagerService), so chat cannot import canvas directly.
   * Provided by the application bootstrapper (app.config.ts).
   */
  readonly orchestraCanvasComponent =
    inject(ORCHESTRA_CANVAS_COMPONENT, { optional: true }) ?? null;

  /**
   * HarnessBuilderViewComponent provided via DI token â€” breaks circular dependency.
   * Provided by the application bootstrapper (app.config.ts).
   */
  readonly harnessBuilderComponent =
    inject(HARNESS_BUILDER_COMPONENT, { optional: true }) ?? null;

  /**
   * SetupHubComponent provided via DI token â€” breaks circular dependency.
   * Provided by the application bootstrapper (app.config.ts).
   */
  readonly setupHubComponent =
    inject(SETUP_HUB_COMPONENT, { optional: true }) ?? null;

  /**
   * MarketplaceHubComponent provided via DI token — breaks circular dependency
   * between @ptah-extension/marketplace and @ptah-extension/chat.
   * Provided by the application bootstrapper (app.config.ts).
   */
  readonly marketplaceComponent =
    inject(MARKETPLACE_COMPONENT, { optional: true }) ?? null;

  /**
   * TribunalPageComponent provided via DI token — breaks circular dependency
   * between @ptah-extension/tribunal-panel and @ptah-extension/chat.
   * Provided by the application bootstrapper (app.config.ts).
   */
  readonly tribunalComponent =
    inject(TRIBUNAL_COMPONENT, { optional: true }) ?? null;
  private readonly _sidebarOpen = signal(this.vscodeService.isElectron);
  readonly sidebarOpen = this._sidebarOpen.asReadonly();
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
  readonly thothFirstRunDismissed = this.appState.thothFirstRunDismissed;
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

  readonly hasActiveFilters = computed(
    () =>
      this._searchQuery().length > 0 ||
      this._dateFrom().length > 0 ||
      this._dateTo().length > 0,
  );

  readonly filteredSessions = computed(() => {
    const sessions = this.chatStore.sessions();
    const query = this._searchQuery().toLowerCase().trim();
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
  readonly licenseReason = computed(
    () => this.chatStore.licenseStatus()?.reason,
  );
  /** Whether the user has Pro — gates the Marketplace nav entry (TASK_2026_131). */
  readonly isPremium = computed(
    () => this.chatStore.licenseStatus()?.isPremium ?? false,
  );
  readonly sessionNameInputRef = viewChild<ElementRef<HTMLInputElement>>(
    'sessionNameInputRef',
  );
  readonly editSessionInput =
    viewChild<ElementRef<HTMLInputElement>>('editSessionInput');

  /**
   * Flag to ensure auth redirect check runs only once.
   * Prevents re-triggering on subsequent signal changes.
   */
  private authCheckDone = false;

  constructor() {
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
      this.rpcService
        .call('auth:getAuthStatus', {})
        .then((rpcResult) => {
          if (!rpcResult.isSuccess() || !rpcResult.data) return;
          if (this.currentView() !== 'chat') return;
          const data = rpcResult.data;
          const activeProvider = data.availableProviders?.find(
            (p) => p.id === data.anthropicProviderId,
          );
          const providerNeedsNoKey =
            activeProvider?.isLocal === true ||
            activeProvider?.authType === 'none' ||
            activeProvider?.supportsOptionalApiKey === true;
          const hasAnyAuth =
            data.hasApiKey ||
            data.hasOpenRouterKey ||
            data.hasAnyProviderKey ||
            data.copilotAuthenticated ||
            data.codexAuthenticated ||
            data.claudeCliInstalled ||
            providerNeedsNoKey;
          if (!hasAnyAuth) {
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
   * Generate slugified default session name from current timestamp
   * Format: session-MM-DD-HH-mm (e.g., "session-12-11-14-45")
   */
  private generateDefaultSessionName(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `session-${month}-${day}-${hours}-${minutes}`;
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
    const sessionName = name || this.generateDefaultSessionName();

    if (this.layoutMode() === 'grid') {
      this.appState.requestNewCanvasSession(sessionName);
    } else {
      this.tabManager.createTab(sessionName);
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
