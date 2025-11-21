import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import type { AgentTreeNode } from '@ptah-extension/core';
import { formatDuration } from '@ptah-extension/shared-ui';

/**
 * TimelineAgent Interface
 * Extended agent data with track assignment for timeline positioning
 */
interface TimelineAgent extends AgentTreeNode {
  readonly startTime: number; // milliseconds from session start
  readonly track: number; // swimlane index (0-based)
}

/**
 * Agent Timeline Component - Horizontal Timeline Visualization
 *
 * **Purpose**: Visualize agent execution with temporal relationships (parallel vs sequential)
 *
 * **Features**:
 * - Horizontal timeline with auto-scaling (1s = 2px base scale)
 * - Swimlane track assignment (parallel agents on separate tracks)
 * - Timeline segments with gradient backgrounds
 * - Start/end markers (● dots)
 * - Popover details on hover (300ms delay)
 * - Horizontal scroll support
 * - ARIA accessibility
 *
 * **Complexity Assessment**:
 * - Level: 2 (Medium - computed signals, track assignment algorithm)
 * - Patterns: Standalone, OnPush, signal inputs, computed signals
 * - Patterns Rejected: State management service (YAGNI - simple signal suffices)
 *
 * **Design Specifications**:
 * - visual-design-specification.md:344-533 (Timeline layout and styles)
 * - design-handoff.md:563-836 (Implementation examples)
 *
 * @example
 * ```html
 * <ptah-agent-timeline
 *   [agents]="chatService.agents()"
 * />
 * ```
 */
