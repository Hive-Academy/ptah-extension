import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
} from '@angular/core';
import {
  SetupWizardStateService,
  AgentRecommendation,
  AgentCategory,
} from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

/**
 * AgentSelectionComponent - Agent selection with relevance scores and recommendations
 *
 * Purpose:
 * - Display available agents with relevance scores from deep analysis
 * - Show matched criteria as tooltips/badges
 * - Visual indicator for "Recommended" agents (score >= 75)
 * - Auto-select highly recommended agents (score >= 80)
 * - Sort agents by score descending
 * - Group agents by category
 *
 * Features:
 * - DaisyUI card layout with agent cards grouped by category
 * - Relevance score progress bars with percentage
 * - "Recommended" badge for high-scoring agents
 * - Matched criteria tooltips
 * - Select All Recommended / Deselect All buttons
 * - Total selected count display
 * - Signal-based reactive UI
 *
 * Usage:
 * ```html
 * <ptah-agent-selection />
 * ```
 */
@Component({
  selector: 'ptah-agent-selection',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-4 py-8">
      <div class="max-w-5xl mx-auto">
        <div class="mb-6">
          <h2 class="text-3xl font-bold mb-2">Select Agents to Generate</h2>
          <p class="text-base-content/70">
            Based on your project analysis, we've scored each agent's relevance.
            Highly recommended agents (score >= 80) are auto-selected.
          </p>
        </div>

        @if (errorMessage(); as error) {
        <div class="alert alert-error mb-4" role="alert">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6 shrink-0 stroke-current"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{{ error }}</span>
        </div>
        }

        <!-- Selection controls and count -->
        <div
          class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6"
        >
          <div class="flex flex-wrap gap-2">
            <button
              class="btn btn-outline btn-sm"
              (click)="onSelectAllRecommended()"
              [disabled]="allRecommendedSelected()"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Select Recommended
            </button>
            <button
              class="btn btn-ghost btn-sm"
              (click)="onDeselectAll()"
              [disabled]="noneSelected()"
            >
              Deselect All
            </button>
          </div>
          <div class="flex items-center gap-3">
            <div class="badge badge-primary badge-lg gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              {{ selectedCount() }} selected
            </div>
            <div class="badge badge-outline badge-lg">
              {{ recommendedCount() }} recommended
            </div>
          </div>
        </div>

        @if (sortedRecommendations().length === 0) {
        <!-- No recommendations available -->
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body items-center text-center py-12">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-16 w-16 text-base-content/30 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            <h3 class="text-xl font-semibold mb-2">No Agent Recommendations</h3>
            <p class="text-base-content/60 max-w-md">
              Unable to load agent recommendations. Please go back and restart
              the analysis.
            </p>
          </div>
        </div>
        } @else {
        <!-- Agent categories -->
        @for (category of categoryOrder; track category) { @if
        (getAgentsByCategory(category).length > 0) {
        <div class="mb-8">
          <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
            <span
              class="badge badge-lg"
              [class]="getCategoryBadgeClass(category)"
            >
              {{ getCategoryIcon(category) }}
            </span>
            {{ getCategoryLabel(category) }}
            <span class="text-sm text-base-content/60 font-normal">
              ({{ getAgentsByCategory(category).length }} agents)
            </span>
          </h3>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            @for (agent of getAgentsByCategory(category); track agent.agentId) {
            <div
              class="card bg-base-100 shadow-md hover:shadow-lg transition-shadow cursor-pointer"
              [class.ring-2]="isSelected(agent.agentId)"
              [class.ring-primary]="isSelected(agent.agentId)"
              (click)="onToggleAgent(agent.agentId)"
              (keydown.enter)="onToggleAgent(agent.agentId)"
              (keydown.space)="
                onToggleAgent(agent.agentId); $event.preventDefault()
              "
              tabindex="0"
              role="checkbox"
              [attr.aria-checked]="isSelected(agent.agentId)"
              [attr.aria-label]="
                'Select ' +
                agent.agentName +
                ' agent, relevance score ' +
                agent.relevanceScore +
                ' percent'
              "
            >
              <div class="card-body p-4">
                <div class="flex items-start justify-between gap-3">
                  <div class="flex items-center gap-3 flex-1 min-w-0">
                    <!-- Checkbox -->
                    <input
                      type="checkbox"
                      class="checkbox checkbox-primary"
                      [checked]="isSelected(agent.agentId)"
                      (click)="$event.stopPropagation()"
                      (change)="onToggleAgent(agent.agentId)"
                      [attr.aria-label]="'Select ' + agent.agentName"
                    />

                    <!-- Agent Info -->
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-semibold">{{ agent.agentName }}</span>
                        @if (agent.recommended) {
                        <span class="badge badge-success badge-sm gap-1">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-3 w-3"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Recommended
                        </span>
                        }
                      </div>
                      <p
                        class="text-sm text-base-content/70 truncate"
                        [title]="agent.description"
                      >
                        {{ agent.description }}
                      </p>
                    </div>
                  </div>

                  <!-- Score Badge -->
                  <div class="flex flex-col items-end gap-1">
                    <span
                      class="badge badge-lg font-bold"
                      [class]="getScoreBadgeClass(agent.relevanceScore)"
                    >
                      {{ agent.relevanceScore }}%
                    </span>
                  </div>
                </div>

                <!-- Score Progress Bar -->
                <div class="mt-3">
                  <progress
                    class="progress w-full h-2"
                    [class]="getScoreProgressClass(agent.relevanceScore)"
                    [value]="agent.relevanceScore"
                    max="100"
                    [attr.aria-label]="
                      agent.agentName +
                      ' relevance: ' +
                      agent.relevanceScore +
                      ' percent'
                    "
                  ></progress>
                </div>

                <!-- Matched Criteria -->
                @if (agent.matchedCriteria && agent.matchedCriteria.length > 0)
                {
                <div class="mt-2 flex flex-wrap gap-1">
                  @for (criteria of agent.matchedCriteria.slice(0, 3); track
                  criteria) {
                  <span class="badge badge-outline badge-xs" [title]="criteria">
                    {{ criteria }}
                  </span>
                  } @if (agent.matchedCriteria.length > 3) {
                  <span
                    class="badge badge-ghost badge-xs cursor-help"
                    [title]="agent.matchedCriteria.slice(3).join(', ')"
                  >
                    +{{ agent.matchedCriteria.length - 3 }} more
                  </span>
                  }
                </div>
                }
              </div>
            </div>
            }
          </div>
        </div>
        } } }

        <!-- Action buttons -->
        <div
          class="flex flex-col sm:flex-row gap-4 justify-between items-center mt-8 pt-6 border-t border-base-300"
        >
          <button class="btn btn-ghost" (click)="onBack()">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back
          </button>

          <button
            class="btn btn-primary btn-lg"
            [class.btn-disabled]="isGenerating() || noneSelected()"
            [disabled]="isGenerating() || noneSelected()"
            [attr.aria-busy]="isGenerating()"
            [attr.aria-label]="
              isGenerating()
                ? 'Generating agents...'
                : 'Generate ' + selectedCount() + ' selected agents'
            "
            (click)="onGenerateAgents()"
          >
            @if (isGenerating()) {
            <span class="loading loading-spinner"></span>
            Generating... } @else {
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Generate {{ selectedCount() }} Agent{{
              selectedCount() === 1 ? '' : 's'
            }}
            }
          </button>
        </div>
      </div>
    </div>
  `,
})
export class AgentSelectionComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  /**
   * Category display order for agent grouping.
   */
  protected readonly categoryOrder: AgentCategory[] = [
    'planning',
    'development',
    'qa',
    'specialist',
    'creative',
  ];

  // Component-local loading and error state
  protected readonly isGenerating = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * Agent recommendations from deep analysis.
   * Sorted by relevance score descending.
   */
  protected readonly sortedRecommendations = computed(() => {
    const recommendations = this.wizardState.recommendations();
    return [...recommendations].sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );
  });

  /**
   * Selected agents map from state service.
   */
  protected readonly selectedAgentsMap = this.wizardState.selectedAgentsMap;

  /**
   * Count of selected agents.
   */
  protected readonly selectedCount = computed(() => {
    const selected = this.selectedAgentsMap();
    return Object.values(selected).filter(Boolean).length;
  });

  /**
   * Count of recommended agents (score >= 75).
   */
  protected readonly recommendedCount = computed(() => {
    return this.wizardState.recommendedAgents().length;
  });

  /**
   * Check if all recommended agents are selected.
   */
  protected readonly allRecommendedSelected = computed(() => {
    const recommended = this.wizardState.recommendedAgents();
    const selected = this.selectedAgentsMap();
    return (
      recommended.length > 0 &&
      recommended.every((agent) => selected[agent.agentId])
    );
  });

  /**
   * Check if no agents are selected.
   */
  protected readonly noneSelected = computed(() => this.selectedCount() === 0);

  /**
   * Get agents filtered by category.
   */
  protected getAgentsByCategory(
    category: AgentCategory
  ): AgentRecommendation[] {
    return this.sortedRecommendations().filter(
      (agent) => agent.category === category
    );
  }

  /**
   * Check if an agent is selected.
   */
  protected isSelected(agentId: string): boolean {
    return this.selectedAgentsMap()[agentId] === true;
  }

  /**
   * Get badge class based on relevance score.
   */
  protected getScoreBadgeClass(score: number): string {
    if (score >= 80) return 'badge-success';
    if (score >= 60) return 'badge-warning';
    return 'badge-error';
  }

  /**
   * Get progress bar class based on relevance score.
   */
  protected getScoreProgressClass(score: number): string {
    if (score >= 80) return 'progress-success';
    if (score >= 60) return 'progress-warning';
    return 'progress-error';
  }

  /**
   * Get category badge class for styling.
   */
  protected getCategoryBadgeClass(category: AgentCategory): string {
    switch (category) {
      case 'planning':
        return 'badge-primary';
      case 'development':
        return 'badge-secondary';
      case 'qa':
        return 'badge-accent';
      case 'specialist':
        return 'badge-info';
      case 'creative':
        return 'badge-warning';
      default:
        return 'badge-ghost';
    }
  }

  /**
   * Get category icon emoji.
   */
  protected getCategoryIcon(category: AgentCategory): string {
    switch (category) {
      case 'planning':
        return '\u{1F4CB}'; // Clipboard
      case 'development':
        return '\u{1F4BB}'; // Laptop
      case 'qa':
        return '\u{1F50D}'; // Magnifying glass
      case 'specialist':
        return '\u{2699}\u{FE0F}'; // Gear
      case 'creative':
        return '\u{1F3A8}'; // Artist palette
      default:
        return '\u{1F4E6}'; // Package
    }
  }

  /**
   * Get human-readable category label.
   */
  protected getCategoryLabel(category: AgentCategory): string {
    switch (category) {
      case 'planning':
        return 'Planning & Architecture';
      case 'development':
        return 'Development';
      case 'qa':
        return 'Quality Assurance';
      case 'specialist':
        return 'Specialists';
      case 'creative':
        return 'Creative';
      default:
        return 'Other';
    }
  }

  /**
   * Toggle individual agent selection.
   */
  protected onToggleAgent(agentId: string): void {
    this.wizardState.toggleAgentRecommendationSelection(agentId);
  }

  /**
   * Select all recommended agents.
   */
  protected onSelectAllRecommended(): void {
    this.wizardState.selectAllRecommended();
  }

  /**
   * Deselect all agents.
   */
  protected onDeselectAll(): void {
    this.wizardState.deselectAllAgents();
  }

  /**
   * Go back to analysis step.
   */
  protected onBack(): void {
    this.wizardState.setCurrentStep('analysis');
  }

  /**
   * Submit selected agents and transition to generation step.
   * - Show loading state during RPC call
   * - Display user-facing error message on failure
   * - Always reset loading state in finally block
   */
  protected async onGenerateAgents(): Promise<void> {
    if (this.isGenerating() || this.noneSelected()) {
      return; // Prevent double-click
    }

    this.isGenerating.set(true);
    this.errorMessage.set(null);

    try {
      const selectedAgentIds = Object.entries(this.selectedAgentsMap())
        .filter(([_, isSelected]) => isSelected)
        .map(([agentId]) => agentId);

      // Convert to AgentSelection format expected by RPC
      const selectedAgents = selectedAgentIds.map((agentId) => {
        const recommendation = this.sortedRecommendations().find(
          (r) => r.agentId === agentId
        );
        return {
          id: agentId,
          name: recommendation?.agentName ?? agentId,
          selected: true,
          score: recommendation?.relevanceScore ?? 0,
          reason: recommendation?.matchedCriteria?.join(', ') ?? '',
          autoInclude: (recommendation?.relevanceScore ?? 0) >= 80,
        };
      });

      // Submit selection to backend via RPC
      await this.wizardRpc.submitAgentSelection(selectedAgents);

      // Transition to generation step
      this.wizardState.setCurrentStep('generation');
    } catch (error) {
      // Handle RPC error with user-facing message
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to start agent generation. Please try again.';
      this.errorMessage.set(message);
      console.error('Agent generation failed:', error);
    } finally {
      // Always reset loading state
      this.isGenerating.set(false);
    }
  }
}
