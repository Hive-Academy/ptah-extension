import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WorkspaceInfo } from '@ptah-extension/shared';

/**
 * Status Bar Component - Angular 20+ Modernized
 * - Signal-based APIs (input(), computed())
 * - OnPush change detection
 * - Pure presentation component
 * - Responsive with accessibility support
 */
@Component({
  selector: 'ptah-status-bar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="vscode-status-bar">
      <div class="vscode-status-content">
        <!-- Connection Status -->
        <div class="vscode-status-section">
          <span
            class="vscode-status-indicator"
            [class.vscode-status-connected]="isConnected()"
            [class.vscode-status-disconnected]="!isConnected()"
            [attr.aria-label]="isConnected() ? 'Connected' : 'Disconnected'"
          ></span>
          <span class="vscode-status-message">{{ statusMessage() }}</span>
        </div>

        <!-- Workspace Information -->
        <div class="vscode-workspace-section">
          @if (workspaceInfo()) {
            <span class="vscode-workspace-info">
              <span class="vscode-workspace-icon" aria-hidden="true">📁</span>
              <span class="vscode-workspace-name">{{ workspaceInfo()!.name }}</span>
            </span>
          }

          @if (projectType()) {
            <span class="vscode-project-badge" [attr.aria-label]="'Project type: ' + projectType()">
              {{ projectType() }}
            </span>
          }

          <!-- Additional Content Slot -->
          <ng-content></ng-content>
        </div>
      </div>
    </footer>
  `,
  styles: [
    `
      .vscode-status-bar {
        height: 32px;
        padding: 0 16px;
        background-color: var(--vscode-statusBar-background);
        border-top: 1px solid var(--vscode-statusBar-border);
        color: var(--vscode-statusBar-foreground);
        font-size: 12px;
        font-family: var(--vscode-font-family);
        flex-shrink: 0;
        display: flex;
        align-items: center;
      }

      .vscode-status-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        height: 100%;
        gap: 16px;
      }

      .vscode-status-section {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .vscode-status-indicator {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
      }

      .vscode-status-connected {
        background-color: var(--vscode-charts-green);
        animation: vscode-pulse 2s infinite;
      }

      .vscode-status-disconnected {
        background-color: var(--vscode-charts-red);
      }

      @keyframes vscode-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.6;
        }
      }

      .vscode-status-message {
        color: var(--vscode-statusBar-foreground);
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vscode-workspace-section {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .vscode-workspace-info {
        display: flex;
        align-items: center;
        gap: 4px;
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--vscode-statusBar-foreground);
      }

      .vscode-workspace-icon {
        font-size: 12px;
        line-height: 1;
        flex-shrink: 0;
      }

      .vscode-workspace-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .vscode-project-badge {
        padding: 2px 6px;
        background-color: var(--vscode-statusBarItem-hoverBackground);
        color: var(--vscode-statusBar-foreground);
        border-radius: 3px;
        font-size: 11px;
        font-weight: 500;
        min-height: 20px;
        display: flex;
        align-items: center;
        cursor: default;
      }

      .vscode-project-badge:hover {
        background-color: var(--vscode-statusBarItem-activeBackground);
      }

      /* Responsive Design for Mobile Webviews */
      @media (max-width: 480px) {
        .vscode-status-content {
          gap: 8px;
        }

        .vscode-workspace-section {
          gap: 8px;
        }

        .vscode-workspace-info {
          max-width: 100px;
        }

        .vscode-status-message {
          max-width: 120px;
        }
      }

      /* Accessibility - Reduced Motion */
      @media (prefers-reduced-motion: reduce) {
        .vscode-status-connected {
          animation: none;
        }
      }

      /* High Contrast Mode Support */
      @media (prefers-contrast: high) {
        .vscode-status-bar {
          border-top-width: 2px;
        }

        .vscode-status-indicator {
          border: 1px solid var(--vscode-contrastBorder);
        }
      }
    `,
  ],
})
export class StatusBarComponent {
  // Signal-based inputs (Angular 20+)
  statusMessage = input<string>('Ready');
  isConnected = input<boolean>(false);
  workspaceInfo = input<WorkspaceInfo | null>(null);

  // Computed signal for project type (Angular 20+)
  projectType = computed(() => this.workspaceInfo()?.type || null);
}
