/**
 * Electron Shell Component
 *
 * Top-level layout for the Electron desktop application.
 * When no workspace is open, shows the welcome/onboarding page.
 * When a workspace is open, composes a global navbar + 3-panel layout:
 *   - Global navbar: Logo, theme toggle, notifications, settings, editor toggle
 *   - Workspace sidebar (left) — folder list
 *   - Chat panel (center) — reuses AppShellComponent entirely
 *   - Editor panel (right, toggleable) — Monaco editor + file tree
 *
 * Resizable dividers between panels. macOS title bar drag region on navbar.
 */

import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import {
  LucideAngularModule,
  PanelRight,
  PanelRightClose,
  Settings,
} from 'lucide-angular';
import {
  ElectronLayoutService,
  VSCodeService,
  AppStateManager,
} from '@ptah-extension/core';
import { ChatStore } from '../../services/chat.store';
import { AppShellComponent } from './app-shell.component';
import { ElectronWelcomeComponent } from './electron-welcome.component';
import { WorkspaceSidebarComponent } from '../organisms/workspace-sidebar.component';
import { ElectronResizeHandleComponent } from '../atoms/electron-resize-handle.component';
import { EditorPanelPlaceholderComponent } from '../organisms/editor-panel-placeholder.component';
import { ThemeToggleComponent } from '../atoms/theme-toggle.component';
import { NotificationBellComponent } from '../molecules/notifications/notification-bell.component';

@Component({
  selector: 'ptah-electron-shell',
  standalone: true,
  imports: [
    AppShellComponent,
    ElectronWelcomeComponent,
    WorkspaceSidebarComponent,
    ElectronResizeHandleComponent,
    EditorPanelPlaceholderComponent,
    ThemeToggleComponent,
    NotificationBellComponent,
    LucideAngularModule,
    NgOptimizedImage,
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
            [ngSrc]="ptahIconUri"
            alt="Ptah"
            class="w-5 h-5 flex-shrink-0"
            width="20"
            height="20"
          />
          <span class="text-sm font-semibold text-base-content/70 select-none"
            >Ptah</span
          >
        </div>

        <!-- Spacer -->
        <div class="flex-1"></div>

        <!-- Global actions (no-drag so buttons are clickable on macOS) -->
        <div class="flex items-center gap-0.5 no-drag">
          <!-- Notification bell -->
          @if (chatStore.licenseStatus(); as license) {
          <ptah-notification-bell
            [trialActive]="license.trialActive"
            [trialDaysRemaining]="license.trialDaysRemaining"
            [isCommunity]="license.isCommunity"
            [reason]="license.reason"
          />
          }

          <!-- Theme toggle -->
          <ptah-theme-toggle />

          <!-- Settings -->
          <button
            class="btn btn-square btn-ghost btn-xs"
            aria-label="Settings"
            title="Settings"
            (click)="openSettings()"
          >
            <lucide-angular [img]="SettingsIcon" class="w-3.5 h-3.5" />
          </button>

          <!-- Editor panel toggle (only when workspace is open) -->
          @if (layout.hasWorkspaceFolders()) {
          <div class="w-px h-4 bg-base-content/10 mx-0.5"></div>
          <button
            class="btn btn-square btn-ghost btn-xs"
            [title]="
              layout.editorPanelVisible()
                ? 'Hide editor panel'
                : 'Show editor panel'
            "
            aria-label="Toggle editor panel"
            (click)="layout.toggleEditorPanel()"
          >
            <lucide-angular
              [img]="
                layout.editorPanelVisible()
                  ? PanelRightCloseIcon
                  : PanelRightIcon
              "
              class="w-3.5 h-3.5"
            />
          </button>
          }
        </div>
      </div>

      <!-- Content: Welcome page or 3-panel layout -->
      @if (layout.hasWorkspaceFolders()) {
      <!-- 3-Panel Content Area -->
      <div class="flex flex-1 overflow-hidden">
        <!-- Workspace sidebar -->
        <ptah-workspace-sidebar [width]="layout.workspaceSidebarWidth()" />

        <!-- Resize handle: sidebar ↔ chat -->
        <ptah-electron-resize-handle
          [direction]="'left'"
          (dragStarted)="layout.setSidebarDragging(true)"
          (dragMoved)="layout.setWorkspaceSidebarWidth($event)"
          (dragEnded)="layout.setSidebarDragging(false)"
        />

        <!-- Chat panel (reuses entire AppShellComponent) -->
        <div class="flex-1 min-w-[400px] overflow-hidden">
          <ptah-app-shell class="h-full w-full" />
        </div>

        <!-- Editor panel (toggleable) -->
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
          <ptah-editor-panel-placeholder />
        </div>
        }
      </div>
      } @else {
      <!-- No workspace open — show welcome/onboarding -->
      <ptah-electron-welcome class="flex-1" />
      }
    </div>
  `,
})
export class ElectronShellComponent {
  protected readonly layout = inject(ElectronLayoutService);
  protected readonly chatStore = inject(ChatStore);
  private readonly vscodeService = inject(VSCodeService);
  private readonly appState = inject(AppStateManager);

  // Icons
  readonly PanelRightIcon = PanelRight;
  readonly PanelRightCloseIcon = PanelRightClose;
  readonly SettingsIcon = Settings;

  // Asset URIs
  readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  // Platform detection from Electron main process (reliable, not deprecated)
  readonly isMac = this.vscodeService.config().platform === 'darwin';

  openSettings(): void {
    this.appState.setCurrentView('settings');
  }
}
