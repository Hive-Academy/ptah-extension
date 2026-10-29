/**
 * Electron Shell Component
 *
 * Top-level layout for the Electron desktop application.
 * Shows a loading state until the first workspace sync settles, then the
 * welcome page or a configuration surface before a workspace opens.
 * With a workspace, the main app uses the 3-panel layout.
 *
 * 3-panel layout:
 *   - Global navbar: Logo, tabs (incl. Setup hub), Thoth/Marketplace/Settings
 *     icon buttons, theme toggle, notifications
 *   - Workspace sidebar (left) — folder list
 *   - Chat panel (center) — reuses AppShellComponent entirely
 *   - Git dock (right, toggleable) — git status, source control, diff view
 *
 * Resizable dividers between panels. macOS title bar drag region on navbar.
 */

import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
  untracked,
  Type,
  ElementRef,
  viewChild,
  afterNextRender,
  Injector,
} from '@angular/core';
import { DOCUMENT, NgComponentOutlet } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import {
  LucideAngularModule,
  BarChart3,
  ArrowLeft,
  LayoutGrid,
  ClipboardList,
  AppWindow,
  Wrench,
  Mic,
  RotateCw,
} from 'lucide-angular';
import {
  ElectronLayoutService,
  VSCodeService,
  AppStateManager,
  SurfaceRouterService,
  NOTIFICATION_FOCUS_ROUTER,
} from '@ptah-extension/core';
import { AppShellComponent } from './app-shell.component';
// Used only inside `@defer` in the template: the compiler turns this
// declaration into a dynamic import (lazy chunk). Keep it a declaration of
// its own and do not use the class anywhere else in this file.
import { ElectronWelcomeComponent } from './electron-welcome.component';
import { WorkspaceLoadingStateComponent } from './workspace-loading-state.component';
import { GlobalConfigActionsComponent } from '../molecules/global-config-actions.component';
import { WorkspaceSidebarComponent } from '../organisms/workspace-sidebar.component';
import {
  SidebarTabComponent,
  ElectronResizeHandleComponent,
  ThemeToggleComponent,
} from '@ptah-extension/chat-ui';
import {
  NotificationAnnouncerComponent,
  NotificationCenterComponent,
  NotificationSnackbarComponent,
  NotificationSoundService,
} from '@ptah-extension/notification-center';
import { ChatFailedTurnAttentionService } from '../../services/chat-failed-turn-attention.service';
import { NotificationFocusCoordinator } from '../../services/notification-focus-coordinator.service';
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';

