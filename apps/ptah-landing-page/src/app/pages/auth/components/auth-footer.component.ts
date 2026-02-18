import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import { AuthMode } from '../models/auth.types';
import { FOOTER_ANIMATION } from '../config/auth-animation.configs';

/**
 * AuthFooterComponent - Footer text and terms
 *
 * Displays:
 * - Contextual footer text based on mode
 * - Terms and Privacy links (signup only)
 */
@Component({
  selector: 'ptah-auth-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [ViewportAnimationDirective],
  template: `
    <div viewportAnimation [viewportConfig]="footerConfig">
      <p class="text-center text-neutral-content/50 text-sm leading-relaxed">
        @if (mode() === 'signin') { Join thousands of developers who trust Ptah
        to supercharge their AI coding workflow. Access your personalized
        dashboard and manage your licenses. } @else { Get started with Ptah
        Extension for VS Code. Unlock the full power of AI-assisted development
        with a beautiful visual interface and powerful features. }
      </p>

      <!-- Terms (for signup) -->
      @if (mode() === 'signup') {
      <p class="text-center text-neutral-content/40 text-xs mt-4">
        By signing up, you agree to our
        <a href="/terms" class="text-secondary hover:underline">Terms</a>
        and
        <a href="/privacy" class="text-secondary hover:underline"
          >Privacy Policy</a
        >.
      </p>
      }
    </div>
  `,
})
export class AuthFooterComponent {
  /** Animation configuration */
  public readonly footerConfig = FOOTER_ANIMATION;

  /** Input: Current auth mode */
  public readonly mode = input.required<AuthMode>();
}
