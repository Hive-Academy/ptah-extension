import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, PlusIcon, BarChart3Icon } from 'lucide-angular';

/**
 * Simple Header Component - Angular 20+ Modernized
 * - Signal-based APIs (input(), output())
 * - OnPush change detection
 * - Pure presentation component (no service dependencies)
 * - All state and navigation managed by parent component
 */
@Component({
  selector: 'ptah-simple-header',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="vscode-header">
      <!-- Left Side: Ptah Icon as Home Button -->
      <div class="vscode-header-left">
        <button class="vscode-header-logo-button" (click)="homeClick.emit()" title="Back to Chat">
          <img [src]="ptahIconUri()" alt="Ptah" class="vscode-header-logo" />
        </button>
      </div>

      <!-- Right Side: Actions -->
      <div class="vscode-header-right">
        <button
          class="vscode-header-action"
          (click)="newSessionClick.emit()"
          [attr.aria-label]="'New Session'"
          title="New Session"
        >
          <lucide-angular [img]="PlusIcon" class="vscode-action-icon"></lucide-angular>
        </button>

        <button
          class="vscode-header-action"
          [class.vscode-action-active]="isAnalyticsView()"
          (click)="analyticsClick.emit()"
          [attr.aria-label]="'Analytics'"
          title="Analytics"
        >
          <lucide-angular [img]="BarChart3Icon" class="vscode-action-icon"></lucide-angular>
        </button>
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

      .vscode-header-action {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.15s ease;
        color: var(--vscode-foreground);
      }

      .vscode-header-action:hover {
        background-color: var(--vscode-list-hoverBackground);
      }

      .vscode-header-action:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      .vscode-header-action.vscode-action-active {
        background-color: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }

      .vscode-action-icon {
        width: 16px;
        height: 16px;
        display: flex;
      }
    `,
  ],
})
export class SimpleHeaderComponent {
  // Lucide Icons
  readonly PlusIcon = PlusIcon;
  readonly BarChart3Icon = BarChart3Icon;

  // Signal-based inputs (Angular 20+)
  ptahIconUri = input.required<string>();
  isAnalyticsView = input<boolean>(false);

  // Signal-based outputs (Angular 20+)
  homeClick = output<void>();
  newSessionClick = output<void>();
  analyticsClick = output<void>();
}
