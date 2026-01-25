import { Component, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { LucideAngularModule, Github, Mail, Check } from 'lucide-angular';

/**
 * SignupPageComponent - User registration page
 *
 * All signup flows go through WorkOS AuthKit which handles:
 * - GitHub OAuth signup
 * - Google OAuth signup
 * - Email + Password signup
 *
 * WorkOS automatically detects new vs existing users.
 *
 * Angular 21 patterns:
 * - signal() for state management
 * - computed() for derived state
 * - inject() for DI
 * - Tailwind/DaisyUI for styling
 */
@Component({
  selector: 'ptah-signup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ViewportAnimationDirective, RouterLink, LucideAngularModule],
  template: `
    <div
      class="relative min-h-screen flex items-center justify-center p-6"
      [style.backgroundImage]="'url(/assets/backgrounds/temple-bg.png)'"
      style="background-size: cover; background-position: center; background-repeat: no-repeat;"
    >
      <!-- Dark Overlay -->
      <div
        class="absolute inset-0 bg-black/70 pointer-events-none"
        aria-hidden="true"
      ></div>

      <!-- Signup Card -->
      <div
        viewportAnimation
        [viewportConfig]="cardConfig"
        class="relative z-10 w-full max-w-md bg-base-200/95 backdrop-blur-xl
               border border-secondary/30 rounded-3xl p-10 shadow-2xl"
      >
        <!-- Logo -->
        <div class="flex justify-center mb-6">
          <img
            src="/assets/icons/ptah-logo.svg"
            alt="Ptah Logo"
            class="w-16 h-16 text-secondary animate-glow-pulse"
            aria-hidden="true"
          />
        </div>

        <!-- Title -->
        <h1
          class="font-display text-3xl font-bold text-center mb-2
                 bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
        >
          Join Ptah
        </h1>
        <p class="text-center text-neutral-content/80 mb-8">
          Create your account to get started
        </p>

        <!-- Social Signup Section -->
        <div class="space-y-3 mb-6">
          <!-- Continue with GitHub -->
          <button
            type="button"
            (click)="signupWithWorkOS()"
            class="btn btn-outline w-full gap-3 border-neutral-content/20 hover:border-secondary/60 hover:bg-secondary/10"
          >
            <lucide-angular
              [img]="GithubIcon"
              class="w-5 h-5"
              aria-hidden="true"
            />
            Sign up with GitHub
          </button>

          <!-- Continue with Google -->
          <button
            type="button"
            (click)="signupWithWorkOS()"
            class="btn btn-outline w-full gap-3 border-neutral-content/20 hover:border-secondary/60 hover:bg-secondary/10"
          >
            <img
              src="/assets/icons/google-logo.svg"
              alt="Google"
              class="w-5 h-5"
              aria-hidden="true"
            />
            Sign up with Google
          </button>

          <!-- Continue with Email (WorkOS) -->
          <button
            type="button"
            (click)="signupWithWorkOS()"
            class="btn btn-secondary w-full gap-3"
          >
            <lucide-angular
              [img]="MailIcon"
              class="w-5 h-5"
              aria-hidden="true"
            />
            Sign up with Email
          </button>
        </div>

        <!-- Features List -->
        <div class="bg-base-300/50 rounded-xl p-4 mb-6">
          <p class="text-neutral-content/70 text-sm font-medium mb-3">
            What you'll get:
          </p>
          <ul class="space-y-2 text-sm text-neutral-content/60">
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="CheckIcon"
                class="w-4 h-4 text-secondary"
                aria-hidden="true"
              />
              Access to Ptah Extension features
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="CheckIcon"
                class="w-4 h-4 text-secondary"
                aria-hidden="true"
              />
              License management dashboard
            </li>
            <li class="flex items-center gap-2">
              <lucide-angular
                [img]="CheckIcon"
                class="w-4 h-4 text-secondary"
                aria-hidden="true"
              />
              Priority support
            </li>
          </ul>
        </div>

        <!-- Terms -->
        <p class="text-center text-neutral-content/50 text-xs">
          By signing up, you agree to our
          <a href="/terms" class="text-secondary hover:underline"
            >Terms of Service</a
          >
          and
          <a href="/privacy" class="text-secondary hover:underline"
            >Privacy Policy</a
          >.
        </p>

        <!-- Sign In Link -->
        <div class="text-center mt-6 pt-6 border-t border-neutral-content/10">
          <p class="text-neutral-content/60 text-sm">
            Already have an account?
            <a
              routerLink="/login"
              class="text-secondary hover:text-secondary/80 font-medium"
              >Sign in</a
            >
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class SignupPageComponent {
  /** Lucide icon references */
  readonly GithubIcon = Github;
  readonly MailIcon = Mail;
  readonly CheckIcon = Check;

  // Animation config
  public readonly cardConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.6,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /**
   * Redirect to WorkOS AuthKit for OAuth signup
   * WorkOS handles: GitHub, Google, Email+Password
   * It automatically detects new users and shows signup flow
   */
  public signupWithWorkOS(): void {
    // Redirect to backend which will redirect to WorkOS AuthKit
    // WorkOS AuthKit handles both login and signup automatically
    window.location.href = '/auth/login';
  }
}
