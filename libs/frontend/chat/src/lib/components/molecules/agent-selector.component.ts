/**
 * AgentSelectorComponent - Dedicated Agent Selection Dropdown
 *
 * A standalone dropdown component for selecting Claude agents.
 * Separated from @ trigger to provide cleaner UX - @ is now for files/folders only.
 *
 * Pattern: Signal-based state from AgentDiscoveryFacade
 * UI: Custom dropdown with single-column vertical layout
 *
 * PERFORMANCE: Uses DropdownInteractionService for conditional event listeners
 * - Listeners only attached when dropdown is open
 * - Automatic cleanup when dropdown closes
 */

import {
  Component,
  inject,
  output,
  signal,
  ChangeDetectionStrategy,
  OnInit,
  ElementRef,
  Injector,
} from '@angular/core';
import { LucideAngularModule, Users, ChevronDown } from 'lucide-angular';
import {
  AgentDiscoveryFacade,
  DropdownInteractionService,
  type AgentSuggestion,
} from '@ptah-extension/core';

@Component({
  selector: 'ptah-agent-selector',
  imports: [LucideAngularModule],
  template: `
    <div class="relative">
      <button
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

      @if (isOpen()) {
      <div
        class="absolute bottom-full left-0 mb-2 z-50 w-80 max-h-80 flex flex-col bg-base-200 border border-base-300 rounded-lg shadow-lg"
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

        <!-- Agent List - Single Column Vertical -->
        @else {
        <div
          class="flex flex-col overflow-y-auto overflow-x-hidden max-h-64 p-1"
        >
          @for (agent of agents(); track agent.name; let i = $index) {
          <button
            type="button"
            class="btn btn-ghost justify-start items-start gap-3 px-3 py-2.5 h-auto min-h-0 rounded-md w-full text-left font-normal"
            [class.btn-primary]="i === focusedIndex()"
            (click)="selectAgent(agent)"
            (mouseenter)="setFocusedIndex(i)"
          >
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
          </button>
          }
        </div>
        }
      </div>
      }
    </div>
  `,
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentSelectorComponent implements OnInit {
  private readonly agentDiscovery = inject(AgentDiscoveryFacade);
  private readonly dropdownService = inject(DropdownInteractionService);
  private readonly elementRef = inject(ElementRef);
  private readonly injector = inject(Injector);

  // Lucide icons
  readonly UsersIcon = Users;
  readonly ChevronDownIcon = ChevronDown;

  // Output event
  readonly agentSelected = output<string>();

  // Local state
  private readonly _isLoading = signal(false);
  private readonly _agents = signal<AgentSuggestion[]>([]);
  private readonly _isOpen = signal(false);
  private readonly _focusedIndex = signal(0);

  // Public signals
  readonly isLoading = this._isLoading.asReadonly();
  readonly agents = this._agents.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();
  readonly focusedIndex = this._focusedIndex.asReadonly();

  constructor() {
    // Setup conditional event listeners (only active when dropdown is open)
    this.dropdownService.autoManageListeners(this.injector, {
      isOpenSignal: this.isOpen,
      elementRef: this.elementRef,
      onClickOutside: () => this._isOpen.set(false),
      keyboardNav: {
        onArrowDown: () => this.navigateDown(),
        onArrowUp: () => this.navigateUp(),
        onEnter: () => this.selectFocused(),
        onEscape: () => this._isOpen.set(false),
      },
    });
  }

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
      this._isOpen.set(false);
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
    this._focusedIndex.set(0);
  }

  /**
   * Navigate down in the list
   */
  private navigateDown(): void {
    const agents = this._agents();
    if (agents.length === 0) return;
    this._focusedIndex.set((this._focusedIndex() + 1) % agents.length);
  }

  /**
   * Navigate up in the list
   */
  private navigateUp(): void {
    const agents = this._agents();
    if (agents.length === 0) return;
    const newIndex = this._focusedIndex() - 1;
    this._focusedIndex.set(newIndex < 0 ? agents.length - 1 : newIndex);
  }

  /**
   * Select the currently focused agent
   */
  private selectFocused(): void {
    const agents = this._agents();
    const focused = agents[this._focusedIndex()];
    if (focused) {
      this.selectAgent(focused);
    }
  }

  setFocusedIndex(index: number): void {
    this._focusedIndex.set(index);
  }

  /**
   * Select an agent and emit the event
   */
  selectAgent(agent: AgentSuggestion): void {
    this._isOpen.set(false);
    this.agentSelected.emit(agent.name);
  }
}
