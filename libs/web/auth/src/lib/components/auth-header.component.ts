import { NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { ViewportAnimationDirective } from '@hive-academy/angular-gsap';
import {
  LOGO_ANIMATION,
  TABS_ANIMATION,
  TITLE_ANIMATION,
} from '../config/auth-animation.configs';
import { AuthMode } from '../models/auth.types';

/**
 * AuthHeaderComponent - Logo, title, and mode tabs
 *
 * Displays:
 * - Ptah logo with link to home
 * - Dynamic title based on mode
 * - Sign In / Sign Up tab switcher
 */
@Component({
  selector: 'ptah-auth-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [RouterLink, NgOptimizedImage, ViewportAnimationDirective],
  template: `
    <!-- Logo -->
    <a
      routerLink="/"
      viewportAnimation
      [viewportConfig]="logoConfig"
      class="flex items-center gap-3 mb-8 "
    >
      <img
        ngSrc="/assets/icons/ptah-icon.png"
        alt="Ptah Extension Logo"
        width="128"
        height="128"
        class="w-32 h-32 transition-transform duration-300 "
      />
    </a>

    <!-- Title -->
    <div viewportAnimation [viewportConfig]="titleConfig" class="mb-8">
      <h1
        class="font-display text-3xl lg:text-4xl font-bold text-white mb-2 transition-all duration-500"
        [class.translate-y-0]="!isTransitioning()"
        [class.opacity-100]="!isTransitioning()"
      >
        {{ mode() === 'signin' ? 'Welcome Back' : 'Get Started' }}
      </h1>
      <p class="text-neutral-content/70 transition-all duration-500">
        {{
          mode() === 'signin'
            ? 'Sign in to access your dashboard'
            : 'Create your account to get started'
        }}
      </p>
    </div>

    <!-- Tab Switcher -->
    <div
      viewportAnimation
      [viewportConfig]="tabsConfig"
      class="flex mb-8 bg-base-300/50 rounded-xl p-1 relative"
    >
      <!-- Animated tab indicator -->
      <div
        class="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-base-100 rounded-lg shadow-lg transition-transform duration-300 ease-out"
        [class.translate-x-0]="mode() === 'signin'"
        [class.translate-x-full]="mode() === 'signup'"
      ></div>

      <button
        type="button"
        (click)="modeChange.emit('signin')"
        class="flex-1 py-3 px-6 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
        [class.text-white]="mode() === 'signin'"
        [class.text-neutral-content]="mode() !== 'signin'"
        [class.opacity-60]="mode() !== 'signin'"
      >
        Sign In
      </button>
      <button
        type="button"
        (click)="modeChange.emit('signup')"
        class="flex-1 py-3 px-6 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
        [class.text-white]="mode() === 'signup'"
        [class.text-neutral-content]="mode() !== 'signup'"
        [class.opacity-60]="mode() !== 'signup'"
      >
        Sign Up
      </button>
    </div>
  `,
})
export class AuthHeaderComponent {
  /** Animation configurations */
  public readonly logoConfig = LOGO_ANIMATION;
  public readonly titleConfig = TITLE_ANIMATION;
  public readonly tabsConfig = TABS_ANIMATION;

  /** Input: Current auth mode */
  public readonly mode = input.required<AuthMode>();

  /** Input: Whether transitioning between modes */
  public readonly isTransitioning = input<boolean>(false);

  /** Output: Mode change requested */
  public modeChange = output<AuthMode>();
}
