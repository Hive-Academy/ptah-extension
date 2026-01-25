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
} from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { AgentCategory } from '@ptah-extension/shared';
import { withErrorHandling } from '../utils/error-handling';
import {
  LucideAngularModule,
  XCircle,
  Check,
  Users,
  ChevronLeft,
  Zap,
} from 'lucide-angular';

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
 * - 'Other' fallback category for unknown agent types
 *
 * Usage:
 * ```html
 * <ptah-agent-selection />
 * ```
 */
@Component({
  selector: 'ptah-agent-selection',
  standalone: true,
  imports: [LucideAngularModule],
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
          <lucide-angular [img]="XCircleIcon" class="h-6 w-6 shrink-0" />
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
              <lucide-angular [img]="CheckIcon" class="h-4 w-4" />
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
              <lucide-angular [img]="CheckIcon" class="h-4 w-4" />
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
            <lucide-angular
              [img]="UsersIcon"
              class="h-16 w-16 text-base-content/30 mb-4"
            />
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
                          <lucide-angular [img]="CheckIcon" class="h-3 w-3" />
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
            <lucide-angular [img]="ChevronLeftIcon" class="h-5 w-5" />
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
            <lucide-angular [img]="ZapIcon" class="h-5 w-5" />
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

  // Lucide icon references
  protected readonly XCircleIcon = XCircle;
  protected readonly CheckIcon = Check;
  protected readonly UsersIcon = Users;
  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ZapIcon = Zap;

  /**
   * Known agent categories for filtering.
   */
  private readonly knownCategories: AgentCategory[] = [
    'planning',
    'development',
    'qa',
    'specialist',
    'creative',
  ];

  /**
   * Category display order for agent grouping.
   * Unknown categories are collected in 'other' at the end.
   */
  protected readonly categoryOrder: (AgentCategory | 'other')[] = [
    'planning',
    'development',
    'qa',
    'specialist',
    'creative',
    'other',
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
   * For 'other', returns agents with unknown categories.
   */
  protected getAgentsByCategory(
    category: AgentCategory | 'other'
  ): AgentRecommendation[] {
    if (category === 'other') {
      return this.sortedRecommendations().filter(
        (agent) =>
          !this.knownCategories.includes(agent.category as AgentCategory)
      );
    }
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
   * Includes fallback for 'other' category.
   */
  protected getCategoryBadgeClass(category: AgentCategory | 'other'): string {
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
      case 'other':
      default:
        return 'badge-ghost';
    }
  }

  /**
   * Get category icon emoji.
   * Includes fallback for 'other' category.
   */
  protected getCategoryIcon(category: AgentCategory | 'other'): string {
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
      case 'other':
      default:
        return '\u{1F4E6}'; // Package
    }
  }

  /**
   * Get human-readable category label.
   * Includes fallback for 'other' category.
   */
  protected getCategoryLabel(category: AgentCategory | 'other'): string {
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
      case 'other':
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
   * Build selected agents array from selection map.
   * Converts internal selection state to format expected by RPC.
   */
  private buildSelectedAgents(): Array<{
    id: string;
    name: string;
    selected: boolean;
    score: number;
    reason: string;
    autoInclude: boolean;
  }> {
    const selectedAgentIds = Object.entries(this.selectedAgentsMap())
      .filter(([_, isSelected]) => isSelected)
      .map(([agentId]) => agentId);

    return selectedAgentIds.map((agentId) => {
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
  }

  /**
   * Submit selected agents and transition to generation step.
   * - Uses standardized error handling utility for consistent error messages
   * - Show loading state during RPC call
   * - Verify backend acknowledgment before step transition
   * - Display user-facing error message on failure
   * - Always reset loading state in finally block
   */
  protected async onGenerateAgents(): Promise<void> {
    if (this.isGenerating() || this.noneSelected()) {
      return; // Prevent double-click
    }

    this.isGenerating.set(true);
    this.errorMessage.set(null);

    const result = await withErrorHandling(
      async () => {
        const selectedAgents = this.buildSelectedAgents();

        // Submit selection and verify acknowledgment
        const response = await this.wizardRpc.submitAgentSelection(
          selectedAgents
        );

        // Verify backend acknowledgment before transitioning
        if (!response?.success) {
          throw new Error(
            response?.error ?? 'Backend did not acknowledge selection'
          );
        }

        return response;
      },
      'Starting agent generation',
      (error) => {
        this.errorMessage.set(error.message);
        console.error(
          'Agent generation failed:',
          error.details ?? error.message
        );
      }
    );

    if (result) {
      // Only transition after confirmed acknowledgment
      this.wizardState.setCurrentStep('generation');
    }

    // Always reset loading state
    this.isGenerating.set(false);
  }
}
