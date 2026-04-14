import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  Layers,
  LucideAngularModule,
  RefreshCw,
  User,
} from 'lucide-angular';
import type { AgentRecommendation } from '@ptah-extension/shared';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

/**
 * All 13 agents as recommendations with score 100 for the new-project path.
 * The new-project flow skips analysis, so all agents are recommended equally.
 */
const ALL_AGENT_RECOMMENDATIONS: AgentRecommendation[] = [
  {
    agentId: 'project-manager',
    agentName: 'Project Manager',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'planning',
    recommended: true,
  },
  {
    agentId: 'software-architect',
    agentName: 'Software Architect',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'planning',
    recommended: true,
  },
  {
    agentId: 'team-leader',
    agentName: 'Team Leader',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'planning',
    recommended: true,
  },
  {
    agentId: 'backend-developer',
    agentName: 'Backend Developer',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'development',
    recommended: true,
  },
  {
    agentId: 'frontend-developer',
    agentName: 'Frontend Developer',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'development',
    recommended: true,
  },
  {
    agentId: 'devops-engineer',
    agentName: 'DevOps Engineer',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'development',
    recommended: true,
  },
  {
    agentId: 'senior-tester',
    agentName: 'Senior Tester',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'qa',
    recommended: true,
  },
  {
    agentId: 'code-style-reviewer',
    agentName: 'Code Style Reviewer',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'qa',
    recommended: true,
  },
  {
    agentId: 'code-logic-reviewer',
    agentName: 'Code Logic Reviewer',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'qa',
    recommended: true,
  },
  {
    agentId: 'researcher-expert',
    agentName: 'Researcher Expert',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'specialist',
    recommended: true,
  },
  {
    agentId: 'modernization-detector',
    agentName: 'Modernization Detector',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'specialist',
    recommended: true,
  },
  {
    agentId: 'ui-ux-designer',
    agentName: 'UI/UX Designer',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'creative',
    recommended: true,
  },
  {
    agentId: 'technical-content-writer',
    agentName: 'Technical Content Writer',
    relevanceScore: 100,
    matchedCriteria: ['New project setup'],
    category: 'creative',
    recommended: true,
  },
];

/**
 * PlanReviewComponent - Displays the generated master plan for user review
 *
 * Purpose:
 * - Show the project summary (name, type, tech stack)
 * - Display architecture decisions as collapsible cards
 * - Show directory structure in a pre-formatted block
 * - Render implementation phases with tasks and agent assignments
 * - Provide "Approve & Continue" and "Regenerate" actions
 *
 * Usage:
 * ```html
 * <ptah-plan-review />
 * ```
 */
