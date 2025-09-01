import { CommonModule } from '@angular/common';
import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

export interface ChatStatusMetrics {
  systemStatus: 'operational' | 'error' | 'recovering' | 'disconnected';
  responseTime: string;
  memoryUsage: string;
  successRate: string;
  isConnected: boolean;
}

/**
 * Chat Status Bar Component - Pure Status Display
 * Displays system performance metrics and connection status
 * No business logic, only presentation
 */
@Component({
  selector: 'vscode-chat-status-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="vscode-unified-status-bar">
      <!-- System Status -->
      <span class="vscode-status-item">
        @if (metrics.systemStatus === 'operational') {
          <span class="vscode-status-icon">✅</span>
          <span class="vscode-status-text">System Operational</span>
        } @else {
          <span class="vscode-status-icon">⚠️</span>
          <span class="vscode-status-text">{{ getStatusText(metrics.systemStatus) }}</span>
        }
      </span>

      <!-- Performance Metrics -->
      <span class="vscode-status-item">
        <span class="vscode-status-text">{{ metrics.responseTime }}</span>
      </span>

      <span class="vscode-status-item">
        <span class="vscode-status-icon">⚡</span>
        <span class="vscode-status-text">{{ metrics.memoryUsage }}</span>
      </span>

      <span class="vscode-status-item">
        <span class="vscode-status-text">{{ metrics.successRate }}</span>
      </span>

      <!-- Connection Status -->
      <span class="vscode-status-item">
        @if (metrics.isConnected) {
          <span class="vscode-status-indicator vscode-status-connected"></span>
          <span class="vscode-status-text">Connected</span>
        } @else {
          <span class="vscode-status-indicator vscode-status-disconnected"></span>
          <span class="vscode-status-text">Disconnected</span>
        }
      </span>
    </div>
  `,
  styles: [
    `
      .vscode-unified-status-bar {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding: 4px 12px;
        background-color: var(--vscode-statusBar-background);
        border-top: 1px solid var(--vscode-statusBar-border, var(--vscode-panel-border));
        font-size: 11px;
        line-height: 1.4;
        flex-shrink: 0;
        gap: 2px;
      }

      .vscode-status-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        color: var(--vscode-statusBar-foreground);
        white-space: nowrap;
        border-right: 1px solid var(--vscode-statusBar-border, transparent);
      }

      .vscode-status-item:last-child {
        border-right: none;
      }

      .vscode-status-icon {
        display: inline-flex;
        align-items: center;
        font-size: 10px;
      }

      .vscode-status-text {
        font-size: 11px;
        font-weight: 400;
      }

      .vscode-status-indicator {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }

      .vscode-status-connected {
        background-color: var(--vscode-charts-green);
      }

      .vscode-status-disconnected {
        background-color: var(--vscode-charts-red);
      }
    `,
  ],
})
export class VSCodeChatStatusBarComponent {
  @Input({ required: true }) metrics!: ChatStatusMetrics;

  getStatusText(status: string): string {
    switch (status) {
      case 'error':
        return 'System Error';
      case 'recovering':
        return 'Recovering';
      case 'disconnected':
        return 'Disconnected';
      default:
        return status;
    }
  }
}
