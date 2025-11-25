import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { StatusBadgeComponent } from '../atoms/status-badge.component';
import { DurationBadgeComponent } from '../atoms/duration-badge.component';
import { TokenBadgeComponent } from '../atoms/token-badge.component';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * AgentCardComponent - Collapsible agent execution card with nested children
 *
 * Complexity Level: 2 (Molecule with composition)
 * Patterns: Colored agent badges (Roo Code-inspired), Recursive container
 *
 * Displays agent type with colored avatar, status, metrics, and nested tools.
 * Expanded by default to show nested execution tree.
 */
@Component({
  selector: 'ptah-agent-card',
  standalone: true,
  imports: [StatusBadgeComponent, DurationBadgeComponent, TokenBadgeComponent],
  template: `
    <div
      class="card bg-base-200 shadow-card hover:shadow-card-hover transition-shadow duration-200 my-2 ml-4"
    >
      <div class="collapse collapse-arrow">
        <input
          type="checkbox"
          [checked]="!isCollapsed()"
          (change)="toggleCollapse()"
          [attr.aria-expanded]="!isCollapsed()"
          [attr.aria-controls]="'agent-content-' + node().id"
        />

        <!-- Collapse header -->
        <div class="collapse-title min-h-0 py-3 px-3 flex items-center gap-3">
          <!-- Colored letter badge -->
          <div class="avatar placeholder">
            <div
              class="w-10 h-10 rounded-full flex items-center justify-center"
              [style.background-color]="getAgentColor()"
            >
              <span class="text-white text-sm font-bold">
                {{ getAgentInitial() }}
              </span>
            </div>
          </div>

          <!-- Agent info -->
          <div class="flex-1 min-w-0">
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
        </div>

        <!-- Collapsible content (nested children) -->
        <div
          class="collapse-content px-3 pb-3"
          [attr.id]="'agent-content-' + node().id"
        >
          <!-- Children rendered by parent ExecutionNode -->
          <ng-content />
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentCardComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(false); // Expanded by default

  protected toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }

  protected getAgentColor(): string {
    const agentType = this.node().agentType || '';

    const colors: Record<string, string> = {
      'software-architect': '#f97316',
      'frontend-developer': '#3b82f6',
      'backend-developer': '#10b981',
      'senior-tester': '#8b5cf6',
      'code-reviewer': '#ec4899',
      'team-leader': '#6366f1',
      'project-manager': '#d97706',
      'researcher-expert': '#06b6d4',
      'ui-ux-designer': '#f59e0b',
    };

    return colors[agentType] || '#717171';
  }

  protected getAgentInitial(): string {
    const agentType = this.node().agentType || '';
    return agentType.charAt(0).toUpperCase();
  }
}
