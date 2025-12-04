/**
 * AgentSelectorComponent - Dedicated Agent Selection Dropdown
 *
 * A standalone dropdown component for selecting Claude agents.
 * Separated from @ trigger to provide cleaner UX - @ is now for files/folders only.
 *
 * Pattern: Signal-based state from AgentDiscoveryFacade
 * UI: DaisyUI dropdown matching model-selector style
 */

import {
  Component,
  inject,
  output,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Users, ChevronDown, Check } from 'lucide-angular';
import {
  AgentDiscoveryFacade,
  type AgentSuggestion,
} from '@ptah-extension/core';

@Component({
  selector: 'ptah-agent-selector',
  imports: [LucideAngularModule],
  template: `
    <div class="dropdown dropdown-top">
      <button
        tabindex="0"
        class="btn btn-ghost btn-xs gap-1 font-normal"
        type="button"
        (click)="loadAgents()"
        [disabled]="isLoading()"
      >
        @if (isLoading()) {
        <span class="loading loading-spinner loading-xs"></span>
        } @else {
        <lucide-angular [img]="UsersIcon" class="w-3 h-3" />
        }
        <span class="text-xs">Agents</span>
        <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3" />
      </button>
      <div
        tabindex="0"
        class="dropdown-content z-50 mb-2 p-1 shadow-lg bg-base-200 rounded-lg w-72 border border-base-300"
      >
        <!-- Header -->
        <div class="px-3 py-2 border-b border-base-300">
          <span
            class="text-xs font-semibold text-base-content/70 uppercase tracking-wide"
          >
            Select Agent
          </span>
        </div>

        <!-- Loading State -->
        @if (isLoading()) {
        <div class="flex items-center justify-center gap-3 p-4">
          <span class="loading loading-spinner loading-sm"></span>
          <span class="text-sm text-base-content/70">Loading agents...</span>
        </div>
        }

        <!-- Empty State -->
        @else if (agents().length === 0) {
        <div class="flex items-center justify-center p-4">
          <span class="text-sm text-base-content/60">No agents available</span>
        </div>
        }

        <!-- Agent List -->
        @else {
        <ul class="menu menu-sm p-1 max-h-64 overflow-y-auto">
          @for (agent of agents(); track agent.name) {
          <li>
            <button
              type="button"
              class="flex items-start gap-3 py-2.5 px-3 rounded-md transition-colors hover:bg-base-300"
              (click)="selectAgent(agent)"
            >
              <!-- Icon -->
              <div class="w-4 h-4 mt-0.5 flex-shrink-0">
                <span class="text-base">{{ agent.icon }}</span>
              </div>

              <!-- Agent Info -->
              <div class="flex flex-col items-start flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{{ agent.name }}</span>
                  @if (agent.scope === 'builtin') {
                  <span class="badge badge-accent badge-xs">Built-in</span>
                  }
                </div>
                <span class="text-xs mt-0.5 text-base-content/60 line-clamp-2">
                  {{ agent.description }}
                </span>
              </div>
            </button>
          </li>
          }
        </ul>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentSelectorComponent {
  private readonly agentDiscovery = inject(AgentDiscoveryFacade);

  // Lucide icons
  readonly UsersIcon = Users;
  readonly ChevronDownIcon = ChevronDown;
  readonly CheckIcon = Check;

  // Output event
  readonly agentSelected = output<string>();

  // Local state
  private readonly _isLoading = signal(false);
  private readonly _agents = signal<AgentSuggestion[]>([]);

  // Public signals
  readonly isLoading = this._isLoading.asReadonly();
  readonly agents = this._agents.asReadonly();

  /**
   * Load agents when dropdown is opened
   */
  async loadAgents(): Promise<void> {
    // Only fetch if not already loaded
    if (this._agents().length > 0) return;

    this._isLoading.set(true);
    try {
      await this.agentDiscovery.fetchAgents();
      this._agents.set(this.agentDiscovery.searchAgents(''));
    } catch (error) {
      console.error('[AgentSelectorComponent] Failed to load agents:', error);
    } finally {
      this._isLoading.set(false);
    }
  }

  /**
   * Select an agent and emit the event
   */
  selectAgent(agent: AgentSuggestion): void {
    // Close dropdown by removing focus
    const activeElement = document.activeElement as HTMLElement;
    activeElement?.blur();

    // Emit agent name for parent to handle
    this.agentSelected.emit(agent.name);
  }
}
