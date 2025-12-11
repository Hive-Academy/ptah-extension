import {
  Component,
  inject,
  signal,
  effect,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Settings,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Check,
  X,
} from 'lucide-angular';
import { ChatViewComponent } from './chat-view.component';
import { TabBarComponent } from '../organisms/tab-bar.component';
import { ConfirmationDialogComponent } from '../molecules/confirmation-dialog.component';
import { SettingsComponent } from '../../settings/settings.component';
import { PopoverComponent } from '@ptah-extension/ui';
import { ChatStore } from '../../services/chat.store';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { TabManagerService } from '../../services/tab-manager.service';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import type { ChatSessionSummary } from '@ptah-extension/shared';

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
 */
@Component({
  selector: 'ptah-app-shell',
  standalone: true,
  imports: [
    ChatViewComponent,
    SettingsComponent,
    TabBarComponent,
    ConfirmationDialogComponent,
    DatePipe,
    NgOptimizedImage,
    LucideAngularModule,
    FormsModule,
    PopoverComponent,
  ],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  // Initialize keyboard shortcuts (constructor injection triggers setup)
  private readonly keyboardShortcuts = inject(KeyboardShortcutsService);

  readonly chatStore = inject(ChatStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);

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

  // Ptah icon URI
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  // Session name popover state
  private readonly _sessionNamePopoverOpen = signal(false);
  readonly sessionNamePopoverOpen = this._sessionNamePopoverOpen.asReadonly();
  readonly sessionNameInput = signal('');

  // ViewChild for session name input (programmatic focus)
  @ViewChild('sessionNameInput')
  sessionNameInputElement?: ElementRef<HTMLInputElement>;

  constructor() {
    // Focus input when popover opens
    effect(() => {
      if (this.sessionNamePopoverOpen()) {
        // Wait for next tick to ensure popover is rendered
        setTimeout(() => {
          this.sessionNameInputElement?.nativeElement.focus();
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

    // Create new tab with name
    this.tabManager.createTab(sessionName);

    // Clear current session (activates new tab)
    this.chatStore.clearCurrentSession();

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
}
