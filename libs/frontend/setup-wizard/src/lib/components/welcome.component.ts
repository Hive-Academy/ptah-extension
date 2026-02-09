import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

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
  imports: [],
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

          <button
            class="btn btn-primary btn-lg"
            aria-label="Start wizard setup"
            (click)="onStartSetup()"
          >
            Start Setup
          </button>
        </div>
      </div>
    </div>
  `,
})
export class WelcomeComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  /**
   * Handle "Start Setup" button click.
   * Transitions directly to scan step — no RPC needed since the wizard webview already exists.
   * The ScanProgressComponent will initiate the actual deep analysis on mount.
   */
  protected onStartSetup(): void {
    this.wizardState.setCurrentStep('scan');
  }
}
