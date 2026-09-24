/**
 * Electron Shell Component
 *
 * Top-level layout for the Electron desktop application.
 * Shows the welcome page or a configuration surface before a workspace opens.
 * With a workspace, the main app uses the 3-panel layout.
 *
 * 3-panel layout:
 *   - Global navbar: Logo, configuration menu, theme toggle, notifications
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
import { NgComponentOutlet } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import {
  LucideAngularModule,
  BarChart3,
  ArrowLeft,
  LayoutGrid,
  Scale,
  ClipboardList,
} from 'lucide-angular';
import {
  ElectronLayoutService,
  VSCodeService,
  AppStateManager,
  SurfaceRouterService,
  NOTIFICATION_FOCUS_ROUTER,
} from '@ptah-extension/core';
import { AppShellComponent } from './app-shell.component';
import { ElectronWelcomeComponent } from './electron-welcome.component';
import { GlobalConfigMenuComponent } from '../molecules/global-config-menu.component';
import { WorkspaceSidebarComponent } from '../organisms/workspace-sidebar.component';
import {
  SidebarTabComponent,
  ElectronResizeHandleComponent,
  ThemeToggleComponent,
} from '@ptah-extension/chat-ui';
import { NotificationCenterComponent } from '@ptah-extension/notification-center';
import { NotificationFocusCoordinator } from '../../services/notification-focus-coordinator.service';

@Component({
  selector: 'ptah-electron-shell',
  standalone: true,
  imports: [
    AppShellComponent,
    ElectronWelcomeComponent,
    WorkspaceSidebarComponent,
    SidebarTabComponent,
    ElectronResizeHandleComponent,
    NgComponentOutlet,
    RouterOutlet,
    GlobalConfigMenuComponent,
    ThemeToggleComponent,
    LucideAngularModule,
    NotificationCenterComponent,
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

    .titlebar-drag {
      -webkit-app-region: drag;
    }

    .no-drag {
      -webkit-app-region: no-drag;
    }
  `,
  template: `
    <div class="flex flex-col h-screen w-screen bg-base-100">
      <!-- Global Navbar (spans full width, draggable on macOS) -->
      <div
        class="flex items-center h-10 px-3 bg-base-200 border-b border-base-content/10 gap-2 flex-shrink-0"
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
          <div role="tablist" class="tabs tabs-lifted electron-tabs no-drag">
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'chat'"
              [attr.aria-selected]="appState.currentView() === 'chat'"
              title="Chat"
              (click)="onCanvasTab()"
            >
              <lucide-angular [img]="LayoutGridIcon" class="w-3.5 h-3.5" />
              Chat
            </button>
            <!-- Apps tab (TASK_2026_494) renders between Chat and Tasks -->
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'tasks'"
              [attr.aria-selected]="appState.currentView() === 'tasks'"
              title="Tasks"
              (click)="openTasks()"
            >
              <lucide-angular [img]="ClipboardListIcon" class="w-3.5 h-3.5" />
              Tasks
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'tribunal'"
              [attr.aria-selected]="appState.currentView() === 'tribunal'"
              title="Tribunal"
              (click)="openTribunal()"
            >
              <lucide-angular [img]="ScaleIcon" class="w-3.5 h-3.5" />
              Tribunal
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'analytics'"
              [attr.aria-selected]="appState.currentView() === 'analytics'"
              title="Analytics"
              (click)="openDashboard()"
            >
              <lucide-angular [img]="BarChart3Icon" class="w-3.5 h-3.5" />
              Analytics
            </button>
          </div>
        }

        <!-- Spacer (right) -->
        <div class="flex-1"></div>

        <!-- Global actions: configuration, theme and notifications.
             The back-office activity ticker never sits in this row: an
             arriving message would resize this cluster and shift the tab
             strip (TASK_2026_405). It lives in the canvas dock row instead,
             pinned to that row's free left edge. -->
        <div class="flex items-center gap-0.5 no-drag">
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
          <ptah-global-config-menu />
          <ptah-theme-toggle />
          <ptah-notification-center />
        </div>
      </div>

      <!-- Content: welcome, pre-workspace configuration, or workspace layout. -->
      @if (
        !layout.hasWorkspaceFolders() &&
        appState.openConfigurationSurface() === null
      ) {
        <ptah-electron-welcome class="flex-1" />
      } @else if (!layout.hasWorkspaceFolders()) {
        <div class="flex-1 min-h-0 overflow-hidden"><router-outlet /></div>
      } @else {
        <!-- 3-Panel Content Area -->
        <div class="flex flex-1 overflow-hidden">
          <!-- Workspace sidebar (toggleable) -->
          @if (layout.workspaceSidebarVisible()) {
            <ptah-workspace-sidebar [width]="layout.workspaceSidebarWidth()" />
          }

          <!-- Workspaces vertical tab (between sidebar and chat) -->
          <ptah-sidebar-tab
            label="Workspaces"
            side="left"
            [isOpen]="layout.workspaceSidebarVisible()"
            (toggled)="layout.toggleWorkspaceSidebar()"
          />

          @if (layout.workspaceSidebarVisible()) {
            <!-- Resize handle: sidebar ↔ chat -->
            <ptah-electron-resize-handle
              [direction]="'left'"
              (dragStarted)="layout.setSidebarDragging(true)"
              (dragMoved)="layout.setWorkspaceSidebarWidth($event)"
              (dragEnded)="layout.setSidebarDragging(false)"
            />
          }

          <!-- Chat panel (reuses entire AppShellComponent) -->
          <div
            #configurationSurfaceHost
            data-test="configuration-surface-host"
            tabindex="-1"
            class="flex-1 min-w-[400px] overflow-hidden outline-none"
          >
            <ptah-app-shell class="h-full w-full" />
          </div>

          <!-- Git dock (lazy-loaded to keep monaco out of the initial Electron renderer bundle) -->
          @if (layout.editorPanelVisible()) {
            <!-- Resize handle: chat ↔ editor -->
            <ptah-electron-resize-handle
              [direction]="'right'"
              (dragStarted)="layout.setEditorDragging(true)"
              (dragMoved)="layout.setEditorPanelWidth($event)"
              (dragEnded)="layout.setEditorDragging(false)"
            />

            <div
              class="min-w-[300px] border-l border-base-content/10 overflow-hidden"
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
  protected readonly layout = inject(ElectronLayoutService);
  private readonly vscodeService = inject(VSCodeService);
  protected readonly appState = inject(AppStateManager);
  private readonly surfaceRouter = inject(SurfaceRouterService);
  private readonly injector = inject(Injector);
  private readonly configurationSurfaceHost = viewChild<
    ElementRef<HTMLElement>
  >('configurationSurfaceHost');

  /** Lazily loaded GitDockComponent — keeps xterm/monaco out of the initial bundle. */
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
    // Electron uses the canvas as its sole chat surface — the single-chat
    // layout was removed. Force grid mode so a returning user with a persisted
    // 'single' layoutMode still lands on the canvas.
    this.appState.setLayoutMode('grid');

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
          .then((m) => this.dockComponent.set(m.GitDockComponent))
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
  readonly ScaleIcon = Scale;
  readonly ClipboardListIcon = ClipboardList;
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();
  readonly isMac = this.vscodeService.config().platform === 'darwin';

  onCanvasTab(): void {
    this.appState.setLayoutMode('grid');
    this.appState.setCurrentView('chat');
  }

  openDashboard(): void {
    this.appState.setCurrentView('analytics');
  }

  openTribunal(): void {
    this.appState.setCurrentView('tribunal');
  }

  openTasks(): void {
    this.appState.setCurrentView('tasks');
  }
}
