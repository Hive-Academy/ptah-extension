import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import { LucideAngularModule, Github, KeyRound } from 'lucide-angular';
import { AuthMode } from '../models/auth.types';
import {
  SOCIAL_BTN_1_ANIMATION,
  SOCIAL_BTN_2_ANIMATION,
  SOCIAL_BTN_3_ANIMATION,
  DIVIDER_ANIMATION,
} from '../config/auth-animation.configs';

/**
 * SocialLoginButtonsComponent - OAuth and Magic Link buttons
 *
 * Handles:
 * - GitHub OAuth button
 * - Google OAuth button
 * - Magic Link button (signin only)
 * - Divider with "Or Continue With" text
 */
@Component({
  selector: 'ptah-social-login-buttons',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [ViewportAnimationDirective, LucideAngularModule],
  template: `
    <!-- Divider -->
    <div
      viewportAnimation
      [viewportConfig]="dividerConfig"
      class="flex items-center my-8"
    >
      <div
        class="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-content/20 to-transparent"
      ></div>
      <span class="px-4 text-sm text-neutral-content/50">Or Continue With</span>
      <div
        class="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-content/20 to-transparent"
      ></div>
    </div>

    <!-- Social Login Buttons -->
    <div class="flex justify-center gap-4 mb-8">
      <!-- GitHub -->
      <button
        viewportAnimation
        [viewportConfig]="socialBtn1Config"
        type="button"
        (click)="githubClick.emit()"
        class="w-14 h-14 rounded-full border border-neutral-content/20 bg-base-300/30
               flex items-center justify-center
               hover:border-secondary/50 hover:bg-base-300/50 hover:scale-110
               active:scale-95 transition-all duration-300
               focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
        aria-label="Continue with GitHub"
      >
        <lucide-angular
          [img]="GithubIcon"
          class="w-6 h-6 text-white"
          aria-hidden="true"
        />
      </button>

      <!-- Google -->
      <button
        viewportAnimation
        [viewportConfig]="socialBtn2Config"
        type="button"
        (click)="googleClick.emit()"
        class="w-14 h-14 rounded-full border border-neutral-content/20 bg-base-300/30
               flex items-center justify-center
               hover:border-secondary/50 hover:bg-base-300/50 hover:scale-110
               active:scale-95 transition-all duration-300
               focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
        aria-label="Continue with Google"
      >
        <img
          src="/assets/icons/google-logo.svg"
          alt=""
          class="w-6 h-6"
          aria-hidden="true"
        />
      </button>

      <!-- Magic Link (for signin only) -->
      @if (mode() === 'signin') {
      <button
        viewportAnimation
        [viewportConfig]="socialBtn3Config"
        type="button"
        (click)="magicLinkClick.emit()"
        [disabled]="!emailValid()"
        class="w-14 h-14 rounded-full border border-neutral-content/20 bg-gradient-to-br from-secondary/20 to-amber-500/20
                 flex items-center justify-center
                 hover:border-secondary/50 hover:from-secondary/30 hover:to-amber-500/30 hover:scale-110
                 active:scale-95 transition-all duration-300
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
        aria-label="Send Magic Link"
        title="Send passwordless login link to your email"
      >
        <lucide-angular
          [img]="KeyRoundIcon"
          class="w-6 h-6 text-secondary"
          aria-hidden="true"
        />
      </button>
      }
    </div>
  `,
})
export class SocialLoginButtonsComponent {
  /** Lucide icon references */
  public readonly GithubIcon = Github;
  public readonly KeyRoundIcon = KeyRound;

  /** Animation configurations */
  public readonly dividerConfig = DIVIDER_ANIMATION;
  public readonly socialBtn1Config = SOCIAL_BTN_1_ANIMATION;
  public readonly socialBtn2Config = SOCIAL_BTN_2_ANIMATION;
  public readonly socialBtn3Config = SOCIAL_BTN_3_ANIMATION;

  /** Input: Current auth mode */
  public readonly mode = input.required<AuthMode>();

  /** Input: Whether email is valid (for magic link button) */
  public readonly emailValid = input<boolean>(false);

  /** Output: GitHub button clicked */
  public readonly githubClick = output<void>();

  /** Output: Google button clicked */
  public readonly googleClick = output<void>();

  /** Output: Magic link button clicked */
  public readonly magicLinkClick = output<void>();
}