@Component({
  selector: 'ptah-plan-review',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-fadeIn {
        animation: fadeIn 0.5s ease-out;
      }
      @media (prefers-reduced-motion: reduce) {
        .animate-fadeIn {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <div class="h-full overflow-y-auto px-3 py-4">
      <div class="w-full max-w-3xl mx-auto animate-fadeIn">
        @if (plan()) {
          <!-- Project Summary -->
          <div class="text-center mb-6">
            <h1 class="text-lg font-bold mb-1">{{ plan()!.projectName }}</h1>
            <p class="text-xs text-base-content/60 mb-3">
              {{ plan()!.summary }}
            </p>
            <div class="flex flex-wrap justify-center gap-2">
              <span class="badge badge-primary badge-sm">
                {{ formatProjectType(plan()!.projectType) }}
              </span>
              @for (tech of plan()!.techStack; track tech) {
                <span class="badge badge-outline badge-sm">{{ tech }}</span>
              }
            </div>
          </div>

          <!-- Architecture Decisions -->
          @if (plan()!.architectureDecisions.length > 0) {
            <div class="mb-6">
              <div class="flex items-center gap-2 mb-3">
                <lucide-angular
                  [img]="LayersIcon"
                  class="w-4 h-4 text-primary"
                  aria-hidden="true"
                />
                <h2 class="text-sm font-semibold">Architecture Decisions</h2>
              </div>

              <div class="space-y-2">
                @for (
                  decision of plan()!.architectureDecisions;
                  track decision.area
                ) {
                  <div
                    class="border border-base-300 rounded-lg bg-base-200/30 overflow-hidden"
                  >
                    <button
                      class="w-full flex items-center justify-between p-3 text-left
                             hover:bg-base-200/50 transition-colors"
                      (click)="toggleDecision(decision.area)"
                      [attr.aria-expanded]="isDecisionExpanded(decision.area)"
                      [attr.aria-controls]="'decision-' + decision.area"
                    >
                      <div class="flex items-center gap-2">
                        <span class="badge badge-sm badge-ghost">{{
                          decision.area
                        }}</span>
                        <span class="text-xs font-medium">{{
                          decision.decision
                        }}</span>
                      </div>
                      <lucide-angular
                        [img]="
                          isDecisionExpanded(decision.area)
                            ? ChevronDownIcon
                            : ChevronRightIcon
                        "
                        class="w-4 h-4 text-base-content/40 shrink-0"
                        aria-hidden="true"
                      />
                    </button>
                    @if (isDecisionExpanded(decision.area)) {
                      <div
                        class="px-3 pb-3 text-xs text-base-content/60"
                        [id]="'decision-' + decision.area"
                      >
                        <p class="border-t border-base-300 pt-2">
                          {{ decision.rationale }}
                        </p>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          }

          <!-- Directory Structure -->
          @if (plan()!.directoryStructure) {
            <div class="mb-6">
              <div class="flex items-center gap-2 mb-3">
                <lucide-angular
                  [img]="FolderTreeIcon"
                  class="w-4 h-4 text-secondary"
                  aria-hidden="true"
                />
                <h2 class="text-sm font-semibold">Directory Structure</h2>
              </div>

              <div class="bg-base-200 rounded-lg p-3 overflow-x-auto">
                <pre
                  class="text-xs text-base-content/80 whitespace-pre font-mono"
                  >{{ plan()!.directoryStructure }}</pre
                >
              </div>
            </div>
          }

          <!-- Implementation Phases -->
          @if (plan()!.phases.length > 0) {
            <div class="mb-6">
              <div class="flex items-center gap-2 mb-3">
                <lucide-angular
                  [img]="FileTextIcon"
                  class="w-4 h-4 text-accent"
                  aria-hidden="true"
                />
                <h2 class="text-sm font-semibold">
                  Implementation Phases
                  <span class="text-base-content/40 font-normal ml-1">
                    ({{ plan()!.phases.length }})
                  </span>
                </h2>
              </div>

              <div class="space-y-3">
                @for (
                  phase of plan()!.phases;
                  track phase.id;
                  let phaseIdx = $index
                ) {
                  <div
                    class="border border-base-300 rounded-lg bg-base-200/30 p-3"
                  >
                    <div class="flex items-center gap-2 mb-2">
                      <span class="badge badge-sm badge-primary">
                        Phase {{ phaseIdx + 1 }}
                      </span>
                      <h3 class="text-xs font-semibold">{{ phase.name }}</h3>
                    </div>

                    <p class="text-xs text-base-content/60 mb-3">
                      {{ phase.description }}
                    </p>

                    @if (phase.dependsOn.length > 0) {
                      <p class="text-xs text-base-content/40 mb-2">
                        Depends on:
                        @for (
                          dep of phase.dependsOn;
                          track dep;
                          let last = $last
                        ) {
                          <span class="font-medium">{{ dep }}</span
                          >{{ last ? '' : ', ' }}
                        }
                      </p>
                    }

                    <!-- Tasks -->
                    @if (phase.tasks.length > 0) {
                      <div class="space-y-1.5">
                        @for (task of phase.tasks; track task.id) {
                          <div
                            class="flex items-start gap-2 bg-base-100/50 rounded p-2"
                          >
                            <lucide-angular
                              [img]="UserIcon"
                              class="w-3.5 h-3.5 text-base-content/40 mt-0.5 shrink-0"
                              aria-hidden="true"
                            />
                            <div class="min-w-0">
                              <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-medium">{{
                                  task.title
                                }}</span>
                                <span class="badge badge-xs badge-ghost">
                                  {{ formatAgentType(task.agentType) }}
                                </span>
                              </div>
                              <p class="text-xs text-base-content/50 mt-0.5">
                                {{ task.description }}
                              </p>
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          }

          <!-- Actions -->
          <div class="flex justify-center gap-3 py-4 border-t border-base-300">
            <button
              class="btn btn-ghost btn-sm"
              [disabled]="isApproving()"
              (click)="onRegenerate()"
              aria-label="Regenerate plan"
            >
              <lucide-angular
                [img]="RefreshCwIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
              Regenerate
            </button>

            <button
              class="btn btn-primary btn-sm"
              [disabled]="isApproving()"
              (click)="onApprove()"
              aria-label="Approve plan and continue"
            >
              @if (isApproving()) {
                <span class="loading loading-spinner loading-xs"></span>
                Approving...
              } @else {
                <lucide-angular
                  [img]="CheckCircleIcon"
                  class="w-4 h-4"
                  aria-hidden="true"
                />
                Approve & Continue
              }
            </button>
          </div>

          <!-- Error state -->
          @if (errorMessage()) {
            <div class="alert alert-error text-xs mt-3">
              <span>{{ errorMessage() }}</span>
            </div>
          }
        } @else {
          <!-- No plan available -->
          <div class="text-center py-8">
            <p class="text-xs text-base-content/60">
              No plan available. Please go back and generate one.
            </p>
            <button class="btn btn-ghost btn-sm mt-3" (click)="onRegenerate()">
              Go Back
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class PlanReviewComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly FileTextIcon = FileText;
  protected readonly FolderTreeIcon = FolderTree;
  protected readonly LayersIcon = Layers;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly UserIcon = User;

  protected readonly plan = this.wizardState.masterPlan;
  protected readonly isApproving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly expandedDecisions = signal<Set<string>>(new Set());

  /**
   * Toggle expansion of an architecture decision card.
   */
  protected toggleDecision(area: string): void {
    this.expandedDecisions.update((current) => {
      const next = new Set(current);
      if (next.has(area)) {
        next.delete(area);
      } else {
        next.add(area);
      }
      return next;
    });
  }

  /**
   * Check if an architecture decision is expanded.
   */
  protected isDecisionExpanded(area: string): boolean {
    return this.expandedDecisions().has(area);
  }

  /**
   * Format project type ID to a human-readable label.
   */
  protected formatProjectType(typeId: string): string {
    const labels: Record<string, string> = {
      'full-saas': 'Full SaaS',
      'nestjs-api': 'NestJS API',
      'angular-app': 'Angular App',
      'react-app': 'React App',
    };
    return labels[typeId] ?? typeId;
  }

  /**
   * Format agent type to a human-readable label.
   */
  protected formatAgentType(agentType: string): string {
    return agentType
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Approve the plan and navigate to agent selection.
   * Populates all 13 agents as recommendations since the new-project path
   * skips analysis-based scoring.
   */
  protected async onApprove(): Promise<void> {
    this.isApproving.set(true);
    this.errorMessage.set(null);

    try {
      await this.wizardRpc.approvePlan(true);
      // Populate all 13 agents as recommended before navigating to selection
      this.wizardState.setRecommendations(ALL_AGENT_RECOMMENDATIONS);
      this.wizardState.setCurrentStep('selection');
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to approve plan',
      );
    } finally {
      this.isApproving.set(false);
    }
  }

  /**
   * Go back to plan generation to regenerate the plan.
   */
  protected onRegenerate(): void {
    this.wizardState.setMasterPlan(null);
    this.wizardState.setForceRegenerate(true);
    this.wizardState.setCurrentStep('plan-generation');
  }
}
