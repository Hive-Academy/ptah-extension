import {
  Component,
  input,
  output,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgentTreeNode } from '@ptah-extension/core';
import { formatDuration } from '@ptah-extension/shared-ui';

/**
 * Agent Status Badge Component - Compact Active Agent Indicator
 *
 * **Responsibilities**:
 * - Display active agent count in chat header (120px × 24px fixed size)
 * - Pulsing animation when agents are active (2s loop, opacity 0.7 ↔ 1.0)
 * - Tooltip on hover showing agent list (300ms delay)
 * - Error indicator (🔴) when agents have errors
 * - Click handler to toggle agent panel visibility
 *
 * **Modernizations Applied**:
 * - Signal-based inputs (`input()`) and outputs (`output<void>()`)
 * - Computed signals for derived state (agentCount, badgeState, tooltipText)
 * - Modern control flow (`@if/@else`) for conditional rendering
 * - OnPush change detection for optimal performance
 * - Pure presentation component (no business logic)
 * - 100% VS Code CSS variables (no hardcoded colors)
 *
 * **Accessibility**:
 * - ARIA role="button" for screen readers
 * - ARIA label with current agent count
 * - Keyboard support (Enter/Space for click)
 * - Focus indicators (2px solid focusBorder)
 * - Reduced motion support
 *
 * **Badge States**:
 * - 'no-agents': Gray background, no animation (0 agents)
 * - 'active': Blue background, pulsing animation (1+ agents, no errors)
 * - 'error': Gray background, red text, no animation (agents with errors)
 *
 * @example
 * ```html
 * <ptah-agent-status-badge
 *   [activeAgents]="chatService.activeAgents()"
 *   (togglePanel)="onToggleAgentPanel()"
 * />
 * ```
 */
@Component({
  selector: 'ptah-agent-status-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './agent-status-badge.component.html',
  styleUrls: ['./agent-status-badge.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentStatusBadgeComponent {
  // Expose imported utility function for template access
  readonly formatDuration = formatDuration;

  // Signal inputs
  readonly activeAgents = input<readonly AgentTreeNode[]>([]);

  // Signal outputs
  readonly togglePanel = output<void>();

  // Internal state - tooltip visibility
  private readonly _showTooltip = signal(false);
  readonly showTooltip = this._showTooltip.asReadonly();

  private tooltipTimeout: ReturnType<typeof setTimeout> | null = null;

  // Computed signals
  readonly agentCount = computed(() => this.activeAgents().length);

  readonly badgeState = computed((): 'no-agents' | 'active' | 'error' => {
    const agents = this.activeAgents();
    if (agents.length === 0) {
      return 'no-agents';
    }
    const hasErrors = agents.some((node) => node.status === 'error');
    return hasErrors ? 'error' : 'active';
  });

  readonly badgeText = computed(() => {
    const count = this.agentCount();
    if (count === 0) {
      return '🤖 No agents';
    } else if (count === 1) {
      return '🤖 1 agent';
    } else {
      return `🤖 ${count} agents`;
    }
  });

  readonly hasErrors = computed(() => this.badgeState() === 'error');

  readonly ariaLabel = computed(() => {
    const count = this.agentCount();
    const state = this.badgeState();
    if (count === 0) {
      return 'No active agents. Click to toggle agent panel.';
    }
    const errorText = state === 'error' ? ' with errors' : '';
    return `${count} active agent${
      count > 1 ? 's' : ''
    }${errorText}. Click to toggle agent panel.`;
  });

  readonly tooltipText = computed(() => {
    const agents = this.activeAgents();
    if (agents.length === 0) {
      return 'No active agents';
    }

    const header = 'Active Agents:';
    const items = agents.map((node) => {
      const type = node.agent.subagentType;
      const duration = node.duration
        ? formatDuration(node.duration)
        : this.getRunningDuration(node.agent.startTime);
      const status = node.status === 'error' ? ' (error)' : '';
      return `• ${type} (${duration})${status}`;
    });

    return [header, ...items].join('\n');
  });

  // Event handlers
  onClick(): void {
    this.togglePanel.emit();
  }

  onMouseEnter(): void {
    // Delay tooltip display by 300ms
    this.tooltipTimeout = setTimeout(() => {
      this._showTooltip.set(true);
    }, 300);
  }

  onMouseLeave(): void {
    // Cancel pending tooltip
    if (this.tooltipTimeout) {
      clearTimeout(this.tooltipTimeout);
      this.tooltipTimeout = null;
    }
    this._showTooltip.set(false);
  }

  // Helper methods (public for template access)
  getRunningDuration(startTimestamp: number): string {
    const now = Date.now();
    const elapsed = now - startTimestamp;
    return formatDuration(elapsed);
  }
}
