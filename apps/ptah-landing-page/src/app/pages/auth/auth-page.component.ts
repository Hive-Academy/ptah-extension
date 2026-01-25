import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgOptimizedImage } from '@angular/common';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
  ScrollAnimationDirective,
  ScrollAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  CircleAlert,
  CheckCircle,
  Mail,
  Github,
  KeyRound,
  Zap,
} from 'lucide-angular';

type AuthMode = 'signin' | 'signup';

/**
 * AuthPageComponent - Unified authentication page with split-screen layout
 *
 * Features:
 * - Split screen: Form on left, temple image on right
 * - Tab switcher for Sign In / Sign Up
 * - Email input with validation
 * - Social login buttons (GitHub, Google)
 * - Magic Link option for existing users
 * - Ptah branding with gold/amber theme
 * - Smooth GSAP animations with staggered entrance
 */
@Component({
  selector: 'ptah-auth-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ViewportAnimationDirective,
    ScrollAnimationDirective,
    RouterLink,
    NgOptimizedImage,
    LucideAngularModule,
  ],
  template: `
    <div class="min-h-screen flex bg-base-100 overflow-hidden">
      <!-- Left Side - Form -->
      <div
        class="w-full lg:w-1/2 flex flex-col justify-center px-8 lg:px-16 xl:px-24 py-12 relative"
      >
        <!-- Subtle gradient background -->
        <div
          class="absolute inset-0 bg-gradient-to-br from-base-100 via-base-100 to-secondary/5 pointer-events-none"
          aria-hidden="true"
        ></div>

        <!-- Animated glow orb -->
        <div
          class="absolute top-1/4 -left-32 w-64 h-64 bg-secondary/10 rounded-full blur-3xl animate-pulse-slow pointer-events-none"
          aria-hidden="true"
        ></div>

        <div class="relative z-10 max-w-md mx-auto w-full">
          <!-- Logo - Fade in first -->
          <a
            routerLink="/"
            viewportAnimation
            [viewportConfig]="logoConfig"
            class="flex items-center gap-3 mb-12 group"
          >
            <img
              ngSrc="/assets/icons/ptah-icon.png"
              alt="Ptah Extension Logo"
              width="40"
              height="40"
              class="w-10 h-10 transition-transform duration-300 group-hover:scale-110"
            />
            <span class="font-display font-bold text-2xl text-secondary">Ptah</span>
          </a>

          <!-- Title - Slide up -->
          <div
            viewportAnimation
            [viewportConfig]="titleConfig"
            class="mb-8"
          >
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

          <!-- Tab Switcher - Slide up with delay -->
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
              (click)="setMode('signin')"
              class="flex-1 py-3 px-6 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
              [class.text-white]="mode() === 'signin'"
              [class.text-neutral-content]="mode() !== 'signin'"
              [class.opacity-60]="mode() !== 'signin'"
            >
              Sign In
            </button>
            <button
              type="button"
              (click)="setMode('signup')"
              class="flex-1 py-3 px-6 rounded-lg text-sm font-medium transition-colors duration-200 relative z-10"
              [class.text-white]="mode() === 'signup'"
              [class.text-neutral-content]="mode() !== 'signup'"
              [class.opacity-60]="mode() !== 'signup'"
            >
              Sign Up
            </button>
          </div>

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
          <div
            class="alert alert-success mb-6 text-sm animate-fade-in"
            role="alert"
          >
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
          <div
            class="alert alert-error mb-6 text-sm animate-fade-in"
            role="alert"
          >
            <lucide-angular
              [img]="CircleAlertIcon"
              class="w-5 h-5 shrink-0"
              aria-hidden="true"
            />
            <span>{{ errorMessage() }}</span>
          </div>
          }

          <!-- Email Input - Slide up with delay -->
          <div
            viewportAnimation
            [viewportConfig]="inputConfig"
            class="mb-6"
          >
            <div
              class="relative flex items-center bg-base-300/50 border border-neutral-content/10 rounded-xl px-4 py-3
                     focus-within:border-secondary/50 focus-within:ring-2 focus-within:ring-secondary/20
                     transition-all duration-300 hover:border-neutral-content/20"
            >
              <!-- Email Icon -->
              <lucide-angular
                [img]="MailIcon"
                class="w-5 h-5 text-neutral-content/50 mr-3 shrink-0 transition-colors duration-200"
                [class.text-secondary]="emailValue()"
                aria-hidden="true"
              />

              <div class="flex-1">
                <label
                  for="email"
                  class="block text-xs mb-0.5 transition-colors duration-200"
                  [class.text-neutral-content]="!emailValue()"
                  [class.opacity-50]="!emailValue()"
                  [class.text-secondary]="emailValue()"
                  [class.opacity-70]="emailValue()"
                >
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  [(ngModel)]="emailValue"
                  [disabled]="isLoading()"
                  placeholder="your@email.com"
                  class="w-full bg-transparent text-white placeholder-neutral-content/30 outline-none text-sm"
                  autocomplete="email"
                />
              </div>

              <!-- Validation Checkmark with animation -->
              <div
                class="transition-all duration-300 transform"
                [class.scale-100]="isEmailValid()"
                [class.scale-0]="!isEmailValid()"
                [class.opacity-100]="isEmailValid()"
                [class.opacity-0]="!isEmailValid()"
              >
                <lucide-angular
                  [img]="CheckCircleIcon"
                  class="w-5 h-5 text-success shrink-0 ml-2"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>

          <!-- Continue Button - Slide up with delay -->
          <div
            viewportAnimation
            [viewportConfig]="buttonConfig"
          >
            <button
              type="button"
              (click)="handleContinue()"
              [disabled]="isLoading() || !isEmailValid()"
              class="w-full py-4 rounded-xl font-semibold text-base transition-all duration-300
                     bg-gradient-to-r from-secondary to-amber-500 text-base-100
                     hover:from-secondary/90 hover:to-amber-400 hover:shadow-lg hover:shadow-secondary/25
                     hover:scale-[1.02] active:scale-[0.98]
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:scale-100"
            >
              @if (isLoading()) {
              <span class="loading loading-spinner loading-sm mr-2"></span>
              Processing...
              } @else {
              Continue
              }
            </button>
          </div>

          <!-- Divider - Fade in -->
          <div
            viewportAnimation
            [viewportConfig]="dividerConfig"
            class="flex items-center my-8"
          >
            <div class="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-content/20 to-transparent"></div>
            <span class="px-4 text-sm text-neutral-content/50">Or Continue With</span>
            <div class="flex-1 h-px bg-gradient-to-r from-transparent via-neutral-content/20 to-transparent"></div>
          </div>

          <!-- Social Login Buttons -->
          <div class="flex justify-center gap-4 mb-8">
            <!-- GitHub -->
            <button
              viewportAnimation
              [viewportConfig]="socialBtn1Config"
              type="button"
              (click)="loginWithWorkOS()"
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
              (click)="loginWithWorkOS()"
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

            <!-- Email (WorkOS) -->
            <button
              viewportAnimation
              [viewportConfig]="socialBtn3Config"
              type="button"
              (click)="loginWithWorkOS()"
              class="w-14 h-14 rounded-full border border-neutral-content/20 bg-gradient-to-br from-secondary/20 to-amber-500/20
                     flex items-center justify-center
                     hover:border-secondary/50 hover:from-secondary/30 hover:to-amber-500/30 hover:scale-110
                     active:scale-95 transition-all duration-300
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
              aria-label="Continue with Email"
            >
              <lucide-angular
                [img]="KeyRoundIcon"
                class="w-6 h-6 text-secondary"
                aria-hidden="true"
              />
            </button>
          </div>

          <!-- Footer Text - Fade in -->
          <div
            viewportAnimation
            [viewportConfig]="footerConfig"
          >
            <p class="text-center text-neutral-content/50 text-sm leading-relaxed">
              @if (mode() === 'signin') {
              Join thousands of developers who trust Ptah to supercharge their
              Claude Code experience. Access your personalized dashboard and manage
              your licenses.
              } @else {
              Get started with Ptah Extension for VS Code. Unlock the full power of
              Claude Code with a beautiful visual interface and powerful features.
              }
            </p>

            <!-- Terms (for signup) -->
            @if (mode() === 'signup') {
            <p class="text-center text-neutral-content/40 text-xs mt-4">
              By signing up, you agree to our
              <a href="/terms" class="text-secondary hover:underline">Terms</a>
              and
              <a href="/privacy" class="text-secondary hover:underline">Privacy Policy</a>.
            </p>
            }
          </div>
        </div>
      </div>

      <!-- Right Side - Image -->
      <div
        class="hidden lg:block lg:w-1/2 relative overflow-hidden"
      >
        <!-- Temple Background with parallax -->
        <div
          scrollAnimation
          [scrollConfig]="parallaxConfig"
          class="absolute inset-0 bg-cover bg-center bg-no-repeat scale-110"
          [style.backgroundImage]="'url(/assets/backgrounds/temple-bg.png)'"
        ></div>

        <!-- Gradient Overlay -->
        <div
          class="absolute inset-0 bg-gradient-to-l from-transparent via-base-100/20 to-base-100"
          aria-hidden="true"
        ></div>

        <!-- Bottom Gradient -->
        <div
          class="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-base-100/80 to-transparent"
          aria-hidden="true"
        ></div>

        <!-- Floating particles -->
        <div class="absolute inset-0 pointer-events-none overflow-hidden">
          <div class="particle particle-1"></div>
          <div class="particle particle-2"></div>
          <div class="particle particle-3"></div>
        </div>

        <!-- Floating Card -->
        <div
          viewportAnimation
          [viewportConfig]="cardConfig"
          class="absolute bottom-16 left-8 right-8 bg-base-200/90 backdrop-blur-xl
                 border border-secondary/20 rounded-2xl p-6 shadow-2xl
                 animate-float"
        >
          <div class="flex items-start gap-4">
            <div
              class="w-12 h-12 rounded-xl bg-secondary/20 flex items-center justify-center shrink-0
                     animate-glow-pulse"
            >
              <lucide-angular
                [img]="ZapIcon"
                class="w-6 h-6 text-secondary"
                aria-hidden="true"
              />
            </div>
            <div>
              <h3 class="font-semibold text-white mb-1">Powered by Claude</h3>
              <p class="text-sm text-neutral-content/70">
                Experience AI-powered coding assistance with a beautiful visual
                interface designed for VS Code.
              </p>
            </div>
          </div>
        </div>

        <!-- Secondary floating element -->
        <div
          viewportAnimation
          [viewportConfig]="secondaryCardConfig"
          class="absolute top-24 right-8 bg-base-200/80 backdrop-blur-xl
                 border border-secondary/10 rounded-xl px-4 py-3 shadow-xl
                 animate-float-delayed"
        >
          <div class="flex items-center gap-3">
            <div class="flex -space-x-2">
              <div class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-secondary flex items-center justify-center text-xs font-bold text-base-100">
                5K+
              </div>
            </div>
            <span class="text-sm text-neutral-content/70">Active developers</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* Slow pulse animation for glow orb */
      @keyframes pulse-slow {
        0%,
        100% {
          opacity: 0.3;
          transform: scale(1);
        }
        50% {
          opacity: 0.5;
          transform: scale(1.1);
        }
      }

      .animate-pulse-slow {
        animation: pulse-slow 4s ease-in-out infinite;
      }

      /* Floating animation for cards */
      @keyframes float {
        0%,
        100% {
          transform: translateY(0px);
        }
        50% {
          transform: translateY(-10px);
        }
      }

      .animate-float {
        animation: float 6s ease-in-out infinite;
      }

      .animate-float-delayed {
        animation: float 6s ease-in-out infinite;
        animation-delay: -3s;
      }

      /* Glow pulse for icon */
      @keyframes glow-pulse {
        0%,
        100% {
          box-shadow: 0 0 20px rgba(212, 175, 55, 0.2);
        }
        50% {
          box-shadow: 0 0 30px rgba(212, 175, 55, 0.4);
        }
      }

      .animate-glow-pulse {
        animation: glow-pulse 3s ease-in-out infinite;
      }

      /* Floating particles */
      @keyframes particle-float {
        0%,
        100% {
          transform: translateY(100vh) rotate(0deg);
          opacity: 0;
        }
        10% {
          opacity: 0.6;
        }
        90% {
          opacity: 0.6;
        }
        100% {
          transform: translateY(-100px) rotate(720deg);
          opacity: 0;
        }
      }

      .particle {
        position: absolute;
        width: 6px;
        height: 6px;
        background: linear-gradient(135deg, #d4af37, #f5d97d);
        border-radius: 50%;
        opacity: 0;
      }

      .particle-1 {
        left: 20%;
        animation: particle-float 15s ease-in-out infinite;
      }

      .particle-2 {
        left: 50%;
        animation: particle-float 18s ease-in-out infinite;
        animation-delay: -5s;
      }

      .particle-3 {
        left: 80%;
        animation: particle-float 12s ease-in-out infinite;
        animation-delay: -10s;
      }

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

      /* Stagger delay for social buttons */
      .social-btn:nth-child(1) {
        animation-delay: 0s;
      }
      .social-btn:nth-child(2) {
        animation-delay: 0.1s;
      }
      .social-btn:nth-child(3) {
        animation-delay: 0.2s;
      }
    `,
  ],
})
export class AuthPageComponent implements OnInit {
  /** Lucide icon references */
  readonly CircleAlertIcon = CircleAlert;
  readonly CheckCircleIcon = CheckCircle;
  readonly MailIcon = Mail;
  readonly GithubIcon = Github;
  readonly KeyRoundIcon = KeyRound;
  readonly ZapIcon = Zap;

  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  // State signals
  public readonly emailValue = signal('');
  public readonly isLoading = signal(false);
  public readonly successMessage = signal('');
  public readonly errorMessage = signal('');
  public readonly mode = signal<AuthMode>('signin');
  public readonly isTransitioning = signal(false);

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

