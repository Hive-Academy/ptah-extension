import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import { LucideAngularModule, CircleAlert, CheckCircle } from 'lucide-angular';
import { ALERT_ANIMATION } from '../config/auth-animation.configs';

/**
 * AuthMessagesComponent - Error and success message display
 *
 * Handles:
 * - URL error messages (from redirects)
 * - Success messages (magic link sent, etc.)
 * - Error messages (validation, auth failures)
 */
@Component({
  selector: 'ptah-auth-messages',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [ViewportAnimationDirective, LucideAngularModule],
  template: `
    <!-- Error Message from URL -->
    @if (urlError()) {
    <div
      viewportAnimation
      [viewportConfig]="alertConfig"
      class="alert alert-error mb-6 text-sm"
      role="alert"
    >
      <lucide-angular
        [img]="CircleAlertIcon"
        class="w-5 h-5 shrink-0"
        aria-hidden="true"
      />
      <span>{{ urlError() }}</span>
    </div>
    }

    <!-- Success Message -->
    @if (successMessage()) {
    <div class="alert alert-success mb-6 text-sm animate-fade-in" role="alert">
      <lucide-angular
        [img]="CheckCircleIcon"
        class="w-5 h-5 shrink-0"
        aria-hidden="true"
      />
      <span>{{ successMessage() }}</span>
    </div>
    }

    <!-- Error Message -->
    @if (errorMessage()) {
    <div class="alert alert-error mb-6 text-sm animate-fade-in" role="alert">
      <lucide-angular
        [img]="CircleAlertIcon"
        class="w-5 h-5 shrink-0"
        aria-hidden="true"
      />
      <span>{{ errorMessage() }}</span>
    </div>
    }
  `,
  styles: [
    `
      /* Fade in animation for alerts */
      @keyframes fade-in {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .animate-fade-in {
        animation: fade-in 0.3s ease-out;
      }
    `,
  ],
})
export class AuthMessagesComponent {
  /** Lucide icon references */
  public readonly CircleAlertIcon = CircleAlert;
  public readonly CheckCircleIcon = CheckCircle;

  /** Animation configuration */
  public readonly alertConfig = ALERT_ANIMATION;

  /** Input: Error from URL query param */
  public readonly urlError = input<string>('');

  /** Input: Success message to display */
  public readonly successMessage = input<string>('');

  /** Input: Error message to display */
  public readonly errorMessage = input<string>('');
}
