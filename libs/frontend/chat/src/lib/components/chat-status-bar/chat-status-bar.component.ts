import { CommonModule } from '@angular/common';
import {
  Component,
  input,
  ChangeDetectionStrategy,
  computed,
} from '@angular/core';

/**
 * Chat Status Metrics - System and performance information
 */
export interface ChatStatusMetrics {
  readonly systemStatus:
    | 'operational'
    | 'error'
    | 'recovering'
    | 'disconnected';
  readonly responseTime: string;
  readonly memoryUsage: string;
  readonly successRate: string;
  readonly isConnected: boolean;
}

/**
 * Chat Status Bar Component - System Status & Performance Metrics
 *
 * **Responsibilities**:
 * - Display system operational status with visual indicators
 * - Show performance metrics (response time, memory usage, success rate)
 * - Display connection status with color-coded indicator
 *
 * **Modernizations Applied**:
 * - `@Input()` → `input.required()` for metrics
 * - `computed()` for derived status text
 * - Modern control flow (`@if/@else`) for conditional rendering
 * - Pure presentation component (no business logic)
 * - OnPush change detection enforced
 * - VS Code theme integration with CSS custom properties
 *
 * **Before**: Used decorator-based inputs
 * **After**: Signal-based API with computed display text
 *
 * @example
 * ```html
 * <ptah-chat-status-bar
 *   [metrics]="{
 *     systemStatus: 'operational',
 *     responseTime: '120ms',
 *     memoryUsage: '45MB',
 *     successRate: '98%',
 *     isConnected: true
 *   }"
 * />
 * ```
 */
@Component({
  selector: 'ptah-chat-status-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="status-bar">
      <!-- System Status -->
      <span class="status-item">
        @if (metrics().systemStatus === 'operational') {
        <span class="status-icon">✅</span>
        <span class="status-text">System Operational</span>
        } @else {
        <span class="status-icon">⚠️</span>
        <span class="status-text">{{ statusText() }}</span>
        }
      </span>

      <!-- Performance Metrics -->
      <span class="status-item">
        <span class="status-icon">⏱️</span>
        <span class="status-text">{{ metrics().responseTime }}</span>
      </span>

      <span class="status-item">
        <span class="status-icon">⚡</span>
        <span class="status-text">{{ metrics().memoryUsage }}</span>
      </span>

      <span class="status-item">
        <span class="status-icon">📊</span>
        <span class="status-text">{{ metrics().successRate }}</span>
      </span>

      <!-- Connection Status -->
      <span class="status-item">
        @if (metrics().isConnected) {
        <span class="status-indicator status-connected"></span>
        <span class="status-text">Connected</span>
        } @else {
        <span class="status-indicator status-disconnected"></span>
        <span class="status-text">Disconnected</span>
        }
      </span>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .status-bar {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding: 4px 12px;
        background-color: var(--vscode-statusBar-background);
        border-top: 1px solid
          var(--vscode-statusBar-border, var(--vscode-panel-border));
        font-size: 11px;
        line-height: 1.4;
        flex-shrink: 0;
        gap: 2px;
      }

      .status-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 6px;
        color: var(--vscode-statusBar-foreground);
        white-space: nowrap;
        border-right: 1px solid var(--vscode-statusBar-border, transparent);
      }

      .status-item:last-child {
        border-right: none;
      }

      .status-icon {
        display: inline-flex;
        align-items: center;
        font-size: 10px;
      }

      .status-text {
        font-size: 11px;
        font-weight: 400;
      }

      .status-indicator {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }

      .status-connected {
        background-color: var(--vscode-charts-green);
      }

      .status-disconnected {
        background-color: var(--vscode-charts-red);
      }
    `,
  ],
})
export class ChatStatusBarComponent {
  // Signal-based inputs (modern Angular 20+ API)
  readonly metrics = input.required<ChatStatusMetrics>();

  // Computed display text for system status
  readonly statusText = computed(() => {
    const status = this.metrics().systemStatus;
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
  });
}
