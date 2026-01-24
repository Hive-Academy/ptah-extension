import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  OnDestroy,
} from '@angular/core';
import {
  SetupWizardStateService,
  SkillGenerationProgressItem,
} from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

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
  imports: [],
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
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-6 w-6 text-success"
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
                    } @case ('error') {
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-6 w-6 text-error"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
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
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
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
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-6 w-6 text-success"
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
                    } @case ('error') {
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-6 w-6 text-error"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
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
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
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
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-6 w-6 text-success"
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
                    } @case ('error') {
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="h-6 w-6 text-error"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
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
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
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

        <!-- Empty state -->
        @if (totalCount() === 0) {
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
        }

        <!-- Completion section -->
        @if (isComplete()) {
        <div
          class="alert mb-6"
          [class.alert-success]="failedCount() === 0"
          [class.alert-warning]="failedCount() > 0"
        >
          @if (failedCount() === 0) {
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
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <div class="font-semibold">Generation Complete!</div>
            <div class="text-sm">
              All {{ completedCount() }} items generated successfully.
            </div>
          </div>
          } @else {
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
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
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
                d="M5 13l4 4L19 7"
              />
            </svg>
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
   * Whether all items are complete (success or error).
   */
  protected readonly isComplete = computed(() => {
    return this.wizardState.isGenerationComplete();
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
