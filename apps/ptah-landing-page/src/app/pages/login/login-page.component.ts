import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * LoginPageComponent - Magic link passwordless authentication
 *
 * Angular 21 patterns:
 * - signal() for state management
 * - computed() for derived state
 * - inject() for DI
 * - Tailwind/DaisyUI for styling
 *
 * Backend API: POST /auth/magic-link
 * Evidence: implementation-plan.md Phase 3 - Login Page
 */
@Component({
  selector: 'ptah-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ViewportAnimationDirective],
  template: `
    <div
      class="relative min-h-screen flex items-center justify-center bg-base-100 p-6"
    >
      <!-- Radial Gradient Background -->
      <div
        class="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(212,175,55,0.1)_0%,transparent_70%)] pointer-events-none"
        aria-hidden="true"
      ></div>

      <!-- Login Card -->
      <div
        viewportAnimation
        [viewportConfig]="cardConfig"
        class="relative z-10 w-full max-w-md bg-base-200/90 backdrop-blur-3xl 
               border border-secondary/20 rounded-3xl p-10 shadow-2xl"
      >
        <!-- Logo -->
        <div class="flex justify-center mb-8">
          <svg
            class="w-20 h-20 text-secondary animate-glow-pulse"
            viewBox="0 0 100 100"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="50"
              cy="50"
              r="45"
              stroke="currentColor"
              stroke-width="3"
            />
            <path
              d="M50 20 L50 80 M35 35 L65 35 M35 65 L65 65"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
            />
          </svg>
        </div>

        <!-- Title -->
        <h1
          class="font-display text-3xl font-bold text-center mb-2 
                 bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent"
        >
          Welcome to Ptah
        </h1>
        <p class="text-center text-neutral-content mb-8">
          Sign in with your email
        </p>

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

        <!-- Email Form -->
        <form (ngSubmit)="handleMagicLink()" class="space-y-6">
          <div class="form-control">
            <label class="label" for="email">
              <span class="label-text text-neutral-content">Email Address</span>
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
            class="btn btn-secondary w-full"
          >
            @if (isLoading()) {
            <span class="loading loading-spinner loading-sm"></span>
            Sending... } @else { Send Magic Link }
          </button>
        </form>

        <!-- Info Text -->
        <p class="text-center text-neutral-content/60 text-sm mt-6">
          We'll send you a secure login link to your email. Click it to sign in
          instantly.
        </p>
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
  private readonly http = inject(HttpClient);

  // State signals
  public readonly emailValue = signal('');
  public readonly isLoading = signal(false);
  public readonly successMessage = signal('');
  public readonly errorMessage = signal('');

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
}
