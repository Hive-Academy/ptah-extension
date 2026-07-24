/**
 * Electron Shell Component
 *
 * Top-level layout for the Electron desktop application.
 * Uses a single workspace gate before showing the main app:
 *   1. Workspace gate — users without a folder open see the open-folder page
 *   2. Main app — users with a workspace get the 3-panel layout
 *
 * 3-panel layout:
 *   - Global navbar: Logo, theme toggle, settings, editor toggle
 *   - Workspace sidebar (left) — folder list
 *   - Chat panel (center) — reuses AppShellComponent entirely
 *   - Editor panel (right, toggleable) — Monaco editor + file tree
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
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import {
  LucideAngularModule,
  Settings,
  BarChart3,
  Zap,
  Bot,
  GitBranch,
  Sparkles,
  LayoutGrid,
  Wrench,
  Store,
  RadioTower,
  Scale,
  ClipboardList,
} from 'lucide-angular';
import {
  ElectronLayoutService,
  VSCodeService,
  AppStateManager,
} from '@ptah-extension/core';
import { AppShellComponent } from './app-shell.component';
import { ElectronWelcomeComponent } from './electron-welcome.component';
import { WorkspaceSidebarComponent } from '../organisms/workspace-sidebar.component';
import {
  SidebarTabComponent,
  ElectronResizeHandleComponent,
  ThemeToggleComponent,
} from '@ptah-extension/chat-ui';

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
    ThemeToggleComponent,
    LucideAngularModule,
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
          <span class="text-sm font-semibold text-base-content/70 select-none"
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
              title="Orchestra Canvas"
              (click)="onCanvasTab()"
            >
              <lucide-angular [img]="LayoutGridIcon" class="w-3.5 h-3.5" />
              Canvas
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'analytics'"
              [attr.aria-selected]="appState.currentView() === 'analytics'"
              title="Session Analytics"
              (click)="openDashboard()"
            >
              <lucide-angular [img]="BarChart3Icon" class="w-3.5 h-3.5" />
              Dashboard
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'thoth'"
              [attr.aria-selected]="appState.currentView() === 'thoth'"
              title="Thoth — agentic platform"
              (click)="openThoth()"
            >
              <lucide-angular [img]="RadioTowerIcon" class="w-3.5 h-3.5" />
              Thoth
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'tribunal'"
              [attr.aria-selected]="appState.currentView() === 'tribunal'"
              title="Tribunal — multi-vendor panel"
              (click)="openTribunal()"
            >
              <lucide-angular [img]="ScaleIcon" class="w-3.5 h-3.5" />
              Tribunal
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'tasks'"
              [attr.aria-selected]="appState.currentView() === 'tasks'"
              title="Tasks — .ptah/specs board"
              (click)="openTasks()"
            >
              <lucide-angular [img]="ClipboardListIcon" class="w-3.5 h-3.5" />
              Tasks
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'setup-hub'"
              [attr.aria-selected]="appState.currentView() === 'setup-hub'"
              title="Setup Hub"
              (click)="openSetupHub()"
            >
              <lucide-angular [img]="WrenchIcon" class="w-3.5 h-3.5" />
              Setup
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'marketplace'"
              [attr.aria-selected]="appState.currentView() === 'marketplace'"
              title="Marketplace"
              (click)="openMarketplace()"
            >
              <lucide-angular [img]="StoreIcon" class="w-3.5 h-3.5" />
              Marketplace
            </button>
            <button
              role="tab"
              class="tab gap-1.5 no-drag"
              [class.tab-active]="appState.currentView() === 'settings'"
              [attr.aria-selected]="appState.currentView() === 'settings'"
              title="Settings"
              (click)="openSettings()"
            >
              <lucide-angular [img]="SettingsIcon" class="w-3.5 h-3.5" />
              Settings
            </button>
          </div>
        }

        <!-- Spacer (right) -->
        <div class="flex-1"></div>

        <!-- Global actions — theme only (navigation moved to pills) -->
        <div class="flex items-center gap-0.5 no-drag">
          <!-- Theme toggle (always available) -->
          <ptah-theme-toggle />
        </div>
      </div>

      <!-- Content: Workspace gate → 3-panel layout -->
      <!-- Gate 1: Workspace check (need a folder open to use the app) -->
      @if (!layout.hasWorkspaceFolders()) {
        <ptah-electron-welcome class="flex-1" />
      }
      <!-- Gate 2: Workspace with folder — show main app -->
      @else {
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
          <div class="flex-1 min-w-[400px] overflow-hidden">
            <ptah-app-shell class="h-full w-full" />
          </div>

          <!-- Editor panel (lazy-loaded to keep xterm/monaco out of the VS Code extension bundle) -->
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
              @if (editorComponent()) {
                <ng-container *ngComponentOutlet="editorComponent()!" />
              } @else {
                <div class="flex items-center justify-center h-full">
                  <span class="loading loading-spinner loading-md"></span>
                </div>
              }
            </div>
          }

          <!-- Editor vertical tab (always visible when folders exist) -->
          <ptah-sidebar-tab
            label="Editor"
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

  /** Lazily loaded EditorPanelComponent — keeps xterm/monaco out of the initial bundle. */
  readonly editorComponent = signal<Type<unknown> | null>(null);

  constructor() {
    // Electron uses the canvas as its sole chat surface — the single-chat
    // layout was removed. Force grid mode so a returning user with a persisted
    // 'single' layoutMode still lands on the canvas.
    this.appState.setLayoutMode('grid');

    effect(() => {
      if (
        this.layout.editorPanelVisible() &&
        !untracked(this.editorComponent)
      ) {
        import('@ptah-extension/editor').then((m) =>
          this.editorComponent.set(m.EditorPanelComponent),
        );
      }
    });
  }
  readonly SettingsIcon = Settings;
  readonly BarChart3Icon = BarChart3;
  readonly ZapIcon = Zap;
  readonly BotIcon = Bot;
  readonly GitBranchIcon = GitBranch;
  readonly SparklesIcon = Sparkles;
  readonly LayoutGridIcon = LayoutGrid;
  readonly WrenchIcon = Wrench;
  readonly StoreIcon = Store;
  readonly RadioTowerIcon = RadioTower;
  readonly ScaleIcon = Scale;
  readonly ClipboardListIcon = ClipboardList;
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();
  readonly isMac = this.vscodeService.config().platform === 'darwin';

  onCanvasTab(): void {
    this.appState.setLayoutMode('grid');
    this.appState.setCurrentView('chat');
  }

  openSettings(): void {
    this.appState.setCurrentView('settings');
  }

  openDashboard(): void {
    this.appState.setCurrentView('analytics');
  }

  openThoth(): void {
    if (!this.appState.thothFirstRunDismissed()) {
      this.appState.dismissThothFirstRun();
    }
    this.appState.setCurrentView('thoth');
  }

  openSetupHub(): void {
    this.appState.setCurrentView('setup-hub');
  }

  openMarketplace(): void {
    this.appState.setCurrentView('marketplace');
  }

  openTribunal(): void {
    this.appState.setCurrentView('tribunal');
  }

  openTasks(): void {
    this.appState.setCurrentView('tasks');
  }
}
