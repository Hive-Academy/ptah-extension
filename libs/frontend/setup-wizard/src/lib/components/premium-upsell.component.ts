/**
 * Premium Upsell Component - Displays Pro feature benefits and upgrade CTA.
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
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  Sparkles,
  TriangleAlert,
  CircleCheck,
  Zap,
  Info,
} from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';
import { PtahUrls } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-premium-upsell',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="hero min-h-screen bg-base-200">
      <div class="hero-content text-center">
        <div class="max-w-2xl">
          <!-- Premium badge -->
          <div class="badge badge-primary badge-lg gap-2 mb-6">
            <lucide-angular
              [img]="SparklesIcon"
              class="h-4 w-4"
              aria-hidden="true"
            />
            Pro Feature
          </div>

          <!-- Title -->
          <h1 class="text-4xl font-bold mb-4">
            Unlock Intelligent Agent Setup
          </h1>

          <!-- Description -->
          <p class="text-lg text-base-content/70 mb-8">
            The Setup Wizard is a Pro feature that provides deep project
            analysis, intelligent agent recommendations, and customized rule
            generation tailored to your codebase.
          </p>

          <!-- Error message with retry -->
          @if (errorMessage()) {
          <div class="alert alert-warning mb-6 max-w-md mx-auto">
            <lucide-angular
              [img]="TriangleAlertIcon"
              class="stroke-current shrink-0 h-6 w-6"
              aria-hidden="true"
            />
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
                Pro Features Include:
              </h2>

              <!-- Features list -->
              <ul class="space-y-3 text-left">
                @for (feature of features(); track feature) {
                <li class="flex items-start gap-3">
                  <lucide-angular
                    [img]="CircleCheckIcon"
                    class="h-6 w-6 text-success shrink-0"
                    aria-hidden="true"
                  />
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
            [disabled]="isOpeningUrl()"
            aria-label="Upgrade to Pro"
          >
            @if (isOpeningUrl()) {
            <span class="loading loading-spinner loading-sm"></span>
            Opening... } @else {
            <lucide-angular
              [img]="ZapIcon"
              class="h-5 w-5"
              aria-hidden="true"
            />
            Upgrade to Pro }
          </button>

          <!-- URL feedback message -->
          @if (urlFeedback()) {
          <div class="alert alert-info mt-4 max-w-md mx-auto">
            <lucide-angular
              [img]="InfoIcon"
              class="stroke-current shrink-0 h-6 w-6"
              aria-hidden="true"
            />
            <span>{{ urlFeedback() }}</span>
          </div>
          }

          <!-- Additional info -->
          <p class="text-sm text-base-content/50 mt-6">
            Already have a Pro license?
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

  /** Lucide icon references for template binding */
  protected readonly SparklesIcon = Sparkles;
  protected readonly TriangleAlertIcon = TriangleAlert;
  protected readonly CircleCheckIcon = CircleCheck;
  protected readonly ZapIcon = Zap;
  protected readonly InfoIcon = Info;

  /** Upgrade URL for the pricing page */
  private static readonly UPGRADE_URL = PtahUrls.PRICING_URL;

  /** Timeout before clearing loading state (assume success) */
  private static readonly LOADING_CLEAR_TIMEOUT_MS = 1000;

  /** Timeout before showing fallback message */
  private static readonly FALLBACK_MESSAGE_TIMEOUT_MS = 3000;

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
   * Loading state for URL opening
   */
  protected readonly isOpeningUrl = signal(false);

  /**
   * Feedback message for URL opening (shown if browser may be opening in background)
   */
  protected readonly urlFeedback = signal<string | null>(null);

  /**
   * Handle retry button click
   */
  protected onRetry(): void {
    this.retry.emit();
  }

  /**
   * Handle upgrade button click.
   * Opens the upgrade page in an external browser with loading feedback.
   */
  protected onUpgradeClick(): void {
    // Prevent double-click
    if (this.isOpeningUrl()) {
      return;
    }

    this.isOpeningUrl.set(true);
    this.urlFeedback.set(null);

    try {
      // Send message to extension to open upgrade URL in external browser
      this.vscodeService.postMessage({
        type: 'command',
        payload: {
          command: 'vscode.open',
          args: [PremiumUpsellComponent.UPGRADE_URL],
        },
      });

      // Set timeout for fallback message if browser is slow
      setTimeout(() => {
        if (this.isOpeningUrl()) {
          // If still loading after 3s, show fallback message
          this.isOpeningUrl.set(false);
          this.urlFeedback.set(
            `Browser may be opening in the background. If not, visit: ${PremiumUpsellComponent.UPGRADE_URL}`
          );
        }
      }, PremiumUpsellComponent.FALLBACK_MESSAGE_TIMEOUT_MS);

      // Clear loading state after short delay (assume success)
      setTimeout(() => {
        this.isOpeningUrl.set(false);
      }, PremiumUpsellComponent.LOADING_CLEAR_TIMEOUT_MS);
    } catch {
      // Handle error gracefully
      this.isOpeningUrl.set(false);
      this.urlFeedback.set(
        `Failed to open browser. Please visit: ${PremiumUpsellComponent.UPGRADE_URL}`
      );
    }
  }
}
