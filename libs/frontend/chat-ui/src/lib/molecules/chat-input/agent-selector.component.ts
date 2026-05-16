/**
 * AgentSelectorComponent - Dedicated Agent Selection Dropdown
 *
 * A standalone dropdown component for selecting Claude agents and custom agents.
 * Separated from @ trigger to provide cleaner UX - @ is now for files/folders only.
 *
 * Shows custom agents alongside built-in agents. Ptah CLI agents are fetched
 * from PtahCliStateService and displayed in a separate section with provider
 * badges and a "clear" option.
 *
 * Pattern: Signal-based state from AgentDiscoveryFacade + PtahCliStateService
 * UI: NativeDropdownComponent from @ptah-extension/ui with Floating UI positioning
 * Keyboard Navigation: Parent manages activeIndex signal for NativeOptionComponent
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
import {
  NativeDropdownComponent,
  NativeOptionComponent,
  KeyboardNavigationService,
} from '@ptah-extension/ui';

@Component({
  selector: 'ptah-agent-selector',
  imports: [
    LucideAngularModule,
    NativeDropdownComponent,
    NativeOptionComponent,
  ],
  providers: [KeyboardNavigationService],
  template: `
    <ptah-native-dropdown
      [isOpen]="isOpen()"
      [closeOnBackdropClick]="true"
      (closed)="closeDropdown()"
      (backdropClicked)="closeDropdown()"
    >
      <button
        trigger
        class="btn btn-ghost btn-xs gap-1 font-normal h-6 min-h-0 px-1.5"
        type="button"
        (click)="toggleDropdown()"
        [disabled]="isLoading()"
      >
        @if (isLoading()) {
          <span class="loading loading-spinner loading-xs"></span>
        } @else {
          <lucide-angular [img]="UsersIcon" class="w-3 h-3" />
        }
        <span class="text-[10px]">Agents</span>
        <lucide-angular
          [img]="ChevronDownIcon"
          class="w-2.5 h-2.5 opacity-60"
        />
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
            <span class="text-sm text-base-content/60"
              >No agents available</span
            >
          </div>
        }

        <!-- Agent List -->
        @else {
          <div
            class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1"
          >
            @for (agent of agents(); track agent.name; let i = $index) {
              <ptah-native-option
                [optionId]="'agent-' + i"
                [value]="agent"
                [isActive]="i === activeIndex()"
                (selected)="selectAgent($event)"
                (hovered)="onHover(i)"
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
                        <span class="badge badge-accent badge-xs"
                          >Built-in</span
                        >
                      }
                    </div>
                    <span class="text-xs opacity-70 line-clamp-2">{{
                      agent.description
                    }}</span>
                  </div>
                </div>
              </ptah-native-option>
            }
          </div>
        }
      </div>
    </ptah-native-dropdown>
  `,
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentSelectorComponent implements OnInit {
  private readonly agentDiscovery = inject(AgentDiscoveryFacade);
  private readonly keyboardNav = inject(KeyboardNavigationService);

  // Lucide icons
  readonly UsersIcon = Users;
  readonly ChevronDownIcon = ChevronDown;

  // Output events
  readonly agentSelected = output<string>();

  // Local state
  private readonly _isLoading = signal(false);
  private readonly _agents = signal<AgentSuggestion[]>([]);
  private readonly _isOpen = signal(false);

  // Public signals
  readonly isLoading = this._isLoading.asReadonly();
  readonly agents = this._agents.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();

  // Keyboard navigation - expose activeIndex for template
  readonly activeIndex = this.keyboardNav.activeIndex;

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
        error,
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
   * Select a built-in agent and emit the event
   */
  selectAgent(value: unknown): void {
    const agent = value as AgentSuggestion;
    this.closeDropdown();
    this.agentSelected.emit(agent.name);
  }

  /**
   * Handle hover on option - update active index
   */
  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }
}
