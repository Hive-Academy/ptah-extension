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
  SkillGenerationProgressItem,
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
  LayoutDashboard,
  Code,
  Search,
  Settings,
  Palette,
  Package,
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
    <div class="px-3 py-4">
      <div class="mb-4">
        <h2 class="text-base font-semibold mb-2">Select Agents to Generate</h2>
        <p class="text-xs text-base-content/60">
          Based on your project analysis, we've scored each agent's relevance.
          Highly recommended agents (score >= 80) are auto-selected.
        </p>
      </div>

      @if (errorMessage(); as error) {
        <div class="alert alert-error mb-2 py-2 text-xs" role="alert">
          <lucide-angular [img]="XCircleIcon" class="h-4 w-4 shrink-0" />
          <span>{{ error }}</span>
        </div>
      }

      <!-- Selection controls and count -->
      <div class="flex flex-wrap justify-between items-center gap-2 mb-4">
        <div class="flex flex-wrap gap-1.5">
          <button
            class="btn btn-outline btn-xs"
            (click)="onSelectAllRecommended()"
            [disabled]="allRecommendedSelected()"
          >
            <lucide-angular [img]="CheckIcon" class="h-3 w-3" />
            Select Recommended
          </button>
          <button
            class="btn btn-ghost btn-xs"
            (click)="onDeselectAll()"
            [disabled]="noneSelected()"
          >
            Deselect All
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="badge badge-primary badge-sm gap-1">
            <lucide-angular [img]="CheckIcon" class="h-3 w-3" />
            {{ selectedCount() }} selected
          </div>
          <div class="badge badge-outline badge-sm">
            {{ recommendedCount() }} recommended
          </div>
        </div>
      </div>

      @if (sortedRecommendations().length === 0) {
        <!-- No recommendations available -->
        <div class="card border border-base-300 bg-base-200/50">
          <div class="card-body items-center text-center py-6">
            <lucide-angular
              [img]="UsersIcon"
              class="h-8 w-8 text-base-content/30 mb-2"
            />
            <h3 class="text-sm font-semibold mb-1">No Agent Recommendations</h3>
            <p class="text-xs text-base-content/60">
              Unable to load agent recommendations. Please go back and restart
              the analysis.
            </p>
          </div>
        </div>
      } @else {
        <!-- Agent categories -->
        @for (category of categoryOrder; track category) {
          @if (getAgentsByCategory(category).length > 0) {
            <div class="mb-4">
              <h3 class="text-sm font-semibold mb-3 flex items-center gap-2">
                <lucide-angular
                  [img]="getCategoryLucideIcon(category)"
                  class="h-4 w-4"
                />
                {{ getCategoryLabel(category) }}
                <span class="badge badge-ghost badge-sm">{{
                  getAgentsByCategory(category).length
                }}</span>
              </h3>

              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                @for (
                  agent of getAgentsByCategory(category);
                  track agent.agentId
                ) {
                  <div
                    class="card border bg-base-200/50 hover:border-primary/50 transition-all cursor-pointer"
                    [class.ring-2]="isSelected(agent.agentId)"
                    [class.ring-primary]="isSelected(agent.agentId)"
                    [class.border-base-300]="!isSelected(agent.agentId)"
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
                    <div class="card-body p-3">
                      <!-- Header row: checkbox + name + score + recommended badge -->
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2">
                          <input
                            type="checkbox"
                            class="checkbox checkbox-primary checkbox-sm"
                            [checked]="isSelected(agent.agentId)"
                            (click)="$event.stopPropagation()"
                            (change)="onToggleAgent(agent.agentId)"
                            [attr.aria-label]="'Select ' + agent.agentName"
                          />
                          <span class="font-semibold text-sm">{{
                            agent.agentName
                          }}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                          @if (agent.recommended) {
                            <span class="badge badge-success badge-xs"
                              >Rec</span
                            >
                          }
                          <span
                            class="badge badge-sm font-bold"
                            [class]="getScoreBadgeClass(agent.relevanceScore)"
                          >
                            {{ agent.relevanceScore }}%
                          </span>
                        </div>
                      </div>

                      <!-- Description (full, not truncated) -->
                      <p
                        class="text-xs text-base-content/70 mt-1 leading-relaxed"
                      >
                        {{ agent.description }}
                      </p>

                      <!-- Matched criteria tags -->
                      @if (agent.matchedCriteria?.length) {
                        <div class="flex flex-wrap gap-1 mt-2">
                          @for (
                            criteria of agent.matchedCriteria;
                            track criteria
                          ) {
                            <span class="badge badge-outline badge-xs">{{
                              criteria
                            }}</span>
                          }
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        }
      }

      <!-- Action buttons -->
      <div
        class="flex gap-2 justify-between items-center mt-4 pt-3 border-t border-base-300"
      >
        <button
          class="btn btn-ghost btn-sm"
          [disabled]="isGenerating()"
          (click)="onBack()"
        >
          <lucide-angular [img]="ChevronLeftIcon" class="h-4 w-4" />
          Back
        </button>

        <button
          class="btn btn-primary btn-sm"
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
            <span class="loading loading-spinner loading-sm"></span>
            Generating...
          } @else {
            <lucide-angular [img]="ZapIcon" class="h-4 w-4" />
            Generate {{ selectedCount() }} Agent{{
              selectedCount() === 1 ? '' : 's'
            }}
          }
        </button>
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
  protected readonly LayoutDashboardIcon = LayoutDashboard;
  protected readonly CodeIcon = Code;
  protected readonly SearchIcon = Search;
  protected readonly SettingsIcon = Settings;
  protected readonly PaletteIcon = Palette;
  protected readonly PackageIcon = Package;

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
      (a, b) => b.relevanceScore - a.relevanceScore,
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
   * Agents grouped by category (memoized).
   * Computed once per signal change instead of per template iteration.
   */
  protected readonly agentsByCategory = computed(() => {
    const agents = this.sortedRecommendations();
    const grouped = new Map<AgentCategory | 'other', AgentRecommendation[]>();

    for (const category of this.categoryOrder) {
      if (category === 'other') {
        const others = agents.filter(
          (agent) =>
            !this.knownCategories.includes(agent.category as AgentCategory),
        );
        if (others.length > 0) grouped.set('other', others);
      } else {
        const matched = agents.filter((agent) => agent.category === category);
        if (matched.length > 0) grouped.set(category, matched);
      }
    }

    return grouped;
  });

  /**
   * Get agents for a category from the memoized map.
   */
  protected getAgentsByCategory(
    category: AgentCategory | 'other',
  ): AgentRecommendation[] {
    return this.agentsByCategory().get(category) ?? [];
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
   * Get Lucide icon for agent category.
   * Replaces emoji-based category icons with proper Lucide icon components.
   */
  protected getCategoryLucideIcon(category: AgentCategory | 'other') {
    switch (category) {
      case 'planning':
        return this.LayoutDashboardIcon;
      case 'development':
        return this.CodeIcon;
      case 'qa':
        return this.SearchIcon;
      case 'specialist':
        return this.SettingsIcon;
      case 'creative':
        return this.PaletteIcon;
      case 'other':
      default:
        return this.PackageIcon;
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
        (r) => r.agentId === agentId,
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
        const multiPhase = this.wizardState.multiPhaseResult();

        if (!multiPhase) {
          throw new Error(
            'No analysis data available. Please re-run the wizard scan.',
          );
        }

        // Submit selection with multi-phase analysisDir
        const response = await this.wizardRpc.submitAgentSelection(
          selectedAgents,
          multiPhase.analysisDir,
        );

        // Verify backend acknowledgment before transitioning
        if (!response?.success) {
          throw new Error(
            response?.error ?? 'Backend did not acknowledge selection',
          );
        }

        return response;
      },
      'Starting agent generation',
      (error) => {
        this.errorMessage.set(error.message);
        console.error(
          'Agent generation failed:',
          error.details ?? error.message,
        );
      },
    );

    if (result) {
      // Initialize generation progress items from selected agents.
      // This MUST happen before transitioning so handleGenerationProgress()
      // can update per-item status (it silently ignores updates when items.length === 0).
      const selectedAgentIds = Object.entries(
        this.wizardState.selectedAgentsMap(),
      )
        .filter(([_, isSelected]) => isSelected)
        .map(([agentId]) => agentId);

      const progressItems: SkillGenerationProgressItem[] = selectedAgentIds.map(
        (agentId) => {
          const recommendation = this.sortedRecommendations().find(
            (r) => r.agentId === agentId,
          );
          return {
            id: agentId,
            name: recommendation?.agentName ?? agentId,
            type: 'agent' as const,
            status: 'pending' as const,
            progress: 0,
          };
        },
      );

      this.wizardState.setSkillGenerationProgress(progressItems);

      // Transition to generation step. Backend generation runs and the user
      // sees real-time progress. After generation completes, they proceed
      // to the enhance step for Enhanced Prompts.
      this.wizardState.setCurrentStep('generation');
    }

    // Always reset loading state
    this.isGenerating.set(false);
  }
}
