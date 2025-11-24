import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  ChevronRight,
  ChevronDown,
  AlertCircle,
} from 'lucide-angular';
import type { AgentTreeNode } from '@ptah-extension/core';
import type { ClaudeToolEvent } from '@ptah-extension/shared';
import { formatDuration } from '@ptah-extension/shared-ui';

/**
 * Agent Tree Component - Collapsible Tree Visualization
 *
 * **Purpose**: Displays active/completed subagents with tool activity logs
 *
 * **Responsibilities**:
 * - Render agent nodes with expand/collapse state
 * - Display agent metadata (type, duration, status)
 * - Show tool activity lines when expanded
 * - Handle keyboard navigation (Tab, Enter, Space, Arrow keys)
 * - Provide WCAG-compliant accessibility
 *
 * **Modernizations Applied**:
 * - Standalone component (no NgModules)
 * - OnPush change detection (performance optimization)
 * - Signal-based inputs (input.required())
 * - Signal state management (expandedAgents signal)
 * - Computed signals for formatting helpers
 * - 100% VS Code CSS variables (no hardcoded colors)
 * - lucide-angular icons (ChevronRight, ChevronDown)
 *
 * **Complexity Assessment**:
 * - Level: 2 (Medium - some state, composition)
 * - Patterns: Standalone, signals, composition
 * - Rejected: Container/Presentational (YAGNI)
 *
 * @example
 * ```html
 * <ptah-agent-tree
 *   [agents]="chatService.agents()"
 * />
 * ```
 */
@Component({
  selector: 'ptah-agent-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './agent-tree.component.html',
  styleUrls: ['./agent-tree.component.css'],
})
export class AgentTreeComponent {
  // Lucide icons
  readonly ChevronRightIcon = ChevronRight;
  readonly ChevronDownIcon = ChevronDown;
  readonly AlertCircleIcon = AlertCircle;

  // Expose imported utility function for template access
  readonly formatDuration = formatDuration;

  // Signal inputs (modern Angular 20+ API)
  readonly agents = input<readonly AgentTreeNode[]>([]);

  // Expanded state tracking (private writable signal)
  private readonly _expandedAgents = signal<Set<string>>(new Set());

  // Readonly signal for template access
  readonly expandedAgents = this._expandedAgents.asReadonly();

  /**
   * Toggle agent node expansion
   * @param agentId - Agent ID to toggle
   */
  toggleExpanded(agentId: string): void {
    this._expandedAgents.update((expanded) => {
      const newSet = new Set(expanded);
      if (newSet.has(agentId)) {
        newSet.delete(agentId);
      } else {
        newSet.add(agentId);
      }
      return newSet;
    });
  }

  /**
   * Check if agent node is expanded
   * @param agentId - Agent ID to check
   */
  isExpanded(agentId: string): boolean {
    return this.expandedAgents().has(agentId);
  }

  /**
   * Get activity text for display (safe for all ClaudeToolEvent types)
   * @param activity - ClaudeToolEvent
   * @returns Formatted activity string
   */
  getActivityText(activity: ClaudeToolEvent): string {
    // Only ClaudeToolEventStart has 'tool' and 'args' properties
    if (activity.type === 'start') {
      const args = activity.args as Record<string, unknown>;
      const inputStr = JSON.stringify(args);
      const truncated =
        inputStr.length > 60 ? inputStr.slice(0, 60) + '...' : inputStr;
      return `${activity.tool}: ${truncated}`;
    }

    // For other event types, show type and toolCallId
    return `[${activity.type}] ${activity.toolCallId}`;
  }

  /**
   * Get activity tooltip (safe for all ClaudeToolEvent types)
   * @param activity - ClaudeToolEvent
   * @returns Full JSON string for tooltip
   */
  getActivityTooltip(activity: ClaudeToolEvent): string {
    if (activity.type === 'start') {
      return this.stringify(activity.args);
    }
    return this.stringify(activity);
  }

  /**
   * Handle keyboard navigation for agent nodes
   * @param event - Keyboard event
   * @param agentId - Agent ID for the focused node
   */
  handleKeydown(event: KeyboardEvent, agentId: string): void {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.toggleExpanded(agentId);
        break;
      case 'ArrowRight':
        if (!this.isExpanded(agentId)) {
          event.preventDefault();
          this.toggleExpanded(agentId);
        }
        break;
      case 'ArrowLeft':
        if (this.isExpanded(agentId)) {
          event.preventDefault();
          this.toggleExpanded(agentId);
        }
        break;
      // ArrowDown and ArrowUp are handled by browser's native focus management
    }
  }

  /**
   * JSON.stringify helper for template
   * @param value - Value to stringify
   */
  stringify(value: unknown): string {
    return JSON.stringify(value);
  }
}
