import { Component, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, PlusIcon, BarChart3Icon } from 'lucide-angular';
import { AppStateManager } from '../../core/services/app-state.service';
import { VSCodeService } from '../../core/services/vscode.service';
import { VSCodeActionButtonComponent } from '../../dumb-components/inputs/action-button.component';

/**
 * Smart Header Component
 * - Manages navigation state via AppStateManager
 * - Pure VS Code styling
 * - No Tailwind or Egyptian theming
 */
@Component({
  selector: 'vscode-simple-header',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, VSCodeActionButtonComponent],
  template: `
    <header class="vscode-header">
      <!-- Left Side: Ptah Icon as Home Button -->
      <div class="vscode-header-left">
        <button class="vscode-header-logo-button" (click)="onHome()" title="Back to Chat">
          <img [src]="ptahIconUri" alt="Ptah" class="vscode-header-logo" />
        </button>
      </div>

      <!-- Right Side: Actions -->
      <div class="vscode-header-right">
        <vscode-action-button
          [icon]="PlusIcon"
          [ariaLabel]="'New Session'"
          variant="secondary"
          (buttonClick)="onNewSession()"
        ></vscode-action-button>

        <vscode-action-button
          [icon]="BarChart3Icon"
          [ariaLabel]="'Analytics'"
          [variant]="appState.currentView() === 'analytics' ? 'primary' : 'secondary'"
          (buttonClick)="onAnalytics()"
        ></vscode-action-button>
      </div>
    </header>
  `,
  styles: [
    `
      .vscode-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background-color: var(--vscode-editor-background);
        border-bottom: 1px solid var(--vscode-widget-border);
        min-height: 48px;
      }

      .vscode-header-left {
        display: flex;
        align-items: center;
      }

      .vscode-header-right {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .vscode-header-logo-button {
        width: 56px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.15s ease;
      }

      .vscode-header-logo-button:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .vscode-header-logo-button:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .vscode-header-logo {
        width: 48px;
        height: 48px;
        border-radius: 4px;
      }
    `,
  ],
})
export class VSCodeSimpleHeaderComponent {
  // Lucide Icons
  readonly PlusIcon = PlusIcon;
  readonly BarChart3Icon = BarChart3Icon;

  // Services
  readonly appState = inject(AppStateManager);
  readonly vscode = inject(VSCodeService);

  // Get proper webview URI for the Ptah icon
  readonly ptahIconUri = this.vscode.getPtahIconUri();

  @Output() newSession = new EventEmitter<void>();
  @Output() analytics = new EventEmitter<void>();

  onHome(): void {
    // Always navigate to chat when Ptah icon is clicked
    this.appState.setCurrentView('chat');
  }

  onNewSession(): void {
    // Navigate to chat and emit new session event
    this.appState.setCurrentView('chat');
    this.newSession.emit();
  }

  onAnalytics(): void {
    // Toggle between analytics and chat views
    if (this.appState.currentView() === 'analytics') {
      this.appState.setCurrentView('chat');
    } else {
      this.appState.setCurrentView('analytics');
    }
    this.analytics.emit();
  }
}
