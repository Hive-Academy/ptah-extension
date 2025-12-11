import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

/**
 * GenerationProgressComponent - Per-agent generation progress display
 *
 * Purpose:
 * - Show overall generation progress
 * - Display per-agent progress cards
 * - Real-time updates via signal reactivity
 * - Visual status indicators (pending/in-progress/complete)
 *
 * Features:
 * - Overall progress bar at top
 * - Per-agent progress cards with status badges
 * - Loading spinner for in-progress agents
 * - Checkmark for completed agents
 * - Duration display for completed agents
 * - Customization summary preview
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
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-4 py-8">
      <div class="max-w-4xl mx-auto">
        <div class="mb-6">
          <h2 class="text-3xl font-bold mb-2">Generating Your Agents</h2>
          <p class="text-base-content/70">
            Analyzing your codebase and customizing agent configurations...
          </p>
        </div>

        <!-- Overall progress bar -->
        @if (progress()) {
        <div class="mb-8">
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm font-semibold text-base-content/80">
              Overall Progress
            </span>
            <span class="text-sm text-base-content/60">
              {{ progress()!.percentComplete }}%
            </span>
          </div>
          <progress
            class="progress progress-primary w-full"
            [value]="progress()!.percentComplete"
            max="100"
          ></progress>
        </div>

        <!-- Phase indicator -->
        <div class="alert mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-info shrink-0 w-6 h-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <span>
            <span class="font-semibold">Current Phase:</span>
            {{ phaseLabel() }}
          </span>
        </div>

        <!-- Per-agent progress cards -->
        <div class="space-y-4">
          @for (agentProgress of agentProgressList(); track agentProgress.id) {
          <div class="card card-compact bg-base-100 shadow-md">
            <div class="card-body">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <!-- Status indicator -->
                  @if (agentProgress.status === 'pending') {
                  <div class="badge badge-outline badge-sm">Pending</div>
                  } @else if (agentProgress.status === 'in-progress') {
                  <span class="loading loading-spinner loading-sm"></span>
                  } @else if (agentProgress.status === 'complete') {
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
                  }

                  <!-- Agent name -->
                  <div>
                    <h3 class="font-semibold">{{ agentProgress.name }}</h3>
                    @if (agentProgress.currentTask) {
                    <p class="text-sm text-base-content/60">
                      {{ agentProgress.currentTask }}
                    </p>
                    }
                  </div>
                </div>

                <!-- Duration (if complete) -->
                @if (agentProgress.status === 'complete' &&
                agentProgress.duration) {
                <span class="badge badge-accent badge-sm">
                  {{ formatDuration(agentProgress.duration) }}
                </span>
                }
              </div>

              <!-- Customization summary (if available) -->
              @if (agentProgress.customizationSummary) {
              <div class="mt-3 p-3 bg-base-200 rounded-lg">
                <p class="text-sm text-base-content/70">
                  {{ agentProgress.customizationSummary }}
                </p>
              </div>
              }
            </div>
          </div>
          }
        </div>
        }
      </div>
    </div>
  `,
})
export class GenerationProgressComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  // Reactive state from wizard state service
  protected readonly progress = this.wizardState.generationProgress;

  // Computed signals for UI display
  protected readonly agentProgressList = computed(
    () => this.progress()?.agents ?? []
  );

  protected readonly phaseLabel = computed(() => {
    const phase = this.progress()?.phase;
    switch (phase) {
      case 'analysis':
        return 'Analyzing workspace structure';
      case 'selection':
        return 'Selecting agent templates';
      case 'customization':
        return 'Customizing agent configurations';
      case 'rendering':
        return 'Rendering agent files';
      case 'complete':
        return 'Generation complete';
      default:
        return 'Initializing...';
    }
  });

  /**
   * Format duration from milliseconds to human-readable string
   */
  protected formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
}
