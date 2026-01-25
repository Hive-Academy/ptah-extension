import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { LucideAngularModule, Github, Mail, CircleAlert } from 'lucide-angular';

/**
 * LoginPageComponent - Multi-provider authentication
 *
 * Supports:
 * - WorkOS AuthKit (GitHub, Google, Email+Password) via /auth/login
 * - Magic Link passwordless (for existing users)
 *
 * Angular 21 patterns:
 * - signal() for state management
 * - computed() for derived state
 * - inject() for DI
 * - Tailwind/DaisyUI for styling
 */
@Component({
  selector: 'ptah-login-page',
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

      <!-- Login Card -->
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
          Welcome to Ptah
        </h1>
        <p class="text-center text-neutral-content/80 mb-8">
          {{ isSignUp() ? 'Create your account' : 'Sign in to your account' }}
        </p>

        <!-- Error Message from URL -->
        @if (urlError()) {
        <div class="alert alert-error mb-6" role="alert">
          <lucide-angular
            [img]="CircleAlertIcon"
            class="w-5 h-5"
            aria-hidden="true"
          />
          <span>{{ urlError() }}</span>
        </div>
        }

        <!-- Success Message -->
        @if (successMessage()) {
        <div class="alert alert-success mb-6" role="alert">
          {{ successMessage() }}
        </div>
        }

        <!-- Error Message -->
        @if (errorMessage()) {
        <div class="alert alert-error mb-6" role="alert">
          {{ errorMessage() }}
        </div>
        }

        <!-- Social Login Section -->
        <div class="space-y-3 mb-6">
          <!-- Continue with GitHub -->
          <button
            type="button"
            (click)="loginWithWorkOS()"
            class="btn btn-outline w-full gap-3 border-neutral-content/20 hover:border-secondary/60 hover:bg-secondary/10"
          >
            <lucide-angular
              [img]="GithubIcon"
              class="w-5 h-5"
              aria-hidden="true"
            />
            Continue with GitHub
          </button>

          <!-- Continue with Google -->
          <button
            type="button"
            (click)="loginWithWorkOS()"
            class="btn btn-outline w-full gap-3 border-neutral-content/20 hover:border-secondary/60 hover:bg-secondary/10"
          >
            <img
              src="/assets/icons/google-logo.svg"
              alt="Google"
              class="w-5 h-5"
              aria-hidden="true"
            />
            Continue with Google
          </button>

          <!-- Continue with Email (WorkOS) -->
          <button
            type="button"
            (click)="loginWithWorkOS()"
            class="btn btn-secondary w-full gap-3"
          >
            <lucide-angular
              [img]="MailIcon"
              class="w-5 h-5"
              aria-hidden="true"
            />
            Continue with Email
          </button>
        </div>

        <!-- Divider -->
        <div class="divider text-neutral-content/40 text-sm my-6">
          or use magic link
        </div>

        <!-- Magic Link Form (Alternative) -->
        <form (ngSubmit)="handleMagicLink()" class="space-y-4">
          <div class="form-control">
            <label class="label" for="email">
              <span class="label-text text-neutral-content/80"
                >Email Address</span
              >
            </label>
            <input
              type="email"
              id="email"
              name="email"
              [(ngModel)]="emailValue"
              [disabled]="isLoading()"
              placeholder="your@email.com"
              class="input input-bordered w-full bg-base-300/60 border-secondary/20
                     focus:border-secondary/60 focus:ring-2 focus:ring-secondary/20"
              required
              autocomplete="email"
            />
          </div>

          <button
            type="submit"
            [disabled]="isLoading() || !isEmailValid()"
            class="btn btn-outline btn-secondary w-full"
          >
            @if (isLoading()) {
            <span class="loading loading-spinner loading-sm"></span>
            Sending... } @else { Send Magic Link }
          </button>
        </form>

        <!-- Info Text -->
        <p class="text-center text-neutral-content/50 text-xs mt-6">
          Magic links work for existing accounts. New users should use the
          buttons above.
        </p>

        <!-- Sign Up / Sign In Toggle -->
        <div class="text-center mt-6 pt-6 border-t border-neutral-content/10">
          @if (isSignUp()) {
          <p class="text-neutral-content/60 text-sm">
            Already have an account?
            <a
              routerLink="/login"
              class="text-secondary hover:text-secondary/80 font-medium"
              >Sign in</a
            >
          </p>
          } @else {
          <p class="text-neutral-content/60 text-sm">
            Don't have an account?
            <a
              routerLink="/signup"
              class="text-secondary hover:text-secondary/80 font-medium"
              >Sign up</a
            >
          </p>
          }
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
export class LoginPageComponent {
  /** Lucide icon references */
  readonly GithubIcon = Github;
  readonly MailIcon = Mail;
  readonly CircleAlertIcon = CircleAlert;

  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);

  // State signals
  public readonly emailValue = signal('');
  public readonly isLoading = signal(false);
  public readonly successMessage = signal('');
  public readonly errorMessage = signal('');
  public readonly isSignUp = signal(false);

  // URL error handling
  public readonly urlError = computed(() => {
    const error = this.route.snapshot.queryParamMap.get('error');
    if (!error) return '';

    const errorMessages: Record<string, string> = {
      token_missing: 'Magic link token is missing. Please request a new one.',
      token_expired: 'Magic link has expired. Please request a new one.',
      token_invalid: 'Invalid magic link. Please request a new one.',
      user_not_found: 'User not found. Please sign up first.',
    };

    return errorMessages[error] || 'An error occurred. Please try again.';
  });

  // Computed email validation
  public readonly isEmailValid = computed(() => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(this.emailValue());
  });

  // Animation config
  public readonly cardConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.6,
    threshold: 0.1,
    ease: 'power2.out',
  };

  /**
   * Redirect to WorkOS AuthKit for OAuth authentication
   * WorkOS handles: GitHub, Google, Email+Password, and signup
   */
  public loginWithWorkOS(): void {
    // Redirect to backend which will redirect to WorkOS AuthKit
    window.location.href = '/auth/login';
  }

  /**
   * Send magic link for passwordless login (existing users only)
   */
  public handleMagicLink(): void {
    this.successMessage.set('');
    this.errorMessage.set('');

    if (!this.isEmailValid()) {
      this.errorMessage.set('Please enter a valid email address');
      return;
    }

    this.isLoading.set(true);

    this.http.post('/auth/magic-link', { email: this.emailValue() }).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.successMessage.set(
          '✨ Magic link sent! Check your email and click the link to sign in.'
        );
        this.emailValue.set('');
      },
      error: (error) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          error.error?.message || 'Failed to send magic link. Please try again.'
        );
      },
    });
  }

  /**
   * Set signup mode based on route
   */
  public setSignUpMode(isSignUp: boolean): void {
    this.isSignUp.set(isSignUp);
  }
}
