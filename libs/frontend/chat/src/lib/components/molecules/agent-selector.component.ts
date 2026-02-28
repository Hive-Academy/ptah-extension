/**
 * AgentSelectorComponent - Dedicated Agent Selection Dropdown
 *
 * A standalone dropdown component for selecting Claude agents and custom agents.
 * Separated from @ trigger to provide cleaner UX - @ is now for files/folders only.
 *
 * TASK_2025_167: Extended to show custom agents alongside built-in agents.
 * Custom agents are fetched from CustomAgentStateService and displayed in a
 * separate section with provider badges and a "clear" option.
 *
 * Pattern: Signal-based state from AgentDiscoveryFacade + CustomAgentStateService
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
import {
  LucideAngularModule,
  Users,
  ChevronDown,
  Bot,
  X,
} from 'lucide-angular';
import {
  AgentDiscoveryFacade,
  CustomAgentStateService,
  type AgentSuggestion,
} from '@ptah-extension/core';
import {
  NativeDropdownComponent,
  NativeOptionComponent,
  KeyboardNavigationService,
} from '@ptah-extension/ui';
import type { CustomAgentSummary } from '@ptah-extension/shared';

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
        class="btn btn-ghost btn-xs gap-1 font-normal"
        type="button"
        (click)="toggleDropdown()"
        [disabled]="isLoading()"
      >
        @if (isLoading()) {
        <span class="loading loading-spinner loading-xs"></span>
        } @else if (hasCustomAgentSelected()) {
        <lucide-angular [img]="BotIcon" class="w-3 h-3 text-primary" />
        } @else {
        <lucide-angular [img]="UsersIcon" class="w-3 h-3" />
        }
        <span class="text-xs">{{
          hasCustomAgentSelected() ? selectedAgentName() : 'Agents'
        }}</span>
        @if (hasCustomAgentSelected()) {
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square ml-0.5 -mr-1"
          (click)="clearCustomAgent($event)"
          aria-label="Clear custom agent selection"
        >
          <lucide-angular [img]="XIcon" class="w-2.5 h-2.5" />
        </button>
        } @else {
        <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3" />
        }
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
        @else if (agents().length === 0 && enabledCustomAgents().length === 0) {
        <div class="flex items-center justify-center p-4">
          <span class="text-sm text-base-content/60">No agents available</span>
        </div>
        }

        <!-- Agent Lists -->
        @else {
        <div
          class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1"
        >
          <!-- Custom Agents Section -->
          @if (enabledCustomAgents().length > 0) {
          <div class="px-2 pt-1 pb-0.5">
            <span
              class="text-[10px] font-semibold text-base-content/50 uppercase tracking-wider"
            >
              Custom Agents
            </span>
          </div>
          @for ( customAgent of enabledCustomAgents(); track customAgent.id; let
          i = $index ) {
          <ptah-native-option
            [optionId]="'custom-agent-' + i"
            [value]="customAgent"
            [isActive]="i === activeIndex()"
            (selected)="onCustomAgentSelected($event)"
            (hovered)="onHover(i)"
          >
            <div class="flex items-start gap-3 py-0.5">
              <!-- Icon -->
              <span
                class="shrink-0 w-5 h-5 flex items-center justify-center text-base mt-0.5"
              >
                <lucide-angular
                  [img]="BotIcon"
                  class="w-4 h-4"
                  [class.text-primary]="selectedAgentId() === customAgent.id"
                />
              </span>

              <!-- Agent Info -->
              <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{{
                    customAgent.name
                  }}</span>
                  <span class="badge badge-primary badge-xs">{{
                    customAgent.providerName
                  }}</span>
                  @if (selectedAgentId() === customAgent.id) {
                  <span class="badge badge-success badge-xs">Active</span>
                  }
                </div>
                <span class="text-xs opacity-70">
                  {{ customAgent.modelCount }} models available
                </span>
              </div>
            </div>
          </ptah-native-option>
          }

          <!-- Divider between custom and built-in agents -->
          @if (agents().length > 0) {
          <div class="divider my-0.5 mx-2 text-[10px] opacity-30"></div>
          } }

          <!-- Built-in Agents Section -->
          @if (agents().length > 0) { @if (enabledCustomAgents().length > 0) {
          <div class="px-2 pt-0.5 pb-0.5">
            <span
              class="text-[10px] font-semibold text-base-content/50 uppercase tracking-wider"
            >
              Built-in Agents
            </span>
          </div>
          } @for ( agent of agents(); track agent.name; let i = $index ) {
          <ptah-native-option
            [optionId]="'agent-' + i"
            [value]="agent"
            [isActive]="i + enabledCustomAgents().length === activeIndex()"
            (selected)="selectAgent($event)"
            (hovered)="onHover(i + enabledCustomAgents().length)"
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
          </ptah-native-option>
          } }
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
  readonly customAgentState = inject(CustomAgentStateService);
  private readonly keyboardNav = inject(KeyboardNavigationService);

  // Lucide icons
  readonly UsersIcon = Users;
  readonly ChevronDownIcon = ChevronDown;
  readonly BotIcon = Bot;
  readonly XIcon = X;

  // Output events
  readonly agentSelected = output<string>();
  readonly customAgentIdSelected = output<string | null>();

  // Local state
  private readonly _isLoading = signal(false);
  private readonly _agents = signal<AgentSuggestion[]>([]);
  private readonly _isOpen = signal(false);

  // Public signals
  readonly isLoading = this._isLoading.asReadonly();
  readonly agents = this._agents.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();

  // Custom agents (enabled and available) - local signals for template type safety
  readonly enabledCustomAgents = this.customAgentState.enabledAgents;
  readonly hasCustomAgentSelected =
    this.customAgentState.hasCustomAgentSelected;
  readonly selectedAgentId = this.customAgentState.selectedAgentId;
  readonly selectedAgentName = this.customAgentState.selectedAgentName;

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
      await Promise.all([
        this.agentDiscovery.fetchAgents(),
        this.customAgentState.loadAgents(),
      ]);
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
        await Promise.all([
          this.agentDiscovery.fetchAgents(),
          this.customAgentState.loadAgents(),
        ]);
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
   * Also clears any custom agent selection
   */
  selectAgent(value: unknown): void {
    const agent = value as AgentSuggestion;
    this.closeDropdown();
    this.customAgentState.clearSelection();
    this.customAgentIdSelected.emit(null);
    this.agentSelected.emit(agent.name);
  }

  /**
   * Handle custom agent selection from NativeOptionComponent
   * The component emits the value as its generic type T, which at runtime
   * is a CustomAgentSummary. We accept unknown for type safety.
   */
  onCustomAgentSelected(value: unknown): void {
    const agent = value as CustomAgentSummary;
    this.closeDropdown();
    this.customAgentState.selectAgent(agent.id);
    this.customAgentIdSelected.emit(agent.id);
  }

  /**
   * Clear the custom agent selection (button in trigger)
   */
  clearCustomAgent(event: Event): void {
    event.stopPropagation();
    this.customAgentState.clearSelection();
    this.customAgentIdSelected.emit(null);
  }

  /**
   * Handle hover on option - update active index
   */
  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }
}
