import {
  Component,
  input,
  signal,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { StatusBadgeComponent } from '../atoms/status-badge.component';
import { DurationBadgeComponent } from '../atoms/duration-badge.component';
import { TokenBadgeComponent } from '../atoms/token-badge.component';
import { LucideAngularModule, ChevronDown } from 'lucide-angular';
import type { ExecutionNode } from '@ptah-extension/shared';
import { NgStyle, NgClass } from '@angular/common';

/**
 * AgentCardComponent - Collapsible agent execution card with nested children
 *
 * Complexity Level: 2 (Molecule with composition)
 * Patterns: Colored agent badges (Roo Code-inspired), Recursive container
 *
 * Custom button-based toggle with chevron icon.
 * Expanded by default to show nested execution tree.
 */
@Component({
  selector: 'ptah-agent-card',
  standalone: true,
  imports: [
    StatusBadgeComponent,
    NgStyle,
    DurationBadgeComponent,
    TokenBadgeComponent,
    LucideAngularModule,
    NgClass,
  ],
  template: `
    <div
      class="card bg-base-200 shadow-card hover:shadow-card-hover transition-shadow duration-200 my-2 w-full"
    >
      <!-- Header (clickable to toggle) -->
      <button
        type="button"
        class="w-full py-3 px-3 flex items-center gap-3 hover:bg-base-300/30 transition-colors cursor-pointer rounded-t-xl"
        (click)="toggleCollapse()"
        [attr.aria-expanded]="!isCollapsed()"
        [attr.aria-controls]="'agent-content-' + node().id"
      >
        <!-- Expand/Collapse icon -->
        <lucide-angular
          [img]="ChevronIcon"
          class="w-4 h-4 flex-shrink-0 text-base-content/50 transition-transform"
          [class.rotate-0]="!isCollapsed()"
          [class.-rotate-90]="isCollapsed()"
        />

        <!-- Colored letter badge -->
        <div class="avatar placeholder">
          <div
            class="w-10 h-10 rounded-full flex items-center justify-center"
            [ngStyle]="{ 'background-color': getAgentColor() }"
          >
            <span class="text-white text-sm font-bold">
              {{ getAgentInitial() }}
            </span>
          </div>
        </div>

        <!-- Agent info -->
        <div class="flex-1 min-w-0 text-left">
          <!-- Name + Status row -->
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-sm text-base-content truncate">
              {{ node().agentType }}
            </span>

            <!-- Status badge -->
            <ptah-status-badge [status]="node().status" />
          </div>

          <!-- Metrics row -->
          <div class="flex items-center gap-2 mt-1 flex-wrap">
            @if (node().duration) {
            <ptah-duration-badge [durationMs]="node().duration!" />
            } @if (node().tokenUsage) {
            <ptah-token-badge
              [count]="node().tokenUsage!.input + node().tokenUsage!.output"
            />
            } @if (node().agentModel) {
            <span class="badge badge-outline badge-xs">
              {{ node().agentModel }}
            </span>
            }
          </div>
        </div>
      </button>

      <!-- Collapsible content (nested children) -->
      @if (!isCollapsed()) {
      <div
        class="px-3 pb-3 border-t border-base-300/30"
        [attr.id]="'agent-content-' + node().id"
      >
        <!-- Children rendered by parent ExecutionNode -->
        <ng-content />
      </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentCardComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(false); // Expanded by default

  // Icons
  readonly ChevronIcon = ChevronDown;

  constructor() {
    // Sync isCollapsed with node's isCollapsed property when node changes
    effect(() => {
      const nodeCollapsed = this.node().isCollapsed;
      this.isCollapsed.set(nodeCollapsed ?? false);
    });
  }

  protected toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }

  protected getAgentColor(): string {
    const agentType = this.node().agentType || '';

    const colors: Record<string, string> = {
      // Claude Code built-in agents
      Explore: '#22c55e', // Green - exploration/discovery
      Plan: '#a855f7', // Purple - planning
      'general-purpose': '#6366f1', // Indigo
      'claude-code-guide': '#0ea5e9', // Sky blue

      // Custom project agents
      'software-architect': '#f97316',
      'frontend-developer': '#3b82f6',
      'backend-developer': '#10b981',
      'senior-tester': '#8b5cf6',
      'code-reviewer': '#ec4899',
      'team-leader': '#6366f1',
      'project-manager': '#d97706',
      'researcher-expert': '#06b6d4',
      'ui-ux-designer': '#f59e0b',
      'business-analyst': '#f43f5e',
      'modernization-detector': '#14b8a6',
    };

    return colors[agentType] || '#717171';
  }

  protected getAgentInitial(): string {
    const agentType = this.node().agentType || '';
    return agentType.charAt(0).toUpperCase();
  }
}