@Component({
  selector: 'ptah-electron-shell',
  standalone: true,
  imports: [
    AppShellComponent,
    ElectronWelcomeComponent,
    WorkspaceLoadingStateComponent,
    WorkspaceSidebarComponent,
    SidebarTabComponent,
    ElectronResizeHandleComponent,
    NgComponentOutlet,
    RouterOutlet,
    GlobalConfigActionsComponent,
    ThemeToggleComponent,
    LucideAngularModule,
    NotificationCenterComponent,
    NotificationSnackbarComponent,
    NotificationAnnouncerComponent,
  ],
  providers: [
    {
      provide: NOTIFICATION_FOCUS_ROUTER,
      useExisting: NotificationFocusCoordinator,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: block;
      height: 100%;
      width: 100%;
    }

    :host-context([data-glass='on']) > .bg-surface-0 {
      background-color: transparent;
    }

    :host-context([data-glass='on']) .electron-shell-root {
      padding: 8px;
      gap: 8px;
    }

    :host-context([data-glass='on']) .electron-shell-body {
      gap: 0;
    }

    /* Glass panes take their depth from an outer shadow. overflow: hidden
       would cut it at the body's top and bottom edges; clip with an 8px
       margin lets it reach into the root's 8px padding and still never
       scrolls or overflows the window. Glass on only (any theme). */
    :host-context([data-theme][data-glass='on']) .electron-shell-body {
      overflow: clip;
      overflow-clip-margin: 8px;
    }

    :host-context([data-glass='on']) .electron-shell-body > :not(ptah-electron-resize-handle):not(:last-child) {
      margin-inline-end: 8px;
    }

    :host-context([data-glass='on']) .electron-shell-body > [data-test='configuration-surface-host']:has(+ ptah-electron-resize-handle) {
      margin-inline-end: 0;
    }

    :host-context([data-glass='on']) .electron-shell-body > ptah-electron-resize-handle {
      margin-inline: 1px;
    }

    /* Glass frame yield: the 8px root padding is chrome around every pane
       (the resize handle's 6px + 1px margins already keep the chat↔dock
       gutter at 8px). The chat column's 400px floor drops by that 16px so
       the hidden-sidebar 1200px row still fits a 700px dock without flex
       taking those pixels out of the dock (git-rail-collapse e2e, 699–701).
       The dock keeps flex-shrink so a row that still does not fit — sidebar
       open — gives the leftover to the dock (down to its 300px min) instead
       of clipping the trailing Git tab. */
    :host-context([data-glass='on']) .electron-shell-body > [data-test='configuration-surface-host'] {
      min-width: 384px;
    }

    :host-context([data-glass='on']) .electron-shell-body > ptah-workspace-sidebar,
    :host-context([data-glass='on']) .electron-shell-body > ptah-sidebar-tab,
    :host-context([data-glass='on']) .electron-shell-body > [data-test='configuration-surface-host'],
    :host-context([data-glass='on']) .electron-shell-body > .electron-git-dock {
      border-radius: var(--glass-radius);
      overflow: hidden;
    }

    .titlebar-drag {
      -webkit-app-region: drag;
    }

    .no-drag {
      -webkit-app-region: no-drag;
    }
    .electron-tabs {
      scrollbar-width: none;
    }
    .electron-tabs::-webkit-scrollbar {
      display: none;
    }
    .electron-tabs .tab-label {
      white-space: nowrap;
    }
    @media (max-width: 1023px) {
      .electron-tabs .tab-label {
        display: none;
      }
      .electron-tabs .tab {
        min-width: 2.5rem;
        padding-inline: 0.65rem;
      }
    }
  `,
  template: `
    <div class="electron-shell-root flex flex-col h-screen w-screen bg-surface-0">
      <!-- Global Navbar (spans full width, draggable on macOS).
           One surface-1 plane and a single bottom edge. The canvas behind
           the panels is the surface-0 root above. -->
      <div
        class="flex items-center h-10 px-3 bg-surface-1 border-b border-surface-border gap-2 flex-shrink-0"
        data-glass-surface="bar"
        [class.titlebar-drag]="isMac"
      >
        <!-- Logo + App name -->
        <div class="flex items-center gap-2 no-drag">
          <img
            [src]="ptahIconUri"
            alt="Ptah"
            class="w-5 h-5 flex-shrink-0"
            width="20"
            height="20"
          />
          <span
            class="text-sm font-semibold text-base-content-muted select-none"
            >Ptah</span
          >
        </div>

        <!-- Spacer (left) -->
        <div class="flex-1"></div>

        <!-- Navbar tabs (DaisyUI tabs-lifted, fixed navigation) -->
        @if (layout.hasWorkspaceFolders()) {
          <div
            #electronTabs
            role="tablist"
            class="tabs tabs-lifted electron-tabs no-drag min-w-0 overflow-x-auto"
          >
            <button
              role="tab"
              class="tab gap-1.5 no-drag whitespace-nowrap"
              [class.tab-active]="appState.currentView() === 'chat'"
              [attr.aria-selected]="appState.currentView() === 'chat'"
              title="Chat"
              aria-label="Chat"
              (click)="onCanvasTab()"
            >
              <lucide-angular [img]="LayoutGridIcon" class="w-3.5 h-3.5" />
              <span class="tab-label whitespace-nowrap">Chat</span>
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag whitespace-nowrap"
              [class.tab-active]="appState.currentView() === 'command-center'"
              [attr.aria-selected]="appState.currentView() === 'command-center'"
              title="Voice"
              aria-label="Voice"
              (click)="openCommandCenter()"
            >
              <lucide-angular [img]="MicIcon" class="w-3.5 h-3.5" />
              <span class="tab-label whitespace-nowrap">Voice</span>
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag whitespace-nowrap"
              [class.tab-active]="appState.currentView() === 'apps'"
              [attr.aria-selected]="appState.currentView() === 'apps'"
              title="Apps"
              aria-label="Apps"
              (click)="openApps()"
            >
              <lucide-angular [img]="AppWindowIcon" class="w-3.5 h-3.5" />
              <span class="tab-label whitespace-nowrap">Apps</span>
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag whitespace-nowrap"
              [class.tab-active]="appState.currentView() === 'tasks'"
              [attr.aria-selected]="appState.currentView() === 'tasks'"
              title="Tasks"
              aria-label="Tasks"
              (click)="openTasks()"
            >
              <lucide-angular [img]="ClipboardListIcon" class="w-3.5 h-3.5" />
              <span class="tab-label whitespace-nowrap">Tasks</span>
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag whitespace-nowrap"
              [class.tab-active]="appState.currentView() === 'analytics'"
              [attr.aria-selected]="appState.currentView() === 'analytics'"
              title="Analytics"
              aria-label="Analytics"
              (click)="openDashboard()"
            >
              <lucide-angular [img]="BarChart3Icon" class="w-3.5 h-3.5" />
              <span class="tab-label whitespace-nowrap">Analytics</span>
            </button>
            <!-- Keeps the former config-menu hook: e2e specs and the showcase
                 harness address the Setup hub surface by it. -->
            <button
              role="tab"
              class="tab gap-1.5 no-drag whitespace-nowrap"
              data-test="config-menu-item-setup-hub"
              [class.tab-active]="
                appState.openConfigurationSurface() === 'setup-hub'
              "
              [attr.aria-selected]="
                appState.openConfigurationSurface() === 'setup-hub'
              "
              [attr.aria-current]="
                appState.openConfigurationSurface() === 'setup-hub'
                  ? 'true'
                  : null
              "
              title="Setup hub"
              aria-label="Setup hub"
              (click)="openSetupHub()"
            >
              <lucide-angular [img]="WrenchIcon" class="w-3.5 h-3.5" />
              <span class="tab-label whitespace-nowrap">Setup hub</span>
            </button>
          </div>
        }

        <!-- Spacer (right) -->
        <div class="flex-1"></div>

        <!-- Global actions: configuration, theme and notifications.
             The back-office activity ticker never sits in this row: an
             arriving message would resize the cluster and shift the tab
             strip (TASK_2026_405). It lives in the canvas dock row instead,
             pinned to that row's free left edge.
             The cluster keeps a fixed minimum width and an always-present
             32px back slot, so the conditional back button (and an in-flow
             badge up to that slack) cannot move the centered tabs. The slot
             is the back button's place; it stays empty while folders — and
             therefore the tab strip — are showing. -->
        <div
          class="flex min-w-[13rem] shrink-0 items-center justify-end gap-0.5 no-drag"
          data-testid="titlebar-global-actions"
        >
          <span
            class="inline-flex h-8 w-8 shrink-0 items-center justify-center"
            data-testid="titlebar-back-slot"
          >
            @if (
              !layout.hasWorkspaceFolders() &&
              appState.openConfigurationSurface() !== null
            ) {
              <button
                type="button"
                class="btn btn-ghost btn-sm btn-square"
                aria-label="Back to welcome"
                data-test="config-back-to-welcome"
                (click)="appState.setCurrentView('chat')"
              >
                <lucide-angular
                  [img]="ArrowLeftIcon"
                  class="w-4 h-4"
                  aria-hidden="true"
                />
              </button>
            }
          </span>
          <ptah-global-config-actions
            [showSetupHub]="!layout.hasWorkspaceFolders()"
          />
          <ptah-theme-toggle />
          <ptah-notification-center #notificationCenter />
          <ptah-notification-announcer />
        </div>
        <ptah-notification-snackbar
          [panelOpen]="notificationPanelOpen()"
          (openNotifications)="openNotifications()"
        />
      </div>

      <!-- Content: L1 loading until the first workspace sync settles, then
           welcome, pre-workspace configuration, or workspace layout. -->
      @if (!layout.workspaceResolved()) {
        <ptah-workspace-loading-state
          class="flex-1 min-h-0 ptah-vt-surface"
          [workspaceName]="layout.pendingWorkspaceName()"
        />
      } @else if (
        !layout.hasWorkspaceFolders() &&
        appState.openConfigurationSurface() === null
      ) {
        <!-- Deferred so the welcome, its vitals stores and the
             @ptah-extension/chat-ui/vitals molecules load as a lazy chunk,
             out of the initial bundle. The placeholder keeps the same
             flex-1 surface box, so the layout does not move while the
             chunk loads. The welcome must not be used outside this block
             nor re-exported by the chat barrel, or the compiler and esbuild
             keep it eager (electron-welcome.lazy-boundary.spec.ts). -->
        @defer (on immediate) {
          <ptah-electron-welcome class="flex-1 ptah-vt-surface" />
        } @placeholder {
          <div
            class="flex-1 ptah-vt-surface"
            data-testid="electron-welcome-placeholder"
            aria-hidden="true"
          ></div>
        } @error {
          <!-- A failed chunk load is cached by Angular and the module
               loader, so a remount would fail again: Reload restarts the
               renderer instead. -->
          <div
            class="flex-1 ptah-vt-surface flex flex-col items-center justify-center gap-3 p-6 text-center"
            data-testid="electron-welcome-error"
            role="alert"
          >
            <p class="text-sm text-base-content">
              The welcome screen could not load.
            </p>
            <button
              type="button"
              class="btn btn-sm btn-primary gap-1.5"
              data-testid="electron-welcome-reload"
              (click)="reloadWindow()"
            >
              <lucide-angular
                [img]="RotateCwIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
              Reload
            </button>
          </div>
        }
      } @else if (!layout.hasWorkspaceFolders()) {
        <div class="flex-1 min-h-0 overflow-hidden ptah-vt-surface"><router-outlet /></div>
      } @else {
        <!-- 3-Panel Content Area -->
        <div class="electron-shell-body flex flex-1 min-h-0 overflow-hidden">
          <!-- Workspace sidebar (toggleable) -->
          @if (layout.workspaceSidebarVisible()) {
            <ptah-workspace-sidebar
              class="shrink-0"
              data-glass-surface="chrome"
              [width]="layout.workspaceSidebarWidth()"
            />
          }

          <!-- Workspaces vertical tab (between sidebar and chat) -->
          <ptah-sidebar-tab
            data-glass-surface="chrome"
            label="Workspaces"
            side="left"
            [isOpen]="layout.workspaceSidebarVisible()"
            (toggled)="layout.toggleWorkspaceSidebar()"
          />

          <!-- Chat panel (reuses entire AppShellComponent) -->
          <div
            #configurationSurfaceHost
            data-test="configuration-surface-host"
            data-glass-surface="chrome"
            tabindex="-1"
            class="flex-1 min-h-0 min-w-[400px] overflow-hidden outline-none ptah-vt-surface"
          >
            <ptah-app-shell class="h-full w-full" />
          </div>

          <!-- Git dock: git-ui's review shell, lazy-loaded to keep git-ui out of the initial Electron renderer bundle -->
          @if (layout.editorPanelVisible()) {
            <!-- Resize handle: chat ↔ editor -->
            <ptah-electron-resize-handle
              [direction]="'right'"
              (dragStarted)="layout.setEditorDragging(true)"
              (dragMoved)="layout.setEditorPanelWidth($event)"
              (dragEnded)="layout.setEditorDragging(false)"
            />

            <div
              class="electron-git-dock min-w-[300px] border-l border-surface-border overflow-hidden"
              data-glass-surface="chrome"
              [style.width.px]="layout.editorPanelWidth()"
            >
              @if (dockComponent()) {
                <ng-container *ngComponentOutlet="dockComponent()!" />
              } @else if (dockLoadFailed()) {
                <div
                  class="flex flex-col items-center justify-center gap-2 h-full p-4 text-center"
                >
                  <span class="text-xs text-error"
                    >Failed to load the git panel.</span
                  >
                  <button
                    type="button"
                    class="btn btn-xs btn-outline"
                    (click)="retryDockLoad()"
                  >
                    Retry
                  </button>
                </div>
              } @else {
                <div class="flex items-center justify-center h-full">
                  <span class="loading loading-spinner loading-md"></span>
                </div>
              }
            </div>
          }

          <!-- Git vertical tab (always visible when folders exist) -->
          <ptah-sidebar-tab
            data-glass-surface="chrome"
            label="Git"
            side="right"
            [isOpen]="layout.editorPanelVisible()"
            (toggled)="layout.toggleEditorPanel()"
          />
        </div>
      }
    </div>
  `,
})
export class ElectronShellComponent {
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

  protected readonly layout = inject(ElectronLayoutService);
  private readonly vscodeService = inject(VSCodeService);
  protected readonly appState = inject(AppStateManager);
  private readonly surfaceRouter = inject(SurfaceRouterService);
  private readonly injector = inject(Injector);
  private readonly electronTabs =
    viewChild<ElementRef<HTMLElement>>('electronTabs');
  // Injected only to instantiate the root singleton eagerly: it ends the backend session of a closed tab.
  private readonly _closedTabSessionEnder = inject(
    ClosedTabSessionEnderService,
  );
  private readonly configurationSurfaceHost = viewChild<
    ElementRef<HTMLElement>
  >('configurationSurfaceHost');

  /** Lazily loaded ReviewShellComponent — keeps git-ui out of the initial bundle. */
  readonly dockComponent = signal<Type<unknown> | null>(null);

  /**
   * Set when the `@ptah-extension/git-ui` chunk fails to load (network blip,
   * corrupted build output, CSP block). Read as a tracked dependency in the
   * load effect below so flipping it back to `false` (via
   * {@link retryDockLoad}) re-triggers the import — without this the user
   * had no way to recover short of closing and reopening the whole panel,
   * and even that gave no visible indication anything had failed
   * (TASK_2026_385 Batch 3.1 fix pass, FIX 1).
   */
  readonly dockLoadFailed = signal(false);

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
    effect(() => {
      this.appState.currentView();
      this.appState.openConfigurationSurface();
      const strip = this.electronTabs()?.nativeElement;
      if (!strip) return;
      afterNextRender(
        () => {
          const active = strip.querySelector<HTMLElement>(
            '[role="tab"][aria-selected="true"]',
          );
          active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        },
        { injector: this.injector },
      );
    });

    let lastHandledTick = this.appState.configurationSurfaceRemountTick();
    effect(() => {
      const tick = this.appState.configurationSurfaceRemountTick();
      if (tick === lastHandledTick) return;
      lastHandledTick = tick;
      if (tick === 0) return;
      untracked(() => {
        if (this.surfaceRouter.pendingSurface() !== null) return;
        const host = this.configurationSurfaceHost()?.nativeElement;
        const active = document.activeElement;
        const wasInside = !!host && !!active && host.contains(active);
        this.surfaceRouter.remountActiveSurface();
        afterNextRender(
          () => {
            const renderedHost = this.configurationSurfaceHost()?.nativeElement;
            if (active === document.body || !active?.isConnected || wasInside) {
              renderedHost?.focus();
            }
          },
          { injector: this.injector },
        );
      });
    });

    effect(() => {
      if (
        this.layout.editorPanelVisible() &&
        !untracked(this.dockComponent) &&
        !this.dockLoadFailed()
      ) {
        import('@ptah-extension/git-ui')
          .then((m) => this.dockComponent.set(m.ReviewShellComponent))
          .catch((error: unknown) => {
            console.error(
              '[ElectronShellComponent] failed to load the git dock chunk:',
              error instanceof Error ? error.message : String(error),
            );
            this.dockLoadFailed.set(true);
          });
      }
    });
  }

  /** Manual retry for a failed git-dock chunk load (see {@link dockLoadFailed}). */
  protected retryDockLoad(): void {
    this.dockLoadFailed.set(false);
  }
  readonly BarChart3Icon = BarChart3;
  readonly ArrowLeftIcon = ArrowLeft;
  readonly LayoutGridIcon = LayoutGrid;
  readonly ClipboardListIcon = ClipboardList;
  readonly AppWindowIcon = AppWindow;
  readonly WrenchIcon = Wrench;
  readonly MicIcon = Mic;
  readonly RotateCwIcon = RotateCw;

  private readonly document = inject(DOCUMENT);

  /** Retry of the deferred welcome: restarts the renderer (see `@error`). */
  protected reloadWindow(): void {
    this.document.defaultView?.location.reload();
  }
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();
  readonly isMac = this.vscodeService.config().platform === 'darwin';

  onCanvasTab(): void {
    this.appState.setCurrentView('chat');
  }

  openDashboard(): void {
    this.appState.setCurrentView('analytics');
  }

  openTasks(): void {
    this.appState.setCurrentView('tasks');
  }

  openApps(): void {
    this.appState.setCurrentView('apps');
  }

  public openCommandCenter(): void {
    this.appState.setCurrentView('command-center');
  }

  openSetupHub(): void {
    this.appState.setCurrentView('setup-hub');
  }
}
