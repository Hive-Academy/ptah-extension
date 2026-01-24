/**
 * Premium Upsell Component - Displays premium feature benefits and upgrade CTA.
 *
 * **Responsibilities**:
 * - Display list of premium features with icons
 * - Show "Upgrade to Premium" call-to-action button
 * - Handle retry when license check fails due to network error
 * - Open upgrade link in external browser
 *
 * **Usage**:
 * ```html
 * <ptah-premium-upsell
 *   [features]="['Feature 1', 'Feature 2']"
 *   [errorMessage]="errorMsg"
 *   (retry)="onRetry()"
 * />
 * ```
 *
 * @see WizardViewComponent
 */

import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  inject,
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';

@Component({
  selector: 'ptah-premium-upsell',
  template: `
    <div class="hero min-h-screen bg-base-200">
      <div class="hero-content text-center">
        <div class="max-w-2xl">
          <!-- Premium badge -->
          <div class="badge badge-primary badge-lg gap-2 mb-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
              />
            </svg>
            Premium Feature
          </div>

          <!-- Title -->
          <h1 class="text-4xl font-bold mb-4">
            Unlock Intelligent Agent Setup
          </h1>

          <!-- Description -->
          <p class="text-lg text-base-content/70 mb-8">
            The Setup Wizard is a premium feature that provides deep project
            analysis, intelligent agent recommendations, and customized rule
            generation tailored to your codebase.
          </p>

          <!-- Error message with retry -->
          @if (errorMessage()) {
          <div class="alert alert-warning mb-6 max-w-md mx-auto">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div class="text-left">
              <span>{{ errorMessage() }}</span>
              <button
                class="btn btn-sm btn-ghost ml-2"
                (click)="onRetry()"
                aria-label="Retry license verification"
              >
                Retry
              </button>
            </div>
          </div>
          }

          <!-- Feature card -->
          <div class="card bg-base-100 shadow-xl mb-8">
            <div class="card-body">
              <h2 class="card-title justify-center mb-4">
                Premium Features Include:
              </h2>

              <!-- Features list -->
              <ul class="space-y-3 text-left">
                @for (feature of features(); track feature) {
                <li class="flex items-start gap-3">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-6 w-6 text-success shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span class="text-base-content">{{ feature }}</span>
                </li>
                }
              </ul>
            </div>
          </div>

          <!-- CTA button -->
          <button
            class="btn btn-primary btn-lg gap-2"
            (click)="onUpgradeClick()"
            aria-label="Upgrade to Premium"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
            Upgrade to Premium
          </button>

          <!-- Additional info -->
          <p class="text-sm text-base-content/50 mt-6">
            Already have a premium license?
            <button
              class="link link-primary"
              (click)="onRetry()"
              aria-label="Re-verify license"
            >
              Re-verify your license
            </button>
          </p>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PremiumUpsellComponent {
  private readonly vscodeService = inject(VSCodeService);

  /**
   * List of premium features to display
   */
  readonly features = input<string[]>([]);

  /**
   * Error message to display (from network error during license check)
   */
  readonly errorMessage = input<string | null>(null);

  /**
   * Event emitted when user clicks retry button
   */
  readonly retry = output<void>();

  /**
   * Handle retry button click
   */
  protected onRetry(): void {
    this.retry.emit();
  }

  /**
   * Handle upgrade button click
   * Opens the upgrade page in an external browser
   */
  protected onUpgradeClick(): void {
    // Send message to extension to open upgrade URL in external browser
    this.vscodeService.postMessage({
      type: 'command',
      payload: {
        command: 'vscode.open',
        args: ['https://ptah.dev/pricing'],
      },
    });
  }
}