  // ============================================
  // ANIMATION CONFIGURATIONS
  // ============================================

  // Logo - First to appear
  public readonly logoConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.1,
    ease: 'power2.out',
    once: true,
  };

  // Title - Slide up after logo
  public readonly titleConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.7,
    delay: 0.1,
    threshold: 0.1,
    ease: 'power3.out',
    distance: 30,
    once: true,
  };

  // Tabs - Slide up with delay
  public readonly tabsConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.2,
    threshold: 0.1,
    ease: 'power2.out',
    distance: 25,
    once: true,
  };

  // Alert config
  public readonly alertConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.4,
    threshold: 0.1,
    ease: 'power2.out',
    once: true,
  };

  // Email input - Slide up with delay
  public readonly inputConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.3,
    threshold: 0.1,
    ease: 'power2.out',
    distance: 25,
    once: true,
  };

  // Continue button - Slide up with delay
  public readonly buttonConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.4,
    threshold: 0.1,
    ease: 'back.out(1.4)',
    distance: 25,
    once: true,
  };

  // Divider - Fade in
  public readonly dividerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.5,
    delay: 0.5,
    threshold: 0.1,
    ease: 'power2.out',
    once: true,
  };

  // Social buttons - Individual bounce in animations
  public readonly socialBtn1Config: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.5,
    delay: 0.5,
    threshold: 0.1,
    ease: 'back.out(1.7)',
    scale: 0.8,
    once: true,
  };

  public readonly socialBtn2Config: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.5,
    delay: 0.6,
    threshold: 0.1,
    ease: 'back.out(1.7)',
    scale: 0.8,
    once: true,
  };

  public readonly socialBtn3Config: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.5,
    delay: 0.7,
    threshold: 0.1,
    ease: 'back.out(1.7)',
    scale: 0.8,
    once: true,
  };

  // Footer text - Fade in last
  public readonly footerConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    delay: 0.7,
    threshold: 0.1,
    ease: 'power2.out',
    once: true,
  };

  // ============================================
  // RIGHT SIDE ANIMATION CONFIGS
  // ============================================

  // Parallax background
  public readonly parallaxConfig: ScrollAnimationConfig = {
    animation: 'parallax',
    speed: 0.3,
    scrub: 1.5,
  };

  // Main floating card - Bounce in
  public readonly cardConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.4,
    threshold: 0.1,
    ease: 'back.out(1.2)',
    distance: 40,
    once: true,
  };

  // Secondary card - Slide from right
  public readonly secondaryCardConfig: ViewportAnimationConfig = {
    animation: 'slideLeft',
    duration: 0.7,
    delay: 0.6,
    threshold: 0.1,
    ease: 'power3.out',
    distance: 50,
    once: true,
  };

  ngOnInit(): void {
    // Set mode based on current route
    const path = this.route.snapshot.routeConfig?.path;
    if (path === 'signup') {
      this.mode.set('signup');
    }
  }

  /**
   * Switch between signin and signup modes with smooth transition
   */
  public setMode(newMode: AuthMode): void {
    if (this.mode() === newMode) return;

    // Trigger transition state for CSS animations
    this.isTransitioning.set(true);

    setTimeout(() => {
      this.mode.set(newMode);
      this.successMessage.set('');
      this.errorMessage.set('');

      // Update URL without navigation
      const newPath = newMode === 'signup' ? '/signup' : '/login';
      this.router.navigate([newPath], { replaceUrl: true });

      // End transition
      setTimeout(() => {
        this.isTransitioning.set(false);
      }, 100);
    }, 150);
  }

  /**
   * Handle continue button - sends magic link or redirects to WorkOS
   */
  public handleContinue(): void {
    if (!this.isEmailValid()) {
      this.errorMessage.set('Please enter a valid email address');
      return;
    }

    // For now, send magic link for signin, redirect to WorkOS for signup
    if (this.mode() === 'signin') {
      this.sendMagicLink();
    } else {
      // For signup, redirect to WorkOS which handles new user creation
      this.loginWithWorkOS();
    }
  }

  /**
   * Send magic link for passwordless login
   */
  private sendMagicLink(): void {
    this.successMessage.set('');
    this.errorMessage.set('');
    this.isLoading.set(true);

    this.http.post('/auth/magic-link', { email: this.emailValue() }).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.successMessage.set(
          'Magic link sent! Check your email and click the link to sign in.'
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
   * Redirect to WorkOS AuthKit for OAuth authentication
   */
  public loginWithWorkOS(): void {
    window.location.href = '/auth/login';
  }
}
