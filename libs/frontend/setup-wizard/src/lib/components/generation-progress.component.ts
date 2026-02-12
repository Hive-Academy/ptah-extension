import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
} from '@angular/core';
import {
  Check,
  CircleAlert,
  CircleCheck,
  LucideAngularModule,
  RotateCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { AnalysisTranscriptComponent } from './analysis-transcript.component';

/**
 * GenerationProgressComponent - Detailed generation progress with grouped items and retry
 *
 * Purpose:
 * - Track agents, commands, and skill files separately
 * - Show individual progress for each item
 * - Display total progress (agents + commands + skill)
 * - Handle partial failures with retry per item
 * - Group items by type for clear organization
 *
 * Features:
 * - Overall progress bar at top with percentage
 * - Grouped sections: Agents, Commands, Skill Files
 * - Per-item progress cards with status badges
 * - Loading spinner for in-progress items
 * - Checkmark for completed items
 * - Error state with retry button per failed item
 * - Duration display for completed items
 * - Signal-based reactive updates
 *
 * Usage:
 * ```html
 * <ptah-generation-progress />
 * ```
 */
@Component({
  selector: 'ptah-generation-progress',
  standalone: true,
  imports: [LucideAngularModule, AnalysisTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-4 py-8">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <h2 class="text-3xl font-bold mb-2">Generating Your Configuration</h2>
          <p class="text-base-content/70">
            Creating customized agents, commands, and orchestration skill
            files...
          </p>
        </div>

        <!-- Overall progress section -->
        <div class="card bg-base-200 shadow-xl mb-8">
          <div class="card-body">
            <div class="flex justify-between items-center mb-2">
              <span class="text-lg font-semibold"> Overall Progress </span>
              <span class="text-lg font-bold text-primary">
                {{ completionPercentage() }}%
              </span>
            </div>
            <progress
              class="progress progress-primary w-full h-4"
              [value]="completionPercentage()"
              max="100"
              role="progressbar"
              [attr.aria-valuenow]="completionPercentage()"
              [attr.aria-valuemin]="0"
              [attr.aria-valuemax]="100"
              aria-label="Overall generation progress"
            ></progress>
            <div class="flex justify-between text-sm text-base-content/60 mt-2">
              <span
                >{{ completedCount() }} of {{ totalCount() }} items
                completed</span
              >
              @if (failedCount() > 0) {
              <span class="text-error">{{ failedCount() }} failed</span>
              }
            </div>
          </div>
        </div>

        <!-- Agent Activity Log (collapsible stream transcript) -->
        @if (hasStreamMessages()) {
        <div class="collapse collapse-arrow bg-base-200 mb-8">
          <input type="checkbox" aria-label="Toggle agent activity log" />
          <div class="collapse-title text-lg font-medium">
            Agent Activity Log
            <span class="badge badge-sm ml-2">{{ streamMessageCount() }}</span>
          </div>
          <div class="collapse-content">
            <ptah-analysis-transcript [messages]="generationStream()" />
          </div>
        </div>
        }

        <!-- Agents Section -->
        @if (agentItems().length > 0) {
        <div class="mb-8">
          <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
            <span class="badge badge-primary badge-lg">🤖</span>
            Agent Files
            <span class="text-sm text-base-content/60 font-normal">
              ({{ getCompletedCountByType('agent') }}/{{ agentItems().length }})
            </span>
          </h3>
          <div class="space-y-3">
            @for (item of agentItems(); track item.id) {
            <div
              class="card card-compact bg-base-100 shadow-md"
              [class.border-error]="item.status === 'error'"
              [class.border-l-4]="item.status === 'error'"
            >
              <div class="card-body">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3 flex-1 min-w-0">
                    <!-- Status indicator -->
                    @switch (item.status) { @case ('pending') {
                    <div class="badge badge-outline badge-sm">Pending</div>
                    } @case ('in-progress') {
                    <span
                      class="loading loading-spinner loading-sm text-primary"
                    ></span>
                    } @case ('complete') {
                    <lucide-angular
                      [img]="CircleCheckIcon"
                      class="h-6 w-6 text-success"
                      aria-hidden="true"
                    />
                    } @case ('error') {
                    <lucide-angular
                      [img]="CircleAlertIcon"
                      class="h-6 w-6 text-error"
                      aria-hidden="true"
                    />
                    } }

                    <!-- Item name and progress -->
                    <div class="flex-1 min-w-0">
                      <div class="font-semibold truncate" [title]="item.name">
                        {{ item.name }}
                      </div>
                      @if (item.status === 'in-progress' && item.progress !==
                      undefined) {
                      <div class="flex items-center gap-2 mt-1">
                        <progress
                          class="progress progress-primary w-32 h-1"
                          [value]="item.progress"
                          max="100"
                        ></progress>
                        <span class="text-xs text-base-content/60"
                          >{{ item.progress }}%</span
                        >
                      </div>
                      } @if (item.status === 'error' && item.errorMessage) {
                      <p class="text-sm text-error mt-1">
                        {{ item.errorMessage }}
                      </p>
                      }
                    </div>
                  </div>

                  <!-- Retry button for failed items -->
                  @if (item.status === 'error') { @if (canRetry(item.id)) {
                  <button
                    class="btn btn-error btn-sm"
                    (click)="onRetryItem(item.id)"
                    [attr.aria-label]="
                      'Retry ' +
                      item.name +
                      ' (' +
                      getRemainingRetries(item.id) +
                      ' attempts remaining)'
                    "
                  >
                    <lucide-angular
                      [img]="RotateCwIcon"
                      class="h-4 w-4"
                      aria-hidden="true"
                    />
                    Retry ({{ getRemainingRetries(item.id) }} left)
                  </button>
                  } @else {
                  <span class="text-error text-sm font-medium"
                    >Max retries reached</span
                  >
                  } }
                </div>
              </div>
            </div>
            }
          </div>
        </div>
        }

        <!-- Commands Section -->
        @if (commandItems().length > 0) {
        <div class="mb-8">
          <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
            <span class="badge badge-secondary badge-lg">⌨️</span>
            Command Files
            <span class="text-sm text-base-content/60 font-normal">
              ({{ getCompletedCountByType('command') }}/{{
                commandItems().length
              }})
            </span>
          </h3>
          <div class="space-y-3">
            @for (item of commandItems(); track item.id) {
            <div
              class="card card-compact bg-base-100 shadow-md"
              [class.border-error]="item.status === 'error'"
              [class.border-l-4]="item.status === 'error'"
            >
              <div class="card-body">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3 flex-1 min-w-0">
                    <!-- Status indicator -->
                    @switch (item.status) { @case ('pending') {
                    <div class="badge badge-outline badge-sm">Pending</div>
                    } @case ('in-progress') {
                    <span
                      class="loading loading-spinner loading-sm text-secondary"
                    ></span>
                    } @case ('complete') {
                    <lucide-angular
                      [img]="CircleCheckIcon"
                      class="h-6 w-6 text-success"
                      aria-hidden="true"
                    />
                    } @case ('error') {
                    <lucide-angular
                      [img]="CircleAlertIcon"
                      class="h-6 w-6 text-error"
                      aria-hidden="true"
                    />
                    } }

                    <!-- Item name and progress -->
                    <div class="flex-1 min-w-0">
                      <div class="font-semibold truncate" [title]="item.name">
                        {{ item.name }}
                      </div>
                      @if (item.status === 'in-progress' && item.progress !==
                      undefined) {
                      <div class="flex items-center gap-2 mt-1">
                        <progress
                          class="progress progress-secondary w-32 h-1"
                          [value]="item.progress"
                          max="100"
                        ></progress>
                        <span class="text-xs text-base-content/60"
                          >{{ item.progress }}%</span
                        >
                      </div>
                      } @if (item.status === 'error' && item.errorMessage) {
                      <p class="text-sm text-error mt-1">
                        {{ item.errorMessage }}
                      </p>
                      }
                    </div>
                  </div>

                  <!-- Retry button for failed items -->
                  @if (item.status === 'error') { @if (canRetry(item.id)) {
                  <button
                    class="btn btn-error btn-sm"
                    (click)="onRetryItem(item.id)"
                    [attr.aria-label]="
                      'Retry ' +
                      item.name +
                      ' (' +
                      getRemainingRetries(item.id) +
                      ' attempts remaining)'
                    "
                  >
                    <lucide-angular
                      [img]="RotateCwIcon"
                      class="h-4 w-4"
                      aria-hidden="true"
                    />
                    Retry ({{ getRemainingRetries(item.id) }} left)
                  </button>
                  } @else {
                  <span class="text-error text-sm font-medium"
                    >Max retries reached</span
                  >
                  } }
                </div>
              </div>
            </div>
            }
          </div>
        </div>
        }

        <!-- Skill Files Section -->
        @if (skillFileItems().length > 0) {
        <div class="mb-8">
          <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
            <span class="badge badge-accent badge-lg">📝</span>
            Orchestration Skill Files
            <span class="text-sm text-base-content/60 font-normal">
              ({{ getCompletedCountByType('skill-file') }}/{{
                skillFileItems().length
              }})
            </span>
          </h3>
          <div class="space-y-3">
            @for (item of skillFileItems(); track item.id) {
            <div
              class="card card-compact bg-base-100 shadow-md"
              [class.border-error]="item.status === 'error'"
              [class.border-l-4]="item.status === 'error'"
            >
              <div class="card-body">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3 flex-1 min-w-0">
                    <!-- Status indicator -->
                    @switch (item.status) { @case ('pending') {
                    <div class="badge badge-outline badge-sm">Pending</div>
                    } @case ('in-progress') {
                    <span
                      class="loading loading-spinner loading-sm text-accent"
                    ></span>
                    } @case ('complete') {
                    <lucide-angular
                      [img]="CircleCheckIcon"
                      class="h-6 w-6 text-success"
                      aria-hidden="true"
                    />
                    } @case ('error') {
                    <lucide-angular
                      [img]="CircleAlertIcon"
                      class="h-6 w-6 text-error"
                      aria-hidden="true"
                    />
                    } }

                    <!-- Item name and progress -->
                    <div class="flex-1 min-w-0">
                      <div class="font-semibold truncate" [title]="item.name">
                        {{ item.name }}
                      </div>
                      @if (item.status === 'in-progress' && item.progress !==
                      undefined) {
                      <div class="flex items-center gap-2 mt-1">
                        <progress
                          class="progress progress-accent w-32 h-1"
                          [value]="item.progress"
                          max="100"
                        ></progress>
                        <span class="text-xs text-base-content/60"
                          >{{ item.progress }}%</span
                        >
                      </div>
                      } @if (item.status === 'error' && item.errorMessage) {
                      <p class="text-sm text-error mt-1">
                        {{ item.errorMessage }}
                      </p>
                      }
                    </div>
                  </div>

                  <!-- Retry button for failed items -->
                  @if (item.status === 'error') { @if (canRetry(item.id)) {
                  <button
                    class="btn btn-error btn-sm"
                    (click)="onRetryItem(item.id)"
                    [attr.aria-label]="
                      'Retry ' +
                      item.name +
                      ' (' +
                      getRemainingRetries(item.id) +
                      ' attempts remaining)'
                    "
                  >
                    <lucide-angular
                      [img]="RotateCwIcon"
                      class="h-4 w-4"
                      aria-hidden="true"
                    />
                    Retry ({{ getRemainingRetries(item.id) }} left)
                  </button>
                  } @else {
                  <span class="text-error text-sm font-medium"
                    >Max retries reached</span
                  >
                  } }
                </div>
              </div>
            </div>
            }
          </div>
        </div>
        }

        <!-- Enhanced Prompts Section -->
        @if (isAgentGenerationComplete()) {
        <div class="mb-8">
          <h3 class="text-xl font-semibold mb-4 flex items-center gap-2">
            <span class="badge badge-warning badge-lg">
              <lucide-angular
                [img]="SparklesIcon"
                class="h-4 w-4"
                aria-hidden="true"
              />
            </span>
            Enhanced Prompts @if (enhancedPromptsStatus() === 'complete') {
            <span class="text-sm text-base-content/60 font-normal">
              (Generated)
            </span>
            } @else if (enhancedPromptsStatus() === 'error') {
            <span class="text-sm text-error font-normal"> (Failed) </span>
            }
          </h3>
          <div
            class="card card-compact bg-base-100 shadow-md"
            [class.border-error]="enhancedPromptsStatus() === 'error'"
            [class.border-l-4]="enhancedPromptsStatus() === 'error'"
          >
            <div class="card-body">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3 flex-1 min-w-0">
                  <!-- Status indicator -->
                  @switch (enhancedPromptsStatus()) { @case ('idle') {
                  <div class="badge badge-outline badge-sm">Pending</div>
                  } @case ('generating') {
                  <span
                    class="loading loading-spinner loading-sm text-warning"
                  ></span>
                  } @case ('complete') {
                  <lucide-angular
                    [img]="CircleCheckIcon"
                    class="h-6 w-6 text-success"
                    aria-hidden="true"
                  />
                  } @case ('error') {
                  <lucide-angular
                    [img]="CircleAlertIcon"
                    class="h-6 w-6 text-error"
                    aria-hidden="true"
                  />
                  } @case ('skipped') {
                  <div class="badge badge-ghost badge-sm">Skipped</div>
                  } }

                  <div class="flex-1 min-w-0">
                    <div class="font-semibold">
                      Project-Specific Prompt Guidance
                    </div>
                    <p class="text-sm text-base-content/60 mt-0.5">
                      @switch (enhancedPromptsStatus()) { @case ('idle') {
                      Waiting for agent generation to complete... } @case
                      ('generating') { Analyzing workspace and generating
                      project-specific guidance... } @case ('complete') {
                      Enhanced prompts generated and enabled for your workspace.
                      @if (enhancedPromptsStack().length > 0) {
                      <span class="block mt-1">
                        Detected:
                        {{ enhancedPromptsStack().join(', ') }}
                      </span>
                      } } @case ('error') {
                      {{ enhancedPromptsErrorMsg() }}
                      } @case ('skipped') { Skipped (requires Pro license). } }
                    </p>
                  </div>
                </div>

                @if (enhancedPromptsStatus() === 'error') {
                <span class="badge badge-error badge-sm">Failed</span>
                }
              </div>
            </div>
          </div>
        </div>
        }

        <!-- Empty state -->
        @if (totalCount() === 0) { @if (hasCompletedWithError()) {
        <!-- Generation failed before items were created (e.g. template loading error) -->
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body items-center text-center py-12">
            <lucide-angular
              [img]="CircleAlertIcon"
              class="h-12 w-12 text-error mb-4"
              aria-hidden="true"
            />
            <h3 class="text-xl font-semibold mb-2">Generation Failed</h3>
            @for (err of completionErrors(); track err) {
            <p class="text-sm text-error mb-1">{{ err }}</p>
            }
            <button class="btn btn-primary btn-sm mt-4" (click)="onContinue()">
              Continue
            </button>
          </div>
        </div>
        } @else {
        <div class="card bg-base-200 shadow-xl">
          <div class="card-body items-center text-center py-12">
            <span
              class="loading loading-spinner loading-lg text-primary mb-4"
            ></span>
            <h3 class="text-xl font-semibold mb-2">Initializing Generation</h3>
            <p class="text-base-content/60">
              Please wait while we prepare your configuration files...
            </p>
          </div>
        </div>
        } }

        <!-- Completion section (visible when agents AND Enhanced Prompts are done) -->
        @if (isFullyComplete()) {
        <div
          class="alert mb-6"
          [class.alert-success]="failedCount() === 0"
          [class.alert-warning]="failedCount() > 0"
        >
          @if (failedCount() === 0) {
          <lucide-angular
            [img]="CircleCheckIcon"
            class="h-6 w-6 shrink-0 stroke-current"
            aria-hidden="true"
          />
          <div>
            <div class="font-semibold">Generation Complete!</div>
            <div class="text-sm">
              All {{ completedCount() }} items generated successfully.
            </div>
          </div>
          } @else {
          <lucide-angular
            [img]="TriangleAlertIcon"
            class="h-6 w-6 shrink-0 stroke-current"
            aria-hidden="true"
          />
          <div>
            <div class="font-semibold">Generation Completed with Errors</div>
            <div class="text-sm">
              {{ completedCount() }} items generated,
              {{ failedCount() }} failed. You can retry failed items or
              continue.
            </div>
          </div>
          }
        </div>

        <div class="flex justify-end">
          <button class="btn btn-primary btn-lg" (click)="onContinue()">
            <lucide-angular
              [img]="CheckIcon"
              class="h-5 w-5"
              aria-hidden="true"
            />
            Continue to Completion
          </button>
        </div>
        }
      </div>
    </div>
  `,
})
export class GenerationProgressComponent implements OnDestroy {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  /** Lucide icon references for template binding */
  protected readonly CircleCheckIcon = CircleCheck;
  protected readonly CircleAlertIcon = CircleAlert;
  protected readonly RotateCwIcon = RotateCw;
  protected readonly CheckIcon = Check;
  protected readonly TriangleAlertIcon = TriangleAlert;
  protected readonly SparklesIcon = Sparkles;

  /**
   * Maximum retry attempts per item.
   * After this limit, retry button is disabled and user sees error message.
   */
  private static readonly MAX_RETRIES = 3;

  /**
   * Base delay for exponential backoff in milliseconds.
   * Actual delay = BASE_DELAY_MS * 2^(retryCount - 1)
   * Example: 1s, 2s, 4s for retries 1, 2, 3
   */
  private static readonly BASE_DELAY_MS = 1000;

  /**
   * Track pending retry operations.
   * Prevents duplicate concurrent retries for the same item.
   */
  private pendingRetries = new Set<string>();

  /**
   * Track retry count per item ID.
   * Used to enforce MAX_RETRIES limit and calculate backoff delay.
   */
  private retryCounts = new Map<string, number>();

  /**
   * Generation stream messages from state service for the activity log transcript.
   */
  protected readonly generationStream = this.wizardState.generationStream;

  /**
   * Whether there are any generation stream messages to display.
   */
  protected readonly hasStreamMessages = computed(
    () => this.generationStream().length > 0
  );

  /**
   * Count of generation stream messages for the badge.
   */
  protected readonly streamMessageCount = computed(
    () => this.generationStream().length
  );

  /**
   * All skill generation progress items from state service.
   */
  protected readonly progressItems = this.wizardState.skillGenerationProgress;

  /**
   * Items filtered by type: agent.
   */
  protected readonly agentItems = computed(() => {
    return this.progressItems().filter((item) => item.type === 'agent');
  });

  /**
   * Items filtered by type: command.
   */
  protected readonly commandItems = computed(() => {
    return this.progressItems().filter((item) => item.type === 'command');
  });

  /**
   * Items filtered by type: skill-file.
   */
  protected readonly skillFileItems = computed(() => {
    return this.progressItems().filter((item) => item.type === 'skill-file');
  });

  /**
   * Total count of all items.
   */
  protected readonly totalCount = computed(() => {
    return this.progressItems().length;
  });

  /**
   * Count of completed items.
   */
  protected readonly completedCount = computed(() => {
    return this.progressItems().filter((item) => item.status === 'complete')
      .length;
  });

  /**
   * Count of failed items.
   */
  protected readonly failedCount = computed(() => {
    return this.wizardState.failedGenerationItems().length;
  });

  /**
   * Overall completion percentage.
   */
  protected readonly completionPercentage = computed(() => {
    return this.wizardState.generationCompletionPercentage();
  });

  /**
   * Whether all agent/command/skill items are complete (success or error).
   */
  protected readonly isAgentGenerationComplete = computed(() => {
    return this.wizardState.isGenerationComplete();
  });

  /**
   * Enhanced Prompts generation status from state service.
   */
  protected readonly enhancedPromptsStatus =
    this.wizardState.enhancedPromptsStatus;

  /**
   * Enhanced Prompts error message.
   */
  protected readonly enhancedPromptsErrorMsg =
    this.wizardState.enhancedPromptsError;

  /**
   * Enhanced Prompts detected stack labels.
   */
  protected readonly enhancedPromptsStack = computed(() => {
    return this.wizardState.enhancedPromptsDetectedStack() ?? [];
  });

  /**
   * Whether generation is fully complete.
   * The "Continue to Completion" button only appears when this is true.
   * Enhanced Prompts generation now runs in the preceding Enhance step.
   */
  protected readonly isFullyComplete = computed(() => {
    return this.wizardState.isGenerationComplete();
  });

  /**
   * Whether generation completed with an error before any items were created.
   * This happens when template loading fails, causing the orchestrator to fail
   * at Phase 2 before individual agent progress items are broadcasted.
   */
  protected readonly hasCompletedWithError = computed(() => {
    const completion = this.wizardState.completionData();
    return (
      completion !== null && !completion.success && this.totalCount() === 0
    );
  });

  /**
   * Error messages from completion data (for early failure display).
   */
  protected readonly completionErrors = computed(() => {
    return this.wizardState.completionData()?.errors ?? [];
  });

  /**
   * Auto-transition to completion when generation finished during a prior step.
   * If the user arrives at the generation step and completionData already exists
   * with progress items tracked, transition to completion immediately.
   */
  private readonly autoCompleteEffect = effect(() => {
    const completion = this.wizardState.completionData();
    const items = this.progressItems();
    // Only auto-transition if generation produced tracked items that are all done
    if (completion && items.length > 0 && this.isFullyComplete()) {
      queueMicrotask(() => this.wizardState.setCurrentStep('completion'));
    }
  });

  /**
   * Get completed count for a specific item type.
   */
  protected getCompletedCountByType(
    type: 'agent' | 'command' | 'skill-file'
  ): number {
    return this.progressItems().filter(
      (item) => item.type === type && item.status === 'complete'
    ).length;
  }

  /**
   * Check if an item can be retried.
   * Returns false if max retries reached or retry is already pending.
   *
   * @param itemId - Item identifier to check
   * @returns true if retry is allowed
   */
  protected canRetry(itemId: string): boolean {
    const count = this.retryCounts.get(itemId) ?? 0;
    return (
      count < GenerationProgressComponent.MAX_RETRIES &&
      !this.pendingRetries.has(itemId)
    );
  }

  /**
   * Get remaining retry count for display in UI.
   *
   * @param itemId - Item identifier
   * @returns Number of retries remaining (0 to MAX_RETRIES)
   */
  protected getRemainingRetries(itemId: string): number {
    const count = this.retryCounts.get(itemId) ?? 0;
    return Math.max(0, GenerationProgressComponent.MAX_RETRIES - count);
  }

  /**
   * Retry a failed generation item with exponential backoff.
   * - Enforces MAX_RETRIES limit per item
   * - Prevents duplicate concurrent retries
   * - Applies exponential backoff delay
   * - Updates UI with remaining retries count
   *
   * @param itemId - Item identifier to retry
   */
  protected async onRetryItem(itemId: string): Promise<void> {
    const currentRetries = this.retryCounts.get(itemId) ?? 0;

    // Check if max retries reached
    if (currentRetries >= GenerationProgressComponent.MAX_RETRIES) {
      this.wizardState.updateSkillGenerationItem(itemId, {
        status: 'error',
        errorMessage: `Maximum retry attempts (${GenerationProgressComponent.MAX_RETRIES}) reached. Please contact support or try again later.`,
      });
      return;
    }

    // Prevent concurrent retries for same item
    if (this.pendingRetries.has(itemId)) {
      return;
    }

    this.pendingRetries.add(itemId);
    this.retryCounts.set(itemId, currentRetries + 1);

    // Apply exponential backoff delay: 1s, 2s, 4s
    const delay =
      GenerationProgressComponent.BASE_DELAY_MS * Math.pow(2, currentRetries);
    await new Promise((resolve) => setTimeout(resolve, delay));

    // Reset item status to pending
    this.wizardState.retryGenerationItem(itemId);

    try {
      // Trigger regeneration via RPC
      await this.wizardRpc.retryGenerationItem(itemId);
    } catch (error) {
      // Update item with error status and remaining retries info
      const message = error instanceof Error ? error.message : 'Retry failed';
      const retriesLeft =
        GenerationProgressComponent.MAX_RETRIES - (currentRetries + 1);

      this.wizardState.updateSkillGenerationItem(itemId, {
        status: 'error',
        errorMessage:
          retriesLeft > 0
            ? `${message} (${retriesLeft} ${
                retriesLeft === 1 ? 'retry' : 'retries'
              } remaining)`
            : `${message}. Maximum retries reached.`,
      });
    } finally {
      this.pendingRetries.delete(itemId);
    }
  }

  /**
   * Continue to completion step.
   */
  protected onContinue(): void {
    this.wizardState.setCurrentStep('completion');
  }

  /**
   * Cleanup on component destruction.
   * Clears pending retries and retry counts to prevent memory leaks.
   */
  ngOnDestroy(): void {
    this.pendingRetries.clear();
    this.retryCounts.clear();
  }
}
