import {
  Component,
  computed,
  inject,
  signal,
  effect,
  untracked,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import {
  LucideAngularModule,
  Check,
  ClipboardList,
  ExternalLink,
  Plus,
  RadioTower,
  Scale,
  Settings,
  Store,
  X,
  BarChart3,
} from 'lucide-angular';
import { ConfirmationDialogComponent } from '../molecules/confirmation-dialog.component';
import { SessionOrganizationEditorComponent } from '../molecules/session-organization-editor/session-organization-editor.component';
import { PreviousSessionsModalComponent } from '../organisms/previous-sessions/previous-sessions-modal.component';
import { PreviousSessionsLoadStateComponent } from '../organisms/previous-sessions/previous-sessions-load-state.component';
import {
  SkeletonBlockComponent,
  ThemeToggleComponent,
} from '@ptah-extension/chat-ui';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { PreviousSessionsDialogService } from '../../services/session-list/previous-sessions-dialog.service';
import { SessionOrganizerService } from '../../services/session-list/session-organizer.service';
import {
  AppStateManager,
  RetainedViewDirective,
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
  ThemeService,
} from '@ptah-extension/core';
import {
  NotificationAnnouncerComponent,
  NotificationCenterComponent,
  NotificationSnackbarComponent,
  NotificationSoundService,
} from '@ptah-extension/notification-center';
import { ChatFailedTurnAttentionService } from '../../services/chat-failed-turn-attention.service';
import { NotificationFocusCoordinator } from '../../services/notification-focus-coordinator.service';
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';
import { AgentFollowUpQueueService } from '../../services/agent-follow-up-queue.service';

/**
 * AppShellComponent - Main application layout: navbar and the orchestra canvas
 *
 * Optimized for VS Code sidebar panel width constraints. In Electron the
 * navbar is hidden (the global navbar carries its controls) and only the
 * canvas shows.
 *
 * The session list is not part of the shell (TASK_2026_679). It lives in the
 * previous-sessions modal, which the shell only hosts (deferred, created per
 * open) next to the organization editor. The modal opens from the canvas Rail
 * footer; `PreviousSessionsDialogService` owns its open state and focus
 * return, and `SessionOrganizerService` owns which session the editor shows.
 *
 * **View Switching Architecture**:
 * - Every standalone surface is a ROUTE. `<router-outlet />` at the top of the
 *   template renders it, and the route table lives in
 *   `apps/ptah-extension-webview/src/app/app.routes.ts` — not here, and not in
 *   a library, because half the route components live in libraries that
 *   `@ptah-extension/core` is imported by.
 * - `currentView()` still answers "which surface", but it now reads the Router
 *   through `SurfaceRouterService` instead of a signal write.
 * - The canvas content area is deliberately NOT routed: the shell row
 *   is retained by `*ptahRetainWhile` (`RetainedViewDirective`), detached from
 *   the DOM and change detection on a standalone surface but never destroyed,
 *   so `CanvasStore` and the gridstack instance survive navigation.
 *
 * **Signal Dependencies**:
 * - currentView: AppStateManager.currentView (Router-derived)
 * - previousSessions.isOpen: the modal is open (shell row inert)
 * - organizer.session: the session the organization editor shows
 *
 * @see AppStateManager
 */

@Component({
  selector: 'ptah-app-shell',
  standalone: true,
  imports: [
    RetainedViewDirective,
    SurfaceActiveDirective,
    RouterOutlet,
    NgComponentOutlet,
    ConfirmationDialogComponent,
    ThemeToggleComponent,
    LucideAngularModule,
    FormsModule,
    NativePopoverComponent,
    SkeletonBlockComponent,
    NotificationCenterComponent,
    NotificationSnackbarComponent,
    NotificationAnnouncerComponent,
    SessionOrganizationEditorComponent,
    PreviousSessionsModalComponent,
    PreviousSessionsLoadStateComponent,
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

  /**
   * Boot progress, for the two skeleton sites (TASK_2026_380). Reports `ready`
   * under VS Code, so both skeletons are unreachable there by construction.
   */
  readonly bootStatus = inject(BootStatusService);
  readonly agentMonitorStore = inject(AgentMonitorStore);
  readonly tabManager = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly authState = inject(AuthStateService);
  /** Read by the template to create the deferred dialog on first open. */
  protected readonly confirmDialog = inject(ConfirmationDialogService);
  /**
   * Read by the template: creates the deferred modal per open and makes the
   * shell row inert while it is open.
   */
  protected readonly previousSessions = inject(PreviousSessionsDialogService);
  /** Read by the template to render the organization editor it shows. */
  protected readonly organizer = inject(SessionOrganizerService);
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
  // Same reason: agent follow-ups queued in the retained row must still be
  // sent when the run ends while a standalone surface is showing.
  private readonly _agentFollowUps = inject(AgentFollowUpQueueService);
  // Same reason: in the VS Code webview only `<ptah-theme-toggle>` in the
  // retained row injects ThemeService, so a standalone-first boot would delay
  // the theme fallback and recovery until the first visit to chat.
  private readonly _theme = inject(ThemeService);
  protected readonly notificationPanelOpen = signal(false);
  private readonly _failedTurns = inject(ChatFailedTurnAttentionService);
  private readonly _notificationSound = inject(NotificationSoundService);
  private readonly pendingNotificationOpen = signal(false);
  private readonly notificationCenter = viewChild(NotificationCenterComponent);

  protected openNotifications(): void {
    const bell = this.notificationCenter();
    if (bell) {
      bell.openPanel();
      return;
    }
    this.pendingNotificationOpen.set(true);
    this.appState.setCurrentView('chat');
  }
  readonly currentView = this.appState.currentView;

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
   * measured evidence: the canvas is the launch surface of every host (the
   * shell's only chat content), so deferring it cost 50-70 ms of startup TTI
   * with no path on which it helped.
   *
   * This is the LAST remaining `*ngComponentOutlet` surface in this template.
   * The five deferred ones (harness builder, setup hub, marketplace, tribunal,
   * tasks) became `loadComponent` routes in TASK_2026_524; the canvas did not,
   * because it is retained detached while the user is elsewhere: it lives in
   * the `*ptahRetainWhile` shell row, so its instance and component-scoped
   * `CanvasStore` outlive every standalone visit. It is constructed on the
   * first visit to chat, not at shell construction.
   */
  readonly orchestraCanvasComponent =
    inject(ORCHESTRA_CANVAS_COMPONENT, { optional: true }) ?? null;

  readonly CheckIcon = Check;
  readonly PlusIcon = Plus;
  readonly SettingsIcon = Settings;
  readonly XIcon = X;
  readonly ExternalLinkIcon = ExternalLink;
  readonly BarChart3Icon = BarChart3;
  readonly RadioTowerIcon = RadioTower;
  readonly StoreIcon = Store;
  readonly ScaleIcon = Scale;
  readonly ClipboardListIcon = ClipboardList;
  readonly thothFirstRunDismissed = this.appState.thothFirstRunDismissed;
  readonly isElectron = this.vscodeService.isElectron;
  private readonly _sessionNamePopoverOpen = signal(false);
  readonly sessionNamePopoverOpen = this._sessionNamePopoverOpen.asReadonly();
  readonly sessionNameInput = signal('');

  readonly sessionNameInputRef = viewChild<ElementRef<HTMLInputElement>>(
    'sessionNameInputRef',
  );

  /**
   * Flag to ensure auth redirect check runs only once.
   * Prevents re-triggering on subsequent signal changes.
   */
  private authCheckDone = false;

  constructor() {
    effect(() => {
      const bell = this.notificationCenter();
      if (!bell) return;
      this.notificationPanelOpen.set(bell.panelOpen());
      if (this.pendingNotificationOpen()) {
        this.pendingNotificationOpen.set(false);
        bell.openPanel();
      }
    });
    // A standalone surface (e.g. a notification route) replaces the chat
    // view while the modal is open: close it without moving focus, since the
    // opener is in the row that just left the document (DP-9).
    effect(() => {
      if (!this.isStandaloneView() || !this.previousSessions.isOpen()) return;
      untracked(() => this.previousSessions.close({ restoreFocus: false }));
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
   * Handle session creation from popover: requests a new canvas tile.
   */
  handleCreateSession(): void {
    const name = this.sessionNameInput().trim();
    this.appState.requestNewCanvasSession(name || defaultSessionName());
    this._sessionNamePopoverOpen.set(false);
  }

  /**
   * Handle popover close (backdrop click or ESC)
   */
  handleCancelSession(): void {
    this._sessionNamePopoverOpen.set(false);
    this.sessionNameInput.set('');
  }
}
