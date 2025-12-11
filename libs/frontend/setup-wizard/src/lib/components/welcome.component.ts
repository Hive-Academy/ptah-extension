import {
  Component,
  inject,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

/**
 * WelcomeComponent - Setup wizard hero screen
 *
 * Purpose:
 * - Welcome users to the setup wizard
 * - Explain what the wizard will do
 * - Provide time estimate
 * - Start the setup process with RPC trigger
 *
 * Features:
 * - DaisyUI hero layout with centered content
 * - Clear call-to-action button
 * - Loading state during RPC call
 * - Error handling with user feedback
 *
 * Usage:
 * ```html
 * <ptah-welcome />
 * ```
 */
@Component({
  selector: 'ptah-welcome',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hero min-h-screen bg-base-200">
      <div class="hero-content text-center">
        <div class="max-w-2xl">
          <h1 class="text-5xl font-bold mb-6">
            Let's Personalize Your Ptah Experience
          </h1>
          <p class="text-lg text-base-content/80 mb-4">
            We'll analyze your project structure, detect your tech stack, and
            generate intelligent agents tailored specifically to your codebase.
          </p>
          <p class="text-base text-base-content/60 mb-8">
            <span class="font-semibold">Estimated time:</span> 2-4 minutes
          </p>

          @if (errorMessage()) {
          <div class="alert alert-error mb-6 max-w-md mx-auto">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
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
            <span>{{ errorMessage() }}</span>
          </div>
          }

          <button
            class="btn btn-primary btn-lg"
            [class.btn-disabled]="isStarting()"
            [disabled]="isStarting()"
            (click)="onStartSetup()"
          >
            @if (isStarting()) {
            <span class="loading loading-spinner"></span>
            Starting... } @else { Start Setup }
          </button>
        </div>
      </div>
    </div>
  `,
})
export class WelcomeComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  // Component-local loading state (not in global state)
  protected readonly isStarting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /**
   * Handle "Start Setup" button click
   * - Trigger RPC call to start wizard
   * - Transition to 'scan' step on success
   * - Show error message on failure
   */
  protected async onStartSetup(): Promise<void> {
    if (this.isStarting()) {
      return; // Prevent double-click
    }

    this.isStarting.set(true);
    this.errorMessage.set(null);

    try {
      // Trigger RPC to start setup wizard
      await this.wizardRpc.startSetupWizard();

      // Transition to scan step
      this.wizardState.setCurrentStep('scan');
    } catch (error) {
      // Handle RPC error (timeout, backend failure, etc.)
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to start setup wizard. Please try again.';
      this.errorMessage.set(message);
    } finally {
      this.isStarting.set(false);
    }
  }
}