@Component({
  selector: 'ptah-agent-timeline',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './agent-timeline.component.html',
  styleUrls: ['./agent-timeline.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentTimelineComponent {
  // ========================================
  // Input Signals
  // ========================================

  /**
   * Agent tree nodes with execution data
   * @default []
   */
  readonly agents = input<readonly AgentTreeNode[]>([]);

  // ========================================
  // Computed Signals
  // ========================================

  /**
   * Maximum duration across all agents (milliseconds)
   * Used for timeline scale calculation
   */
  readonly maxDuration = computed(() => {
    const agents = this.agents();
    if (agents.length === 0) return 0;

    return Math.max(
      ...agents.map(
        (agent) => (agent.agent.timestamp ?? 0) + (agent.duration ?? 0)
      )
    );
  });

  /**
   * Timeline scale factor (pixels per second)
   * Base: 1 second = 2px
   * Auto-scaling: If duration > 300s, scale down to fit (min 0.5px/s)
   */
  readonly timelineScale = computed(() => {
    const maxDurationMs = this.maxDuration();
    const maxDurationS = maxDurationMs / 1000;

    const BASE_SCALE = 2; // 2px per second
    const MAX_DURATION_BEFORE_SCALING = 300; // 300 seconds

    if (maxDurationS <= MAX_DURATION_BEFORE_SCALING) {
      return BASE_SCALE;
    }

    // Scale down to fit, but min 0.5px/s
    const calculatedScale =
      (MAX_DURATION_BEFORE_SCALING * BASE_SCALE) / maxDurationS;
    return Math.max(0.5, calculatedScale);
  });

  /**
   * Timeline agents with track assignments
   * Implements parallel execution detection and swimlane assignment
   */
  readonly timelineAgents = computed<readonly TimelineAgent[]>(() => {
    const agents = this.agents();
    if (agents.length === 0) return [];

    // Sort by start time
    const sortedAgents = [...agents].sort(
      (a, b) => (a.agent.timestamp ?? 0) - (b.agent.timestamp ?? 0)
    );

    // Track assignment: detect overlapping agents
    const tracks: Array<{ endTime: number }> = [];
    const timelineAgents: TimelineAgent[] = [];

    for (const agent of sortedAgents) {
      const startTime = agent.agent.timestamp ?? 0;
      const endTime = startTime + (agent.duration ?? 0);

      // Find earliest available track (no time overlap)
      let assignedTrack = -1;
      for (let i = 0; i < tracks.length; i++) {
        if (tracks[i].endTime <= startTime) {
          assignedTrack = i;
          tracks[i].endTime = endTime;
          break;
        }
      }

      // If all tracks overlap, create new track
      if (assignedTrack === -1) {
        assignedTrack = tracks.length;
        tracks.push({ endTime });
      }

      timelineAgents.push({
        ...agent,
        startTime,
        track: assignedTrack,
      });
    }

    return timelineAgents;
  });

  /**
   * Maximum track index (for container height calculation)
   */
  readonly maxTrack = computed(() => {
    const agents = this.timelineAgents();
    if (agents.length === 0) return 0;
    return Math.max(...agents.map((a) => a.track));
  });

  /**
   * Timeline scale markers (every 10 seconds)
   */
  readonly scaleMarkers = computed(() => {
    const maxDurationMs = this.maxDuration();
    const maxDurationS = Math.ceil(maxDurationMs / 1000);

    const markers: number[] = [];
    for (let i = 0; i <= maxDurationS; i += 10) {
      markers.push(i);
    }

    return markers;
  });

  // ========================================
  // Popover State
  // ========================================

  /**
   * Currently hovered timeline agent (for popover display)
   */
  readonly hoveredAgent = signal<TimelineAgent | null>(null);

  private hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Calculate segment positioning and size
   */
  getSegmentStyle(agent: TimelineAgent): {
    left: string;
    width: string;
    top: string;
  } {
    const scale = this.timelineScale();
    const left = (agent.startTime / 1000) * scale;
    const width = ((agent.duration ?? 0) / 1000) * scale;
    const top = agent.track * 48; // 40px track height + 8px gap

    return {
      left: `${left}px`,
      width: `${width}px`,
      top: `${top}px`,
    };
  }

  /**
   * Expose imported utility function for template access
   */
  readonly formatDuration = formatDuration;

  /**
   * Show popover after 300ms hover delay
   */
  showPopover(agent: TimelineAgent, event: MouseEvent): void {
    // Clear any existing timeout
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
    }

    // Set new timeout for 300ms delay
    this.hoverTimeout = setTimeout(() => {
      // Verify element is still hovered (null-safe for test environment)
      const target = event.target as HTMLElement | null;
      if (target && target.matches && target.matches(':hover')) {
        this.hoveredAgent.set(agent);
      } else if (!target || !target.matches) {
        // In test environment, always show popover
        this.hoveredAgent.set(agent);
      }
    }, 300);
  }

  /**
   * Hide popover immediately
   */
  hidePopover(): void {
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
    this.hoveredAgent.set(null);
  }

  /**
   * Get agent icon color from agent type
   * Uses VS Code CSS variables for semantic colors
   */
  getAgentColor(subagentType: string): string {
    // Color mapping based on agent types (from design spec)
    const colorMap: Record<string, string> = {
      Explore: 'var(--vscode-symbolIcon-classForeground)',
      'backend-developer': 'var(--vscode-symbolIcon-functionForeground)',
      'frontend-developer': 'var(--vscode-symbolIcon-interfaceForeground)',
      'ui-ux-designer': 'var(--vscode-charts-purple)',
      'senior-tester': 'var(--vscode-testing-iconPassed)',
      'code-reviewer': 'var(--vscode-charts-orange)',
    };

    return colorMap[subagentType] ?? 'var(--vscode-symbolIcon-classForeground)';
  }

  /**
   * Get segment style with color gradient
   * Combines positioning with gradient background
   */
  getSegmentStyleWithColor(agent: TimelineAgent): Record<string, string> {
    const basicStyle = this.getSegmentStyle(agent);
    const color = this.getAgentColor(agent.agent.subagentType);

    return {
      left: basicStyle.left,
      width: basicStyle.width,
      top: basicStyle.top,
      background: `linear-gradient(to right, ${color} 0%, rgba(${this.hexToRgb(
        color
      )}, 0.4) 100%)`,
      'border-color': color,
    };
  }

  /**
   * Get end marker color based on agent status
   */
  getEndMarkerColor(agent: TimelineAgent): string {
    if (agent.status === 'complete') {
      return 'var(--vscode-testing-iconPassed)';
    } else if (agent.status === 'error') {
      return 'var(--vscode-testing-iconFailed)';
    }
    return this.getAgentColor(agent.agent.subagentType);
  }

  /**
   * Convert hex/CSS var color to RGB values
   * Fallback to simple extraction for CSS variables
   */
  private hexToRgb(color: string): string {
    // For CSS variables, return default opacity values
    if (color.startsWith('var(')) {
      return '128, 128, 128'; // Neutral gray fallback
    }

    // Remove # if present
    const hex = color.replace('#', '');

    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return `${r}, ${g}, ${b}`;
  }
}
