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
import { NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Settings,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  Check,
  X,
  Trash2,
  MessageSquare,
} from 'lucide-angular';
import { ChatViewComponent } from './chat-view.component';
import { TabBarComponent } from '../organisms/tab-bar.component';
import { ConfirmationDialogComponent } from '../molecules/confirmation-dialog.component';
import { TrialEndedModalComponent } from '../molecules/trial-ended-modal.component';
import { SettingsComponent } from '../../settings/settings.component';
import { WelcomeComponent } from './welcome.component';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { WizardViewComponent } from '@ptah-extension/setup-wizard';
import { AgentMonitorPanelComponent } from '../organisms/agent-monitor-panel.component';
import { ThemeToggleComponent } from '../atoms/theme-toggle.component';
import { NotificationBellComponent } from '../molecules/notification-bell.component';
import { BackgroundAgentBadgeComponent } from '../molecules/background-agent-badge.component';
import { ChatStore } from '../../services/chat.store';
import { AgentMonitorStore } from '../../services/agent-monitor.store';
import { BackgroundAgentStore } from '../../services/background-agent.store';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { TabManagerService } from '../../services/tab-manager.service';
import {
  AppStateManager,
  VSCodeService,
  ClaudeRpcService,
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
    WizardViewComponent,
    TabBarComponent,
    ConfirmationDialogComponent,
    TrialEndedModalComponent,
    ThemeToggleComponent,
    NotificationBellComponent,
    BackgroundAgentBadgeComponent,
    NgOptimizedImage,
    LucideAngularModule,
    FormsModule,
    NativePopoverComponent,
    AgentMonitorPanelComponent,
  ],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  // Initialize keyboard shortcuts (constructor injection triggers setup)
  private readonly keyboardShortcuts = inject(KeyboardShortcutsService);

  readonly chatStore = inject(ChatStore);
  readonly agentMonitorStore = inject(AgentMonitorStore);
  readonly backgroundAgentStore = inject(BackgroundAgentStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly confirmDialog = inject(ConfirmationDialogService);

  // Expose currentView signal for template
  readonly currentView = this.appState.currentView;

  // Sidebar state (default hidden for VS Code sidebar space efficiency)
  private readonly _sidebarOpen = signal(false);
  readonly sidebarOpen = this._sidebarOpen.asReadonly();

  // Lucide icons
  readonly SettingsIcon = Settings;
  readonly PlusIcon = Plus;
  readonly CheckIcon = Check;
  readonly XIcon = X;
  readonly PanelLeftCloseIcon = PanelLeftClose;
  readonly PanelLeftOpenIcon = PanelLeftOpen;
  readonly ChevronDownIcon = ChevronDown;
  readonly Trash2Icon = Trash2;
  readonly MessageSquareIcon = MessageSquare;
  readonly PanelRightCloseIcon = PanelRightClose;
  readonly PanelRightOpenIcon = PanelRightOpen;

  // Ptah icon URI
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  // Session name popover state (sidebar)
  private readonly _sessionNamePopoverOpen = signal(false);
  readonly sessionNamePopoverOpen = this._sessionNamePopoverOpen.asReadonly();
  readonly sessionNameInput = signal('');

  // TASK_2025_142: License reason for trial ended modal
  readonly licenseReason = computed(
    () => this.chatStore.licenseStatus()?.reason
  );

  // ViewChild for session name input (programmatic focus)
  readonly sessionNameInputRef = viewChild<ElementRef<HTMLInputElement>>(
    'sessionNameInputRef'
  );

  constructor() {
    // Focus sidebar input when popover opens
    effect(() => {
      if (this.sessionNamePopoverOpen()) {
        setTimeout(() => {
          this.sessionNameInputRef()?.nativeElement.focus();
        }, 0);
      }
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
  async deleteSession(
    event: Event,
    session: ChatSessionSummary
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
        session.id as SessionId
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

        console.log(`[AppShell] Session ${session.id} deleted successfully`);
      } else {
        console.error(
          '[AppShell] Failed to delete session:',
          result.error || result.data?.error
        );
      }
    } catch (error) {
      console.error('[AppShell] Error deleting session:', error);
    }
  }
}
