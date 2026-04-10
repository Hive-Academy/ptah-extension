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
import { NgComponentOutlet, NgOptimizedImage } from '@angular/common';
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
  Search,
  Settings,
  Trash2,
  X,
  BarChart3,
} from 'lucide-angular';
import { ChatViewComponent } from './chat-view.component';
import { TabBarComponent } from '../organisms/tab-bar.component';
import { ConfirmationDialogComponent } from '../molecules/confirmation-dialog.component';
import { TrialEndedModalComponent } from '../molecules/trial-billing/trial-ended-modal.component';
import { SettingsComponent } from '../../settings/settings.component';
import { WelcomeComponent } from './welcome.component';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { AgentMonitorPanelComponent } from '../organisms/agent-monitor-panel.component';
import { ResizeHandleComponent } from '../atoms/resize-handle.component';
import { SidebarTabComponent } from '../atoms/sidebar-tab.component';
import { ThemeToggleComponent } from '../atoms/theme-toggle.component';
import { NotificationBellComponent } from '../molecules/notifications/notification-bell.component';
import { SessionAnalyticsDashboardViewComponent } from '@ptah-extension/dashboard';
import { ChatStore } from '../../services/chat.store';
import { AgentMonitorStore } from '../../services/agent-monitor.store';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { TabManagerService } from '../../services/tab-manager.service';
import {
  AppStateManager,
  VSCodeService,
  ClaudeRpcService,
  WIZARD_VIEW_COMPONENT,
  ORCHESTRA_CANVAS_COMPONENT,
} from '@ptah-extension/core';
import type { ChatSessionSummary, SessionId } from '@ptah-extension/shared';
import { ConfirmationDialogService } from '../../services/confirmation-dialog.service';

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
    NgOptimizedImage,
    LucideAngularModule,
    FormsModule,
    NativePopoverComponent,
    AgentMonitorPanelComponent,
    ResizeHandleComponent,
    SidebarTabComponent,
    SessionAnalyticsDashboardViewComponent,
  ],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  // Initialize keyboard shortcuts (constructor injection triggers setup)
  private readonly keyboardShortcuts = inject(KeyboardShortcutsService);

  readonly chatStore = inject(ChatStore);
  readonly agentMonitorStore = inject(AgentMonitorStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly confirmDialog = inject(ConfirmationDialogService);

  // Expose currentView signal for template
  readonly currentView = this.appState.currentView;

  /**
   * WizardViewComponent provided via DI token — breaks circular dependency between chat and setup-wizard.
   * Provided by the application bootstrapper (app.config.ts) so chat never imports setup-wizard directly.
   */
  readonly wizardComponent =
    inject(WIZARD_VIEW_COMPONENT, { optional: true }) ?? null;

  /**
   * OrchestraCanvasComponent provided via DI token — breaks circular dependency between chat and canvas.
   * canvas imports from chat (TabManagerService), so chat cannot import canvas directly.
   * Provided by the application bootstrapper (app.config.ts).
   */
  readonly orchestraCanvasComponent =
    inject(ORCHESTRA_CANVAS_COMPONENT, { optional: true }) ?? null;

  // Sidebar state: default open in Electron (more space), hidden in VS Code sidebar
  private readonly _sidebarOpen = signal(this.vscodeService.isElectron);
  readonly sidebarOpen = this._sidebarOpen.asReadonly();

  // Lucide icons
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

  // Inline edit state for session renaming
  readonly editingSessionId = signal<string | null>(null);
  readonly editingSessionName = signal('');

  // Agent monitor badge type for the sidebar tab (session-scoped).
  // Uses activeTab-filtered signals so the badge reflects only agents
  // belonging to the currently viewed session, matching the panel content.
  // Permission warnings remain global — the user should always see them.
  readonly agentBadgeType = computed<'warning' | 'info' | 'neutral' | null>(
    () => {
      if (this.agentMonitorStore.pendingPermissions().length > 0)
        return 'warning';
      if (this.agentMonitorStore.hasActiveTabRunningAgents()) return 'info';
      if (this.agentMonitorStore.activeTabAgentCount() > 0) return 'neutral';
      return null;
    },
  );

  // Platform detection: in Electron, some icons move to the global navbar
  readonly isElectron = this.vscodeService.isElectron;

  // Ptah icon URI
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  // Session name popover state (sidebar)
  private readonly _sessionNamePopoverOpen = signal(false);
  readonly sessionNamePopoverOpen = this._sessionNamePopoverOpen.asReadonly();
  readonly sessionNameInput = signal('');

  // TASK_2025_192: Session search & filter state
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

    // Parse dates once outside the filter loop, using local time
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
      // Name filter (case-insensitive substring, null-safe)
      if (query && !(session.name || '').toLowerCase().includes(query)) {
        return false;
      }

      // Date range filter on lastActivityAt
      if (fromMs && session.lastActivityAt < fromMs) {
        return false;
      }
      if (toMs && session.lastActivityAt > toMs) {
        return false;
      }

      return true;
    });
  });

  // TASK_2025_142: License reason for trial ended modal
  readonly licenseReason = computed(
    () => this.chatStore.licenseStatus()?.reason,
  );

  // ViewChild for session name input (programmatic focus)
  readonly sessionNameInputRef = viewChild<ElementRef<HTMLInputElement>>(
    'sessionNameInputRef',
  );

  // ViewChild for inline session rename input
  readonly editSessionInput =
    viewChild<ElementRef<HTMLInputElement>>('editSessionInput');

  /**
   * TASK_2025_194: Flag to ensure auth redirect check runs only once.
   * Prevents re-triggering on subsequent signal changes.
   */
  private authCheckDone = false;

  constructor() {
    // Focus sidebar input when popover opens
    effect(() => {
      if (this.sessionNamePopoverOpen()) {
        setTimeout(() => {
          this.sessionNameInputRef()?.nativeElement.focus();
        }, 0);
      }
    });

    // TASK_2025_194: Check auth status on initial load.
    // If user is licensed but has no auth configured, redirect to settings.
    // This handles the case where a user activates their license on the welcome
    // page and lands on chat view with no provider keys configured.
    effect(() => {
      const view = this.currentView();
      if (view !== 'chat' || this.authCheckDone) {
        return;
      }
      this.authCheckDone = true;

      // Check auth status asynchronously (non-blocking)
      this.rpcService
        .call('auth:getAuthStatus', {})
        .then((rpcResult) => {
          if (!rpcResult.isSuccess() || !rpcResult.data) return;
          // Re-check: user may have navigated away while RPC was in flight
          if (this.currentView() !== 'chat') return;
          const data = rpcResult.data;
          const hasAnyAuth =
            data.hasOAuthToken ||
            data.hasApiKey ||
            data.hasOpenRouterKey ||
            data.hasAnyProviderKey ||
            data.copilotAuthenticated;
          if (!hasAnyAuth) {
            this.appState.setCurrentView('settings');
          }
        })
        .catch(() => {
          // Non-fatal: if RPC fails, don't redirect
        });
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
   * Navigate to Orchestra Canvas view
   */
  openCanvas(): void {
    this.appState.setCurrentView('orchestra-canvas');
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

    // Block pop-out during streaming — events would be orphaned
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

      // Force-close the tab in the sidebar (no confirmation — session is being transferred)
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
   * Handle session creation from popover
   */
  handleCreateSession(): void {
    const name = this.sessionNameInput().trim();
    const sessionName = name || this.generateDefaultSessionName();

    // Create new tab with name (createTab already switches to the new tab)
    this.tabManager.createTab(sessionName);

    // Close popover
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
   * Clear all session search/filter inputs (TASK_2025_192)
   */
  clearFilters(): void {
    this._searchQuery.set('');
    this._dateFrom.set('');
    this._dateTo.set('');
    this._dateFilterOpen.set(false);
  }

  /**
   * Toggle date filter visibility (TASK_2025_192)
   */
  toggleDateFilter(): void {
    this._dateFilterOpen.update((open) => !open);
  }

  // TASK_2025_192: Setter methods for template ngModel bindings
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
   * Pure function - no side effects, no dependencies.
   *
   * Rules:
   *   < 1 minute:    "Just now"
   *   < 1 hour:      "Xm ago"    (e.g., "5m ago")
   *   < 24 hours:    "Xh ago"    (e.g., "2h ago")
   *   Yesterday:     "Yesterday"
   *   Current week:  "Mon", "Tue", etc.
   *   Current year:  "Jan 15"
   *   Previous year: "Jan 15, 2025"
   */
  formatRelativeDate(date: Date | string | number): string {
    if (!date || (typeof date === 'number' && date <= 0)) return '';
    const now = new Date();
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 0) return 'Just now';
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;

    // Check if yesterday
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

    // Current week: show day name
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 7) {
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    }

    // Current year: "Jan 15"
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    // Previous year: "Jan 15, 2025"
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /**
   * Get display name for session
   * Falls back to truncated UUID if no proper title
   */
  getSessionDisplayName(session: ChatSessionSummary): string {
    const name = session.name;

    // Check if name is a UUID (fallback case)
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(name)) {
      // Return truncated UUID with "Session" prefix
      return `Session ${name.substring(0, 8)}...`;
    }

    // Check if name starts with "<command-message>" (Claude CLI system output)
    if (name.startsWith('<command-message>')) {
      // Extract meaningful content or use fallback
      const cleaned = name.replace(/<\/?command-message>/g, '').trim();
      if (cleaned.length > 0 && cleaned.length < 80) {
        return cleaned;
      }
      return `Session ${session.id.substring(0, 8)}...`;
    }

    // Return the name, truncated if too long
    if (name.length > 50) {
      return name.substring(0, 47) + '...';
    }

    return name;
  }

  /**
   * Check if a session has an open tab
   * Used to highlight sessions in the sidebar
   */
  isSessionOpen(sessionId: string): boolean {
    return this.tabManager.findTabBySessionId(sessionId) !== null;
  }

  /**
   * Delete session from storage (TASK_2025_086)
   * Shows confirmation dialog before deleting
   */
  /**
   * Start inline editing of a session name
   */
  startEditingSession(event: Event, session: ChatSessionSummary): void {
    event.stopPropagation();
    this.editingSessionId.set(session.id);
    this.editingSessionName.set(session.name || '');
    // Programmatic focus — HTML autofocus doesn't work on dynamically rendered elements
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

    // Guard: skip if already saved/cancelled (prevents Enter + blur double-fire)
    if (this.editingSessionId() !== session.id) {
      return;
    }

    const newName = this.editingSessionName().trim();
    if (!newName || newName === (session.name || '')) {
      this.cancelEditingSession();
      return;
    }

    // Clear edit state immediately to prevent double-fire
    this.cancelEditingSession();

    try {
      const result = await this.rpcService.renameSession(
        session.id as SessionId,
        newName,
      );

      if (result.isSuccess() && result.data?.success) {
        this.chatStore.updateSessionName(session.id as SessionId, newName);

        // Update open tab name and title if this session has one
        const tab = this.tabManager.findTabBySessionId(session.id);
        if (tab) {
          this.tabManager.updateTab(tab.id, { name: newName, title: newName });
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
    // Prevent click from propagating to session button
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
      const result = await this.rpcService.deleteSession(
        session.id as SessionId,
      );

      if (result.isSuccess() && result.data?.success) {
        // Remove from local session list
        this.chatStore.removeSessionFromList(session.id as SessionId);

        // If this was the current session, clear it
        if (this.chatStore.currentSession()?.id === session.id) {
          this.chatStore.clearCurrentSession();
        }

        // Close any open tab for this session
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
