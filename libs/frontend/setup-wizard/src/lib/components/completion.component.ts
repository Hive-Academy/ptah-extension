import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
} from '@angular/core';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

/**
 * CompletionComponent - Success screen with generation summary
 *
 * Purpose:
 * - Celebrate successful agent generation
 * - Display generation summary statistics
 * - Provide next steps and action buttons
 * - Guide users to start using their new agents
 *
 * Features:
 * - Hero success layout with checkmark icon
 * - Generation summary card (agents, time, location)
 * - Action buttons (Open Agents Folder, Start New Chat)
 * - Useful tips section
 * - Signal-based reactive statistics
 *
 * Usage:
 * ```html
 * <ptah-completion />
 * ```
 */
@Component({
  selector: 'ptah-completion',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hero min-h-screen bg-base-200">
      <div class="hero-content text-center">
        <div class="max-w-3xl">
          <!-- Success icon -->
          <div class="flex justify-center mb-6">
            <div class="rounded-full bg-success/20 p-6">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-24 w-24 text-success"
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
            </div>
          </div>

          <h1 class="text-5xl font-bold mb-6">Setup Complete!</h1>
          <p class="text-lg text-base-content/80 mb-8">
            Your personalized agents have been generated and are ready to use.
          </p>

          <!-- Generation summary card -->
          <div class="card bg-base-100 shadow-xl mb-8">
            <div class="card-body">
              <h2 class="card-title justify-center mb-4">Generation Summary</h2>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <!-- Total agents -->
                <div class="stat p-4">
                  <div class="stat-title">Agents Generated</div>
                  <div class="stat-value text-primary">
                    {{ totalAgentsGenerated() }}
                  </div>
                </div>

                <!-- Total time -->
                <div class="stat p-4">
                  <div class="stat-title">Total Time</div>
                  <div class="stat-value text-accent">
                    {{ formatTotalTime() }}
                  </div>
                </div>

                <!-- File location -->
                <div class="stat p-4">
                  <div class="stat-title">Location</div>
                  <div class="stat-value text-sm">.claude/agents/</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="flex flex-col sm:flex-row gap-4 justify-center mb-8">
            <button
              class="btn btn-primary btn-lg"
              (click)="onOpenAgentsFolder()"
            >
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
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              Open Agents Folder
            </button>
            <button class="btn btn-ghost btn-lg" (click)="onStartNewChat()">
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
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
              Start New Chat
            </button>
          </div>

          <!-- Useful tips -->
          <div class="alert alert-info max-w-2xl mx-auto">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              class="stroke-current shrink-0 w-6 h-6"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              ></path>
            </svg>
            <div class="text-left">
              <h3 class="font-bold mb-1">Tip: Using Your Agents</h3>
              <p class="text-sm">
                Your agents are now available in the chat interface. Use
                <code class="bg-base-300 px-1 py-0.5 rounded">@agent-name</code>
                to invoke specific agents, or start chatting and Ptah will
                automatically select the most relevant agent for your task.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class CompletionComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly vscodeService = inject(VSCodeService);

  // Reactive state from wizard state service
  protected readonly progress = this.wizardState.generationProgress;

  // Computed signals for summary statistics
  protected readonly totalAgentsGenerated = computed(() => {
    const agents = this.progress()?.agents ?? [];
    return agents.filter((a) => a.status === 'complete').length;
  });

  protected readonly totalDuration = computed(() => {
    const agents = this.progress()?.agents ?? [];
    return agents.reduce((total, agent) => total + (agent.duration ?? 0), 0);
  });

  /**
   * Format total generation time
   * Handles negative values gracefully (edge case: timing errors)
   */
  protected formatTotalTime(): string {
    const ms = this.totalDuration();
    // Ensure non-negative duration
    const safeMs = Math.max(0, ms);
    const seconds = Math.floor(safeMs / 1000);

    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
      return `${minutes}m ${remainingSeconds}s`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  /**
   * Open agents folder in VS Code explorer
   */
  protected onOpenAgentsFolder(): void {
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.SETUP_WIZARD_OPEN_AGENTS_FOLDER,
    });
  }

  /**
   * Navigate to chat view and close wizard
   */
  protected onStartNewChat(): void {
    this.vscodeService.postMessage({
      type: MESSAGE_TYPES.SETUP_WIZARD_START_CHAT,
    });
  }
}
