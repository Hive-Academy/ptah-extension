/**
 * AgentSelectorComponent - Dedicated Agent Selection Dropdown
 *
 * A standalone dropdown component for selecting Claude agents.
 * Separated from @ trigger to provide cleaner UX - @ is now for files/folders only.
 *
 * Pattern: Signal-based state from AgentDiscoveryFacade
 * UI: lib-dropdown from @ptah-extension/ui with CDK Overlay portal rendering
 * Keyboard Navigation: Handled by lib-option components (no manual implementation needed)
 */

import {
  Component,
  inject,
  output,
  signal,
  ChangeDetectionStrategy,
  OnInit,
} from '@angular/core';
import { LucideAngularModule, Users, ChevronDown } from 'lucide-angular';
import {
  AgentDiscoveryFacade,
  type AgentSuggestion,
} from '@ptah-extension/core';
import { DropdownComponent, OptionComponent } from '@ptah-extension/ui';

@Component({
  selector: 'ptah-agent-selector',
  imports: [LucideAngularModule, DropdownComponent, OptionComponent],
  template: `
    <ptah-dropdown
      [isOpen]="isOpen()"
      [closeOnBackdropClick]="true"
      (closed)="closeDropdown()"
      (backdropClicked)="closeDropdown()"
    >
      <button
        trigger
        class="btn btn-ghost btn-xs gap-1 font-normal"
        type="button"
        (click)="toggleDropdown()"
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

      <div content class="w-80 max-h-80 flex flex-col">
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

        <!-- Agent List - Single Column Vertical -->
        @else {
        <div
          class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1"
        >
          @for (agent of agents(); track agent.name; let i = $index) {
          <ptah-option
            [optionId]="'agent-' + i"
            [value]="agent"
            (selected)="selectAgent($event)"
          >
            <div class="flex items-start gap-3 py-0.5">
              <!-- Icon -->
              <span
                class="shrink-0 w-5 h-5 flex items-center justify-center text-base mt-0.5"
              >
                {{ agent.icon }}
              </span>

              <!-- Agent Info -->
              <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{{ agent.name }}</span>
                  @if (agent.scope === 'builtin') {
                  <span class="badge badge-accent badge-xs">Built-in</span>
                  }
                </div>
                <span class="text-xs opacity-70 line-clamp-2">{{
                  agent.description
                }}</span>
              </div>
            </div>
          </ptah-option>
          }
        </div>
        }
      </div>
    </ptah-dropdown>
  `,
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentSelectorComponent implements OnInit {
  private readonly agentDiscovery = inject(AgentDiscoveryFacade);

  // Lucide icons
  readonly UsersIcon = Users;
  readonly ChevronDownIcon = ChevronDown;

  // Output event
  readonly agentSelected = output<string>();

  // Local state
  private readonly _isLoading = signal(false);
  private readonly _agents = signal<AgentSuggestion[]>([]);
  private readonly _isOpen = signal(false);

  // Public signals
  readonly isLoading = this._isLoading.asReadonly();
  readonly agents = this._agents.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();

  ngOnInit(): void {
    // Pre-load agents on component init for better UX
    this.preloadAgents();
  }

  /**
   * Pre-load agents in background
   */
  private async preloadAgents(): Promise<void> {
    try {
      await this.agentDiscovery.fetchAgents();
      this._agents.set(this.agentDiscovery.searchAgents(''));
    } catch (error) {
      console.error(
        '[AgentSelectorComponent] Failed to preload agents:',
        error
      );
    }
  }

  /**
   * Toggle dropdown visibility
   */
  async toggleDropdown(): Promise<void> {
    if (this._isOpen()) {
      this.closeDropdown();
      return;
    }

    // Load agents if not already loaded
    if (this._agents().length === 0) {
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

    this._isOpen.set(true);
  }

  /**
   * Close dropdown
   */
  closeDropdown(): void {
    this._isOpen.set(false);
  }

  /**
   * Select an agent and emit the event
   * Called by lib-option (selected) output
   */
  selectAgent(agent: AgentSuggestion): void {
    this.closeDropdown();
    this.agentSelected.emit(agent.name);
  }
}
