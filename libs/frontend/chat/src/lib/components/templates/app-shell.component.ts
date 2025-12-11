import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import {
  LucideAngularModule,
  Settings,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
} from 'lucide-angular';
import { ChatViewComponent } from './chat-view.component';
import { TabBarComponent } from '../organisms/tab-bar.component';
import { ConfirmationDialogComponent } from '../molecules/confirmation-dialog.component';
import { SettingsComponent } from '../../settings/settings.component';
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
  readonly PanelLeftCloseIcon = PanelLeftClose;
  readonly PanelLeftOpenIcon = PanelLeftOpen;
  readonly ChevronDownIcon = ChevronDown;

  // Ptah icon URI
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

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
   * Create a new chat session
   */
  createNewSession(): void {
    // Clear current session to start fresh
    // The ChatStore will create a new session on first message
    this.chatStore.clearCurrentSession();
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
