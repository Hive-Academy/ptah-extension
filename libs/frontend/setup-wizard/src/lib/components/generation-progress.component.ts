import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
} from '@angular/core';
import {
  Check,
  CircleAlert,
  CircleCheck,
  LucideAngularModule,
  RotateCw,
  TriangleAlert,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { AnalysisTranscriptComponent } from './analysis-transcript.component';

/**
 * GenerationProgressComponent - Detailed generation progress with grouped items and retry
 *
 * Purpose:
 * - Track agent generation progress
 * - Show individual progress for each item
 * - Display total progress
 * - Handle partial failures with retry per item
 *
 * Features:
 * - Overall progress bar at top with percentage
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
    <div class="container mx-auto px-3 py-4">
      <div class="max-w-6xl mx-auto">
        <div class="mb-4">
          <h2 class="text-lg font-bold mb-2">Generating Your Configuration</h2>
          <p class="text-base-content/70">Creating customized agent files...</p>
        </div>

        <!-- Empty/initializing state (full-width, no grid) -->
        @if (totalCount() === 0) { @if (hasCompletedWithError()) {
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
        } } @else {

        <!-- Two-column grid layout -->
        <div class="grid grid-cols-5 gap-4">
          <!-- LEFT COLUMN: Agent Activity Log (60%) -->
          <div class="col-span-3">
            <div class="bg-base-200 rounded-box p-4">
              <div
                class="text-sm font-medium uppercase mb-3 flex items-center gap-2"
              >
                Agent Activity Log @if (hasStreamMessages()) {
                <span class="badge badge-sm">{{ streamMessageCount() }}</span>
                }
              </div>
              <div class="max-h-[70vh] overflow-y-auto">
                <ptah-analysis-transcript [messages]="generationStream()" />
              </div>
            </div>
          </div>

          <!-- RIGHT COLUMN: Progress + Item Status (40%, sticky) -->
          <div
            class="col-span-2 sticky top-0 self-start max-h-screen overflow-y-auto"
          >
            <div class="space-y-3">
              <!-- Overall Progress Card -->
              <div class="card bg-base-200 shadow-xl">
                <div class="card-body">
                  <div class="flex justify-between items-center mb-2">
                    <span class="text-lg font-semibold">Overall Progress</span>
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
                  <div
                    class="flex justify-between text-sm text-base-content/60 mt-2"
                  >
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

              <!-- Agents Section -->
              @if (agentItems().length > 0) {
              <div>
                <h3
                  class="text-sm font-medium uppercase mb-3 flex items-center gap-2"
                >
                  <span class="badge badge-primary badge-lg">🤖</span>
                  Agent Files
                  <span class="text-sm text-base-content/60 font-normal">
                    ({{ getCompletedCountByType('agent') }}/{{
                      agentItems().length
                    }})
                  </span>
                </h3>
                <div class="space-y-2">
                  @for (item of agentItems(); track item.id) {
                  <div
                    class="card card-compact bg-base-100 shadow-md"
                    [class.border-error]="item.status === 'error'"
                    [class.border-l-4]="item.status === 'error'"
                  >
                    <div class="card-body">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3 flex-1 min-w-0">
                          @switch (item.status) { @case ('pending') {
                          <div class="badge badge-outline badge-sm">
                            Pending
                          </div>
                          } @case ('in-progress') {
                          <span
                            class="loading loading-spinner loading-sm text-primary"
                          ></span>
                          } @case ('complete') {
                          <lucide-angular
                            [img]="CircleCheckIcon"
                            class="h-4 w-4 text-success"
                            aria-hidden="true"
                          />
                          } @case ('error') {
                          <lucide-angular
                            [img]="CircleAlertIcon"
                            class="h-4 w-4 text-error"
                            aria-hidden="true"
                          />
                          } }
                          <div class="flex-1 min-w-0">
                            <div
                              class="font-semibold truncate"
                              [title]="item.name"
                            >
                              {{ item.name }}
                            </div>
                            @if (item.status === 'in-progress' && item.progress
                            !== undefined) {
                            <div class="flex items-center gap-2 mt-1">
                              <progress
                                class="progress progress-primary w-24 h-1"
                                [value]="item.progress"
                                max="100"
                              ></progress>
                              <span class="text-xs text-base-content/60"
                                >{{ item.progress }}%</span
                              >
                            </div>
                            } @if (item.status === 'error' && item.errorMessage)
                            {
                            <p class="text-sm text-error mt-1">
                              {{ item.errorMessage }}
                            </p>
                            }
                          </div>
                        </div>
                        @if (item.status === 'error') { @if (canRetry(item.id))
                        {
                        <button
                          class="btn btn-error btn-xs"
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
                            class="h-3 w-3"
                            aria-hidden="true"
                          />
                          Retry
                        </button>
                        } @else {
                        <span class="text-error text-xs font-medium"
                          >Max retries</span
                        >
                        } }
                      </div>
                    </div>
                  </div>
                  }
                </div>
              </div>
              }
            </div>
          </div>
        </div>
        <!-- End two-column grid -->

        <!-- Completion section (full-width below grid) -->
        @if (isFullyComplete()) {
        <div
          class="alert mt-4 mb-6"
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
            Continue to Enhance
          </button>
        </div>
        } }
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
   * Whether all agent items are complete (success or error).
   */
  protected readonly isAgentGenerationComplete = computed(() => {
    return this.wizardState.isGenerationComplete();
  });

  /**
   * Whether generation is fully complete.
   * The "Continue to Enhance" button only appears when this is true.
   * Enhanced Prompts generation runs in the subsequent Enhance step.
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

  // Auto-transition handled by SetupWizardStateService.handleGenerationComplete()
  // to avoid duplicate navigation to 'enhance' step.

  /**
   * Get completed count for a specific item type.
   */
  protected getCompletedCountByType(type: 'agent'): number {
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
   * Continue to enhance step.
   */
  protected onContinue(): void {
    this.wizardState.setCurrentStep('enhance');
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
