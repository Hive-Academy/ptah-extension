/**
 * Electron Shell Component
 *
 * Top-level layout for the Electron desktop application.
 * Uses a two-gate system before showing the main app:
 *   1. License gate — unlicensed users see the auth welcome page first
 *   2. Workspace gate — licensed users without a folder see the open-folder page
 *   3. Main app — licensed users with a workspace get the 3-panel layout
 *
 * 3-panel layout:
 *   - Global navbar: Logo, theme toggle, notifications, settings, editor toggle
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
  Shield,
  GitBranch,
  Sparkles,
  X,
  MessageSquare,
  Wand2,
  LayoutGrid,
  type LucideIconData,
} from 'lucide-angular';
import {
  ElectronLayoutService,
  VSCodeService,
  AppStateManager,
  type ViewType,
} from '@ptah-extension/core';
import { ChatStore } from '../../services/chat.store';
import { AppShellComponent } from './app-shell.component';
import { ElectronWelcomeComponent } from './electron-welcome.component';
import { WelcomeComponent } from './welcome.component';
import { WorkspaceSidebarComponent } from '../organisms/workspace-sidebar.component';
import { SidebarTabComponent } from '../atoms/sidebar-tab.component';
import { ElectronResizeHandleComponent } from '../atoms/electron-resize-handle.component';
import { ThemeToggleComponent } from '../atoms/theme-toggle.component';
import { NotificationBellComponent } from '../molecules/notifications/notification-bell.component';

@Component({
  selector: 'ptah-electron-shell',
  standalone: true,
  imports: [
    AppShellComponent,
    ElectronWelcomeComponent,
    WelcomeComponent,
    WorkspaceSidebarComponent,
    SidebarTabComponent,
    ElectronResizeHandleComponent,
    NgComponentOutlet,
    ThemeToggleComponent,
    NotificationBellComponent,
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

    /* Hero panel animations for license welcome split-screen */
    @keyframes hero-float {
      0%,
      100% {
        transform: translateY(0px);
      }
      50% {
        transform: translateY(-10px);
      }
    }
    @keyframes hero-float-delayed {
      0%,
      100% {
        transform: translateY(0px);
      }
      50% {
        transform: translateY(-8px);
      }
    }
    @keyframes hero-glow-pulse {
      0%,
      100% {
        box-shadow: 0 0 20px rgba(212, 175, 55, 0.15);
      }
      50% {
        box-shadow: 0 0 40px rgba(212, 175, 55, 0.3);
      }
    }
    @keyframes hero-particle-float {
      0% {
        transform: translateY(100%) rotate(0deg);
        opacity: 0;
      }
      10% {
        opacity: 0.6;
      }
      90% {
        opacity: 0.6;
      }
      100% {
        transform: translateY(-100vh) rotate(720deg);
        opacity: 0;
      }
    }

    .hero-card-float {
      animation: hero-float 6s ease-in-out infinite;
    }
    .hero-card-float-delayed {
      animation: hero-float-delayed 6s ease-in-out infinite;
      animation-delay: -3s;
    }
    .hero-glow {
      animation: hero-glow-pulse 3s ease-in-out infinite;
    }
    .hero-particle {
      position: absolute;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: linear-gradient(135deg, #d4af37, #f5d97d);
    }
    .hero-particle-1 {
      left: 20%;
      animation: hero-particle-float 16s linear infinite;
    }
    .hero-particle-2 {
      left: 55%;
      animation: hero-particle-float 14s linear infinite;
      animation-delay: -5s;
    }
    .hero-particle-3 {
      left: 80%;
      animation: hero-particle-float 18s linear infinite;
      animation-delay: -10s;
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

        <!-- Navbar tabs (centered, curved-notch design) -->
        @if (appState.isLicensed() && layout.hasWorkspaceFolders()) {
          <div class="navbar-tab-group no-drag">
            <!-- Canvas layout toggle tab (always visible, not closeable) -->
            <button
              class="navbar-tab"
              [class.navbar-tab-active]="appState.layoutMode() === 'grid'"
              [class.navbar-tab-inactive]="appState.layoutMode() !== 'grid'"
              title="Toggle canvas grid / single chat"
              aria-label="Toggle canvas grid / single chat"
              (click)="appState.toggleLayoutMode()"
            >
              <lucide-angular [img]="LayoutGridIcon" class="w-3.5 h-3.5" />
              <span>Canvas</span>
            </button>

            <!-- Dynamic view tabs (Chat, Dashboard, Settings, etc.) -->
            @for (view of appState.openViews(); track view) {
              <button
                class="navbar-tab"
                [class.navbar-tab-active]="appState.currentView() === view"
                [class.navbar-tab-inactive]="appState.currentView() !== view"
                [title]="getViewMeta(view).label"
                (click)="appState.setCurrentView(view)"
              >
                <lucide-angular
                  [img]="getViewMeta(view).icon"
                  class="w-3.5 h-3.5"
                />
                <span>{{ getViewMeta(view).label }}</span>
                @if (view !== 'chat') {
                  <span
                    class="ml-0.5 rounded-full hover:bg-base-content/20 p-0.5 cursor-pointer"
                    title="Close"
                    (click)="closeViewTab(view, $event)"
                  >
                    <lucide-angular [img]="XIcon" class="w-2.5 h-2.5" />
                  </span>
                }
              </button>
            }
          </div>
        }

        <!-- Spacer (right) -->
        <div class="flex-1"></div>

        <!-- Global actions — notifications + theme only (navigation moved to pills) -->
        <div class="flex items-center gap-0.5 no-drag">
          <!-- Notification bell (only when licensed) -->
          @if (appState.isLicensed()) {
            @if (chatStore.licenseStatus(); as license) {
              <ptah-notification-bell
                [trialActive]="license.trialActive"
                [trialDaysRemaining]="license.trialDaysRemaining"
                [isCommunity]="license.isCommunity"
                [reason]="license.reason"
              />
            }
          }

          <!-- Theme toggle (always available) -->
          <ptah-theme-toggle />
        </div>
      </div>

      <!-- Content: License gate → Workspace gate → 3-panel layout -->
      <!-- Gate 1: License check — split-screen layout (form left, hero right) -->
      @if (!appState.isLicensed()) {
        <div class="flex flex-1 overflow-hidden">
          <!-- Left Panel: Auth/License form -->
          <div class="w-1/2 overflow-y-auto bg-base-100 relative">
            <!-- Subtle gradient bleed from right panel -->
            <div
              class="absolute inset-0 bg-gradient-to-r from-transparent to-[#d4af37]/[0.02] pointer-events-none"
            ></div>
            <ptah-auth-welcome class="relative z-10" />
          </div>

          <!-- Right Panel: Branded hero with temple background + feature list -->
          <div class="w-1/2 relative overflow-hidden">
            <!-- Temple background image -->
            <div
              class="absolute inset-0 bg-cover bg-center bg-no-repeat scale-110"
              style="background-image: url('./images/temple-bg.png');"
            ></div>

            <!-- Gradient overlays for depth and blending -->
            <div
              class="absolute inset-0 bg-gradient-to-l from-transparent via-base-100/30 to-base-100"
            ></div>
            <div
              class="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-base-100/80 to-transparent"
            ></div>
            <div
              class="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-base-100/40 to-transparent"
            ></div>

            <!-- Floating particles -->
            <div class="hero-particle hero-particle-1"></div>
            <div class="hero-particle hero-particle-2"></div>
            <div class="hero-particle hero-particle-3"></div>

            <!-- Centered feature list -->
            <div
              class="absolute inset-0 flex flex-col items-center justify-center px-10 z-10"
            >
              <div class="flex flex-col gap-3 w-full max-w-sm">
                <!-- Feature: AI-Powered Assistance -->
                <div
                  class="bg-base-200/60 backdrop-blur-xl border border-[#d4af37]/10 rounded-xl p-4 shadow-lg hero-card-float"
                >
                  <div class="flex items-start gap-3">
                    <lucide-angular
                      [img]="BotIcon"
                      class="w-5 h-5 text-[#d4af37] flex-shrink-0 mt-0.5"
                    />
                    <div class="text-left">
                      <h3 class="font-semibold text-sm text-base-content">
                        AI-Powered Assistance
                      </h3>
                      <p class="text-xs text-base-content/60">
                        Get intelligent code suggestions and explanations
                      </p>
                    </div>
                  </div>
                </div>

                <!-- Feature: Multi-Agent Orchestration -->
                <div
                  class="bg-base-200/60 backdrop-blur-xl border border-[#d4af37]/10 rounded-xl p-4 shadow-lg hero-card-float"
                  style="animation-delay: -1s;"
                >
                  <div class="flex items-start gap-3">
                    <lucide-angular
                      [img]="GitBranchIcon"
                      class="w-5 h-5 text-[#d4af37] flex-shrink-0 mt-0.5"
                    />
                    <div class="text-left">
                      <h3 class="font-semibold text-sm text-base-content">
                        Multi-Agent Orchestration
                      </h3>
                      <p class="text-xs text-base-content/60">
                        Coordinate specialized agents for complex tasks
                      </p>
                    </div>
                  </div>
                </div>

                <!-- Feature: VS Code Native Integration -->
                <div
                  class="bg-base-200/60 backdrop-blur-xl border border-[#d4af37]/10 rounded-xl p-4 shadow-lg hero-card-float"
                  style="animation-delay: -2s;"
                >
                  <div class="flex items-start gap-3">
                    <lucide-angular
                      [img]="ZapIcon"
                      class="w-5 h-5 text-[#d4af37] flex-shrink-0 mt-0.5"
                    />
                    <div class="text-left">
                      <h3 class="font-semibold text-sm text-base-content">
                        VS Code Native Integration
                      </h3>
                      <p class="text-xs text-base-content/60">
                        Seamless integration with your development workflow
                      </p>
                    </div>
                  </div>
                </div>

                <!-- Feature: Session Continuity -->
                <div
                  class="bg-base-200/60 backdrop-blur-xl border border-[#d4af37]/10 rounded-xl p-4 shadow-lg hero-card-float"
                  style="animation-delay: -3s;"
                >
                  <div class="flex items-start gap-3">
                    <lucide-angular
                      [img]="SparklesIcon"
                      class="w-5 h-5 text-[#d4af37] flex-shrink-0 mt-0.5"
                    />
                    <div class="text-left">
                      <h3 class="font-semibold text-sm text-base-content">
                        Session Continuity
                      </h3>
                      <p class="text-xs text-base-content/60">
                        Resume conversations and maintain context across
                        sessions
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Bottom card: Agentic Harness -->
            <div
              class="absolute bottom-16 left-8 right-8 hero-card-float-delayed z-10"
            >
              <div
                class="bg-base-200/80 backdrop-blur-xl border border-[#d4af37]/20 rounded-2xl p-5 shadow-2xl"
              >
                <div class="flex items-start gap-4">
                  <div
                    class="w-10 h-10 rounded-xl bg-[#d4af37]/15 flex items-center justify-center flex-shrink-0 hero-glow"
                  >
                    <lucide-angular
                      [img]="ZapIcon"
                      class="w-5 h-5 text-[#d4af37]"
                    />
                  </div>
                  <div class="text-left">
                    <h3 class="font-semibold text-base-content text-sm">
                      Agentic Harness for VS Code
                    </h3>
                    <p class="text-xs text-base-content/60 mt-0.5">
                      Unifies OpenAI, Claude, and GitHub Copilot into one
                      seamless orchestration workflow.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      }
      <!-- Gate 2: Workspace check (need a folder open to use the app) -->
      @else if (!layout.hasWorkspaceFolders()) {
        <ptah-electron-welcome class="flex-1" />
      }
      <!-- Gate 3: Fully licensed with workspace — show main app -->
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
  protected readonly chatStore = inject(ChatStore);
  private readonly vscodeService = inject(VSCodeService);
  protected readonly appState = inject(AppStateManager);

  /** Lazily loaded EditorPanelComponent — keeps xterm/monaco out of the initial bundle. */
  readonly editorComponent = signal<Type<unknown> | null>(null);

  constructor() {
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

  // Icons
  readonly SettingsIcon = Settings;
  readonly BarChart3Icon = BarChart3;
  readonly ZapIcon = Zap;
  readonly BotIcon = Bot;
  readonly ShieldIcon = Shield;
  readonly GitBranchIcon = GitBranch;
  readonly SparklesIcon = Sparkles;
  readonly XIcon = X;
  readonly MessageSquareIcon = MessageSquare;
  readonly Wand2Icon = Wand2;
  readonly LayoutGridIcon = LayoutGrid;

  // Asset URIs
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  // Platform detection from Electron main process (reliable, not deprecated)
  readonly isMac = this.vscodeService.config().platform === 'darwin';

  /** Map view types to display metadata for tab pills */
  protected getViewMeta(view: ViewType): {
    label: string;
    icon: LucideIconData;
  } {
    switch (view) {
      case 'chat':
        return { label: 'Chat', icon: MessageSquare };
      case 'settings':
        return { label: 'Settings', icon: Settings };
      case 'analytics':
        return { label: 'Dashboard', icon: BarChart3 };
      case 'setup-wizard':
        return { label: 'Setup', icon: Wand2 };
      // Kept for backward compat: users may have 'orchestra-canvas' persisted in _openViews.
      // AppStateManager.handleViewSwitch() maps it to layoutMode('grid') + chat view,
      // but the pill still needs a label/icon if it appears in the tab bar.
      case 'orchestra-canvas':
        return { label: 'Canvas', icon: LayoutGrid };
      default:
        return { label: view, icon: MessageSquare };
    }
  }

  closeViewTab(view: ViewType, event: Event): void {
    event.stopPropagation();
    this.appState.closeView(view);
  }

  openSettings(): void {
    this.appState.openView('settings');
  }

  openDashboard(): void {
    this.appState.openView('analytics');
  }
}
